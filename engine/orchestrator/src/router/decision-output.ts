// decision-output.ts · v1.7.0 §五 · 三原语概率面完整化（完整输出 + 四态映射 + 建议动作 + 直落 decision-log）
// ============================================================
// 定位：把三原语的概率输出**做完整**并写死「概率以什么形态进入判定链」
// 的边界。输出形态不是 pass/warn/fail 三选一，而是
// 「概率 + 置信度 + 四态 + 建议动作」——**只出建议，不执法**。
//
// 三原语完整面（§五交付表）：
//   ChoiceFullOutput：selected + distribution（全候选归一分布）+ entropy（分布熵）
//   ScoreFullOutput ：value + credibleInterval（校准后分位区间）+ ordinal（档位序）
//   NoulFullOutput  ：probability（真值概率）+ fourState（四态）
//
// 关键边界（行为锁两件）：
//   1. 建议动作不具执法力——suggestedAction 只是判定层的输入建议，
//      执行权仍在既有确定性规则与审计层手里。类型层：SuggestedAction
//      与执行状态完全分类型；运行时：构造函数不触碰任何执行状态。
//   2. 证据面不扩大——判定输入的 state 只含已获证据，判定层不新增
//      采集动作、不访问新数据源。构造函数对输入 state 无写、无新读
//      （只消费传入字段——「只提高已获证据的利用率」）。
//
// 四态映射与校准联动（§五验收第 2/3 条）：
//   - fourStateMapping(probability, segmentBoundaries) 分段口径 = §四
//     ThresholdsByPrimitive（门槛按原语分档——同一套门槛面）；
//   - ECE 未达阈 → 边界可算但整体标 uncalibrated（calibrationStatus
//     字段 + 消费守卫——不进分流决策路径）；
//   - 达阈 → calibrationStatus='calibrated' 且带校准依据标注（对齐
//     §三校准依据声明制）。
//
// 与 decision-log 的关系：serializeForDecisionLog 输出结构化 JSON，
// 可直接作为既有 decision-log 条目（DecisionLogEntry）的 evidence/
// payload 消费（无需二次解析）；若需新 kind（判定留痕专用 kind）留给
// W4 §七（decision-schema kind 扩容面），本版不私建 kind。
// ============================================================

/** 判定输出件错误（fail-closed 载体） */
export class DecisionOutputError extends Error {
  constructor(message: string) {
    super(`[decision-output] ${message}`);
    this.name = 'DecisionOutputError';
  }
}

// ── 校准状态（§三校准依据声明制的输出面）─────────────────

/** 输出校准状态（uncalibrated = 不进任何分流决策路径——消费守卫的判据面） */
export type CalibrationStatus = 'calibrated' | 'uncalibrated';

/** 校准依据标注（calibrated 时必带——对齐 §三 CalibrationEvidence 三件） */
export interface OutputCalibrationEvidence {
  calibrationSetVersion: string;
  ece: number;
  fittedAt: string;
}

// ── 四态（noul 概率面）──────────────────────────────────

/** Noul 四态（由校准后概率分段得出——分段口径 = §四门槛） */
export type NoulFourState = '成立' | '倾向成立' | '倾向不成立' | '不成立';

/** 四态分段边界（§四 ThresholdsByPrimitive 的消费形态——分段口径同源） */
export interface SegmentBoundaries {
  /** 倾向成立下界（≥ 此且 < 成立下界 → 倾向成立） */
  leanYesLower: number;
  /** 成立下界（≥ 此 → 成立） */
  yesLower: number;
  /** 倾向不成立上界（< 此且 > 不成立上界 → 倾向不成立） */
  leanNoUpper: number;
  /** 不成立上界（≤ 此 → 不成立） */
  noUpper: number;
}

/**
 * 四态映射（§五验收第 2 条）：
 *   probability ≥ yesLower                    → 成立
 *   leanYesLower ≤ probability < yesLower     → 倾向成立
 *   noUpper < probability < leanYesLower      → 中间带（势均力敌区——归倾向两侧由
 *                                               leanYesLower/noUpper 夹逼；本版口径：
 *                                               中间带按 0.5 侧归类，见实现注释）
 *   probability ≤ noUpper                     → 不成立
 *
 * 实现口径：四段由三个切点（noUpper < leanNoUpper ≤ leanYesLower < yesLower）
 * 常规形态——leanNoUpper 与 leanYesLower 之间为「势均力敌带」，四态不含
 * 「势均力敌」态（那是 NOUL_SEMANTICS 0.5 的语义位，非四态位）——
 * 势均力敌带按离哪侧近归哪侧（确定性映射，同输入同输出）。
 */
export function fourStateMapping(probability: number, segmentBoundaries: SegmentBoundaries): NoulFourState {
  if (!(probability >= 0 && probability <= 1)) {
    throw new DecisionOutputError(`概率 ${probability} 越界 [0,1]`);
  }
  const b = segmentBoundaries;
  if (!(0 <= b.noUpper && b.noUpper < b.leanNoUpper && b.leanNoUpper <= b.leanYesLower && b.leanYesLower < b.yesLower && b.yesLower <= 1)) {
    throw new DecisionOutputError(
      `分段边界非法（须 0 ≤ noUpper < leanNoUpper ≤ leanYesLower < yesLower ≤ 1——得 ${JSON.stringify(b)}）`,
    );
  }
  if (probability >= b.yesLower) return '成立';
  if (probability >= b.leanYesLower) return '倾向成立';
  if (probability <= b.noUpper) return '不成立';
  if (probability <= b.leanNoUpper) return '倾向不成立';
  // 势均力敌带（leanNoUpper, leanYesLower）：按离哪侧近归哪侧（确定性映射）
  const midpoint = (b.leanNoUpper + b.leanYesLower) / 2;
  return probability >= midpoint ? '倾向成立' : '倾向不成立';
}

// ── 建议动作（不执法——类型层与运行时双锁）───────────────

/**
 * 建议动作（§五验收第 4 条）：
 * '放行' | '复核' | '转人工' | '阻断'——判定层只提供输入，
 * **不具执法力**：执行权仍在既有确定性规则与审计层手里。
 *
 * 类型锁：本类型是纯建议值（ discriminated union 的 tag 层），
 * 与任何执行状态类型无转换函数——「建议 → 执行」必须经既有规则/审计层
 * 的显式决策（不存在 applySuggestion / enforce 之类的函数——搜不到就
 * 是设计）。
 */
export type SuggestedAction = '放行' | '复核' | '转人工' | '阻断';

// ── 三原语完整输出类型 ──────────────────────────────────

/** Choice 完整输出：选中项 + 全候选归一分布 + 分布熵 */
export interface ChoiceFullOutput {
  kind: 'choice';
  questionId: string;
  selected: string;
  /** 全候选项归一分布（所有候选各一项，和≈1） */
  distribution: Readonly<Record<string, number>>;
  /** 分布熵（归一 ∈ [0,1]——低熵=判定明确，高熵=选项间接近→「需复核」信号） */
  entropy: number;
  /** 校准状态（ECE 未达阈 → uncalibrated——消费守卫判据面） */
  calibrationStatus: CalibrationStatus;
  /** 校准依据（calibrated 时必带） */
  calibrationEvidence?: OutputCalibrationEvidence;
  /** 建议动作（不执法） */
  suggestedAction: SuggestedAction;
}

/** Score 完整输出：分值 + 校准后分位区间 + 档位序 */
export interface ScoreFullOutput {
  kind: 'score';
  questionId: string;
  value: number;
  /** 可信区间（校准后分位区间——[lower, upper] 含 value） */
  credibleInterval: { lower: number; upper: number };
  /** 档位序（value 在量程内按档位切分的序——保序由 §二保证） */
  ordinal: number;
  /** 档位总数（序/总数并列——序不可独读） */
  ordinalTotal: number;
  calibrationStatus: CalibrationStatus;
  calibrationEvidence?: OutputCalibrationEvidence;
  suggestedAction: SuggestedAction;
}

/** Noul 完整输出：真值概率 + 四态 */
export interface NoulFullOutput {
  kind: 'noul';
  questionId: string;
  /** 真值概率 ∈ [0,1]（语义=NOUL_SEMANTICS：0.5 势均力敌非中等可信） */
  probability: number;
  /** 四态（由分段边界映射——分段口径 = §四门槛） */
  fourState: NoulFourState;
  /** 分段边界（留痕——四态由哪个口径分出） */
  segmentBoundaries: SegmentBoundaries;
  calibrationStatus: CalibrationStatus;
  calibrationEvidence?: OutputCalibrationEvidence;
  suggestedAction: SuggestedAction;
}

export type PrimitiveFullOutput = ChoiceFullOutput | ScoreFullOutput | NoulFullOutput;

// ── 消费守卫（uncalibrated 不进分流决策路径）────────────

/**
 * 消费守卫（§五验收第 3 条降级口径的执行点）：
 * calibrationStatus='uncalibrated' 的输出**不得进入任何分流决策路径**——
 * 分流消费方（若要消费 full output 做放行/复核/转人工分流）调用本守卫，
 * uncalibrated 即抛错（边界可算、照常落数，但进分流 = 违纪）。
 */
export function assertConsumableForRouting(output: PrimitiveFullOutput): void {
  if (output.calibrationStatus === 'uncalibrated') {
    throw new DecisionOutputError(
      `问句 ${output.questionId} 输出标 uncalibrated——四态分段边界可算但不进任何分流决策路径（ECE 未达阈的降级口径：照常落数、不进分流）`,
    );
  }
}

// ── 构造器（证据面不扩大——只消费传入字段）───────────────

/** 归一分布熵（底 log(k) 归一 ∈ [0,1]） */
function normalizedEntropy(dist: readonly number[]): number {
  const k = dist.length;
  const h = -dist.reduce((acc, p) => (p > 0 ? acc + p * Math.log(p) : acc), 0);
  return h / Math.log(k);
}

/**
 * Choice 完整输出构造器。
 *
 * 行为锁（证据面不扩大）：本函数只读入参（distribution/selected 等），
 * 不接收 state、无任何采集动作——测试以 deepEqual 输入不变断言。
 */
export function makeChoiceFullOutput(input: {
  questionId: string;
  selected: string;
  distribution: Record<string, number>;
  calibrationStatus: CalibrationStatus;
  calibrationEvidence?: OutputCalibrationEvidence;
  suggestedAction: SuggestedAction;
}): ChoiceFullOutput {
  if (!input.questionId.trim()) throw new DecisionOutputError('缺 questionId');
  const values = Object.values(input.distribution);
  if (values.length < 2) throw new DecisionOutputError('choice 分布至少两候选');
  if (values.some((p) => p < 0 || p > 1)) throw new DecisionOutputError('choice 分布含越界概率');
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) throw new DecisionOutputError(`choice 分布和=${sum}（须≈1）`);
  if (!(input.selected in input.distribution)) {
    throw new DecisionOutputError(`选中项「${input.selected}」不在分布键内`);
  }
  if (input.calibrationStatus === 'calibrated' && !input.calibrationEvidence) {
    throw new DecisionOutputError('标 calibrated 须带校准依据（§三声明制——证据三件）');
  }
  return {
    kind: 'choice',
    questionId: input.questionId,
    selected: input.selected,
    distribution: { ...input.distribution },
    entropy: normalizedEntropy(values),
    calibrationStatus: input.calibrationStatus,
    ...(input.calibrationEvidence ? { calibrationEvidence: { ...input.calibrationEvidence } } : {}),
    suggestedAction: input.suggestedAction,
  };
}

/** Score 完整输出构造器（证据面不扩大——同上行为锁） */
export function makeScoreFullOutput(input: {
  questionId: string;
  value: number;
  credibleInterval: { lower: number; upper: number };
  /** 档位总数（ordinal 由 value 在 [min,max] 等宽 ordinalTotal 档中的位置算出） */
  min: number;
  max: number;
  ordinalTotal: number;
  calibrationStatus: CalibrationStatus;
  calibrationEvidence?: OutputCalibrationEvidence;
  suggestedAction: SuggestedAction;
}): ScoreFullOutput {
  if (!input.questionId.trim()) throw new DecisionOutputError('缺 questionId');
  if (!(input.min < input.max)) throw new DecisionOutputError(`量程非法（min=${input.min} 须 < max=${input.max}）`);
  if (input.value < input.min || input.value > input.max) {
    throw new DecisionOutputError(`分值 ${input.value} 越界 [${input.min},${input.max}]`);
  }
  if (!(input.credibleInterval.lower <= input.value && input.value <= input.credibleInterval.upper)) {
    throw new DecisionOutputError('可信区间须包含分值');
  }
  if (!Number.isInteger(input.ordinalTotal) || input.ordinalTotal < 2) {
    throw new DecisionOutputError(`ordinalTotal=${input.ordinalTotal} 非法（≥2 整数）`);
  }
  // 档位序：value 在等宽 ordinalTotal 档中的档序（0 基——序/总数并列不可独读）
  const ordinal = Math.min(
    Math.floor(((input.value - input.min) / (input.max - input.min)) * input.ordinalTotal),
    input.ordinalTotal - 1,
  );
  if (input.calibrationStatus === 'calibrated' && !input.calibrationEvidence) {
    throw new DecisionOutputError('标 calibrated 须带校准依据（§三声明制）');
  }
  return {
    kind: 'score',
    questionId: input.questionId,
    value: input.value,
    credibleInterval: { ...input.credibleInterval },
    ordinal,
    ordinalTotal: input.ordinalTotal,
    calibrationStatus: input.calibrationStatus,
    ...(input.calibrationEvidence ? { calibrationEvidence: { ...input.calibrationEvidence } } : {}),
    suggestedAction: input.suggestedAction,
  };
}

/**
 * Noul 完整输出构造器（证据面不扩大——同上行为锁）：
 * fourState 由分段边界映射；ECE 未达阈（calibrationStatus='uncalibrated'）
 * 时边界可算、四态照常落数，但消费守卫拦截其进入分流路径。
 */
export function makeNoulFullOutput(input: {
  questionId: string;
  probability: number;
  segmentBoundaries: SegmentBoundaries;
  calibrationStatus: CalibrationStatus;
  calibrationEvidence?: OutputCalibrationEvidence;
  suggestedAction: SuggestedAction;
}): NoulFullOutput {
  if (!input.questionId.trim()) throw new DecisionOutputError('缺 questionId');
  const fourState = fourStateMapping(input.probability, input.segmentBoundaries);
  if (input.calibrationStatus === 'calibrated' && !input.calibrationEvidence) {
    throw new DecisionOutputError('标 calibrated 须带校准依据（§三声明制）');
  }
  return {
    kind: 'noul',
    questionId: input.questionId,
    probability: input.probability,
    fourState,
    segmentBoundaries: { ...input.segmentBoundaries },
    calibrationStatus: input.calibrationStatus,
    ...(input.calibrationEvidence ? { calibrationEvidence: { ...input.calibrationEvidence } } : {}),
    suggestedAction: input.suggestedAction,
  };
}

// ── 序列化（结构化直落 decision-log）────────────────────

/** 序列化 schema 标识（直落 payload 的形态版本） */
export const DECISION_OUTPUT_SCHEMA = 'decision-output/v1' as const;

/**
 * 序列化为 decision-log 可直接消费的结构化 JSON（§五验收第 6 条）：
 * 输出为 JSON 字符串，可直接作为既有 DecisionLogEntry 的 evidence/payload
 *（结构化类型化记录——无需二次解析）。概率字段不截断精度（JSON.stringify
 * 保留全部有效位数——§三概率有效位数纪律）。
 */
export function serializeForDecisionLog(output: PrimitiveFullOutput): string {
  return JSON.stringify({ schema: DECISION_OUTPUT_SCHEMA, ...output });
}

/**
 * 反序列化（往返对账的另一端——deserialize(serialize(x)) 字段双向对账，
 * 缺任一字段即红）。
 */
export function deserializeDecisionOutput(json: string): PrimitiveFullOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DecisionOutputError('decision-output JSON 解析失败（fail-closed）');
  }
  const o = parsed as { schema?: string } & Partial<PrimitiveFullOutput>;
  if (o.schema !== DECISION_OUTPUT_SCHEMA) {
    throw new DecisionOutputError(`schema 缺失或不识别（得 ${String(o.schema)}）`);
  }
  if (o.kind === 'choice') {
    const c = o as Partial<ChoiceFullOutput>;
    if (!c.questionId || !c.selected || !c.distribution || typeof c.entropy !== 'number' || !c.calibrationStatus || !c.suggestedAction) {
      throw new DecisionOutputError('choice 输出缺字段（questionId/selected/distribution/entropy/calibrationStatus/suggestedAction 双向对账红）');
    }
    return c as ChoiceFullOutput;
  }
  if (o.kind === 'score') {
    const s = o as Partial<ScoreFullOutput>;
    if (!s.questionId || typeof s.value !== 'number' || !s.credibleInterval || typeof s.ordinal !== 'number' || typeof s.ordinalTotal !== 'number' || !s.calibrationStatus || !s.suggestedAction) {
      throw new DecisionOutputError('score 输出缺字段（value/credibleInterval/ordinal/ordinalTotal/… 双向对账红）');
    }
    return s as ScoreFullOutput;
  }
  if (o.kind === 'noul') {
    const n = o as Partial<NoulFullOutput>;
    if (!n.questionId || typeof n.probability !== 'number' || !n.fourState || !n.segmentBoundaries || !n.calibrationStatus || !n.suggestedAction) {
      throw new DecisionOutputError('noul 输出缺字段（probability/fourState/segmentBoundaries/… 双向对账红）');
    }
    return n as NoulFullOutput;
  }
  throw new DecisionOutputError(`kind 缺失或不识别（得 ${String(o.kind)}——三原语之外无第四 kind（弃权走 §四 AbstainOutput 独立留痕））`);
}
