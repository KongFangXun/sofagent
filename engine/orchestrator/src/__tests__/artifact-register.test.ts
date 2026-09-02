// artifact-register.test.ts · 训练产物 → 模型注册自动衔接测试
//
// 覆盖（changelog 第三章验收对齐）：
// 1. 前置双闸：train done（状态/企业隔离）+ eval pass（decision/归属）
// 2. eval pass → 自动注册（拷贝产物 + appendVersion + registerModel + 挂载建议）
// 3. 幂等：同权重版本不重复注册（manifest 层 + registry 层）
// 4. 供应链红线：幂等命中前哈希校验（篡改即拒）
// 5. 端到端：train → eval → 注册 → 幂等再触发（闭环不动手）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { registerTrainArtifact } from '../train/artifact-register';
import type { TrainEvalReport } from '../train-eval-loop';
import {
  createTrainJob,
  transitionTrainJob,
  loadTrainJobRecord,
  type TrainJobRecord,
} from '../train/train-job';
import { manifestPath } from '../weights-manifest';
import { loadRegistry } from '../model-registry';

let dataDir: string;
let weightsDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-artreg-data-'));
  weightsDir = mkdtempSync(join(tmpdir(), 'sofagent-artreg-w-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(weightsDir, { recursive: true, force: true });
});

// ════════════════════════════════════════
// 测试基建：造一个 completed 的 train job + eval 报告
// ════════════════════════════════════════

/** 造 completed train job（含产物落盘）——返回 record */
function makeCompletedJob(
  jobId: string,
  opts?: { enterpriseId?: string; outputFiles?: string[] },
): TrainJobRecord {
  const enterpriseId = opts?.enterpriseId ?? 'battery-factory';
  const { record } = createTrainJob({
    dataDir,
    enterpriseId,
    jobId,
    dataPath: join(dataDir, 'datasets', 'cells.jsonl'),
    baseModel: 'Qwen/Qwen3-8B',
    algorithm: 'sft',
    hyperparams: { lora_r: 16 },
  });
  // 产物落盘（模拟训练框架产出）
  const outputDir = record.job.outputDir;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'adapter_model.safetensors'), `lora-weights-${jobId}-${Math.random()}`);
  writeFileSync(join(outputDir, 'adapter_config.json'), JSON.stringify({ base: 'qwen3-8b', lora_r: 16 }));
  writeFileSync(join(outputDir, 'train.log'), 'epoch 1 loss 0.32'); // 应被排除
  for (const extra of opts?.outputFiles ?? []) {
    writeFileSync(join(outputDir, extra), `extra-${Math.random()}`);
  }
  // 状态推进：queued → running → completed
  transitionTrainJob(dataDir, enterpriseId, jobId, 'running');
  transitionTrainJob(dataDir, enterpriseId, jobId, 'completed');
  return loadTrainJobRecord(dataDir, enterpriseId, jobId)!;
}

/** 造 eval 报告（decision=stop 为缺省——eval pass） */
function makeEvalReport(
  trainJobId: string,
  opts?: { decision?: 'stop' | 'continue'; averageScore?: number; benchmarkId?: string },
): TrainEvalReport {
  return {
    trainJobId,
    enterpriseId: 'battery-factory',
    benchmarkId: opts?.benchmarkId ?? 'bench-cells-v1',
    evaluations: [],
    averageScore: opts?.averageScore ?? 87.5,
    failureRate: 0,
    decision: opts?.decision ?? 'stop',
    reason: '综合分 87.5 ≥ 80 且无短板 case——达标收工，产出权重',
    datasetVersion: null,
    evaluatedAt: new Date().toISOString(),
  };
}

// ════════════════════════════════════════
// 一、前置双闸（train done + eval pass）
// ════════════════════════════════════════

describe('前置双闸', () => {
  it('train job 不存在 → rejected', () => {
    const r = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-nonexistent',
      evalReport: makeEvalReport('job-nonexistent'), weightsDir,
    });
    expect(r.ok).toBe(false);
    expect(r.action).toBe('rejected');
    expect(r.issues[0]).toContain('不存在');
  });

  it('跨企业隔离拒绝（job 属别家企业）', () => {
    makeCompletedJob('job-other', { enterpriseId: 'other-enterprise' });
    const r = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-other',
      evalReport: makeEvalReport('job-other'), weightsDir,
    });
    // 分区作用域读取找不到 →「不存在」（存在性不泄露）
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('不存在');
  });

  it('状态非 completed → rejected（train done 前置）', () => {
    createTrainJob({
      dataDir, enterpriseId: 'battery-factory', jobId: 'job-running',
      dataPath: join(dataDir, 'd.jsonl'), baseModel: 'Qwen/Qwen3-8B', algorithm: 'sft',
    });
    transitionTrainJob(dataDir, 'battery-factory', 'job-running', 'running');
    const r = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-running',
      evalReport: makeEvalReport('job-running'), weightsDir,
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('running');
  });

  it('eval decision=continue → rejected（eval pass 前置）', () => {
    makeCompletedJob('job-evalfail');
    const r = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-evalfail',
      evalReport: makeEvalReport('job-evalfail', { decision: 'continue' }), weightsDir,
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('continue');
  });

  it('eval 报告归属不一致（串档）→ rejected', () => {
    makeCompletedJob('job-a');
    makeCompletedJob('job-b');
    const r = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-a',
      evalReport: makeEvalReport('job-b'), weightsDir, // 报告属于 job-b
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('串档');
  });
});

// ════════════════════════════════════════
// 二、eval pass → 自动注册
// ════════════════════════════════════════

describe('自动注册', () => {
  it('eval pass → registered（产物拷贝 + manifest 登记 + 注册表落档 + 挂载建议）', () => {
    makeCompletedJob('job-ok');
    const r = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-ok',
      evalReport: makeEvalReport('job-ok'), weightsDir,
    });
    expect(r.ok).toBe(true);
    expect(r.action).toBe('registered');
    expect(r.versionId).toBe('v1');
    // manifest 登记（meta 三件套溯源）
    const m = JSON.parse(readFileSync(manifestPath(weightsDir), 'utf-8'));
    expect(m.versions).toHaveLength(1);
    expect(m.versions[0].meta).toEqual({
      trainJobId: 'job-ok', evalScore: 87.5, baseModel: 'Qwen/Qwen3-8B',
    });
    // 产物已拷贝（日志被排除）
    expect(existsSync(join(weightsDir, 'v1', 'adapter_model.safetensors'))).toBe(true);
    expect(existsSync(join(weightsDir, 'v1', 'train.log'))).toBe(false);
    // 注册表落档
    const reg = loadRegistry(dataDir);
    expect(reg.models['battery-factory-Qwen-Qwen3-8B'].source).toBe('local-path');
    expect(reg.models['battery-factory-Qwen-Qwen3-8B'].localWeights?.currentVersion).toBe('v1');
    // 挂载建议（人工确认点）
    expect(r.suggestion).toMatchObject({
      model: 'battery-factory-Qwen-Qwen3-8B', lane: 'pipeline',
      suggestedPercent: 20, requiresHuman: true,
    });
  });

  it('注册事件留痕（actor=artifact-register:<jobId> + comment 含 eval 分数）', () => {
    makeCompletedJob('job-evt');
    registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-evt',
      evalReport: makeEvalReport('job-evt', { averageScore: 91.2 }), weightsDir,
    });
    const reg = loadRegistry(dataDir);
    const last = reg.events[reg.events.length - 1];
    expect(last.op).toBe('register');
    expect(last.actor).toBe('artifact-register:job-evt');
    expect(last.comment).toContain('91.2');
  });

  it('产物目录缺失 → rejected', () => {
    createTrainJob({
      dataDir, enterpriseId: 'battery-factory', jobId: 'job-noout',
      dataPath: join(dataDir, 'd.jsonl'), baseModel: 'Qwen/Qwen3-8B', algorithm: 'sft',
    });
    transitionTrainJob(dataDir, 'battery-factory', 'job-noout', 'running');
    transitionTrainJob(dataDir, 'battery-factory', 'job-noout', 'completed');
    const r = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-noout',
      evalReport: makeEvalReport('job-noout'), weightsDir,
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('产物目录缺失');
  });

  it('自定义 modelName / endpoint / lane / percent 透传', () => {
    makeCompletedJob('job-custom');
    const r = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-custom',
      evalReport: makeEvalReport('job-custom'), weightsDir,
      modelName: 'cell-calib-lora', endpoint: 'http://10.0.0.5:9000',
      lane: 'executor', suggestedPercent: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.suggestion).toMatchObject({ model: 'cell-calib-lora', lane: 'executor', suggestedPercent: 50 });
    const reg = loadRegistry(dataDir);
    expect(reg.models['cell-calib-lora'].endpoint).toBe('http://10.0.0.5:9000');
  });
});

// ════════════════════════════════════════
// 三、幂等（同权重版本不重复注册）
// ════════════════════════════════════════

describe('幂等', () => {
  it('同 trainJobId 重复触发 → skipped（manifest 层 + registry 层双命中）', () => {
    makeCompletedJob('job-idem');
    const r1 = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-idem',
      evalReport: makeEvalReport('job-idem'), weightsDir,
    });
    expect(r1.action).toBe('registered');
    // 第二次触发（如 webhook 重放）——产物不变
    const r2 = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-idem',
      evalReport: makeEvalReport('job-idem'), weightsDir,
    });
    expect(r2.ok).toBe(true);
    expect(r2.action).toBe('skipped');
    expect(r2.versionId).toBe('v1');
    // manifest 不重复登记
    const m = JSON.parse(readFileSync(manifestPath(weightsDir), 'utf-8'));
    expect(m.versions).toHaveLength(1);
    // 注册表事件链不增长（幂等的审计意义）
    const reg = loadRegistry(dataDir);
    expect(reg.events.filter((e) => e.op === 'register').length).toBe(1);
  });

  it('不同 trainJobId（第二次训练）→ 新版本 v2 + 再注册（meta.evalScore 更新）', () => {
    makeCompletedJob('job-t1');
    registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-t1',
      evalReport: makeEvalReport('job-t1', { averageScore: 85 }), weightsDir,
    });
    makeCompletedJob('job-t2');
    const r2 = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-t2',
      evalReport: makeEvalReport('job-t2', { averageScore: 92.3 }), weightsDir,
    });
    expect(r2.action).toBe('registered');
    expect(r2.versionId).toBe('v2');
    const m = JSON.parse(readFileSync(manifestPath(weightsDir), 'utf-8'));
    expect(m.versions).toHaveLength(2);
    expect(m.current).toBe('v2');
    expect(m.versions[1].meta.evalScore).toBe(92.3);
    const reg = loadRegistry(dataDir);
    expect(reg.models['battery-factory-Qwen-Qwen3-8B'].localWeights).toMatchObject({
      currentVersion: 'v2', versionCount: 2,
    });
  });

  it('幂等命中前哈希校验：既有版本被篡改 → rejected（红线优先于便利）', () => {
    makeCompletedJob('job-tamper');
    registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-tamper',
      evalReport: makeEvalReport('job-tamper'), weightsDir,
    });
    // 篡改既有版本权重
    writeFileSync(join(weightsDir, 'v1', 'adapter_model.safetensors'), 'tampered');
    const r2 = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-tamper',
      evalReport: makeEvalReport('job-tamper'), weightsDir,
    });
    expect(r2.ok).toBe(false);
    expect(r2.action).toBe('rejected');
    expect(r2.issues[0]).toContain('完整性校验失败');
  });
});

// ════════════════════════════════════════
// 四、端到端：train → eval → 注册 → 幂等再触发
// ════════════════════════════════════════

describe('端到端训练闭环', () => {
  it('电池厂场景：train → eval pass → 自动注册 → 重复触发幂等 → 挂载建议全程在', () => {
    // 一、训练完成
    makeCompletedJob('job-e2e');
    // 二、eval 通过 → 自动注册
    const r1 = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-e2e',
      evalReport: makeEvalReport('job-e2e', { averageScore: 90.1 }), weightsDir,
    });
    expect(r1.action).toBe('registered');
    expect(r1.suggestion?.hint).toContain('model_switch');
    // 三、webhook 重放/自动重试 → 幂等
    const r2 = registerTrainArtifact({
      dataDir, enterpriseId: 'battery-factory', trainJobId: 'job-e2e',
      evalReport: makeEvalReport('job-e2e', { averageScore: 90.1 }), weightsDir,
    });
    expect(r2.action).toBe('skipped');
    // 四、挂载建议仍在（幂等不丢建议——人审点不因重放消失）
    expect(r2.suggestion?.hint).toContain('model_switch');
    // 五、审计双侧留痕
    const reg = loadRegistry(dataDir);
    expect(reg.events.filter((e) => e.actor === 'artifact-register:job-e2e').length).toBe(1);
    const m = JSON.parse(readFileSync(manifestPath(weightsDir), 'utf-8'));
    expect(m.versions[0].meta.trainJobId).toBe('job-e2e');
  });
});
