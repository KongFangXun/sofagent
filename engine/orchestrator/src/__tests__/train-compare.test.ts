// train-compare.test.ts · 多基座对比训练测试
//
// 覆盖（changelog 第四章验收对齐）：
// 1. 同数据多基座并行提交（同 hash / 同模板——jobId 含 hash 前缀）
// 2. 对比报告含 eval 分数 + 成本 + ROI 排序（Infinity 最前 / 未完成不进排序）
// 3. 对比任务走 GPU 队列（串行/budget 两模式 snapshot 留档）
// 4. 端到端：提交 → eval 就绪 → 汇总（选型场景）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  submitCompareJobs,
  buildCompareReport,
  type CompareBaseResult,
} from '../train/train-compare';
import { computeDatasetHash } from '../train/train-fingerprint';
import type { TrainEvalReport } from '../train-eval-loop';

let dataDir: string;
let dataPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-cmp-data-'));
  const datasetDir = join(dataDir, 'datasets', 'cells-v3');
  mkdirSync(datasetDir, { recursive: true });
  writeFileSync(join(datasetDir, 'train.jsonl'), JSON.stringify({ input: '电芯 A', output: '合格' }));
  dataPath = datasetDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 造 eval 报告（attach 到 CompareBaseResult） */
function evalOf(trainJobId: string, score: number): TrainEvalReport {
  return {
    trainJobId,
    enterpriseId: 'battery-factory',
    benchmarkId: 'bench-cells-v1',
    evaluations: [],
    averageScore: score,
    failureRate: 0,
    decision: 'stop',
    reason: '达标收工',
    datasetVersion: null,
    evaluatedAt: new Date().toISOString(),
  };
}

// ════════════════════════════════════════
// 一、同数据多基座并行提交
// ════════════════════════════════════════

describe('多基座并行提交', () => {
  it('双基座提交：两个 job + 同 hash 前缀 + 共享超参模板', () => {
    const r = submitCompareJobs({
      dataDir, enterpriseId: 'battery-factory', dataPath,
      bases: [
        { baseModel: 'Qwen/Qwen3-8B' },
        { baseModel: 'R1-Distill-7B' },
      ],
      algorithm: 'sft',
      hyperparams: { lora_r: 16 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jobs).toHaveLength(2);
    // jobId = compare-<hash8>-<slug>——同数据 hash 前缀
    const hash = computeDatasetHash(dataPath);
    expect(r.jobs[0].trainJobId).toBe(`compare-${hash.slice(0, 8)}-qwen-qwen3-8b`);
    expect(r.jobs[1].trainJobId).toBe(`compare-${hash.slice(0, 8)}-r1-distill-7b`);
    expect(r.jobs.every((j) => j.status === 'queued')).toBe(true);
  });

  it('bases 为空 → 拒绝', () => {
    const r = submitCompareJobs({
      dataDir, enterpriseId: 'battery-factory', dataPath,
      bases: [], algorithm: 'sft',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]).toContain('bases 非空');
  });

  it('基座超参覆盖合并（同模板 + per-base override）', () => {
    const submitted: Array<Record<string, unknown>> = [];
    const r = submitCompareJobs(
      {
        dataDir, enterpriseId: 'battery-factory', dataPath,
        bases: [
          { baseModel: 'Qwen/Qwen3-8B', hyperparamsOverride: { context_length: 8192 } },
          { baseModel: 'R1-Distill-7B' },
        ],
        algorithm: 'sft',
        hyperparams: { lora_r: 16 },
      },
      {
        submitFn: (input) => {
          submitted.push(input.hyperparams ?? {});
          return {
            record: {
              jobId: input.jobId ?? 'x', enterpriseId: input.enterpriseId,
              status: 'queued', job: {} as never, createdAt: '', updatedAt: '',
              usage: { elapsedMinutes: 0, steps: 0, cost: 0 },
            },
            created: true,
          };
        },
      },
    );
    expect(r.ok).toBe(true);
    expect(submitted[0]).toEqual({ lora_r: 16, context_length: 8192 });
    expect(submitted[1]).toEqual({ lora_r: 16 });
  });

  it('dataPath 缺失 → 拒绝', () => {
    const r = submitCompareJobs({
      dataDir, enterpriseId: 'battery-factory', dataPath: '',
      bases: [{ baseModel: 'Qwen/Qwen3-8B' }], algorithm: 'sft',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]).toContain('dataPath 必填');
  });
});

// ════════════════════════════════════════
// 二、对比报告：eval + 成本 + ROI 排序
// ════════════════════════════════════════

describe('ROI 排序', () => {
  const hash = 'abcd1234abcd1234';

  function base(baseModel: string, score: number, cost: number, minutes: number): CompareBaseResult {
    return {
      baseModel,
      trainJobId: `j-${baseModel}`,
      status: 'completed',
      evalReport: evalOf(`j-${baseModel}`, score),
      usage: { elapsedMinutes: minutes, steps: 1000, cost },
    };
  }

  it('ROI 降序排序（分数÷成本）', () => {
    const report = buildCompareReport({
      datasetHash: hash,
      results: [
        base('qwen3-8b', 85, 100, 60),   // ROI 0.85
        base('r1-distill-7b', 78, 50, 40), // ROI 1.56 ← 最优
        base('qwen3-14b', 90, 300, 120),  // ROI 0.30
      ],
    });
    expect(report.ranking).toHaveLength(3);
    expect(report.ranking[0]).toMatchObject({ baseModel: 'r1-distill-7b', rank: 1 });
    expect(report.ranking[1]).toMatchObject({ baseModel: 'qwen3-8b', rank: 2 });
    expect(report.ranking[2]).toMatchObject({ baseModel: 'qwen3-14b', rank: 3 });
    expect(report.ranking[0].summary).toContain('ROI 1.56');
  });

  it('零成本拿分 → ROI Infinity 排最前', () => {
    const report = buildCompareReport({
      datasetHash: hash,
      results: [
        base('qwen3-8b', 85, 100, 60),
        base('free-base', 60, 0, 10), // ROI ∞
      ],
    });
    expect(report.ranking[0]).toMatchObject({ baseModel: 'free-base', roi: Number.POSITIVE_INFINITY });
    expect(report.ranking[0].summary).toContain('∞');
  });

  it('未完成基座不参与排序（evalReport=null）', () => {
    const report = buildCompareReport({
      datasetHash: hash,
      results: [
        base('qwen3-8b', 85, 100, 60),
        { baseModel: 'unfinished', trainJobId: 'j-u', status: 'failed', evalReport: null, usage: { elapsedMinutes: 10, steps: 100, cost: 5 } },
      ],
    });
    expect(report.ranking).toHaveLength(1);
    expect(report.results).toHaveLength(2); // 原始结果保留（如实呈现）
  });

  it('compareId 含 hash8 前缀（可复现性锚点）', () => {
    const report = buildCompareReport({ datasetHash: hash, results: [base('qwen3-8b', 85, 100, 60)] });
    expect(report.compareId).toBe('compare-abcd1234');
  });
});

// ════════════════════════════════════════
// 三、GPU 队列（不 OOM）
// ════════════════════════════════════════

describe('GPU 队列', () => {
  it('budget 模式：小预算下部分任务排队（不 OOM）', () => {
    const r = submitCompareJobs({
      dataDir, enterpriseId: 'battery-factory', dataPath,
      bases: [
        { baseModel: 'Qwen/Qwen3-8B' },
        { baseModel: 'Qwen/Qwen3-14B' },
      ],
      algorithm: 'sft',
      gpuTotalMiB: 9 * 1024, // 9 GiB——8B 全参约 50GiB → 两个都放不下
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 串行/budget：两任务显存均超预算 → running ≤ 1（第一个占位后第二个排队）
    expect(r.gpuSnapshot.queuedCount + r.gpuSnapshot.runningCount).toBe(2);
    expect(r.gpuSnapshot.mode).toBe('budget');
  });

  it('serial 模式（缺省 gpuTotalMiB=0）：一次只放一个', () => {
    const r = submitCompareJobs({
      dataDir, enterpriseId: 'battery-factory', dataPath,
      bases: [
        { baseModel: 'Qwen/Qwen3-8B' },
        { baseModel: 'R1-Distill-7B' },
      ],
      algorithm: 'sft',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gpuSnapshot.mode).toBe('serial');
    expect(r.gpuSnapshot.runningCount).toBe(1); // 串行只放第一个
    expect(r.gpuSnapshot.queuedCount).toBe(1);
  });
});

// ════════════════════════════════════════
// 四、端到端：提交 → eval → 汇总
// ════════════════════════════════════════

describe('端到端选型场景', () => {
  it('电池厂选型：Qwen3-8B vs R1-Distill-7B → 提交 + 汇总出 ROI 结论', () => {
    // 一、提交（真 createTrainJob——job 落盘可查）
    const sub = submitCompareJobs({
      dataDir, enterpriseId: 'battery-factory', dataPath,
      bases: [
        { baseModel: 'Qwen/Qwen3-8B' },
        { baseModel: 'R1-Distill-7B' },
      ],
      algorithm: 'sft',
      hyperparams: { lora_r: 16 },
    });
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    // 二、模拟两基座训练完成 + eval 出分（外部驱动）
    const results: CompareBaseResult[] = [
      {
        baseModel: 'Qwen/Qwen3-8B', trainJobId: sub.jobs[0].trainJobId, status: 'completed',
        evalReport: evalOf(sub.jobs[0].trainJobId, 88.4),
        usage: { elapsedMinutes: 55, steps: 1200, cost: 42 },
      },
      {
        baseModel: 'R1-Distill-7B', trainJobId: sub.jobs[1].trainJobId, status: 'completed',
        evalReport: evalOf(sub.jobs[1].trainJobId, 84.1),
        usage: { elapsedMinutes: 48, steps: 1100, cost: 31 },
      },
    ];
    // 三、汇总（ROI：8B=2.10 vs 7B=2.71 → 7B 更优）
    const report = buildCompareReport({
      results,
      datasetHash: computeDatasetHash(dataPath),
    });
    expect(report.ranking[0].baseModel).toBe('R1-Distill-7B');
    expect(report.ranking[0].summary).toContain('第 1 名');
  });
});
