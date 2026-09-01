// train-eval-loop.ts · v1.4.3 章三 · 训练中 eval 闭环（不 eval 的训练是盲训）
//
// 定位：OpenAI prove 思想——训练必须连着评估。train job 完成后自动跑
// Benchmark eval（复用 v1.3.1/v1.3.7 评测体系：case-evaluator 隔离执行
// read-only + statement/rubric 物理分离），分数 vs 目标阈值 → continue
// （继续训练调超参）/ stop（产出权重收工）分支判定。
//
// 机制开源 / 阈值外部化（2026-08-10 拍板）：本文件只提供 eval 运行机制，
// 「什么指标算合格」的验收阈值由部署侧配置注入（thresholds 参数——
// 商业侧/企业侧可配，机制是通用工程能力）。
//
// 复用来源：
//   - evaluateCase（benchmark/case-evaluator）：read-only 隔离评测单 case
//   - appendEvaluationRecord（benchmark/evaluation-log）：eval 结果写
//     evaluation-log.jsonl（v1.3.1 格式，HMAC 防篡改链）
//   - readBenchmarkLayout（benchmark/benchmark-designer）：Benchmark 题库回读
//   - dataset_version（章二 dataset-version）：eval 报告引用训练集版本——
//     训练前后对比可复现
//
// 依赖注入：评测函数（evalCaseFn）/ 记录函数（logRecordFn）/ 时钟（now）
// 全部可注入——单测零 LLM 调用、零真实落盘（对齐 train-env ExecFn 模式）。

import { evaluateCase, type EvaluateCaseInput, type CaseEvaluation } from '../benchmark/case-evaluator';
import {
  appendEvaluationRecord,
  type EvaluationLogInput,
  type EvaluationLogRecord,
} from '../benchmark/evaluation-log';
import {
  readBenchmarkLayout,
  benchmarksRoot,
  type BenchmarkDefinition,
} from '../benchmark/benchmark-designer';
import { getDatasetVersion, type DatasetVersionRecord } from './dataset-version';

// ══════════════════════════════════════
// 阈值配置（外部化——部署侧注入）
// ══════════════════════════════════════

/** eval 验收阈值（机制开源——阈值是部署侧配置项，不硬编码在引擎里） */
export interface EvalThresholds {
  /** 综合分达标线（0..100，均分 ≥ 此值才可 stop；缺省 80） */
  targetScore?: number;
  /** 单 case 最低分（0..100；均分达标但存在低于此值的 case → 建议 continue 补短板） */
  minCaseScore?: number;
  /** 失败 case 占比上限（0..1；evaluation_failed 占比超此值 → eval 本身可疑，重跑或人审） */
  maxFailureRate?: number;
}

/** 阈值缺省值（部署侧未注入时的兜底——显式常量便于文档对齐） */
export const DEFAULT_EVAL_THRESHOLDS: Required<EvalThresholds> = {
  targetScore: 80,
  minCaseScore: 50,
  maxFailureRate: 0.3,
};

/** eval 循环决策（阈值判定分支） */
export type EvalDecision = 'continue' | 'stop';

// ══════════════════════════════════════
// eval 结果模型
// ══════════════════════════════════════

/** 单轮 eval 报告（train job 完成后自动触发的一轮全量 case 评测） */
export interface TrainEvalReport {
  /** 训练任务标识 */
  trainJobId: string;
  /** 企业标识 */
  enterpriseId: string;
  /** Benchmark ID */
  benchmarkId: string;
  /** 各 case 评测明细 */
  evaluations: CaseEvaluation[];
  /** 综合（平均）分 0..100 */
  averageScore: number;
  /** 失败 case 占比（0..1） */
  failureRate: number;
  /** 阈值判定结论 */
  decision: EvalDecision;
  /** 判定理由（人读——决策面与审计消费） */
  reason: string;
  /** 引用的训练集版本（章二——训练前后对比可复现；未引用时 null） */
  datasetVersion: DatasetVersionRecord | null;
  /** 评测时间戳（ISO） */
  evaluatedAt: string;
}

/** 可注入依赖（单测零 LLM / 零真实落盘） */
export interface TrainEvalLoopDeps {
  /** 单 case 评测（缺省 evaluateCase——read-only 隔离执行） */
  evalCaseFn?: (input: EvaluateCaseInput) => Promise<CaseEvaluation>;
  /** eval 记录写入（缺省 appendEvaluationRecord——HMAC 链） */
  logRecordFn?: (input: EvaluationLogInput, overrideDataDir?: string) => EvaluationLogRecord;
  /** Benchmark 题库回读（缺省 readBenchmarkLayout——测试可注入固定题库） */
  loadBenchmarkFn?: (dataDir: string, benchmarkId: string) => BenchmarkDefinition | null;
  /** 时钟（缺省 Date.now——测试可注入固定值） */
  now?: () => number;
}

// ══════════════════════════════════════
// 阈值判定（纯函数）
// ══════════════════════════════════════

/** 汇总统计（均分 / 失败率——判定输入） */
export interface EvalScoreStats {
  averageScore: number;
  failureRate: number;
  minScore: number;
  caseCount: number;
}

/** 计算汇总统计（空列表 → 均分 0、失败率 1——「没跑成任何 case」按最差处理） */
export function computeScoreStats(evaluations: readonly CaseEvaluation[]): EvalScoreStats {
  if (evaluations.length === 0) {
    return { averageScore: 0, failureRate: 1, minScore: 0, caseCount: 0 };
  }
  const total = evaluations.reduce((sum, e) => sum + e.score, 0);
  const failed = evaluations.filter((e) => e.failureCode !== null).length;
  return {
    averageScore: total / evaluations.length,
    failureRate: failed / evaluations.length,
    minScore: Math.min(...evaluations.map((e) => e.score)),
    caseCount: evaluations.length,
  };
}

/**
 * 阈值判定 → continue / stop 分支（纯函数）。
 *
 * 判定序（先严重后宽松）：
 *   1. 失败率超限 → continue（reason 标注 eval 可疑——先修 eval 再谈训练好坏）
 *   2. 均分未达标 → continue（继续训练调超参）
 *   3. 均分达标但存在低分短板 case → continue（补短板）
 *   4. 全部达标 → stop（产出权重收工）
 */
export function decideFromScores(
  stats: EvalScoreStats,
  thresholds: EvalThresholds = {},
): { decision: EvalDecision; reason: string } {
  const t = { ...DEFAULT_EVAL_THRESHOLDS, ...thresholds };
  if (stats.caseCount === 0) {
    return { decision: 'continue', reason: '未产出任何 case 评测结果——eval 异常，先排查再继续' };
  }
  if (stats.failureRate > t.maxFailureRate) {
    return {
      decision: 'continue',
      reason: `失败 case 占比 ${(stats.failureRate * 100).toFixed(1)}% 超上限 ${(t.maxFailureRate * 100).toFixed(0)}%——eval 本身可疑，先修评测链路再判定训练好坏`,
    };
  }
  if (stats.averageScore < t.targetScore) {
    return {
      decision: 'continue',
      reason: `综合分 ${stats.averageScore.toFixed(1)} 未达标线 ${t.targetScore}——继续训练（建议调整超参或补数据）`,
    };
  }
  if (stats.minScore < t.minCaseScore) {
    return {
      decision: 'continue',
      reason: `综合分 ${stats.averageScore.toFixed(1)} 已达标，但存在低分短板 case（最低 ${stats.minScore} < ${t.minCaseScore}）——建议补短板样本继续训练`,
    };
  }
  return {
    decision: 'stop',
    reason: `综合分 ${stats.averageScore.toFixed(1)} ≥ ${t.targetScore} 且无短板 case（最低 ${stats.minScore}）——达标收工，产出权重`,
  };
}

// ══════════════════════════════════════
// eval 闭环主流程
// ══════════════════════════════════════

/** eval 触发入参 */
export interface RunTrainEvalInput {
  dataDir: string;
  enterpriseId: string;
  trainJobId: string;
  /** Benchmark ID（题库在 data/benchmarks/<id>/） */
  benchmarkId: string;
  /** 被测 Agent 执行函数（透传 evaluateCase 的 agentFn——生产为训后模型调用） */
  agentFn: EvaluateCaseInput['agentFn'];
  /** 验收阈值（外部化配置——部署侧注入） */
  thresholds?: EvalThresholds;
  /** 引用的训练集版本（章二 dataset_version——未引用省略） */
  datasetVersionRef?: { datasetId: string; version: string };
  /** 依赖注入 */
  deps?: TrainEvalLoopDeps;
  /** dataDir 覆盖（eval 落盘隔离——测试用；缺省 input.dataDir） */
  overrideDataDir?: string;
}

/** eval 触发结果 */
export interface RunTrainEvalResult {
  report: TrainEvalReport;
  /** 写入 evaluation-log 的记录数（与 evaluations 同长——逐 case 一条） */
  loggedRecords: number;
}

/**
 * 训练后自动 eval：全量 case 隔离评测 → 阈值判定 → 逐 case 写 evaluation-log
 * （v1.3.1 格式 HMAC 链）→ 报告引用 dataset_version。
 *
 * 题库缺失 → 结构化错误抛出（eval 是训练闭环的一环，题库没有就不是
 * 「可以跳过」而是「必须先建」——fail fast）。单个 case 评测异常不中断
 * 整轮（evaluateCase 内部已按 failureCode 结构化失败——失败也进统计）。
 */
export async function runTrainEval(input: RunTrainEvalInput): Promise<RunTrainEvalResult> {
  const deps = input.deps ?? {};
  const evalCase = deps.evalCaseFn ?? evaluateCase;
  const logRecord = deps.logRecordFn ?? appendEvaluationRecord;
  const loadBenchmark =
    deps.loadBenchmarkFn ?? ((dataDir: string, id: string) => readBenchmarkLayout(benchmarksRoot(dataDir), id));

  const def = loadBenchmark(input.dataDir, input.benchmarkId);
  if (def === null) {
    throw new Error(
      `[train-eval-loop] Benchmark ${input.benchmarkId} 不存在（data/benchmarks/ 下未找到）——eval 是训练闭环必经环节，请先建题库（createBenchmark + addCase + freeze）`,
    );
  }

  // ── 逐 case 隔离评测（read-only——evaluateCase 强制）──
  // 元数据锚定题库为准：评测结果归属以被评 case（c.id / def.id / def.revision）
  // 为准，不信任评测器回显（防注入侧/实现侧漂移导致日志归属错位）。
  const evaluations: CaseEvaluation[] = [];
  for (const c of def.cases) {
    const result = await evalCase({
      benchmarkId: def.id,
      caseId: c.id,
      statement: c.statement,
      rubric: c.rubric,
      actualRevision: def.revision,
      agentFn: input.agentFn,
    });
    evaluations.push({ ...result, benchmarkId: def.id, caseId: c.id, revision: def.revision });
  }

  // ── 阈值判定（外部化阈值——部署侧注入或缺省）──
  const stats = computeScoreStats(evaluations);
  const { decision, reason } = decideFromScores(stats, input.thresholds);

  // ── 引用训练集版本（章二——eval 可复现的关键引用）──
  let datasetVersion: DatasetVersionRecord | null = null;
  if (input.datasetVersionRef) {
    datasetVersion = getDatasetVersion(
      input.dataDir,
      input.enterpriseId,
      input.datasetVersionRef.datasetId,
      input.datasetVersionRef.version,
    );
  }

  // ── 逐 case 写 evaluation-log（v1.3.1 格式 + HMAC 链；agentId 带 trainJobId 溯源）──
  let loggedRecords = 0;
  for (const e of evaluations) {
    try {
      logRecord(
        {
          benchmarkId: e.benchmarkId,
          caseId: e.caseId,
          revision: e.revision,
          score: e.score,
          failureCode: e.failureCode,
          agentId: `train:${input.trainJobId}`,
          durationMs: e.durationMs,
        },
        input.overrideDataDir ?? input.dataDir,
      );
      loggedRecords += 1;
    } catch {
      // 单条日志写入失败不中断整轮（eval 结果已在报告里——日志失败可事后补录）
    }
  }

  const report: TrainEvalReport = {
    trainJobId: input.trainJobId,
    enterpriseId: input.enterpriseId,
    benchmarkId: def.id,
    evaluations,
    averageScore: stats.averageScore,
    failureRate: stats.failureRate,
    decision,
    reason,
    datasetVersion,
    evaluatedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
  };
  return { report, loggedRecords };
}

// ══════════════════════════════════════
// 训练前后对比（eval 报告消费形态）
// ══════════════════════════════════════

/** 两轮 eval 报告对比（SFT 基线 vs RL 后——训练是否有效一眼可判） */
export interface EvalComparison {
  /** 后轮相对前轮的均分变化 */
  scoreDelta: number;
  /** 是否提升 */
  improved: boolean;
  /** 两轮是否引用同一训练集版本（数据没变，分数变化才归因训练） */
  sameDataset: boolean;
  /** 人读摘要 */
  summary: string;
}

/**
 * 训练前后对比（纯函数——两份 TrainEvalReport 输入）。
 * sameDataset=false 时 summary 必标注「数据已变」——归因要谨慎
 * （章二 diffDatasetVersions 的判定哲学延伸到 eval 对比）。
 */
export function compareEvalReports(baseline: TrainEvalReport, after: TrainEvalReport): EvalComparison {
  const scoreDelta = after.averageScore - baseline.averageScore;
  const sameDataset =
    baseline.datasetVersion !== null &&
    after.datasetVersion !== null &&
    baseline.datasetVersion.contentHash === after.datasetVersion.contentHash;
  const parts = [
    `均分 ${baseline.averageScore.toFixed(1)} → ${after.averageScore.toFixed(1)}（${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(1)}）`,
    scoreDelta > 0 ? '训练有效（分数提升）' : scoreDelta < 0 ? '⚠ 分数回退——检查超参/数据质量' : '分数持平',
  ];
  if (!sameDataset) {
    if (baseline.datasetVersion === null || after.datasetVersion === null) {
      parts.push('⚠ 有 eval 轮未引用训练集版本——无法验证数据一致性，归因需谨慎');
    } else {
      parts.push('⚠ 数据已变（两轮训练集 contentHash 不同）——分数变化可能来自数据而非训练，先对齐数据再归因');
    }
  }
  return { scoreDelta, improved: scoreDelta > 0, sameDataset, summary: parts.join('；') };
}
