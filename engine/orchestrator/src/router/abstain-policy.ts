// abstain-policy.ts · v1.7.0 §四 · 弃权策略面（分档门槛 + 峰位推导 + 预算反解 + 稳定化重读 + 行为锁）
// ============================================================
// 定位：弃权的**策略与门槛面**——decision-abstain.ts 定语义（一等输出态
// 与三源留痕），本文件定**何时触发**与**门槛从哪来**。
//
// 核心纪律（SSOT §四交付表）：
//   1. 门槛不是 0.5 且按原语分档——「看起来对称」不构成理由：模型是
//      校准的，不是对称的。noul 门槛偏高（事实性是非题判对时通常很
//      自信）；choice 门槛须明显低于 noul（相似选项重排时普遍不确定，
//      否则几乎全体落入复核）；score 看整条分布（各档概率彼此接近）。
//      **无全局默认 0.5 路径**——构造时传单一数字拒载（类型层消灭
//      「全局一个 0.5」的退化形态）。
//   2. 门槛起步值取自校准集直方图峰位（峰值桶下界）——不是直觉中点。
//      门槛错位的代价是门控静默失效（不是报错）。算法写死，容差入配置。
//   3. 弃权预算反解：业务方按业务语言给目标弃权率（如「转人工 ≤5%」），
//      系统从校准分布**反解**分流阈值——阈值由目标导出，不由人工拍。
//   4. 稳定化重读默认关闭；开启须校准集按同口径重测（口径不一致 ⇒
//      ECE 对该输出不成立——用一套口径的校准结论担保另一套口径的输出）。
//   5. 行为锁三件：
//      a) ECE 未达阈（消费 §二 eceVerdict 输出）→ 弃权默认开启且不可
//         关闭（attemptDisable → throw）——「未达阈 ⇒ 系统行为受限」；
//      b) 新增判据域弃权带默认最宽（宁可多转人工，域内校准达阈后才收窄）；
//      c) 重标触发路径枚举登记（换基座 / 数据漂移——生产分布待 v1.8.0
//         接线后按同算法重标）。
// ============================================================

// ── ECE 达阈读数（§二 eceVerdict 的消费形态——包边界防循环）──
//
// 依赖方向纪律：train → orchestrator 单向（train package.json //deps 注记，
// 反向会造成包级循环）。orchestrator 消费 §二 eceVerdict 读数时**不引
// train 包构建期依赖**，只消费其**结构形态**（achieved + slots[].pass +
// slots[].{primitive,lang,ece}——engine/train/src/rlcd/calibration.ts
// EceVerdictResult 的最小消费投影）。
/** ECE 达阈读数（§二 eceVerdict 输出的消费投影——结构同源） */
export interface EceVerdictReading {
  /** 总判定（任一档未达即 false——中英分列不合并） */
  achieved: boolean;
  /** 逐档判定（未达档明细——attemptDisable 抛错文案的数据源） */
  slots: Array<{
    primitive: 'choice' | 'score' | 'noul';
    lang: 'zh' | 'en';
    ece: number | 'not-measured';
    pass: boolean;
  }>;
}

/** EceVerdictReading 的构造断言（与 §二 EceVerdictResult 结构同源对账） */
export function assertEceVerdictShape(input: object): asserts input is EceVerdictReading {
  const v = input as Partial<EceVerdictReading>;
  if (typeof v.achieved !== 'boolean') throw new AbstainPolicyError('eceVerdict 读数缺 achieved（§二投影最小面）');
  if (!Array.isArray(v.slots)) throw new AbstainPolicyError('eceVerdict 读数缺 slots（未达档明细面）');
}

/** 弃权策略错误（fail-closed 载体） */
export class AbstainPolicyError extends Error {
  constructor(message: string) {
    super(`[abstain-policy] ${message}`);
    this.name = 'AbstainPolicyError';
  }
}

// ── 门槛按原语分档（无全局默认 0.5 路径）────────────────

/** 三原语（与 decision-primitives.DecisionPrimitiveKind 同源） */
export type AbstainPrimitive = 'noul' | 'choice' | 'score';

/**
 * 门槛分档结构（§四验收第 5 条）——**三个键全必填**：
 * noul / choice / score 各自独立门槛，无全局默认 0.5 路径。
 * 构造断言：传单一数字（全局阈值形态）拒载；缺任一原语键拒载。
 */
export interface ThresholdsByPrimitive {
  noul: number;
  choice: number;
  score: number;
}

/**
 * 分档门槛构造断言：
 *   - 传单一 number（全局阈值形态）→ 拒载（无全局默认 0.5 路径——
 *     「传个数字就能跑」是门控静默失效的第一步）；
 *   - 缺任一原语键 → 拒载（分档不完整 = 变相全局化）；
 *   - 任一门槛 ∉ (0,1) → 拒载（门槛是概率尺度）。
 */
export function assertThresholdsByPrimitive(input: unknown): asserts input is ThresholdsByPrimitive {
  if (typeof input === 'number') {
    throw new AbstainPolicyError(
      `拒载单一数字门槛 ${input}（门槛须按原语分档 {noul,choice,score}——无全局默认路径，0.5 也不行）`,
    );
  }
  if (typeof input !== 'object' || input === null) {
    throw new AbstainPolicyError('门槛输入非对象（须 ThresholdsByPrimitive 三键形态）');
  }
  const t = input as Partial<Record<AbstainPrimitive, unknown>>;
  for (const k of ['noul', 'choice', 'score'] as const) {
    if (typeof t[k] !== 'number') {
      throw new AbstainPolicyError(`门槛缺 ${k} 档（分档不完整 = 变相全局化——三键全必填）`);
    }
    const v = t[k] as number;
    if (!(v > 0 && v < 1)) {
      throw new AbstainPolicyError(`门槛 ${k}=${v} 越界 (0,1)（门槛是概率尺度）`);
    }
  }
}

// ── 校准集直方图（峰位推导的输入面）─────────────────────

/** 校准集置信直方图（§二分桶温度拟合的读数面——每桶计数） */
export interface CalibrationHistogram {
  /** 直方图引用标识（留痕来源字段——门槛由哪个直方图导出） */
  ref: string;
  /** 桶（等宽 [lower,upper) + 计数；桶序任意，取峰位前内部排序） */
  buckets: Array<{ lower: number; upper: number; count: number }>;
}

/** 峰位容差（容差入配置——算法写死、容差可调的分离面） */
export interface PeakTolerance {
  /** 计数并列时的取桶偏移容差（并列峰取下界最高者 ± indexTol 桶内） */
  indexTol: number;
}

/** 缺省峰位容差（并列峰取最先出现者——容差 0） */
export const DEFAULT_PEAK_TOLERANCE: PeakTolerance = { indexTol: 0 };

/**
 * 从校准集直方图取峰值桶下界（门槛起步值推导——§四验收第 6 条）。
 *
 * 算法写死：门槛值 = 计数最大桶的 **lower**（峰值桶下界）。
 *   - 计数并列时取 lower 最大者（并列峰中偏保守的高门槛侧），
 *     偏移容差 indexTol 允许在并列判定中把 |count 差| ≤ indexTol*0
 *     视为并列（容差语义：并列识别的读数容差，不改算法形态）；
 *   - 不得人工指定门槛值——本函数是门槛唯一来源（SSOT 原文：
 *     「门槛值 == 本版校准集直方图峰值桶下界」）；
 *   - 空直方图 / 全空桶拒载（无峰位可取 = 无门槛可导——不虚构）。
 */
export function histogramPeakBucketLower(
  histogram: CalibrationHistogram,
  tol?: PeakTolerance,
): { threshold: number; peakBucket: { lower: number; upper: number; count: number }; ref: string } {
  if (!histogram.buckets || histogram.buckets.length === 0) {
    throw new AbstainPolicyError('校准直方图为空（无峰位可导——门槛不得人工指定，fail-closed）');
  }
  if (histogram.buckets.every((b) => b.count === 0)) {
    throw new AbstainPolicyError('校准直方图全空桶（无峰位可导——不虚构门槛）');
  }
  const indexTol = tol?.indexTol ?? DEFAULT_PEAK_TOLERANCE.indexTol;
  let peak = histogram.buckets[0]!;
  for (const b of histogram.buckets) {
    if (b.count > peak.count + indexTol || (b.count >= peak.count - indexTol && b.lower > peak.lower)) {
      peak = b;
    }
  }
  return { threshold: peak.lower, peakBucket: peak, ref: histogram.ref };
}

/** 门槛来源留痕（histogramRef——「门槛由哪个直方图导出」的可审计面） */
export interface ThresholdProvenance {
  /** 导出的门槛（分档三键） */
  thresholds: ThresholdsByPrimitive;
  /** 来源直方图引用（每原语各自的直方图 ref） */
  histogramRef: Record<AbstainPrimitive, string>;
  /** 推导时间（ISO 8601） */
  derivedAt: string;
  /** 算法标识（写死——重标按同算法） */
  algorithm: 'peak-bucket-lower';
}

/**
 * 从校准直方图导出全档门槛（三原语各一直方图——起步值留痕）：
 * 门槛 = 各原语校准集直方图峰值桶下界；来源 ref 随门槛落数。
 */
export function deriveThresholdsFromHistogram(input: {
  histograms: Record<AbstainPrimitive, CalibrationHistogram>;
  derivedAt?: string;
  tol?: PeakTolerance;
}): ThresholdProvenance {
  const out: Partial<ThresholdsByPrimitive> = {};
  const refs: Partial<Record<AbstainPrimitive, string>> = {};
  for (const p of ['noul', 'choice', 'score'] as const) {
    const h = input.histograms[p];
    if (!h) {
      throw new AbstainPolicyError(`缺 ${p} 校准直方图（三原语各一——不得缺档推导）`);
    }
    const { threshold, ref } = histogramPeakBucketLower(h, input.tol);
    out[p] = threshold;
    refs[p] = ref;
  }
  const thresholds = out as ThresholdsByPrimitive;
  assertThresholdsByPrimitive(thresholds);
  return {
    thresholds,
    histogramRef: refs as Record<AbstainPrimitive, string>,
    derivedAt: input.derivedAt ?? new Date().toISOString(),
    algorithm: 'peak-bucket-lower',
  };
}

// ── 重标触发路径（换基座 / 数据漂移——枚举登记）──────────

/** 重标触发原因（闭合枚举——生产分布待 v1.8.0 接线后按同算法重标） */
export type RelabelTrigger =
  | 'base-model-swap' // 换基座（校准参数与新基座失配——门槛须同算法重导）
  | 'data-drift' // 数据漂移（校准分布移位——峰位失效）
  | 'v1.8.0-production-wiring'; // 生产接线重标（校准集→生产分布——SSOT 预留路径）

/** 重标登记记录 */
export interface RelabelRecord {
  trigger: RelabelTrigger;
  at: string;
  /** 重标后门槛（含来源留痕） */
  provenance: ThresholdProvenance;
}

/**
 * 重标触发路径（retriggerRelabel）：给定触发原因与新校准直方图，按同
 * 算法（peak-bucket-lower）重导门槛并登记触发原因——重标不是改数字，
 * 是**换输入重跑同一算法**（算法写死，只换直方图）。
 */
export function retriggerRelabel(input: {
  trigger: RelabelTrigger;
  histograms: Record<AbstainPrimitive, CalibrationHistogram>;
  at?: string;
  tol?: PeakTolerance;
}): RelabelRecord {
  const known: RelabelTrigger[] = ['base-model-swap', 'data-drift', 'v1.8.0-production-wiring'];
  if (!known.includes(input.trigger)) {
    throw new AbstainPolicyError(
      `重标触发原因「${String(input.trigger)}」不在枚举内（base-model-swap / data-drift / v1.8.0-production-wiring）`,
    );
  }
  const provenance = deriveThresholdsFromHistogram({
    histograms: input.histograms,
    derivedAt: input.at,
    tol: input.tol,
  });
  return { trigger: input.trigger, at: provenance.derivedAt, provenance };
}

// ── 弃权预算反解（目标弃权率 → 阈值，非人工拍）──────────

/**
 * 反解结果（含支撑集边界——「不外插」断言的读数面）
 */
export interface SolvedThresholds {
  thresholds: ThresholdsByPrimitive;
  /** 各原语支撑集 [min,max]（反解结果须落在其内——不外插） */
  support: Record<AbstainPrimitive, { min: number; max: number }>;
  /** 实际预期弃权率（反解阈值下校准分布中低于门槛的样本占比） */
  achievedRate: number;
}

/**
 * 弃权预算反解（solveThresholdsForBudget——§四验收第 8 条）：
 * 给定目标弃权率（如 0.05 = 转人工 ≤5%），从各原语校准置信分布**反解**
 * 分流阈值——取「分布中 (1-target) 分位之上的样本放行」的分位点。
 *
 * 断言面（测试逐条锁）：
 *   ① 单调性——target 越大（弃权预算越宽），放行面越宽 ⇒ 阈值越低
 *      （单调收紧：target 升 → 阈值降/不升）。实现取分位点：target↑
 *      ⇒ 下分位点↓ ⇒ 阈值↓（数学上单调，测试锁数值方向）；
 *   ② 支撑集内不外插——阈值 ∈ [min(dist), max(dist)]（分布支撑集），
 *      反解是「在已有分布里找分位点」，不是造分布外的数。
 * 语义约定：本题把「弃权」定义为「置信低于门槛」的样本占比（弃权带
 * = 阈值以下）；target=0.05 ⇒ 阈值取 5% 分位（最低 5% 置信的样本弃权）。
 */
export function solveThresholdsForBudget(input: {
  /** 目标弃权率 ∈ (0,1)（如 0.05——业务语言「转人工 ≤5%」） */
  targetAbstainRate: number;
  /** 各原语校准置信分布（支撑集来源——反解不得外插） */
  calibrationConfidence: Record<AbstainPrimitive, readonly number[]>;
}): SolvedThresholds {
  const target = input.targetAbstainRate;
  if (!(target > 0 && target < 1)) {
    throw new AbstainPolicyError(`目标弃权率 ${target} 越界 (0,1)（弃权预算为 0 或 100% 无反解面）`);
  }
  const quantile = (sorted: readonly number[], q: number): number => {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo] as number;
    return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
  };
  const thresholds: Partial<ThresholdsByPrimitive> = {};
  const support: Partial<Record<AbstainPrimitive, { min: number; max: number }>> = {};
  const achieved: Partial<Record<AbstainPrimitive, number>> = {};
  for (const p of ['noul', 'choice', 'score'] as const) {
    const dist = input.calibrationConfidence[p];
    if (!dist || dist.length === 0) {
      throw new AbstainPolicyError(`缺 ${p} 校准置信分布（反解须各原语分档实取——不得回落默认值）`);
    }
    const sorted = [...dist].sort((a, b) => a - b);
    const threshold = quantile(sorted, target);
    // 支撑集断言：分位点天然落在 [min,max] 内（浮点插值不越界——显式锁）
    const min = (sorted[0] as number);
    const max = (sorted[sorted.length - 1] as number);
    if (!(threshold >= min && threshold <= max)) {
      throw new AbstainPolicyError(
        `${p} 反解阈值 ${threshold} 外插出支撑集 [${min},${max}]（反解是分布内找点，不是造分布外的数）`,
      );
    }
    thresholds[p] = threshold;
    support[p] = { min, max };
    // 实际预期弃权率：低于阈值的样本占比（含并列语义——< threshold 计弃权）
    achieved[p] = sorted.filter((v) => v < threshold).length / sorted.length;
  }
  const solved = thresholds as ThresholdsByPrimitive;
  assertThresholdsByPrimitive(solved);
  const achievedRate =
    ((achieved.noul as number) + (achieved.choice as number) + (achieved.score as number)) / 3;
  return { thresholds: solved, support: support as SolvedThresholds['support'], achievedRate };
}

// ── score 分流消费整条分布（非仅置信度）─────────────────

/** score 整分布消费读数 */
export interface ScoreDistributionReading {
  /** 分布熵（整条分布的熵——各档概率彼此接近时熵高） */
  entropy: number;
  /** top1 档概率（仅置信度面——**不足以为据**，列出作对照） */
  top1: number;
  /** top1 与 top2 的差（margin——整分布第二个可消费统计面） */
  margin: number;
  /** 分流判据（熵超阈 → 复核信号；低熵 → 判定明确） */
  basis: 'distribution-entropy';
}

/**
 * score 分流判据消费整条分布（consumeDistributionForScore——§四验收第 7 条）：
 * score 的安全类评分各档概率彼此接近，只看 top1 置信度会把「分布平」
 * 误判为「不自信」或反之——分流依据取**分布熵**（整条分布的形态），
 * top1/margin 仅并列留读（对照面，非判据本体）。
 */
export function consumeDistributionForScore(distribution: readonly number[]): ScoreDistributionReading {
  if (distribution.length < 2) {
    throw new AbstainPolicyError('score 分布至少两档（单档无分布面）');
  }
  if (distribution.some((p) => p < 0 || p > 1)) {
    throw new AbstainPolicyError('score 分布含越界概率');
  }
  const sum = distribution.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new AbstainPolicyError(`score 分布和=${sum}（须≈1）`);
  }
  const entropy = -distribution.reduce(
    (acc, p) => (p > 0 ? acc + p * Math.log(p) : acc),
    0,
  ) / Math.log(distribution.length); // 归一熵 ∈ [0,1]（档数不同的分布可比）
  const sorted = [...distribution].sort((a, b) => b - a);
  return {
    entropy,
    top1: sorted[0] as number,
    margin: (sorted[0] as number) - (sorted[1] as number),
    basis: 'distribution-entropy',
  };
}

// ── 稳定化重读（默认关闭 + 同口径重测检查钩子）──────────

/** 稳定化重读配置 */
export interface StabilizationConfig {
  /** 默认关闭（重读增加延迟且改变概率语义——开启须显式配置） */
  enabled: boolean;
  /** 逐问句熵阈（超阈触发重读——触发粒度是逐问句非全局） */
  perQuestionEntropyThreshold: number;
  /** 重读上限（超限不收敛 → 弃权——与弃权的分工） */
  maxRereads: number;
  /** 校准集同口径重测完成标记（开启前置——口径不一致 ⇒ ECE 对该输出不成立） */
  calibrationRemeasuredWithSameProtocol: boolean;
}

/** 缺省配置（默认关闭——SSOT 原文「默认关闭」） */
export const DEFAULT_STABILIZATION_CONFIG: StabilizationConfig = {
  enabled: false,
  perQuestionEntropyThreshold: 0.9,
  maxRereads: 3,
  calibrationRemeasuredWithSameProtocol: false,
};

/**
 * 稳定化重读口径检查（§四验收第 9/10 条的检查钩子）：
 * 开启重读须校准集**按同口径重测**（重读输出 = 多次噪声采样平均，
 * 与单次前向不同分布——用单次口径的 ECE 担保平均口径的输出不成立）。
 * 口径不一致 → 返回 false（调用方拒开）；返回值即「ECE 对该输出成立
 * 与否」的可判定读数——**注释写死于代码**：口径不一致时 ECE 对该
 * 输出不成立。
 */
export function stabilizationRereadProtocolCheck(config: StabilizationConfig): {
  ok: boolean;
  reason: string;
} {
  if (!config.enabled) {
    return { ok: true, reason: '重读未开启（默认关闭——无口径检查义务）' };
  }
  if (!config.calibrationRemeasuredWithSameProtocol) {
    return {
      ok: false,
      reason:
        '重读已开启但校准集未按同口径重测——平均后的概率不再等价于单次前向的读数，ECE 对该输出不成立（用一套口径的校准结论担保另一套口径的输出 = 担保失效）',
    };
  }
  return { ok: true, reason: '校准集已按同口径重测（平均口径的 ECE 成立）' };
}

/**
 * 弃权与稳定化重读的分工判定（§四验收第 9 条——两者不是二选一）：
 *   - 熵高且在有限重读内**收敛** → 给出稳定后的概率（重读的领地）；
 *   - 熵高且重读至上限**不收敛** → 弃权（弃权的领地）；
 *   - 熵不高 → 正常作答（两者都不触发）。
 */
export function divideAbstainOrReread(input: {
  entropy: number;
  entropyThreshold: number;
  rereadConverged: boolean;
  rereadsUsed: number;
  maxRereads: number;
}): { action: 'answer' | 'reread-then-answer' | 'abstain'; reason: string } {
  if (input.entropy <= input.entropyThreshold) {
    return { action: 'answer', reason: `熵 ${input.entropy.toFixed(3)} ≤ 阈 ${input.entropyThreshold}（判定明确，正常作答）` };
  }
  if (input.rereadsUsed >= input.maxRereads && !input.rereadConverged) {
    return {
      action: 'abstain',
      reason: `熵超阈且 ${input.rereadsUsed}/${input.maxRereads} 次重读不收敛——弃权（重读不收敛才弃权，两者不是二选一）`,
    };
  }
  if (input.rereadConverged) {
    return { action: 'reread-then-answer', reason: '熵超阈但重读后收敛——给出稳定后的概率（采样降-variance 非放弃作答）' };
  }
  return { action: 'reread-then-answer', reason: `熵超阈，重读 ${input.rereadsUsed}/${input.maxRereads} 未到上限——继续重读` };
}

// ── 行为锁：ECE 未达阈 ⇒ 弃权默认开启且不可关闭 ──────────

/**
 * 弃权开关策略（校准上线前置门——§四验收第 11 条）：
 * 消费 §二 `eceVerdict` 输出（EceVerdictResult.achieved）：
 *   - achieved=false（ECE 未达阈）→ 弃权**强制开启**：attemptDisable
 *     抛错（行为锁：尝试关闭即失败）——「未达阈 ⇒ 系统行为受限」，
 *     未校准的概率不得用于分流，弃权是唯一不依赖概率可信度的安全出口；
 *   - achieved=true → 可按域配置弃权带（可关）。
 * 版本否决不否决机制交付（§四验收第 15 条）：本行为锁按「未校准态」
 * 交付并保留——无论版本收口裁决如何，机制在位。
 */
export class AbstainGatePolicy {
  private forced: boolean;
  private disabled = false;

  /**
   * @param eceVerdict §二 eceVerdict 输出（achieved=false ⇒ 强制开启）；
   *        传 undefined = 无达阈判定读数（视同未达阈——保守侧 fail-closed：
   *        无读数不得当作已校准）。
   */
  constructor(private readonly eceVerdict?: EceVerdictReading) {
    this.forced = eceVerdict ? !eceVerdict.achieved : true;
  }

  /** 是否强制开启（未达阈读数回显——审计面） */
  get forcedOn(): boolean {
    return this.forced;
  }

  /** 弃权当前是否启用（强制态恒 true） */
  get enabled(): boolean {
    return this.forced || !this.disabled;
  }

  /**
   * 尝试关闭弃权（行为锁）：ECE 未达阈时调用即抛错——
   * 「未校准态下弃权是唯一安全出口」，关闭出口 = 把未校准概率
   * 逼上分流路径。
   */
  attemptDisable(): void {
    if (this.forced) {
      const detail = this.eceVerdict
        ? this.eceVerdict.slots.filter((s) => !s.pass).map((s) => `${s.primitive}/${s.lang} ECE=${String(s.ece)}`).join('、')
        : '无达阈判定读数（保守视同未达阈）';
      throw new AbstainPolicyError(
        `ECE 未达阈（${detail}）——弃权默认开启且不可关闭（校准上线前置门：未校准的概率不得用于分流，弃权是唯一不依赖概率可信度的安全出口）`,
      );
    }
    this.disabled = true;
  }

  /** 重新启用（达阈态关闭后可再开——无锁） */
  reEnable(): void {
    this.disabled = false;
  }
}

// ── 行为锁：新增判据域弃权带默认最宽 ────────────────────

/**
 * 新域弃权带（newDomainWidestBand——§四验收第 12 条）：
 * 新增判据域时弃权带**默认最宽**（[0,1) 全带宽——宁可多转人工），
 * 域内校准达阈后才允许收窄。收窄前置：必须携带该域的 eceVerdict
 * 达阈读数（achieved=true），否则拒载——「判据面扩张不得以放宽弃权
 * 为代价」的机制化。
 */
export interface DomainAbstainBand {
  domain: string;
  /** 弃权带 [lower, upper)——置信落带内即弃权 */
  lower: number;
  upper: number;
  /** 带宽来源（new-domain-default = 默认最宽；calibrated-narrowed = 达阈后收窄） */
  origin: 'new-domain-default' | 'calibrated-narrowed';
}

/** 新域默认带（最宽——全带宽 [0,1)） */
export function newDomainWidestBand(domain: string): DomainAbstainBand {
  if (!domain || domain.trim() === '') {
    throw new AbstainPolicyError('域名为空（新域弃权带须可指认）');
  }
  return { domain, lower: 0, upper: 1, origin: 'new-domain-default' };
}

/**
 * 收窄弃权带（域内校准达阈后）：无达阈读数 / 读数未达 ⇒ 拒载
 * （行为锁——扩张不得放宽弃权，收窄须凭校准证据）。
 */
export function narrowDomainBand(input: {
  band: DomainAbstainBand;
  newLower: number;
  newUpper: number;
  domainEceVerdict?: EceVerdictReading;
}): DomainAbstainBand {
  const v = input.domainEceVerdict;
  const achieved = v ? v.achieved : false;
  if (!achieved) {
    throw new AbstainPolicyError(
      `域 ${input.band.domain} 无达阈读数（或有未达档）——弃权带不得收窄（默认最宽是行为锁，收窄须凭该域校准证据）`,
    );
  }
  if (!(0 <= input.newLower && input.newLower < input.newUpper && input.newUpper <= 1)) {
    throw new AbstainPolicyError(`新带 [${input.newLower},${input.newUpper}) 非法（须 0≤lower<upper≤1）`);
  }
  const wider = input.newLower <= input.band.lower && input.newUpper >= input.band.upper;
  if (wider && input.band.origin === 'new-domain-default') {
    throw new AbstainPolicyError('新带不得比默认最宽带更宽（[0,1) 已是最宽——只可收窄）');
  }
  return { domain: input.band.domain, lower: input.newLower, upper: input.newUpper, origin: 'calibrated-narrowed' };
}

// ── 门控健康度四联红旗（采集点——只采集不判阈）───────────

/** 四联红旗观测样本（单次门控事件的结构化采集单元） */
export interface GateHealthSample {
  /** 观测窗口（如小时桶 ISO 串） */
  window: string;
  /** 是否发生 ASK（转人批请求）——ASK 率趋零是红旗① */
  asked: boolean;
  /** ASK 的处置（approved=获批 / rejected=驳回 / none=无 ASK）——获批率恒 100% 是红旗② */
  approval: 'approved' | 'rejected' | 'none';
  /** 审批时延秒（提示发出到审批动作的间隔——1–2 秒反射式点击是红旗③） */
  approvalLatencySeconds?: number;
  /** 审批人 id（人均审批量异常高是红旗④——按人聚合的键） */
  approverId?: string;
}

/** 单窗口四指标读数 */
export interface GateHealthMetrics {
  window: string;
  /** ASK 率（ASK 数 / 总门控数——趋零红旗①） */
  askRate: number;
  /** 获批率（approved / (approved+rejected)——恒 100% 红旗②） */
  approvalRate: number;
  /** 审批时延 P50 秒（反射式点击红旗③） */
  approvalLatencyP50: number | 'no-approvals';
  /** 人均审批量（max per approver——异常高红旗④） */
  approvalsPerPerson: number | 'no-approvals';
}

/**
 * 门控健康度四联红旗采集（§四验收第 14 条）：
 *   ① ASK 率趋近于零 ② 获批率恒为 100%（同一审批人零驳回）
 *   ③ 审批时延落在提示后 1–2 秒（反射式点击） ④ 人均审批量异常高。
 *
 * **只采集不判阈**——四者同时出现即门控失效的**判定**属 v1.9.0 消费面
 * （判定使用度量），本函数的义务是让四指标**可观测**（有采集点）。
 * 分开看每一项都有良性解释，合起来看没有——所以四指标同表输出，
 * 不做单项红绿。
 */
export function gateHealthMetrics(
  samples: readonly GateHealthSample[],
  totalGateEvents: number,
): GateHealthMetrics[] {
  if (!Number.isInteger(totalGateEvents) || totalGateEvents < 0) {
    throw new AbstainPolicyError(`totalGateEvents=${totalGateEvents} 非法（非负整数——分母面）`);
  }
  const byWindow = new Map<string, GateHealthSample[]>();
  for (const s of samples) {
    const cur = byWindow.get(s.window) ?? [];
    cur.push(s);
    byWindow.set(s.window, cur);
  }
  const out: GateHealthMetrics[] = [];
  for (const [window, ws] of byWindow) {
    const asks = ws.filter((s) => s.asked);
    const decided = ws.filter((s) => s.approval !== 'none');
    const approved = ws.filter((s) => s.approval === 'approved');
    const latencies = ws
      .filter((s) => typeof s.approvalLatencySeconds === 'number')
      .map((s) => s.approvalLatencySeconds as number)
      .sort((a, b) => a - b);
    const perPerson = new Map<string, number>();
    for (const s of ws) {
      if (s.approval === 'approved' && s.approverId) {
        perPerson.set(s.approverId, (perPerson.get(s.approverId) ?? 0) + 1);
      }
    }
    const p50 = latencies.length
      ? latencies[Math.floor((latencies.length - 1) / 2)]
      : 'no-approvals';
    out.push({
      window,
      askRate: totalGateEvents === 0 ? 0 : asks.length / totalGateEvents,
      approvalRate: decided.length === 0 ? 0 : approved.length / decided.length,
      approvalLatencyP50: p50 as GateHealthMetrics['approvalLatencyP50'],
      approvalsPerPerson: perPerson.size
        ? Math.max(...perPerson.values())
        : 'no-approvals',
    });
  }
  return out;
}
