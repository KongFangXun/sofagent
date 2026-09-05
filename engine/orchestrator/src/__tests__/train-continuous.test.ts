// train-continuous.test.ts · v1.4.5 第二章 测试
//
// 验收标准逐条覆盖：
// - 三种触发可用（数据阈值 / 定时 @weekly / 人工 manual）
// - 增量训练复用 train-job + 数据管道（不重复实现——submitTrain 注入验证）
// - 回退保护：eval 分数低于基线 → 回滚旧权重；不低于 → 晋升
// - 飞轮数据源三源采集（worklog + decision-log + llm-calls——语料导出同源）
// - 合规闸联动（增量数据未过闸 → 本轮 skip 不留半成品）
//
// 测试纪律：submitTrain / runEval / registerArtifact / rollbackWeights 全注入
// ——零真实训练进程、零 LLM 调用（mock eval 分数）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  collectFlywheelSamples,
  flywheelToIngestRecords,
  shouldTrigger,
  runContinuousTraining,
  continuousStatePath,
  DEFAULT_TRIGGER_POLICY,
  type ContinuousDeps,
  type FlywheelSnapshot,
} from '../train/train-continuous';
import type { TrainEvalReport } from '../train/train-eval-loop';

// ── 测试基建 ──
let dataDir: string;
const ENTERPRISE = 'ent-continuous';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-continuous-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 造飞轮数据源（三源各 N 条——ts 可控） */
function seedFlywheelSources(opts: { decisions?: number; llmCalls?: number; worklog?: number; ts?: string } = {}): void {
  const { decisions = 0, llmCalls = 0, worklog = 0, ts = new Date().toISOString() } = opts;
  if (decisions > 0) {
    mkdirSync(join(dataDir, 'audit'), { recursive: true });
    const lines = Array.from({ length: decisions }, (_, i) =>
      JSON.stringify({ ts, agentId: `agent-${i}`, kind: 'TOOL_GATE', why: { text: `决策理由 ${i}：拦截越界操作` } }),
    ).join('\n') + '\n';
    writeFileSync(join(dataDir, 'audit', 'decision-log.jsonl'), lines, 'utf-8');
  }
  if (llmCalls > 0) {
    mkdirSync(join(dataDir, 'audit', 'runtime'), { recursive: true });
    const lines = Array.from({ length: llmCalls }, (_, i) =>
      JSON.stringify({ ts, model: `qwen3-8b`, stopReason: 'end_turn', rawResponse: `模型回答内容 ${i}` }),
    ).join('\n') + '\n';
    writeFileSync(join(dataDir, 'audit', 'runtime', 'llm-calls.jsonl'), lines, 'utf-8');
  }
  if (worklog > 0) {
    mkdirSync(join(dataDir, 'worklog'), { recursive: true });
    const lines = Array.from({ length: worklog }, (_, i) =>
      JSON.stringify({ ts, agentId: `agent-${i}`, nodeMs: 1000 + i }),
    ).join('\n') + '\n';
    writeFileSync(join(dataDir, 'worklog', 'entries.jsonl'), lines, 'utf-8');
  }
}

/** 假 eval 报告（mock 分数） */
function fakeEvalReport(score: number, trainJobId = 'job-ct-1'): TrainEvalReport {
  return {
    trainJobId,
    enterpriseId: ENTERPRISE,
    benchmarkId: 'bench-ct',
    evaluations: [],
    averageScore: score,
    failureRate: 0,
    decision: 'stop',
    reason: '测试 eval',
    datasetVersion: null,
    evaluatedAt: new Date().toISOString(),
  } as TrainEvalReport;
}

/** 假提交器（记录调用 + 立即完成） */
function fakeSubmitDeps(
  evalScore: number | null,
  baselineScore: number | null,
): { deps: ContinuousDeps; submitted: Array<{ dataPath: string; baseModel: string; algorithm: string }> } {
  const submitted: Array<{ dataPath: string; baseModel: string; algorithm: string }> = [];
  const deps: ContinuousDeps = {
    submitTrain: async (input) => {
      submitted.push(input);
      return {
        jobId: 'job-ct-1',
        waitForDone: Promise.resolve({ status: 'completed', outputDir: '/tmp/out' }),
      };
    },
    ...(evalScore !== null
      ? {
          runEval: async () => fakeEvalReport(evalScore),
        }
      : {}),
    ...(baselineScore !== null
      ? { baseline: fakeEvalReport(baselineScore, 'job-baseline') }
      : { baseline: null }),
    registerArtifact: async () => ({ ok: true, message: '已注册 v2' }),
    rollbackWeights: async () => ({ ok: true, message: '已回拨 v1' }),
  };
  return { deps, submitted };
}

describe('飞轮数据回流（三源采集——语料导出同源）', () => {
  it('test_collectFlywheelSamples_三源计数正确', () => {
    seedFlywheelSources({ decisions: 5, llmCalls: 3, worklog: 2 });
    const snap = collectFlywheelSamples(dataDir, null);
    expect(snap.sources['decision-log']).toBe(5);
    expect(snap.sources['llm-calls']).toBe(3);
    expect(snap.sources['worklog']).toBe(2);
    expect(snap.newSamples).toBe(10);
    expect(snap.lastTrainAt).toBeNull();
  });

  it('test_collectFlywheelSamples_since增量过滤_旧数据不计', () => {
    const old = new Date('2026-01-01T00:00:00Z').toISOString();
    seedFlywheelSources({ decisions: 4, ts: old });
    const snap = collectFlywheelSamples(dataDir, '2026-06-01T00:00:00Z');
    expect(snap.sources['decision-log']).toBe(0);
    expect(snap.newSamples).toBe(0);
  });

  it('test_collectFlywheelSamples_状态文件带lastTrainAt', () => {
    seedFlywheelSources({ decisions: 1 });
    const statePath = continuousStatePath(dataDir);
    mkdirSync(join(statePath, '..'), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ lastTrainAt: '2026-08-01T00:00:00Z' }), 'utf-8');
    const snap = collectFlywheelSamples(dataDir, null);
    expect(snap.lastTrainAt).toBe('2026-08-01T00:00:00Z');
  });

  it('test_flywheelToIngestRecords_decisionReason变instruction_llmResponse变output', () => {
    seedFlywheelSources({ decisions: 1, llmCalls: 1 });
    const { records, columns } = flywheelToIngestRecords(dataDir, null);
    expect(records.length).toBe(2);
    expect(columns).toEqual(['instruction', 'input', 'output']);
    const decision = records.find((r) => r.source === 'decision-log')!;
    expect(decision.fields.instruction).toContain('决策理由');
    const llm = records.find((r) => r.source === 'llm-calls')!;
    expect(llm.fields.output).toContain('模型回答内容');
  });
});

describe('触发判定（三模式——纯函数）', () => {
  it('test_shouldTrigger_样本达阈值_数据阈值触发', () => {
    const snap: FlywheelSnapshot = {
      collectedAt: new Date().toISOString(),
      newSamples: 60,
      sources: { 'decision-log': 60 },
      lastTrainAt: new Date().toISOString(), // 刚训过——数据红利仍优先
    };
    const d = shouldTrigger(snap, { minNewSamples: 50, maxIntervalDays: 7 });
    expect(d.fire).toBe(true);
    expect(d.trigger).toBe('data-threshold');
    expect(d.reason).toContain('60');
  });

  it('test_shouldTrigger_从未训练_定时触发', () => {
    const snap: FlywheelSnapshot = {
      collectedAt: new Date().toISOString(),
      newSamples: 3, // 远低于阈值
      sources: {},
      lastTrainAt: null,
    };
    const d = shouldTrigger(snap, DEFAULT_TRIGGER_POLICY);
    expect(d.fire).toBe(true);
    expect(d.trigger).toBe('schedule');
    expect(d.reason).toContain('从未');
  });

  it('test_shouldTrigger_距上次训练超7天_定时触发weekly口径', () => {
    const snap: FlywheelSnapshot = {
      collectedAt: new Date().toISOString(),
      newSamples: 5,
      sources: {},
      lastTrainAt: new Date(Date.now() - 8 * 86400_000).toISOString(),
    };
    const d = shouldTrigger(snap, DEFAULT_TRIGGER_POLICY);
    expect(d.fire).toBe(true);
    expect(d.trigger).toBe('schedule');
    expect(d.reason).toContain('@weekly');
  });

  it('test_shouldTrigger_样本不足且未超期_跳过并说明差距', () => {
    const snap: FlywheelSnapshot = {
      collectedAt: new Date().toISOString(),
      newSamples: 10,
      sources: { worklog: 10 },
      lastTrainAt: new Date().toISOString(), // 刚训过
    };
    const d = shouldTrigger(snap, DEFAULT_TRIGGER_POLICY);
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('10/50');
  });
});

describe('runContinuousTraining 编排主流程', () => {
  it('test_run_manual触发_无条件执行并提交训练', async () => {
    seedFlywheelSources({ decisions: 5 });
    const { deps, submitted } = fakeSubmitDeps(null, null);
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'manual',
      deps,
    });
    // manual 直通（样本 5 < 50 阈值也执行）
    expect(result.decided).toBe('train');
    expect(result.trainJobId).toBe('job-ct-1');
    expect(submitted.length).toBe(1);
    expect(submitted[0]!.baseModel).toBe('qwen3-8b');
    expect(submitted[0]!.algorithm).toBe('sft');
  });

  it('test_run_dataThreshold触发_阈值命中提交且数据管道产出训练集', async () => {
    seedFlywheelSources({ decisions: 60 }); // 超阈值
    const { deps, submitted } = fakeSubmitDeps(null, null);
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'data-threshold',
      deps,
    });
    expect(result.decided).toBe('train');
    expect(result.newDatasetVersion).toBeTruthy();
    // 提交的数据路径真实存在（buildAndPersistDataset 落盘）
    expect(existsSync(submitted[0]!.dataPath)).toBe(true);
    // 训练集内容来自飞轮样本（decision 理由进 instruction）
    const firstLine = readFileSync(submitted[0]!.dataPath, 'utf-8').split('\n')[0]!;
    expect(firstLine).toContain('决策理由');
  });

  it('test_run_schedule触发_从未训练时定时模式触发', async () => {
    seedFlywheelSources({ decisions: 2 }); // 低于阈值——但从未训练过
    const { deps } = fakeSubmitDeps(null, null);
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'schedule',
      deps,
    });
    expect(result.decided).toBe('train');
  });

  it('test_run_未达触发条件_skip并说明', async () => {
    seedFlywheelSources({ decisions: 1 });
    // 状态：刚训练过（避开「从未训练」定时触发）
    const statePath = continuousStatePath(dataDir);
    mkdirSync(join(statePath, '..'), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ lastTrainAt: new Date().toISOString() }), 'utf-8');

    const { deps, submitted } = fakeSubmitDeps(null, null);
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'data-threshold',
      deps,
    });
    expect(result.decided).toBe('skip');
    expect(result.reason).toContain('跳过');
    expect(submitted.length).toBe(0); // 没提交训练
  });

  it('test_run_训练后lastTrainAt落盘_增量口径锚点刷新', async () => {
    seedFlywheelSources({ decisions: 60 });
    const { deps } = fakeSubmitDeps(null, null);
    await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'manual',
      deps,
    });
    const state = JSON.parse(readFileSync(continuousStatePath(dataDir), 'utf-8')) as { lastTrainAt: string; lastTrainJobId: string };
    expect(state.lastTrainAt).toBeTruthy();
    expect(state.lastTrainJobId).toBe('job-ct-1');
  });
});

describe('回退保护（eval 分数 vs 基线）', () => {
  it('test_run_eval高于基线_晋升registerArtifact', async () => {
    seedFlywheelSources({ decisions: 60 });
    const registered: string[] = [];
    const rolledBack: string[] = [];
    const deps: ContinuousDeps = {
      submitTrain: async () => ({
        jobId: 'job-ct-promote',
        waitForDone: Promise.resolve({ status: 'completed' }),
      }),
      runEval: async () => fakeEvalReport(88.5, 'job-ct-promote'),
      baseline: fakeEvalReport(85, 'job-base'),
      registerArtifact: async (jobId) => {
        registered.push(jobId);
        return { ok: true, message: '注册 v2' };
      },
      rollbackWeights: async (name) => {
        rolledBack.push(name);
        return { ok: true, message: '回拨' };
      },
    };
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'manual',
      deps,
    });
    expect(result.decided).toBe('train');
    expect(result.promotion).toBe('promoted');
    expect(result.evalScore).toBeCloseTo(88.5, 1);
    expect(result.baselineScore).toBeCloseTo(85, 1);
    expect(registered).toEqual(['job-ct-promote']);
    expect(rolledBack).toEqual([]); // 没回滚
  });

  it('test_run_eval低于基线_回退旧权重不晋升', async () => {
    seedFlywheelSources({ decisions: 60 });
    const registered: string[] = [];
    const rolledBack: string[] = [];
    const deps: ContinuousDeps = {
      submitTrain: async () => ({
        jobId: 'job-ct-rollback',
        waitForDone: Promise.resolve({ status: 'completed' }),
      }),
      runEval: async () => fakeEvalReport(71.2, 'job-ct-rollback'),
      baseline: fakeEvalReport(85, 'job-base'),
      registerArtifact: async (jobId) => {
        registered.push(jobId);
        return { ok: true, message: '注册' };
      },
      rollbackWeights: async (name) => {
        rolledBack.push(name);
        return { ok: true, message: '回拨 v1' };
      },
    };
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'manual',
      deps,
    });
    expect(result.decided).toBe('train');
    expect(result.promotion).toBe('rolled-back');
    expect(result.reason).toContain('回退');
    expect(rolledBack.length).toBe(1); // 回滚被调
    expect(registered).toEqual([]); // 注册没被调
  });

  it('test_run_首轮无基线_有效eval分即晋升（锚从此建）', async () => {
    seedFlywheelSources({ decisions: 60 });
    const { deps } = fakeSubmitDeps(42, null); // 分不高但无基线
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'manual',
      deps,
    });
    expect(result.promotion).toBe('promoted');
    expect(result.reason).toContain('首轮建锚');
  });

  it('test_run_eval等于基线_晋升（不低于即过）', async () => {
    seedFlywheelSources({ decisions: 60 });
    const { deps } = fakeSubmitDeps(85.0, 85.0);
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'manual',
      deps,
    });
    expect(result.promotion).toBe('promoted'); // 「不低于基线」语义——等于过
  });
});

describe('合规闸联动（增量数据同样过闸）', () => {
  it('test_run_增量数据含严重PII_合规闸阻断本轮skip不训练', async () => {
    // decision 理由里带身份证号——增量数据过不了合规闸
    mkdirSync(join(dataDir, 'audit'), { recursive: true });
    const lines = Array.from({ length: 60 }, (_, i) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        agentId: `a-${i}`,
        kind: 'TOOL_GATE',
        why: { text: `用户 ${i} 身份证 110101199003078515 越界` },
      }),
    ).join('\n') + '\n';
    writeFileSync(join(dataDir, 'audit', 'decision-log.jsonl'), lines, 'utf-8');

    const { deps, submitted } = fakeSubmitDeps(null, null);
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'manual',
      deps,
    });
    expect(result.decided).toBe('skip');
    expect(result.reason).toContain('合规闸阻断');
    expect(submitted.length).toBe(0); // 没提交训练——不留半成品
  });
});

describe('复用验证（不重复实现）', () => {
  it('test_run_数据管道产出走dataset-builder_dataset_version台账在案', async () => {
    seedFlywheelSources({ decisions: 55, llmCalls: 5 });
    const { deps } = fakeSubmitDeps(null, null);
    const result = await runContinuousTraining({
      dataDir,
      enterpriseId: ENTERPRISE,
      baseModel: 'qwen3-8b',
      trigger: 'manual',
      deps,
    });
    expect(result.decided).toBe('train');
    // dataset_version 台账有记录（buildAndPersistDataset 复用的证据）
    const { readDatasetVersions } = await import('../train/dataset-version');
    const versions = readDatasetVersions(dataDir, ENTERPRISE);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions.some((v) => v.datasetId.startsWith('continuous-'))).toBe(true);
  });
});
