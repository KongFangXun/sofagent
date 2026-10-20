// scoring-rules.ts · v1.7.0 §一 · 严格适当评分规则集（strictly proper scoring rules）
// ============================================================
// 定位：RLCD 训练目标的根约束——「严格适当」的数学含义是报出真实概率时
// 期望得分最优（诚实报概率是唯一不被惩罚的策略），模型没有「虚报高置信
// 度占便宜」的空间（SSOT v1.7.0 §一交付表首行）。按判定三原语分派：
//   Noul  → log score（伯努利）——真值概率的单点评分
//   Choice→ log score（多类）+ spherical score——全候选项分布评分
//   Score → RPS（Ranked Probability Score）——有序分档的序感知评分
//
// 计分口径统一（对内契约）：
//   - 全部以「得分（越大越好）」导出：logScore / sphericalScore 为负损失取负
//     （log score ∈ (−∞, 0]，spherical ∈ [0, 1]）；rps 为惩罚（越小越好），
//     另导出 rpsScore = −rps 统一到「越大越好」——训练消费面（policy-gradient）
//     只认「越大越好」一种口径，防混用。
//   - 非对称惩罚（交付表第二行）：报极端概率判错重罚、温和概率判错轻罚。
//     严格适当评分规则天然具此性质（log score 在 p→1 而事件未发生时损失
//     →∞），本文件把它落成显式可断言的实现面：asymmetricPenalty 系数 =
//     极端口径罚分 ÷ 温和口径罚分（供数值断言与审计读数，非额外惩罚项）。
//   - 边界（fail-closed，对齐 decision-primitives 构造器纪律）：概率 0/1
//     在 log score 里数学上合法（log 0 = −∞），实现层以 CLAMP 下界承载
//     （防 −∞ 污染损失序列），但空分布 / 概率越界 / 非有限数一律拒载抛错。
// ============================================================

/** 评分规则统一错误（fail-closed 载体） */
export class ScoringRuleError extends Error {
  constructor(message: string) {
    super(`[scoring-rules] ${message}`);
    this.name = 'ScoringRuleError';
  }
}

/** log score 概率下界钳制（p=0/p=1 判错时损失为 −∞——实现层给有限下界，防损失序列被 ±∞ 污染） */
export const LOG_PROB_CLAMP = 1e-12;

/** 分布归一容差（与 decision-primitives.DIST_TOLERANCE 同量级） */
export const DIST_SUM_TOLERANCE = 1e-6;

// ── 校验（fail-closed——三类规则共享）────────────────────

/** 单概率合法性：∈ [0,1] 且为有限数 */
export function assertProbability(p: number, what: string): void {
  if (typeof p !== 'number' || !Number.isFinite(p)) {
    throw new ScoringRuleError(`${what} 非有限数：${p}`);
  }
  if (p < 0 || p > 1) {
    throw new ScoringRuleError(`${what} 越界 [0,1]：${p}`);
  }
}

/** 概率向量合法性：非空 + 归一（容差内） */
export function assertDistribution(dist: readonly number[], what: string): void {
  if (!Array.isArray(dist) || dist.length === 0) {
    throw new ScoringRuleError(`${what} 为空分布（拒载——fail-closed）`);
  }
  let sum = 0;
  for (const p of dist) {
    assertProbability(p, `${what}[${dist.indexOf(p)}]`);
    sum += p;
  }
  if (Math.abs(sum - 1) > DIST_SUM_TOLERANCE) {
    throw new ScoringRuleError(`${what} 和=${sum}（须≈1，容差 ${DIST_SUM_TOLERANCE}）`);
  }
}

// ════════════════════════════════════════
// log score
// ════════════════════════════════════════

/**
 * 伯努利 log score（Noul 原语）：事件是否发生 × 报出概率 p。
 * 得分 = log(p_reported | outcome)，越大越好（最优 0）。
 * p=0/1 判错钳制到 LOG_PROB_CLAMP（有限下界——见文件头）。
 */
export function logScoreBernoulli(pReported: number, outcome: boolean): number {
  assertProbability(pReported, 'noul 报出概率');
  const p = Math.min(Math.max(pReported, LOG_PROB_CLAMP), 1 - LOG_PROB_CLAMP);
  return Math.log(outcome ? p : 1 - p);
}

/**
 * 多类 log score（Choice 原语）：报出全候选项分布 × 实际选中项。
 * 得分 = log(dist[selectedIndex])，越大越好。
 * 分布与 selectedIndex 一致性校验（越界即拒载）。
 */
export function logScoreMulticlass(
  distribution: readonly number[],
  selectedIndex: number,
): number {
  assertDistribution(distribution, 'choice 分布');
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= distribution.length) {
    throw new ScoringRuleError(`selectedIndex ${selectedIndex} 越界（分布长度 ${distribution.length}）`);
  }
  const p = distribution[selectedIndex] ?? LOG_PROB_CLAMP;
  return Math.log(Math.max(p, LOG_PROB_CLAMP));
}

// ════════════════════════════════════════
// spherical score
// ════════════════════════════════════════

/**
 * spherical score（Choice 原语第二规则）：分布尖度与指向的联合度量。
 *   S = dist[y] / ‖dist‖₂  ∈ [0, 1]，越大越好。
 * 严格适当（多类形态——Gneiting & Raftery 2007 §4）；与 log score 互补：
 * log score 对尾部极端错罚极重（→∞），spherical 对「尖而错」的惩罚更平缓，
 * 两者并列给训练侧做奖励形状选择（配置可查）。
 */
export function sphericalScore(
  distribution: readonly number[],
  selectedIndex: number,
): number {
  assertDistribution(distribution, 'choice 分布');
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= distribution.length) {
    throw new ScoringRuleError(`selectedIndex ${selectedIndex} 越界（分布长度 ${distribution.length}）`);
  }
  let normSq = 0;
  for (const p of distribution) normSq += p * p;
  const norm = Math.sqrt(normSq);
  if (norm === 0) {
    // 全零分布已被 assertDistribution 的归一校验拦截——防御性兜底（不静默）
    throw new ScoringRuleError('分布范数为 0（不可能态——归一校验应已拦截）');
  }
  return (distribution[selectedIndex] as number) / norm;
}

// ════════════════════════════════════════
// RPS（Ranked Probability Score）
// ════════════════════════════════════════

/**
 * RPS（Score 原语——有序分档）：分档有序时的距离感知惩罚。
 *   RPS = Σ_{k=1}^{K-1} (CDF_pred(k) − CDF_true(k))²
 * 惩罚（越小越好）；另导出 rpsScore = −RPS 统一「越大越好」口径。
 * 与多类 log score 的行为差异（验收断言面）：预测概率质量在相邻档间挪动时
 * RPS 惩罚变化平滑且保序（挪得越远罚越重），log score 只看选中档的单点概率
 * ——序信息被 RPS 正确利用、不退化为多类 log score。
 * 真值为 one-hot（分档确定性结果）或已知分档概率（概率目标形态）。
 */
export function rps(
  predicted: readonly number[],
  truth: readonly number[],
): number {
  assertDistribution(predicted, 'score 预测分档分布');
  assertDistribution(truth, 'score 真值分档分布');
  if (predicted.length !== truth.length) {
    throw new ScoringRuleError(
      `预测与真值分档数不一致（${predicted.length} vs ${truth.length}）`,
    );
  }
  let acc = 0;
  let cdfPred = 0;
  let cdfTruth = 0;
  for (let k = 0; k < predicted.length - 1; k++) {
    cdfPred += predicted[k] as number;
    cdfTruth += truth[k] as number;
    const d = cdfPred - cdfTruth;
    acc += d * d;
  }
  return acc;
}

/** RPS 的「越大越好」形态（训练消费面统一口径：−RPS） */
export function rpsScore(
  predicted: readonly number[],
  truth: readonly number[],
): number {
  return -rps(predicted, truth);
}

// ════════════════════════════════════════
// 非对称惩罚（校准的物理机制——显式可断言面）
// ════════════════════════════════════════

/** 非对称惩罚检查读数：极端口径罚分 / 温和口径罚分（> 1 即非对称在位） */
export interface AsymmetryReadout {
  /** 极端口径（如 0.99）判错的罚分（log 损失，≥0） */
  extremePenalty: number;
  /** 温和口径（如 0.55）判错的罚分（log 损失，≥0） */
  mildPenalty: number;
  /** 罚分比（extreme ÷ mild——严格适当规则下恒 > 1，数值断言面） */
  ratio: number;
}

/**
 * 非对称惩罚读数（Noul 伯努利口径）：
 * 报 p 判错（outcome 与 p>0.5 的倾向相反）时的 log 损失。
 * 严格适当性的实现层落法——极端口径（0.99 判错）罚分显著高于温和口径
 * （0.55 判错）：−log(1−0.99) ≈ 4.605 vs −log(1−0.55) ≈ 0.799。
 * 该函数只产读数（审计/断言用），不改变任何评分规则本身。
 */
export function asymmetricPenalty(
  extremeProb = 0.99,
  mildProb = 0.55,
): AsymmetryReadout {
  assertProbability(extremeProb, '极端口径概率');
  assertProbability(mildProb, '温和口径概率');
  if (extremeProb <= mildProb) {
    throw new ScoringRuleError(
      `极端口径 ${extremeProb} 须大于温和口径 ${mildProb}（语义倒置）`,
    );
  }
  // 两口径同向自信（p > 0.5）且同判错（outcome=false）
  const extremePenalty = -logScoreBernoulli(extremeProb, false);
  const mildPenalty = -logScoreBernoulli(mildProb, false);
  return { extremePenalty, mildPenalty, ratio: extremePenalty / mildPenalty };
}

// ════════════════════════════════════════
// 按原语分派的总入口（训练回路消费面）
// ════════════════════════════════════════

/** Choice 可用评分规则（配置可查——奖励形状选择面） */
export type ChoiceRuleName = 'log' | 'spherical';

/** 单样本评分入参（三原语统一形态——训练回路的奖励来源） */
export interface PrimitiveScoreInput {
  /** Noul：报出概率 */
  noulReported?: number;
  /** Noul：事件是否发生 */
  noulOutcome?: boolean;
  /** Choice：报出分布 */
  choiceDistribution?: readonly number[];
  /** Choice：实际选中项下标 */
  choiceSelected?: number;
  /** Choice：规则选择（缺省 log——奖励形状配置面） */
  choiceRule?: ChoiceRuleName;
  /** Score：预测分档分布（有序） */
  scorePredicted?: readonly number[];
  /** Score：真值分档分布（one-hot 或概率目标） */
  scoreTruth?: readonly number[];
}

/**
 * 按原语分派评分（统一「越大越好」）：
 *   noul  → logScoreBernoulli
 *   choice→ logScoreMulticlass / sphericalScore（choiceRule 选）
 *   score → rpsScore（−RPS）
 * 同一样本混装多原语字段时逐项计分求和（多问并行形态）；三原语字段全缺
 * 即拒载（fail-closed——不静默给 0 分）。
 */
export function scoreByPrimitive(input: PrimitiveScoreInput): number {
  let total = 0;
  let scoredAny = false;
  if (typeof input.noulReported === 'number' || typeof input.noulOutcome === 'boolean') {
    if (typeof input.noulReported !== 'number' || typeof input.noulOutcome !== 'boolean') {
      throw new ScoringRuleError('noul 评分须同时给出 noulReported 与 noulOutcome');
    }
    total += logScoreBernoulli(input.noulReported, input.noulOutcome);
    scoredAny = true;
  }
  if (input.choiceDistribution !== undefined || input.choiceSelected !== undefined) {
    if (input.choiceDistribution === undefined || input.choiceSelected === undefined) {
      throw new ScoringRuleError('choice 评分须同时给出 choiceDistribution 与 choiceSelected');
    }
    const rule = input.choiceRule ?? 'log';
    total +=
      rule === 'spherical'
        ? sphericalScore(input.choiceDistribution, input.choiceSelected)
        : logScoreMulticlass(input.choiceDistribution, input.choiceSelected);
    scoredAny = true;
  }
  if (input.scorePredicted !== undefined || input.scoreTruth !== undefined) {
    if (input.scorePredicted === undefined || input.scoreTruth === undefined) {
      throw new ScoringRuleError('score 评分须同时给出 scorePredicted 与 scoreTruth');
    }
    total += rpsScore(input.scorePredicted, input.scoreTruth);
    scoredAny = true;
  }
  if (!scoredAny) {
    throw new ScoringRuleError('三原语字段全缺（无可评分目标——fail-closed 拒载）');
  }
  return total;
}
