// train-diagnose.test.ts · v1.4.3 第二章 测试
//
// 验收标准逐条覆盖：
// - 七类分类输出（OOM/数据/发散/框架/环境/重复坍塌/精度异常）
// - 诊断报告含上下文（日志尾部 + 环境 + checkpoint + 超参）
// - 每类失败有修复建议（含重复坍塌与精度异常两类新处方）
// - 报告落盘可回读

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  classifyTrainFailure,
  diagnoseTrainFailure,
  saveTrainDiagnoseReport,
  trainDiagnoseReportPath,
  FAILURE_CATEGORIES,
  FAILURE_PRESCRIPTIONS,
  type TrainFailureCategory,
} from '../train/train-diagnose';
import type { TrainJobRecord } from '../train/train-job';

// ── 测试基建 ──
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-diagnose-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 落盘一个 failed job（带 reason——分类输入源） */
function seedFailedJob(jobId: string, reason: string, overrides: Partial<TrainJobRecord> = {}): void {
  const dir = join(dataDir, 'train', 'ent-1', jobId);
  mkdirSync(dir, { recursive: true });
  const record: TrainJobRecord = {
    jobId,
    enterpriseId: 'ent-1',
    status: 'failed',
    job: {
      schemaVersion: 'v1',
      jobId,
      dataPath: '/data/train.jsonl',
      baseModel: 'Qwen3-8B',
      algorithm: 'grpo',
      hyperparams: { learning_rate: 1e-4, group_size: 8 },
      checkpointPath: '/ckpt',
      outputDir: '/out',
    },
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T01:00:00.000Z',
    reason,
    lastCheckpoint: { checkpointPath: '/ckpt/step-500', step: 500 },
    usage: { elapsedMinutes: 60, steps: 500, cost: 0 },
    ...overrides,
  } as TrainJobRecord;
  writeFileSync(join(dir, 'state.json'), JSON.stringify(record), 'utf-8');
}

// ════════════════════════════════════════
// 一、七类分类
// ════════════════════════════════════════

describe('classifyTrainFailure 七类分类', () => {
  const cases: Array<{ category: TrainFailureCategory; log: string; hit: string }> = [
    { category: 'oom', log: 'torch.cuda.OutOfMemoryError: Tried to allocate 2.00 GiB', hit: 'tried to allocate' },
    { category: 'oom', log: 'CUDA OOM during backward pass', hit: 'cuda oom' },
    { category: 'data_format', log: "KeyError: 'instruction' in dataloader worker", hit: 'keyerror' },
    { category: 'data_format', log: 'JSONDecodeError: Unexpected token in dataset line 42', hit: 'jsondecodeerror' },
    { category: 'hyperparam_divergence', log: 'Loss is NaN at step 1200, gradient overflow detected', hit: 'loss is nan' },
    { category: 'hyperparam_divergence', log: 'training diverged after LR increase', hit: 'diverged' },
    { category: 'framework_error', log: "ModuleNotFoundError: No module named 'verl.trainer'", hit: 'modulenotfounderror' },
    { category: 'framework_error', log: "AttributeError: 'Trainer' object has no attribute 'fit'", hit: 'attributeerror' },
    { category: 'environment_mismatch', log: 'CUDA driver version is insufficient for CUDA runtime', hit: 'cuda driver version is insufficient' },
    { category: 'environment_mismatch', log: 'undefined symbol: cublasLtMatmulAlgoGetHeuristic in libcudart', hit: 'libcudart' },
    { category: 'repetition_collapse', log: 'degenerate output: identical responses in group 7 (repetition loop detected)', hit: 'repetition' },
    { category: 'precision_anomaly', log: 'loss spike 2.1 → 8.7 at step 300 (numerical instability in bf16)', hit: 'loss spike' },
  ];

  it('七类全量定义（id 唯一 + 每类有名称与关键词）', () => {
    expect(FAILURE_CATEGORIES).toHaveLength(7);
    const ids = new Set(FAILURE_CATEGORIES.map((c) => c.id));
    expect(ids.size).toBe(7);
    for (const def of FAILURE_CATEGORIES) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.keywords.length).toBeGreaterThan(0);
    }
  });

  for (const { category, log, hit } of cases) {
    it(`「${log.slice(0, 40)}…」→ ${category}`, () => {
      const result = classifyTrainFailure(log);
      expect(result.category).toBe(category);
      expect(result.matchedKeywords).toContain(hit);
    });
  }

  it('零命中 → 未识别（category=null，转人审）', () => {
    const result = classifyTrainFailure('一切正常但就是失败了');
    expect(result.category).toBeNull();
    expect(result.name).toContain('未识别');
    expect(result.matchedKeywords).toEqual([]);
  });

  it('多类命中 → 关键词最多者胜出（分类优先级可解释）', () => {
    // 同时含 OOM 与数据错误关键词，但 OOM 命中 3 个、数据 1 个
    const log = 'CUDA OOM: Tried to allocate; out of memory; KeyError in loader';
    const result = classifyTrainFailure(log);
    expect(result.category).toBe('oom');
  });
});

// ════════════════════════════════════════
// 二、处方表（每类有修复建议——含 2026-08-26 两类新处方）
// ════════════════════════════════════════

describe('FAILURE_PRESCRIPTIONS 七类处方', () => {
  it('七类各有处方（steps 非空 + source 非空）', () => {
    for (const def of FAILURE_CATEGORIES) {
      const rx = FAILURE_PRESCRIPTIONS[def.id];
      expect(rx).toBeDefined();
      expect(rx.steps.length).toBeGreaterThan(0);
      expect(rx.source.length).toBeGreaterThan(0);
    }
  });

  it('OOM 处方：减 batch + gradient checkpointing（验收口径）', () => {
    const steps = FAILURE_PRESCRIPTIONS.oom.steps.join(' ');
    expect(steps).toContain('batch');
    expect(steps).toContain('gradient_checkpointing');
  });

  it('重复坍塌处方：重复早停 + 长度窗口分阶段扩张（MiniMax-M1）', () => {
    const steps = FAILURE_PRESCRIPTIONS.repetition_collapse.steps.join(' ');
    expect(steps).toContain('重复早停');
    expect(steps).toContain('长度窗口分阶段扩张');
    expect(FAILURE_PRESCRIPTIONS.repetition_collapse.source).toContain('MiniMax-M1');
  });

  it('精度异常处方：LM head/优化器状态升 FP32（MiniMax-M1 + ScaleRL）', () => {
    const steps = FAILURE_PRESCRIPTIONS.precision_anomaly.steps.join(' ');
    expect(steps).toContain('LM head');
    expect(steps).toContain('FP32');
    expect(FAILURE_PRESCRIPTIONS.precision_anomaly.source).toContain('ScaleRL');
  });

  it('超参发散处方：调 learning rate + KL 系数（验收口径）', () => {
    const steps = FAILURE_PRESCRIPTIONS.hyperparam_divergence.steps.join(' ');
    expect(steps.toLowerCase()).toContain('learning_rate');
    expect(steps).toContain('KL');
  });
});

// ════════════════════════════════════════
// 三、诊断主链路（上下文四源 + 报告落盘）
// ════════════════════════════════════════

describe('diagnoseTrainFailure 诊断主链路', () => {
  it('七类分类输出 + 上下文四源打包（日志/环境/checkpoint/超参）', () => {
    seedFailedJob('job-oom', 'python 退出码 1：CUDA OOM: Tried to allocate 4.00 GiB');
    const report = diagnoseTrainFailure(dataDir, 'ent-1', 'job-oom');
    expect(report.classification.category).toBe('oom');
    expect(report.context.logTail).toContain('Tried to allocate');
    expect(report.context.lastCheckpoint).toEqual({ checkpointPath: '/ckpt/step-500', step: 500 });
    expect(report.context.hyperparams.group_size).toBe(8);
    expect(report.context.envManifest).toBeNull(); // 无 train-env.json——如实 null
    expect(report.prescription?.steps.length).toBeGreaterThan(0);
  });

  it('环境清单存在时进上下文（train-env.json 读取）', () => {
    seedFailedJob('job-env', 'CUDA driver version is insufficient');
    const entDir = join(dataDir, 'train', 'ent-1');
    writeFileSync(
      join(entDir, 'train-env.json'),
      JSON.stringify({
        schemaVersion: 'v1',
        pythonVersion: '3.11.4',
        framework: { name: 'verl', version: '0.4.0' },
        cudaVersion: '12.4',
        gpu: null,
        packageManager: 'pip3',
        platform: 'linux',
        generatedAt: '2026-08-29T00:00:00.000Z',
      }),
      'utf-8',
    );
    const report = diagnoseTrainFailure(dataDir, 'ent-1', 'job-env');
    expect(report.classification.category).toBe('environment_mismatch');
    expect(report.context.envManifest?.framework?.name).toBe('verl');
    expect(report.context.envManifest?.cudaVersion).toBe('12.4');
  });

  it('未识别失败 → 通用排查处方（category=null 不崩）', () => {
    seedFailedJob('job-weird', '玄学失败原因');
    const report = diagnoseTrainFailure(dataDir, 'ent-1', 'job-weird');
    expect(report.classification.category).toBeNull();
    expect(report.prescription).not.toBeNull();
    expect(report.prescription!.steps.join(' ')).toContain('train_doctor');
  });

  it('任务不存在抛错（快速失败）', () => {
    expect(() => diagnoseTrainFailure(dataDir, 'ent-1', 'ghost')).toThrow(/不存在/);
  });

  it('报告落盘可回读（diagnose.json——幂等覆盖）', () => {
    seedFailedJob('job-save', 'Loss is NaN at step 100');
    const report = diagnoseTrainFailure(dataDir, 'ent-1', 'job-save');
    const file = saveTrainDiagnoseReport(dataDir, report);
    expect(file).toBe(trainDiagnoseReportPath(dataDir, 'ent-1', 'job-save'));
    const reread = JSON.parse(readFileSync(file, 'utf-8'));
    expect(reread.classification.category).toBe('hyperparam_divergence');
    expect(reread.prescription.steps.length).toBeGreaterThan(0);
  });

  it('events.jsonl 的 failed 事件也进日志尾部（多源收集）', () => {
    seedFailedJob('job-ev', '先行原因');
    const eventsFile = join(dataDir, 'train', 'ent-1', 'job-ev', 'events.jsonl');
    writeFileSync(
      eventsFile,
      JSON.stringify({ type: 'failed', reason: 'Loss became NaN during rollout' }) + '\n',
      'utf-8',
    );
    const report = diagnoseTrainFailure(dataDir, 'ent-1', 'job-ev');
    // events 的 failed reason 参与分类（NaN 关键词命中发散类）
    expect(report.classification.category).toBe('hyperparam_divergence');
  });
});
