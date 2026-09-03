// train-compare.ts · 多基座对比训练（同一数据多基座并行 → ROI 排序）
//
// 定位：后训练阶段 2 的选型前置——Qwen3 vs R1-Distill、7B vs 14B 这类
// 对比实验，手动跑既慢又不可复现。本模块把「同一数据多基座并行提交 →
// 对比报告」做成引擎能力：
//
//   trainCompare({ dataPath, bases: ['qwen3-8b', 'r1-distill-7b'] })
//     → 同一数据 hash（computeDatasetHash——可复现性锚点）
//     → 每基座一个 train job（同超参模板，仅 baseModel 不同）
//     → GPU 队列控并发（estimateTrainVramMiB 估算显存 → acquire/release）
//     → 各基座完成后汇总对比报告（eval 分数 + 成本 + ROI 排序）
//
// ROI 口径（eval ÷ 成本）：eval 分数来自 v1.4.2 train-eval-loop，训练成本
// 来自 train job usage（elapsedMinutes + steps + cost——预算三维度中的
// 实际用量）。ROI = evalScore / trainCost（成本为 0 时按 Infinity 处理——
// 零成本满分是最优；实际部署时成本恒 > 0）。
//
// 依赖注入：train job 提交（submitFn）/ eval 执行（evalFn）可注入——
// 单测零真实训练、零 LLM 调用（对齐 train-env ExecFn 模式）。

import {
  createTrainJob,
  loadTrainJobRecord,
  type CreateTrainJobResult,
  type TrainJobRecord,
} from './train-job';
import { computeDatasetHash } from './train-fingerprint';
import type { TrainEvalReport } from './train-eval-loop';
import { createGpuQueue, estimateTrainVramMiB, type GpuQueueSnapshot } from './gpu-queue';

// ══════════════════════════════════════
// 数据模型
// ══════════════════════════════════════

/** 单基座条目（对比实验的一个臂） */
export interface CompareBaseSpec {
  /** 基座模型标识（如 'qwen3-8b' / 'Qwen/Qwen3-8B'） */
  baseModel: string;
  /** 该基座的超参覆盖（合并进同模板——基座特定超参如 context_length） */
  hyperparamsOverride?: Record<string, unknown>;
}

/** trainCompare 入参 */
export interface TrainCompareInput {
  /** 数据根目录 */
  dataDir: string;
  /** 企业标识（隔离分区） */
  enterpriseId: string;
  /** 训练数据路径（全部基座共用——同 hash 是对比的前提） */
  dataPath: string;
  /** 对比基座列表（≥2 才有对比意义；=1 时是普通单基座训练） */
  bases: CompareBaseSpec[];
  /** 训练算法 */
  algorithm: 'sft' | 'dpo' | 'grpo';
  /** 共享超参模板（各基座相同——差异只允许来自 baseModel 与 override） */
  hyperparams?: Record<string, unknown>;
  /** 预算（透传各 job——超限 SIGINT 暂停） */
  budget?: { maxMinutes?: number; maxSteps?: number; maxCost?: number };
  /** GPU 总显存预算（MiB——0/缺省 serial 串行；>0 budget 并发模式） */
  gpuTotalMiB?: number;
  /** GPU 最大并发上限（缺省 Infinity） */
  gpuMaxConcurrent?: number;
  /** 时钟注入（测试） */
  now?: () => number;
}

/** 单基座执行结果 */
export interface CompareBaseResult {
  /** 基座标识 */
  baseModel: string;
  /** 提交的 train job id */
  trainJobId: string;
  /** job 状态（submitted 时 queued——对比报告在全部完成后生成） */
  status: TrainJobRecord['status'];
  /** 该基座最终 eval 报告（尚未跑时 null——报告生成需传入） */
  evalReport: TrainEvalReport | null;
  /** 训练成本（usage 快照——elapsedMinutes/steps/cost 三维） */
  usage: { elapsedMinutes: number; steps: number; cost: number };
}

/** ROI 排序条目（对比报告核心） */
export interface RoiRankEntry {
  /** 基座标识 */
  baseModel: string;
  /** eval 综合分（0..100） */
  evalScore: number;
  /** 训练成本（元——usage.cost；缺省 0） */
  trainCost: number;
  /** 训练耗时（分钟） */
  elapsedMinutes: number;
  /** ROI = evalScore / trainCost（trainCost=0 → Infinity） */
  roi: number;
  /** 排名（1 = 最优——ROI 降序） */
  rank: number;
  /** 人读摘要 */
  summary: string;
}

/** 对比报告 */
export interface TrainCompareReport {
  /** 对比实验标识（compare-<hash8>） */
  compareId: string;
  /** 共享数据 hash（可复现性锚点——全部基座同一份） */
  datasetHash: string;
  /** 参与基座 */
  bases: CompareBaseSpec[];
  /** 各基座执行结果（提交顺序） */
  results: CompareBaseResult[];
  /** ROI 排序（降序——rank 1 最优） */
  ranking: RoiRankEntry[];
  /** 生成时间（ISO） */
  generatedAt: string;
}

/** trainCompare 依赖注入（单测零真实训练） */
export interface TrainCompareDeps {
  /** train job 提交（缺省 createTrainJob） */
  submitFn?: (input: CreateTrainJobInputAlias) => CreateTrainJobResult;
  /** 时钟（缺省 Date.now） */
  now?: () => number;
}

/** CreateTrainJobInput 别名（循环引用规避——train-job 模块直引） */
type CreateTrainJobInputAlias = Parameters<typeof createTrainJob>[0];

// ══════════════════════════════════════
// 主流程
// ══════════════════════════════════════

/**
 * 多基座对比训练——同一数据并行提交 + GPU 队列控并发。
 *
 * 校验：
 *   一、bases 非空（空列表无对比意义）
 *   二、dataPath 存在（数据路径缺失直接拒——同 hash 前提）
 *
 * 并发控制（诚实口径）：acquire 只做「提交时点的显存账本记账」——
 * submit 与 acquire 均发生在提交刻，真正的训练进程由训练框架自行
 * 拉起；队列对象随本函数返回即不再持有（快照留档给监控面）。
 * 跨任务生命周期的真并发管控在 train-scheduler（release 由任务终态
 * 触发）——本模块不越权声称。
 *
 * 对比报告的生成分两步（提交与汇总解耦）：
 *   步一 submitCompareJobs：提交全部基座 job（本函数）
 *   步二 buildCompareReport：全部完成后汇总 ROI 排序（独立函数——
 *   eval 结果就绪后调用，避免提交方阻塞等训练）
 *   中间态（usage / evalReport 回填）：refreshCompareResults（独立函数——
 *   从 job 记录拉真实用量，防 ROI 恒 ∞/0 失真）
 */
export function submitCompareJobs(
  input: TrainCompareInput,
  deps?: TrainCompareDeps,
): { ok: true; jobs: CompareBaseResult[]; gpuSnapshot: GpuQueueSnapshot } | { ok: false; issues: string[] } {
  const submit = deps?.submitFn ?? createTrainJob;
  const now = deps?.now ?? input.now ?? Date.now;

  // 校验一：bases 非空
  if (!Array.isArray(input.bases) || input.bases.length === 0) {
    return { ok: false, issues: ['bases 非空——至少一个基座（对比实验的基本前提）'] };
  }
  // 校验二：dataPath 必填（hash 计算前提）
  if (typeof input.dataPath !== 'string' || input.dataPath.trim() === '') {
    return { ok: false, issues: ['dataPath 必填——同一数据是多基座对比的可复现性前提'] };
  }

  // 共享数据 hash（对比锚点——报告与全部 job 同源）
  const datasetHash = computeDatasetHash(input.dataPath);

  // GPU 队列：预算并发 or 串行（对比任务同规格——基座间显存差异按估算）
  const queue = createGpuQueue({
    totalMiB: input.gpuTotalMiB ?? 0,
    maxConcurrent: input.gpuMaxConcurrent,
    now,
  });
  const jobs: CompareBaseResult[] = [];
  for (const base of input.bases) {
    const hyperparams = { ...(input.hyperparams ?? {}), ...(base.hyperparamsOverride ?? {}) };
    const jobId = `compare-${datasetHash.slice(0, 8)}-${slugify(base.baseModel)}`;
    // 提交时点显存记账（acquire 先于 submit——显存超总预算的任务不提交，不放行 OOM 组合）
    const requiredMiB = estimateTrainVramMiB(base.baseModel, input.algorithm, hyperparams);
    const acquired = queue.acquire(jobId, requiredMiB);
    const totalBudget = (input.gpuTotalMiB ?? 0) > 0 ? input.gpuTotalMiB! : null;
    // 拒绝语义只针对「单任务自身超总预算」——排到天荒地老也进不去；
    // 「预算够但当前被占」是合法排队（GPU 队列 pump 语义），照常提交
    if (!acquired && totalBudget !== null && requiredMiB > totalBudget) {
      return {
        ok: false,
        issues: [
          `GPU 显存预算不足：${base.baseModel}（估算 ${requiredMiB} MiB）超出总预算 ${totalBudget} MiB——该任务永远排不进，调大 gpuTotalMiB 或换小基座`,
          ...jobs.map((j) => `已提交：${j.baseModel}（${j.trainJobId}）`),
        ],
      };
    }
    const res = submit({
      dataDir: input.dataDir,
      enterpriseId: input.enterpriseId,
      jobId,
      dataPath: input.dataPath,
      baseModel: base.baseModel,
      algorithm: input.algorithm,
      hyperparams,
      ...(input.budget ? { budget: input.budget } : {}),
    });
    if (!res.created && res.record.status === 'completed') {
      // 幂等命中已完成的 job——对比重放场景（同数据同基座重提交）
      // 复用既有 job（train-job 幂等语义），不重复训练。
      // usage 从既有记录回填（幂等路径不再恒零——ROI 数字保真）
      jobs.push({
        baseModel: base.baseModel,
        trainJobId: jobId,
        status: res.record.status,
        evalReport: null,
        usage: { ...res.record.usage },
      });
      continue;
    }
    jobs.push({
      baseModel: base.baseModel,
      trainJobId: jobId,
      status: res.record.status,
      evalReport: null,
      usage: { elapsedMinutes: 0, steps: 0, cost: 0 },
    });
  }

  return { ok: true, jobs, gpuSnapshot: queue.snapshot() };
}

/** baseModel → jobId 片段（斜杠等非法字符转 -） */
function slugify(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-_.]/g, '-').toLowerCase();
}

// ═════ 中间态回填（步一与步二之间——usage/status 从 job 记录拉真实值）═════

/** refreshCompareResults 入参 */
export interface RefreshCompareInput {
  /** 步一返回的基座结果（原地更新——引用语义，便于调用方持同一数组） */
  results: CompareBaseResult[];
  /** 数据根 */
  dataDir: string;
  /** 企业标识（job 记录分区） */
  enterpriseId: string;
  /** job 记录读取（测试注入——缺省 loadTrainJobRecord） */
  loadRecord?: typeof loadTrainJobRecord;
}

/**
 * 中间态回填——从 train job 记录拉真实 usage 与 status。
 *
 * 为什么需要：submitCompareJobs 提交刻的 usage 恒零（还没跑）、
 * buildCompareReport 的 ROI = evalScore / trainCost——不回填则恒 ∞/0，
 * 对比报告核心数字失真。外部调用方在「全部基座完成后、生成报告前」
 * 调本函数一次（或轮询调至全部终态）。
 *
 * evalReport 不在本函数职责内：eval 报告由 train-eval-loop 产出
 * （runTrainEval 返回），由调用方按需注入 results[i].evalReport——
 * 引用语义原地更新，改写即生效。
 */
export function refreshCompareResults(input: RefreshCompareInput): CompareBaseResult[] {
  const load = input.loadRecord ?? loadTrainJobRecord;
  for (const r of input.results) {
    const rec = load(input.dataDir, input.enterpriseId, r.trainJobId);
    if (rec === null) continue; // 记录缺席（被清理）——保留原值如实呈现
    r.status = rec.status;
    r.usage = { ...rec.usage };
  }
  return input.results;
}

// ═════ 报告汇总（步二——全部完成后调用）═════

/** buildCompareReport 入参 */
export interface BuildCompareReportInput {
  /** 对比实验的基座结果（各 job 已完成 + eval 已跑） */
  results: CompareBaseResult[];
  /** 数据 hash（submitCompareJobs 返回的 datasetHash——可复现性锚点） */
  datasetHash: string;
  /** 时钟（缺省 Date.now） */
  now?: () => number;
}

/**
 * 汇总对比报告——eval 分数 + 成本 + ROI 排序。
 *
 * ROI = evalScore / trainCost：
 *   - trainCost = 0 且 evalScore > 0 → Infinity（理论最优——零成本拿分）
 *   - evalScore = 0 → ROI = 0（没分白花钱）
 *   - Infinity 排最前（降序）
 *
 * 未完成的基座（evalReport=null）不参与排序——对比报告只含完成基座
 * （未完成的不该进 ROI 比较扭曲结论）。
 */
export function buildCompareReport(input: BuildCompareReportInput): TrainCompareReport {
  const now = input.now ?? Date.now;
  const entries: RoiRankEntry[] = input.results
    .filter((r) => r.evalReport !== null)
    .map((r) => {
      const evalScore = r.evalReport!.averageScore;
      const trainCost = r.usage.cost;
      const roi = trainCost > 0 ? evalScore / trainCost : evalScore > 0 ? Number.POSITIVE_INFINITY : 0;
      return {
        baseModel: r.baseModel,
        evalScore: Math.round(evalScore * 10) / 10,
        trainCost,
        elapsedMinutes: r.usage.elapsedMinutes,
        roi,
        rank: 0, // 排序后回填
        summary: '',
      };
    });

  // ROI 降序（Infinity 最前；同 ROI 按 evalScore 高者优先——分高的赢）
  const sorted = [...entries].sort((a, b) => {
    if (b.roi !== a.roi) return b.roi - a.roi;
    return b.evalScore - a.evalScore;
  });
  sorted.forEach((e, i) => {
    e.rank = i + 1;
    e.summary = `${e.baseModel}：eval ${e.evalScore} 分 / 训练成本 ${e.trainCost} 元 → ROI ${formatRoi(e.roi)}（第 ${e.rank} 名）`;
  });

  return {
    compareId: `compare-${input.datasetHash.slice(0, 8)}`,
    datasetHash: input.datasetHash,
    bases: input.results.map((r) => ({ baseModel: r.baseModel })),
    results: input.results,
    ranking: sorted,
    generatedAt: new Date(now()).toISOString(),
  };
}

/** ROI 人读形态（Infinity → '∞'） */
function formatRoi(roi: number): string {
  return Number.isFinite(roi) ? roi.toFixed(2) : '∞';
}
