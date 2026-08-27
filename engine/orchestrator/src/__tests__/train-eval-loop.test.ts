// ============================================================
// train-eval-loop.test.ts · v1.4.2 章三 · 训练中 eval 闭环测试
//
// 覆盖：
//   - 阈值判定纯函数（continue/stop 四分支：eval 可疑 / 未达标 /
//     短板 case / 全达标收工）
//   - runTrainEval 主流程：train job 完成后自动触发 Benchmark eval
//     （read-only 隔离）、eval 报告写 evaluation-log（HMAC 链路 mock
//     验证入参形态）、引用 dataset_version
//   - 阈值外部化（部署侧注入覆盖缺省）
//   - 训练前后对比（compareEvalReports——同数据集归因 / 跨数据集警示）
//
// 全部依赖注入（evalCaseFn / logRecordFn / loadBenchmarkFn / now——
// 零真实 LLM、零真实题库、零真实落盘）。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  computeScoreStats,
  decideFromScores,
  runTrainEval,
  compareEvalReports,
  DEFAULT_EVAL_THRESHOLDS,
  type TrainEvalReport,
} from '../train/train-eval-loop';
import { recordDatasetVersion } from '../train/dataset-version';
import type { CaseEvaluation, EvaluateCaseInput } from '../benchmark/case-evaluator';
import type { EvaluationLogInput } from '../benchmark/evaluation-log';
import type { BenchmarkDefinition } from '../benchmark/benchmark-designer';

// ──────────────────────────────────────
// 夹具
// ──────────────────────────────────────

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-eval-test-'));
});

/** 造 case 评测结果 */
function caseEval(score: number, failureCode: CaseEvaluation['failureCode'] = null): CaseEvaluation {
  return {
    benchmarkId: 'bench-x',
    caseId: `CASE-${score}-${Math.random().toString(36).slice(2, 6)}`,
    revision: 1,
    score,
    failureCode,
    details: [],
    workspace: '',
    durationMs: 10,
  };
}

/** 造固定题库（两个 case；id 可定制——题库 id 与入参 benchmarkId 保持一致） */
function makeBenchmark(id = 'bench-x'): BenchmarkDefinition {
  return {
    id,
    title: '测试题库',
    description: '',
    runs: 1,
    revision: 1,
    frozen: true,
    cases: [
      { id: 'CASE-001-a', name: 'a', statement: '任务甲', rubric: '评分甲' },
      { id: 'CASE-002-b', name: 'b', statement: '任务乙', rubric: '评分乙' },
    ],
    calibrations: [],
  };
}

// ──────────────────────────────────────
// 阈值判定纯函数
// ──────────────────────────────────────

describe('train-eval-loop · 阈值判定', () => {
  it('test_decideFromScores_零case_eval可疑继续', () => {
    const r = decideFromScores({ averageScore: 0, failureRate: 1, minScore: 0, caseCount: 0 });
    expect(r.decision).toBe('continue');
    expect(r.reason).toContain('未产出任何 case');
  });

  it('test_decideFromScores_失败率超限_eval可疑继续', () => {
    // 2/3 case 失败 → 失败率 0.67 > 0.3 → continue（先修 eval 链路）
    const stats = computeScoreStats([caseEval(100), caseEval(0, 'evaluation_failed'), caseEval(0, 'evaluation_failed')]);
    const r = decideFromScores(stats);
    expect(r.decision).toBe('continue');
    expect(r.reason).toContain('超上限');
  });

  it('test_decideFromScores_均分未达标_继续训练', () => {
    const stats = computeScoreStats([caseEval(70), caseEval(74)]);
    const r = decideFromScores(stats);
    expect(r.decision).toBe('continue');
    expect(r.reason).toContain('未达标线');
  });

  it('test_decideFromScores_均分达标有短板_继续补短板', () => {
    // 均分 (100+60)/2=80 达标，但 min 60 > 50？否——60>50 不算短板。
    // 用 (100+40)/2=70 需降 targetScore；直接造：均分 85、min 40 < 50
    const stats = computeScoreStats([caseEval(100), caseEval(70), caseEval(40)]);
    // 均分 70 < 80 不达标…… 重造：4 case = 100,100,100,40 → 均分 85、min 40
    const stats2 = computeScoreStats([caseEval(100), caseEval(100), caseEval(100), caseEval(40)]);
    expect(stats2.averageScore).toBe(85);
    const r = decideFromScores(stats2);
    expect(r.decision).toBe('continue');
    expect(r.reason).toContain('短板');
  });

  it('test_decideFromScores_全达标_stop收工', () => {
    const stats = computeScoreStats([caseEval(90), caseEval(85)]);
    const r = decideFromScores(stats);
    expect(r.decision).toBe('stop');
    expect(r.reason).toContain('收工');
  });

  it('test_decideFromScores_阈值外部化_部署侧覆盖缺省', () => {
    // 同样均分 85：缺省阈值 80 → stop 边界内；targetScore 90 注入 → continue
    const stats = computeScoreStats([caseEval(85), caseEval(85)]);
    expect(decideFromScores(stats).decision).toBe('stop');
    const r = decideFromScores(stats, { targetScore: 90 });
    expect(r.decision).toBe('continue');
    expect(DEFAULT_EVAL_THRESHOLDS.targetScore).toBe(80);
  });
});

// ──────────────────────────────────────
// runTrainEval 主流程（全注入 mock）
// ──────────────────────────────────────

describe('train-eval-loop · runTrainEval', () => {
  it('test_runTrainEval_全量case评测并写evaluation_log', async () => {
    const bench = makeBenchmark();
    const evals = [caseEval(90), caseEval(86)];
    let caseIdx = 0;
    const logged: EvaluationLogInput[] = [];

    const { report, loggedRecords } = await runTrainEval({
      dataDir,
      enterpriseId: 'ent-e',
      trainJobId: 'job-1',
      benchmarkId: 'bench-x',
      agentFn: async () => 'mock output',
      deps: {
        evalCaseFn: async (input: EvaluateCaseInput) => {
          // read-only 隔离由 evaluateCase 保证——注入版验证入参透传
          expect(input.benchmarkId).toBe('bench-x');
          expect(input.statement).toBeTruthy();
          expect(input.rubric).toBeTruthy();
          return evals[caseIdx++] ?? caseEval(0);
        },
        logRecordFn: (input) => {
          logged.push(input);
          return {
            ts: new Date().toISOString(),
            benchmarkId: input.benchmarkId,
            caseId: input.caseId,
            revision: input.revision,
            score: input.score,
            failureCode: input.failureCode ?? null,
            durationMs: input.durationMs,
            prevHash: 'genesis',
            hashVersion: 2,
            envFingerprint: 'test',
          };
        },
        loadBenchmarkFn: () => bench,
        now: () => 1_800_000_000_000,
      },
    });

    // eval 触发：两个 case 全跑
    expect(report.evaluations).toHaveLength(2);
    expect(report.averageScore).toBe(88);
    expect(report.decision).toBe('stop');

    // evaluation-log 写入：逐 case 一条，agentId 带 trainJobId 溯源
    expect(loggedRecords).toBe(2);
    expect(logged).toHaveLength(2);
    expect(logged[0]?.agentId).toBe('train:job-1');
    expect(logged[0]?.caseId).toBe('CASE-001-a');

    // evaluatedAt 用注入时钟（确定性）
    expect(report.evaluatedAt).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it('test_runTrainEval_题库缺失_结构化拒绝', async () => {
    await expect(
      runTrainEval({
        dataDir,
        enterpriseId: 'ent-e',
        trainJobId: 'job-1',
        benchmarkId: 'ghost',
        agentFn: async () => 'x',
        deps: { loadBenchmarkFn: () => null },
      }),
    ).rejects.toThrow(/不存在/);
  });

  it('test_runTrainEval_引用dataset_version_可复现', async () => {
    // 章二衔接：先记一个 dataset_version，eval 报告引用它
    const { createHash } = await import('crypto');
    const contentHash = createHash('sha256').update('seed').digest('hex');
    const version = recordDatasetVersion(
      {
        dataDir,
        enterpriseId: 'ent-e',
        datasetId: 'ds-1',
        contentHash,
        sampleCount: 12,
        algorithm: 'sft',
        columnMapping: { instruction: 'q', output: 'a' },
        datasetFile: '/tmp/x.jsonl',
        createdAt: '2026-08-30T00:00:00.000Z',
      },
      'v1',
    );

    const { report } = await runTrainEval({
      dataDir,
      enterpriseId: 'ent-e',
      trainJobId: 'job-1',
      benchmarkId: 'bench-x',
      agentFn: async () => 'x',
      datasetVersionRef: { datasetId: 'ds-1', version: 'v1' },
      deps: {
        evalCaseFn: async () => caseEval(90),
        logRecordFn: () => ({} as never), // 不关心写入
        loadBenchmarkFn: () => makeBenchmark(),
      },
    });

    expect(report.datasetVersion).not.toBeNull();
    expect(report.datasetVersion?.contentHash).toBe(contentHash);
    expect(report.datasetVersion?.version).toBe('v1');
  });

  it('test_runTrainEval_单case失败不中断_进统计', async () => {
    // 场景：两 case 一成一败（failureCode 结构化）→ 失败率 0.5 超限 → continue
    const evals = [caseEval(95), caseEval(0, 'evaluation_failed')];
    let idx = 0;
    const { report } = await runTrainEval({
      dataDir,
      enterpriseId: 'ent-e',
      trainJobId: 'job-2',
      benchmarkId: 'bench-x',
      agentFn: async () => 'x',
      deps: {
        evalCaseFn: async () => evals[idx++],
        logRecordFn: () => ({} as never),
        loadBenchmarkFn: () => makeBenchmark(),
      },
    });
    expect(report.evaluations).toHaveLength(2); // 失败也进报告（不中断）
    expect(report.failureRate).toBe(0.5);
    expect(report.decision).toBe('continue');
  });

  it('test_runTrainEval_真实evaluation_log链路_默认logRecordFn落盘', async () => {
    // 场景：不注入 logRecordFn → 走真实 appendEvaluationRecord（HMAC 链）——
    // 临时 dataDir 落盘验证（零真实 LLM：evalCaseFn 仍注入）
    const { report, loggedRecords } = await runTrainEval({
      dataDir,
      enterpriseId: 'ent-e',
      trainJobId: 'job-3',
      benchmarkId: 'bench-real',
      agentFn: async () => 'x',
      deps: {
        evalCaseFn: async () => caseEval(88),
        loadBenchmarkFn: () => makeBenchmark('bench-real'),
      },
    });
    expect(loggedRecords).toBe(2);
    // 落盘验证：data/benchmarks/bench-real/evaluation-log.jsonl 两行
    const logPath = join(dataDir, 'benchmarks', 'bench-real', 'evaluation-log.jsonl');
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(first['agentId']).toBe('train:job-3');
    expect(first['score']).toBe(88);
    expect(report.decision).toBe('stop');
  });
});

// ──────────────────────────────────────
// 训练前后对比
// ──────────────────────────────────────

describe('train-eval-loop · 训练前后对比', () => {
  const baseReport = (score: number, contentHash: string | null): TrainEvalReport => ({
    trainJobId: 'job-b',
    enterpriseId: 'ent-e',
    benchmarkId: 'bench-x',
    evaluations: [caseEval(score)],
    averageScore: score,
    failureRate: 0,
    decision: 'stop',
    reason: '',
    datasetVersion:
      contentHash === null
        ? null
        : {
            version: 'v1',
            datasetId: 'ds-1',
            enterpriseId: 'ent-e',
            contentHash,
            sampleCount: 10,
            algorithm: 'sft',
            columnMapping: {},
            datasetFile: '/x',
            createdAt: '2026-08-30T00:00:00.000Z',
          },
    evaluatedAt: '2026-08-30T00:00:00.000Z',
  });

  it('test_compareEvalReports_提升且同数据集_归因训练', () => {
    const c = compareEvalReports(baseReport(70, 'aaa'), baseReport(88, 'aaa'));
    expect(c.scoreDelta).toBe(18);
    expect(c.improved).toBe(true);
    expect(c.sameDataset).toBe(true);
    expect(c.summary).toContain('训练有效');
  });

  it('test_compareEvalReports_跨数据集_警示归因', () => {
    const c = compareEvalReports(baseReport(70, 'aaa'), baseReport(88, 'bbb'));
    expect(c.sameDataset).toBe(false);
    expect(c.summary).toContain('数据已变');
  });

  it('test_compareEvalReports_回退_标注检查', () => {
    const c = compareEvalReports(baseReport(88, 'aaa'), baseReport(72, 'aaa'));
    expect(c.improved).toBe(false);
    expect(c.summary).toContain('回退');
  });
});
