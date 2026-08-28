// ============================================================
// train-dryrun.test.ts · v1.4.2 章五 · dry-run + 缩放律拟合测试
//
// 覆盖：
//   - estimateVram 纯函数（权重/优化器/激活三分量 + 梯度检查点省内存）
//   - runDryrun 四项预检（管线连通 ok / 文件缺失 fail / 列映射缺列 fail /
//     数据量不足 warn / 显存超限 fail / 显存充裕 ok / 外推置信分级 /
//     外推成本超预算 warn）
//   - fitSigmoid（3 点拟合 sigmoid 收敛 / 2 点降级 / 全常数降级）
//   - extrapolate（high/medium/low 三级置信 / 线性兜底 / 单点不可推 /
//     远超观测域降级）
//   - suggestNextPilotCompute（最大间隙中点 / 零间隙翻倍）
//
// 全部纯函数 + 临时目录小 CSV fixture——零真实训练零真实大文件。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  estimateVram,
  runDryrun,
  type DryrunCheck,
} from '../train/train-dryrun';
import {
  fitSigmoid,
  extrapolate,
  sigmoid,
  suggestNextPilotCompute,
  type ScaleCurvePoint,
} from '../train/scale-curve';
import {
  computeQuantification,
  generateTrainReport,
  trainReportPaths,
  trainReportsDir,
} from '../train/train-report';
import type { TrainEvalReport } from '../train/train-eval-loop';
import type { DatasetVersionRecord } from '../train/dataset-version';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-dryrun-test-'));
});

/** 造一个可用的 sft CSV（n 条） */
function makeSftCsv(n: number): string {
  const rows = ['instruction,output'];
  for (let i = 0; i < n; i++) rows.push(`问题${i}怎么处理,答案${i}是这样做`);
  const p = join(dataDir, `sft-${n}.csv`);
  writeFileSync(p, rows.join('\n'), 'utf8');
  return p;
}

function checkOf(result: { checks: DryrunCheck[] }, name: string): DryrunCheck | undefined {
  return result.checks.find((c) => c.name === name);
}

// ──────────────────────────────────────
// 显存估算纯函数
// ──────────────────────────────────────

describe('train-dryrun · 显存估算', () => {
  it('test_estimateVram_8B混合精度_三分量构成', () => {
    // 8B × 2B/param = 16 权重；优化器 16×2 = 32；激活 8×sqrt(4×2048)×0.02 ≈ 14.5
    const r = estimateVram({ paramsBillions: 8, batchSize: 4, sequenceLength: 2048 });
    expect(r.weightsGiB).toBe(16);
    expect(r.optimizerGiB).toBe(32);
    expect(r.activationsGiB).toBeGreaterThan(10);
    expect(r.activationsGiB).toBeLessThan(20);
    expect(r.totalGiB).toBeGreaterThan(60);
    expect(r.formula).toContain('权重 16');
  });

  it('test_estimateVram_梯度检查点_激活减半以上', () => {
    const plain = estimateVram({ paramsBillions: 8, batchSize: 16, sequenceLength: 4096 });
    const ckpt = estimateVram({
      paramsBillions: 8, batchSize: 16, sequenceLength: 4096, gradientCheckpointing: true,
    });
    expect(ckpt.activationsGiB).toBeLessThan(plain.activationsGiB / Math.sqrt(16) + 1);
    expect(ckpt.totalGiB).toBeLessThan(plain.totalGiB);
  });

  it('test_estimateVram_fp32_字节数翻倍', () => {
    const bf16 = estimateVram({ paramsBillions: 7, batchSize: 1, sequenceLength: 512 });
    const fp32 = estimateVram({ paramsBillions: 7, batchSize: 1, sequenceLength: 512, bytesPerParam: 4 });
    expect(fp32.weightsGiB).toBe(bf16.weightsGiB * 2);
  });
});

// ──────────────────────────────────────
// runDryrun 四项预检
// ──────────────────────────────────────

describe('train-dryrun · runDryrun', () => {
  it('test_runDryrun_管线连通与数据预检_全过', () => {
    const csv = makeSftCsv(20);
    const r = runDryrun({ dataPath: csv, algorithm: 'sft' });

    expect(r.passed).toBe(true);
    expect(checkOf(r, 'pipeline-connectivity')?.status).toBe('ok');
    expect(checkOf(r, 'pipeline-connectivity')?.detail).toContain('管线连通');
    expect(checkOf(r, 'data-preflight')?.status).toBe('ok');
    expect(checkOf(r, 'vram-preflight')?.status).toBe('skip');
    expect(checkOf(r, 'scale-extrapolation')?.status).toBe('skip');
  });

  it('test_runDryrun_文件不存在_fail', () => {
    const r = runDryrun({ dataPath: join(dataDir, 'ghost.csv'), algorithm: 'sft' });
    expect(r.passed).toBe(false);
    expect(checkOf(r, 'pipeline-connectivity')?.status).toBe('fail');
    expect(checkOf(r, 'pipeline-connectivity')?.detail).toContain('不存在');
  });

  it('test_runDryrun_列映射缺必填列_fail并给修复指引', () => {
    // 无 output 列——sft 必填 instruction+output
    const p = join(dataDir, 'bad-cols.csv');
    writeFileSync(p, 'q\n问题1\n问题2\n', 'utf8');
    const r = runDryrun({ dataPath: p, algorithm: 'sft' });

    expect(r.passed).toBe(false);
    const pc = checkOf(r, 'pipeline-connectivity');
    expect(pc?.status).toBe('fail');
    expect(pc?.detail).toContain('output');
    expect(checkOf(r, 'data-preflight')?.status).toBe('fail');
  });

  it('test_runDryrun_样本量不足10条_warn不阻断', () => {
    const csv = makeSftCsv(5);
    const r = runDryrun({ dataPath: csv, algorithm: 'sft' });

    expect(r.passed).toBe(true); // warn 不算 fail
    expect(checkOf(r, 'data-preflight')?.status).toBe('warn');
    expect(checkOf(r, 'data-preflight')?.detail).toContain('< 10');
  });

  it('test_runDryrun_显存超限_fail给降级建议', () => {
    const csv = makeSftCsv(15);
    const r = runDryrun({
      dataPath: csv,
      algorithm: 'sft',
      vram: { paramsBillions: 14, batchSize: 8, sequenceLength: 4096, gpuVramMiB: 24 * 1024 },
    });

    // 14B 需 >70GiB，24G 卡必然超
    expect(r.passed).toBe(false);
    const v = checkOf(r, 'vram-preflight');
    expect(v?.status).toBe('fail');
    expect(v?.detail).toContain('显存不足');
    expect(v?.detail).toContain('LoRA');
    expect(r.vramEstimate?.totalGiB).toBeGreaterThan(60);
  });

  it('test_runDryrun_显存充裕_ok给余量', () => {
    const csv = makeSftCsv(15);
    const r = runDryrun({
      dataPath: csv,
      algorithm: 'sft',
      vram: { paramsBillions: 8, batchSize: 2, sequenceLength: 1024, gpuVramMiB: 80 * 1024 },
    });

    expect(checkOf(r, 'vram-preflight')?.status).toBe('ok');
    expect(checkOf(r, 'vram-preflight')?.detail).toContain('余量');
  });

  it('test_runDryrun_未给GPU上限_warn', () => {
    const csv = makeSftCsv(15);
    const r = runDryrun({
      dataPath: csv,
      algorithm: 'sft',
      vram: { paramsBillions: 8, batchSize: 2, sequenceLength: 1024 },
    });
    expect(checkOf(r, 'vram-preflight')?.status).toBe('warn');
    expect(checkOf(r, 'vram-preflight')?.detail).toContain('gpuVramMiB');
  });

  it('test_runDryrun_外推成本超预算_warn衔接预算控制', () => {
    const csv = makeSftCsv(15);
    // 3 个优质 pilot 点（sigmoid 形状清晰）
    const points: ScaleCurvePoint[] = [
      { compute: 10, performance: 30 },
      { compute: 30, performance: 55 },
      { compute: 100, performance: 72 },
    ];
    const r = runDryrun({
      dataPath: csv,
      algorithm: 'sft',
      extrapolate: { points, targetCompute: 200, costPerUnit: 15, budgetCap: 2000 },
    });

    // 200 × 15 = 3000 > 2000 → warn
    const e = checkOf(r, 'scale-extrapolation');
    expect(e?.status).toBe('warn');
    expect(e?.detail).toContain('超预算');
    expect(e?.detail).toContain('预算控制');
    expect(r.extrapolation?.projectedPerformance).not.toBeNull();
  });

  it('test_runDryrun_外推预算内_ok', () => {
    const csv = makeSftCsv(15);
    const points: ScaleCurvePoint[] = [
      { compute: 10, performance: 30 },
      { compute: 30, performance: 55 },
      { compute: 100, performance: 72 },
    ];
    const r = runDryrun({
      dataPath: csv,
      algorithm: 'sft',
      extrapolate: { points, targetCompute: 50, costPerUnit: 10, budgetCap: 10000 },
    });

    expect(checkOf(r, 'scale-extrapolation')?.status).not.toBe('fail');
    expect(r.passed).toBe(true);
  });

  it('test_runDryrun_单pilot点_外推不可推但整体不fail', () => {
    const csv = makeSftCsv(15);
    const r = runDryrun({
      dataPath: csv,
      algorithm: 'sft',
      extrapolate: { points: [{ compute: 10, performance: 40 }], targetCompute: 100 },
    });

    expect(r.extrapolation?.projectedPerformance).toBeNull();
    expect(r.extrapolation?.confidence).toBe('low');
    expect(r.passed).toBe(true); // 数据不足是 warn/skip 语义不是 fail
  });
});

// ──────────────────────────────────────
// sigmoid 拟合
// ──────────────────────────────────────

describe('scale-curve · fitSigmoid', () => {
  it('test_fitSigmoid_理想sigmoid数据_收敛且R2高', () => {
    const truth = { L: 85, k: 0.08, x0: 40 };
    const points: ScaleCurvePoint[] = [5, 15, 25, 40, 60, 90, 130].map((x) => ({
      compute: x,
      performance: sigmoid(x, truth),
    }));

    const fit = fitSigmoid(points);
    expect(fit.params).not.toBeNull();
    expect(fit.quality?.converged).toBe(true);
    expect(fit.quality?.r2).toBeGreaterThan(0.95);
    expect(fit.params?.L).toBeGreaterThan(80);
    expect(fit.params?.L).toBeLessThan(90);
  });

  it('test_fitSigmoid_仅2点_降级明示', () => {
    const fit = fitSigmoid([
      { compute: 10, performance: 30 },
      { compute: 50, performance: 60 },
    ]);
    expect(fit.params).toBeNull();
    expect(fit.degradedReason).toContain('降级');
  });

  it('test_fitSigmoid_性能全常数_不可辨识', () => {
    const fit = fitSigmoid([
      { compute: 1, performance: 50 },
      { compute: 2, performance: 50 },
      { compute: 3, performance: 50 },
    ]);
    expect(fit.params).toBeNull();
    expect(fit.degradedReason).toContain('不可辨识');
  });
});

describe('scale-curve · extrapolate', () => {
  /** 造拟合友好的点集 */
  const goodPoints: ScaleCurvePoint[] = [
    { compute: 5, performance: 20.1 },
    { compute: 15, performance: 38.7 },
    { compute: 35, performance: 62.5 },
    { compute: 60, performance: 74.2 },
    { compute: 90, performance: 78.9 },
  ];

  it('test_extrapolate_优质拟合_高置信与band', () => {
    const e = extrapolate(goodPoints, 120);
    expect(e.projectedPerformance).not.toBeNull();
    expect(e.projectedPerformance as number).toBeGreaterThan(70);
    expect(e.ceiling).not.toBeNull();
    expect(e.band.lower).not.toBeNull();
    expect(e.band.upper).not.toBeNull();
    expect((e.band.lower as number) < (e.projectedPerformance as number)).toBe(true);
    expect((e.band.upper as number) > (e.projectedPerformance as number)).toBe(true);
    expect(['high', 'medium']).toContain(e.confidence);
  });

  it('test_extrapolate_2点_线性兜底置信低', () => {
    const e = extrapolate(
      [
        { compute: 10, performance: 30 },
        { compute: 30, performance: 50 },
      ],
      60,
    );
    expect(e.projectedPerformance).toBe(80); // 线性：30 + (60−10)×1 = 80（截距 20）
    expect(e.confidence).toBe('low');
    expect(e.confidenceNote).toContain('线性');
    expect(e.ceiling).toBeNull(); // 线性无天花板概念
  });

  it('test_extrapolate_1点_不可推', () => {
    const e = extrapolate([{ compute: 10, performance: 40 }], 100);
    expect(e.projectedPerformance).toBeNull();
    expect(e.confidenceNote).toContain('无法外推');
  });

  it('test_extrapolate_远超观测域10倍_置信降级', () => {
    const e = extrapolate(goodPoints, 2000); // 观测最大 90 → 2000 是 22 倍
    expect(e.confidence).not.toBe('high');
    expect(e.confidenceNote).toContain('10 倍');
  });
});

describe('scale-curve · suggestNextPilotCompute', () => {
  it('test_suggest_最大间隙中点', () => {
    // 间隙 10→100 最大 → 中点 55
    expect(suggestNextPilotCompute([
      { compute: 10, performance: 1 },
      { compute: 100, performance: 2 },
      { compute: 110, performance: 3 },
    ])).toBe(55);
  });

  it('test_suggest_零间隙_翻倍', () => {
    expect(suggestNextPilotCompute([
      { compute: 50, performance: 1 },
      { compute: 50, performance: 2 },
    ])).toBe(100);
  });

  it('test_suggest_空集_最小规模起', () => {
    expect(suggestNextPilotCompute([])).toBe(1);
  });
});

// ──────────────────────────────────────
// train-report（章六——同批验证）
// ──────────────────────────────────────

const baseEvalReport = (score: number, hash: string | null): TrainEvalReport => ({
  trainJobId: 'job-r',
  enterpriseId: 'ent-r',
  benchmarkId: 'bench-r',
  evaluations: [],
  averageScore: score,
  failureRate: 0,
  decision: score >= 80 ? 'stop' : 'continue',
  reason: '',
  datasetVersion:
    hash === null
      ? null
      : ({
          version: 'v1', datasetId: 'ds-r', enterpriseId: 'ent-r', contentHash: hash,
          sampleCount: 100, algorithm: 'sft', columnMapping: { instruction: 'q', output: 'a' },
          datasetFile: '/tmp/x.jsonl', createdAt: '2026-08-30T00:00:00.000Z',
        } as DatasetVersionRecord),
  evaluatedAt: '2026-08-30T00:00:00.000Z',
});

describe('train-report · 量化四字段', () => {
  it('test_computeQuantification_GUIDE公式_年节省与回本', () => {
    // GUIDE §4.3 例：岗位年薪 6 万 × 接管 33% ≈ 2 万/年
    const q = computeQuantification({ annualSalary: 60_000, takeoverRatio: 0.33, aiAnnualCost: 3_000, oneTimeInvestment: 10_000 });
    expect(q.annualSaving.value).toBeCloseTo(19_800, -2);
    expect(q.annualSaving.display).toContain('万');
    expect(q.currentCost.display).toContain('6.0 万');
    // 回本 = 10000/19800 ≈ 0.5 年 → 按月显示
    expect(q.paybackPeriod.display).toContain('月');
  });

  it('test_computeQuantification_零节省_回本不适用', () => {
    const q = computeQuantification({ annualSalary: 50_000, takeoverRatio: 0, aiAnnualCost: 10_000 });
    expect(q.annualSaving.value).toBe(0);
    expect(q.paybackPeriod.display).toContain('不适用');
    expect(q.paybackPeriod.value).toBe(-1);
  });
});

describe('train-report · 报告生成与归档', () => {
  it('test_generateTrainReport_全输入_五段markdown与json归档', () => {
    const r = generateTrainReport({
      dataDir,
      enterpriseId: 'ent-r',
      trainJobId: 'job-report-1',
      baselineEval: baseEvalReport(70, 'hash-aaa'),
      afterEval: baseEvalReport(88, 'hash-aaa'),
      datasetVersion: {
        version: 'v1', datasetId: 'ds-r', enterpriseId: 'ent-r', contentHash: 'hash-aaa',
        sampleCount: 120, algorithm: 'sft', columnMapping: { instruction: 'q', output: 'a' },
        datasetFile: '/tmp/x.jsonl', createdAt: '2026-08-30T00:00:00.000Z',
      },
      quantification: computeQuantification({ annualSalary: 60_000, takeoverRatio: 0.33, aiAnnualCost: 3_000, oneTimeInvestment: 10_000 }),
      artifacts: ['/data/output/model.safetensors', '/data/output/checkpoints/'],
      now: () => 1_800_000_000_000,
    });

    // 五段结构
    expect(r.markdown).toContain('# 训练报告 · job-report-1');
    expect(r.markdown).toContain('## 一、训练数据概况');
    expect(r.markdown).toContain('120 条');
    expect(r.markdown).toContain('脱敏');
    expect(r.markdown).toContain('## 二、训练配置');
    expect(r.markdown).toContain('## 三、评测对比（基线 → 训后）');
    expect(r.markdown).toContain('70.0 → 88.0');
    expect(r.markdown).toContain('## 四、产物清单');
    expect(r.markdown).toContain('model.safetensors');
    expect(r.markdown).toContain('## 五、绩效量化（GUIDE §4.3 量化四字段）');
    expect(r.markdown).toContain('当前成本');
    expect(r.markdown).toContain('回本周期');

    // JSON 段
    expect(r.json.evaluation.scoreDelta).toBe(18);
    expect(r.json.evaluation.improved).toBe(true);
    expect(r.json.evaluation.sameDataset).toBe(true);
    expect(r.json.dataset?.sampleCount).toBe(120);
    expect(r.json.quantification?.annualSaving.value).toBeGreaterThan(19_000);

    // 归档 data/dashboard/train-reports/<jobId>.md + .json
    expect(r.archivePaths.markdownPath).toBe(join(dataDir, 'dashboard', 'train-reports', 'job-report-1.md'));
    expect(r.archivePaths.jsonPath).toBe(join(dataDir, 'dashboard', 'train-reports', 'job-report-1.json'));
    expect(trainReportsDir(dataDir)).toBe(join(dataDir, 'dashboard', 'train-reports'));
    expect(trainReportPaths(dataDir, 'x').markdownPath.endsWith('x.md')).toBe(true);
  });

  it('test_generateTrainReport_job缺失与eval缺失_降级段不抛错', () => {
    const r = generateTrainReport({
      dataDir,
      enterpriseId: 'ent-none',
      trainJobId: 'job-ghost',
      baselineEval: null,
      afterEval: null,
      datasetVersion: null,
      now: () => 1_800_000_000_000,
    });

    expect(r.markdown).toContain('train job 记录缺失');
    expect(r.markdown).toContain('训后 eval 缺失');
    expect(r.markdown).toContain('未关联训练集版本');
    expect(r.json.job).toBeNull();
    expect(r.json.evaluation.afterAverage).toBeNull();
  });

  it('test_generateTrainReport_跨数据集对比_警示入报告', () => {
    const r = generateTrainReport({
      dataDir,
      enterpriseId: 'ent-r',
      trainJobId: 'job-report-2',
      baselineEval: baseEvalReport(70, 'hash-aaa'),
      afterEval: baseEvalReport(88, 'hash-bbb'),
      datasetVersion: null,
      now: () => 1_800_000_000_000,
    });
    expect(r.json.evaluation.sameDataset).toBe(false);
    expect(r.markdown).toContain('归因需谨慎');
  });
});
