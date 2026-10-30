// decision-primitives.ts · 判定三原语类型（Choice / Score / Noul）typed answer 定稿
// ============================================================
// 定位：v1.7.0 判定底座阶段一的根契约——把「判定」从裸枚举/裸布尔/裸分值
// 升级为带概率结构的类型化答案。类型是判定面的根契约，拔掉则判定结果
// 无法被审计消费（形态归属：[主干] 不可拔）。
//
// 三原语：
//   Choice——从候选项里做选择：输出选中项 + 全候选项概率分布（不是只输出一个选项）。
//   Score ——按标准打分：输出分值 + 区间/不确定度。
//   Noul  ——给出某判断成立的概率：输出真值概率。
//
// 设计铁律（fail-closed 面）：
//   ① 问句集限定：判定请求携带限定回答类型的问句集（问题与原语类型绑定），
//      输出类型与请求问句类型不符时拒绝（非静默接受）。
//   ② Choice 候选集必含兜底项（「以上都不是」/「信息不足」类）；缺项即拒载
//      该问句（加载期 fail-closed）。兜底项与弃权互补、不等价、两处都要有：
//      弃权（ABSTAIN）是模型自给的态；兜底项是问句集里的候选，需要模型选中。
//   ③ 兜底项实证边界：判据本身可被布尔复核时，拒答不只依赖模型自报的类别
//      选择——校验式路径配套（verificationPath 字段）。
//   ④ 多问并行：同一状态多问一次前向出全部答案（schema 层批量形态）。
//   ⑤ 与既有置信度并存：新类型与 TriggerConfidence / 'high'|'med'|'low' /
//      confidentiality 并存不冲突；映射口径见 ARCHITECTURE 判定面。
//   ⑥ decision-log / HMAC 链 schema 本版零改动（本模块只新增，不触碰既有链）。
// ============================================================

/** 判定原语种类（闭合枚举——本版只有这三种，新增须过 schema 评审） */
export type DecisionPrimitiveKind = 'choice' | 'score' | 'noul';

/** 兜底项语义标记（候选集内的「以上都不是 / 信息不足」类候选） */
export interface FallbackOption {
  /** 兜底候选的 id（如 'none-of-the-above'） */
  id: string;
  /** 兜底语义标签（人类可读） */
  label: string;
}

/** 普通候选（非兜底） */
export interface PlainOption {
  id: string;
  label: string;
  /** 兜底标记——普通候选恒 false（类型层防混装） */
  isFallback: false;
}

/** 兜底候选——isFallback 恒 true */
export interface FallbackMarkedOption extends FallbackOption {
  isFallback: true;
}

export type ChoiceOption = PlainOption | FallbackMarkedOption;

// ── 问句定义（判定请求侧）──────────────────────────────

/** Choice 问句：候选集 + 兜底项强制 */
export interface ChoiceQuestion {
  kind: 'choice';
  /** 问句 id（判定请求内唯一） */
  id: string;
  /** 问句文本 */
  question: string;
  /** 候选集（必含恰一个兜底项——构造器强制） */
  options: readonly ChoiceOption[];
  /**
   * 校验式路径（实证边界配套）：判据本身可被布尔复核时给出复核函数名/路径。
   * 拒答不应只依赖模型自报的类别选择——有此字段时消费侧须优先走校验。
   */
  verificationPath?: string;
}

/** Score 问句：值域 + 精度 */
export interface ScoreQuestion {
  kind: 'score';
  id: string;
  question: string;
  /** 分值下界（含） */
  min: number;
  /** 分值上界（含） */
  max: number;
  /** 步长（刻度粒度；缺省 1） */
  step?: number;
}

/** Noul 问句：无额外参数（输出真值概率） */
export interface NoulQuestion {
  kind: 'noul';
  id: string;
  question: string;
}

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

// ── 答案类型（判定输出侧）──────────────────────────────

/** Choice 答案：选中项 + 全候选项概率分布 + 兜底/弃权区分 */
export interface ChoiceAnswer {
  kind: 'choice';
  /** 对应问句 id */
  questionId: string;
  /** 选中的候选 id */
  selected: string;
  /** 全候选项概率分布（所有候选含兜底项各一项，和≈1，容差 1e-6） */
  distribution: Readonly<Record<string, number>>;
  /**
   * 分布熵（v1.7.0 §五 补齐——可选字段向后兼容）：
   * 归一熵 ∈ [0,1]（底 log(k)）。低熵=判定明确，高熵=选项间接近→
   * 可作为「需复核」信号。完整输出面（含熵的构造与守卫）见
   * decision-output.ts makeChoiceFullOutput——本字段是 Answer 层的
   * 薄留痕位（既有消费方零改动）。
   */
  entropy?: number;
  /**
   * 兜底项与弃权的区分留痕：
   *   fallbackSelected = true  ⇒ 模型「选中了兜底候选」（分类路径）
   *   abstained       = true  ⇒ 模型给出弃权态（ABSTAIN）
   * 两者互补不等价：可同时为 false（正常选中普通候选）；同时为 true 无意义
   * （构造器拒绝）——弃权时 selected 应指向兜底项 id 以保持分布完整。
   */
  fallbackSelected: boolean;
  abstained: boolean;
  /**
   * 答案来源（v1.7.x 修补线，可选向后兼容）：'deterministic' = 确定性
   * 复算出（deterministic-judge 路由命中）；缺省 = 模型推理出。
   */
  source?: AnswerSource;
  /** 确定性复算留痕（source='deterministic' 时必带——构造器校验） */
  deterministicTrace?: DeterministicTraceFields;
}

/** Score 答案：分值 + 区间/不确定度 */
export interface ScoreAnswer {
  kind: 'score';
  questionId: string;
  /** 分值（落在问句 [min,max] 内） */
  value: number;
  /** 区间下界（含） */
  lower: number;
  /** 区间上界（含） */
  upper: number;
  /** 不确定度（≥0；区间宽度的另一种表达，二者须自洽：upper-lower ≈ 2σ 量级） */
  uncertainty: number;
  /**
   * 档位序（v1.7.0 §五 补齐——可选字段向后兼容）：
   * value 在等宽 ordinalTotal 档中的档序（0 基）。序信息由 §二保序约束
   * 保证不被校准破坏（RPS 优化出的序结构）。完整输出面（区间+序构造与
   * 守卫）见 decision-output.ts makeScoreFullOutput。
   */
  ordinal?: number;
  /** 档位总数（序/总数并列——序不可独读） */
  ordinalTotal?: number;
  /**
   * 答案来源（v1.7.x 修补线，可选向后兼容）：'deterministic' = 确定性
   * 复算出（deterministic-judge 路由命中）；缺省 = 模型推理出。
   */
  source?: AnswerSource;
  /** 确定性复算留痕（source='deterministic' 时必带——构造器校验） */
  deterministicTrace?: DeterministicTraceFields;
}

/** Noul 答案：真值概率 */
export interface NoulAnswer {
  kind: 'noul';
  questionId: string;
  /** 判断成立的概率 ∈ [0,1] */
  probability: number;
  /**
   * 四态（v1.7.0 §五 补齐——可选字段向后兼容）：
   * '成立'|'倾向成立'|'倾向不成立'|'不成立'——由校准后概率分段得出
   * （分段口径 = §四门槛 ThresholdsByPrimitive，映射函数与边界留痕见
   * decision-output.ts fourStateMapping / makeNoulFullOutput）。
   */
  fourState?: '成立' | '倾向成立' | '倾向不成立' | '不成立';
  /**
   * 答案来源（v1.7.x 修补线，可选向后兼容）：'deterministic' = 确定性
   * 复算出（deterministic-judge 路由命中）；缺省 = 模型推理出。
   *（当前确定性路由只覆盖 choice/score 两族——noul 留位为类型面完整，
   *  语义与另两原语同构。）
   */
  source?: AnswerSource;
  /** 确定性复算留痕（source='deterministic' 时必带——构造器校验） */
  deterministicTrace?: DeterministicTraceFields;
}

export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

// ── 确定性留痕（v1.7.x 修补线——答案由确定性复算出的留痕位）────

/**
 * 答案来源标记：'deterministic' = 该答案由确定性复算出（非模型推理）。
 * 留在 Answer 层而非 Result 层——一次判定里逐问来源可不同
 *（部分问句确定性命中、部分落模型，A/B 对照读数按问粒度对账）。
 */
export type AnswerSource = 'deterministic';

/**
 * 确定性复算留痕（与 deterministic-judge.DeterministicTrace 同构——
 * rule 类型用 string 而非 DeterministicRule 枚举：decision-primitives 是
 * 根契约层，不反向依赖判定实现层（防循环 import；合法值由生产侧保证）。
 */
export interface DeterministicTraceFields {
  /** 命中规则名（如 'extremum'/'edges'——deterministic-judge 的 DeterministicRule） */
  rule: string;
  /** 人类可读复算依据（审计面对账用） */
  observed: string;
  /** 触发时刻（ISO 8601） */
  at: string;
}

/** 确定性留痕校验（make*Answer 构造器共用——source='deterministic' 而 trace 缺/observed 空 → 抛错；报错含 rule 名便于定位） */
function validateDeterministicTrace(
  source: AnswerSource | undefined,
  trace: DeterministicTraceFields | undefined,
  questionId: string,
): void {
  if (source === 'deterministic') {
    if (!trace || !trace.rule || !trace.rule.trim()) {
      throw new DecisionPrimitiveError(`问句 ${questionId} source='deterministic' 但 trace.rule 缺（留痕不留空的记录等于没留）`);
    }
    if (!trace.observed || !trace.observed.trim()) {
      throw new DecisionPrimitiveError(
        `问句 ${questionId} source='deterministic'（rule=${trace.rule}）但 trace.observed 为空（复算依据须可对账）`,
      );
    }
    if (!trace.at || !trace.at.trim()) {
      throw new DecisionPrimitiveError(
        `问句 ${questionId} source='deterministic'（rule=${trace.rule}）但 trace.at 缺（时间锚）`,
      );
    }
  }
  if (trace && source !== 'deterministic') {
    throw new DecisionPrimitiveError(
      `问句 ${questionId} 带 deterministicTrace（rule=${trace.rule ?? '?'}）但 source 非 'deterministic'（trace 只属确定性来源——错配即拒载）`,
    );
  }
}

// ── 弃权归因（ABSTAIN 三源）────────────────────────────

/** 弃权归因三源（与 v1.6.0 判据档位五态的 ABSTAIN 态配套） */
export type AbstainAttribution =
  | 'evidence-insufficient' // 证据不足
  | 'criteria-unregistered' // 判据未登记
  | 'domain-out-of-scope'; // 域外

// ── 批量形态（多问并行）────────────────────────────────

/** 判定请求：同一状态 + 多问句集（问题间相互独立、不串扰） */
export interface DecisionRequest {
  /** 状态（判定输入的最小可判定表示；内容不透明于本层） */
  state: string;
  /** 问句集（id 唯一；混合原语种类允许——一次前向出全部答案） */
  questions: readonly DecisionQuestion[];
}

/** 判定结果：请求内全部问句的答案（一一对应，无静默缺问） */
export interface DecisionResult {
  answers: readonly DecisionAnswer[];
  /** 弃权归因（仅当存在 abstained=true 的答案时必填） */
  abstainAttribution?: AbstainAttribution;
}

// ── 校验错误（fail-closed 统一形态）────────────────────

export class DecisionPrimitiveError extends Error {
  constructor(message: string) {
    super(`[decision-primitives] ${message}`);
    this.name = 'DecisionPrimitiveError';
  }
}

// ── 构造器与校验 ────────────────────────────────────────

const DIST_TOLERANCE = 1e-6;

/** Choice 问句构造器：候选集必含恰一个兜底项（缺项/多项即拒载） */
export function makeChoiceQuestion(
  id: string,
  question: string,
  plainOptions: ReadonlyArray<{ id: string; label: string }>,
  fallback: FallbackOption,
  opts?: { verificationPath?: string },
): ChoiceQuestion {
  if (plainOptions.length === 0) {
    throw new DecisionPrimitiveError(`问句 ${id} 候选集为空（须至少一个普通候选 + 一个兜底项）`);
  }
  const ids = new Set([...plainOptions.map((o) => o.id), fallback.id]);
  if (ids.size !== plainOptions.length + 1) {
    throw new DecisionPrimitiveError(`问句 ${id} 候选 id 重复`);
  }
  return {
    kind: 'choice',
    id,
    question,
    options: [
      ...plainOptions.map((o) => ({ ...o, isFallback: false as const })),
      { ...fallback, isFallback: true as const },
    ],
    ...(opts?.verificationPath ? { verificationPath: opts.verificationPath } : {}),
  };
}

/** Choice 问句加载校验：候选集缺兜底项即拒载（fail-closed） */
export function validateChoiceQuestion(q: ChoiceQuestion): void {
  const fallbacks = q.options.filter((o) => o.isFallback);
  if (fallbacks.length !== 1) {
    throw new DecisionPrimitiveError(
      `问句 ${q.id} 候选集兜底项数=${fallbacks.length}（须恰一个——加载期 fail-closed）`,
    );
  }
}

/** Choice 答案构造器：分布合法性 + 兜底/弃权互斥留痕 + 确定性来源留痕 */
export function makeChoiceAnswer(
  q: ChoiceQuestion,
  selected: string,
  distribution: Record<string, number>,
  flags?: { abstained?: boolean },
  detOpts?: DeterministicAnswerOpts,
): ChoiceAnswer {
  validateChoiceQuestion(q);
  // 分布键须与候选集完全一致
  const optIds = new Set(q.options.map((o) => o.id));
  const distKeys = new Set(Object.keys(distribution));
  if (optIds.size !== distKeys.size || [...optIds].some((k) => !distKeys.has(k))) {
    throw new DecisionPrimitiveError(
      `问句 ${q.id} 答案分布键与候选集不一致（候选 ${optIds.size} / 分布 ${distKeys.size}）`,
    );
  }
  // 概率非负 + 归一
  const sum = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (Object.values(distribution).some((p) => p < 0)) {
    throw new DecisionPrimitiveError(`问句 ${q.id} 分布含负概率`);
  }
  if (Math.abs(sum - 1) > DIST_TOLERANCE) {
    throw new DecisionPrimitiveError(`问句 ${q.id} 分布和=${sum}（须≈1，容差 ${DIST_TOLERANCE}）`);
  }
  if (!optIds.has(selected)) {
    throw new DecisionPrimitiveError(`问句 ${q.id} 选中项「${selected}」不在候选集`);
  }
  const fallbackId = q.options.find((o) => o.isFallback)!.id;
  const fallbackSelected = selected === fallbackId;
  const abstained = flags?.abstained === true;
  // 兜底选中与弃权互斥不可同真（同真=「选了兜底还要弃权」语义无意义）
  if (fallbackSelected && abstained) {
    throw new DecisionPrimitiveError(
      `问句 ${q.id} fallbackSelected 与 abstained 不可同时为 true（兜底是候选路径，弃权是态——互补不等价）`,
    );
  }
  // 弃权时 selected 须指向兜底项（分布完整性的约定形态）
  if (abstained && !fallbackSelected) {
    throw new DecisionPrimitiveError(
      `问句 ${q.id} 弃权时 selected 须指向兜底项「${fallbackId}」（保持分布完整）`,
    );
  }
  validateDeterministicTrace(detOpts?.source, detOpts?.deterministicTrace, q.id);
  return {
    kind: 'choice',
    questionId: q.id,
    selected,
    distribution,
    fallbackSelected,
    abstained,
    ...(detOpts?.source ? { source: detOpts.source } : {}),
    ...(detOpts?.deterministicTrace ? { deterministicTrace: detOpts.deterministicTrace } : {}),
  };
}

// makeChoiceAnswer 重载面（确定性留痕 opts——见下方 DeterministicAnswerOpts）

/** 确定性答案构造 opts（make*Answer 共用——source + trace 成对校验） */
export interface DeterministicAnswerOpts {
  /** 答案来源：'deterministic' = 确定性复算出（须带 trace——校验器强制） */
  source?: AnswerSource;
  /** 复算留痕（source='deterministic' 时必带；非确定性来源不得带） */
  deterministicTrace?: DeterministicTraceFields;
}

/** Score 答案构造器：值域 + 区间自洽 + 确定性来源留痕 */
export function makeScoreAnswer(
  q: ScoreQuestion,
  value: number,
  interval: { lower: number; upper: number },
  uncertainty: number,
  detOpts?: DeterministicAnswerOpts,
): ScoreAnswer {
  if (value < q.min || value > q.max) {
    throw new DecisionPrimitiveError(`问句 ${q.id} 分值 ${value} 越界 [${q.min},${q.max}]`);
  }
  if (!(interval.lower <= value && value <= interval.upper)) {
    throw new DecisionPrimitiveError(
      `问句 ${q.id} 区间 [${interval.lower},${interval.upper}] 须包含分值 ${value}`,
    );
  }
  if (interval.lower > interval.upper) {
    throw new DecisionPrimitiveError(`问句 ${q.id} 区间下界 > 上界`);
  }
  if (uncertainty < 0) {
    throw new DecisionPrimitiveError(`问句 ${q.id} 不确定度须 ≥0`);
  }
  validateDeterministicTrace(detOpts?.source, detOpts?.deterministicTrace, q.id);
  return {
    kind: 'score',
    questionId: q.id,
    value,
    ...interval,
    uncertainty,
    ...(detOpts?.source ? { source: detOpts.source } : {}),
    ...(detOpts?.deterministicTrace ? { deterministicTrace: detOpts.deterministicTrace } : {}),
  };
}

/** Noul 答案构造器：概率 ∈ [0,1] + 确定性来源留痕（类型面完整留位） */
export function makeNoulAnswer(q: NoulQuestion, probability: number, detOpts?: DeterministicAnswerOpts): NoulAnswer {
  if (probability < 0 || probability > 1) {
    throw new DecisionPrimitiveError(`问句 ${q.id} 真值概率 ${probability} 越界 [0,1]`);
  }
  validateDeterministicTrace(detOpts?.source, detOpts?.deterministicTrace, q.id);
  return {
    kind: 'noul',
    questionId: q.id,
    probability,
    ...(detOpts?.source ? { source: detOpts.source } : {}),
    ...(detOpts?.deterministicTrace ? { deterministicTrace: detOpts.deterministicTrace } : {}),
  };
}

// ── 问句集限定（类型不符拒绝）──────────────────────────

/** 判定请求校验：问句 id 唯一 + 答案类型与问句类型一致（fail-closed） */
export function validateDecisionPairing(
  request: DecisionRequest,
  result: DecisionResult,
): void {
  const qById = new Map(request.questions.map((q) => [q.id, q] as const));
  if (qById.size !== request.questions.length) {
    throw new DecisionPrimitiveError('请求内问句 id 重复');
  }
  const answered = new Set<string>();
  for (const a of result.answers) {
    const q = qById.get(a.questionId);
    if (!q) {
      throw new DecisionPrimitiveError(`答案 ${a.questionId} 无对应问句`);
    }
    // 问句集限定：类型必须一致（拒绝而非静默接受）
    if (a.kind !== q.kind) {
      throw new DecisionPrimitiveError(
        `问句 ${q.id} 类型 ${q.kind} 与答案类型 ${a.kind} 不符（问句集限定 fail-closed）`,
      );
    }
    if (answered.has(a.questionId)) {
      throw new DecisionPrimitiveError(`问句 ${q.id} 被重复作答`);
    }
    answered.add(a.questionId);
  }
  // 无静默缺问：请求内每个问句都必须有答案
  for (const q of request.questions) {
    if (!answered.has(q.id)) {
      throw new DecisionPrimitiveError(`问句 ${q.id} 缺答案（多问并行不得静默缺问）`);
    }
  }
  // 弃权归因必填性
  const hasAbstain = result.answers.some(
    (a): a is ChoiceAnswer => a.kind === 'choice' && a.abstained,
  );
  if (hasAbstain && !result.abstainAttribution) {
    throw new DecisionPrimitiveError('存在弃权答案但缺 abstainAttribution（三源归因必填）');
  }
}

/** 批量形态校验入口：请求 + 结果一次校验（多问并行不串扰的结构保证） */
export function makeDecisionResult(
  request: DecisionRequest,
  answers: readonly DecisionAnswer[],
  abstainAttribution?: AbstainAttribution,
): DecisionResult {
  const result: DecisionResult = { answers, ...(abstainAttribution ? { abstainAttribution } : {}) };
  validateDecisionPairing(request, result);
  return result;
}

// ── 与既有置信度枚举的映射（并存口径）──────────────────

/** 既有三档置信枚举（audit/decision-schema 的 'high'|'med'|'low'） */
export type LegacyConfidence = 'high' | 'med' | 'low';

/**
 * 既有三档枚举 → Noul 概率的映射（迁移路径——旧消费方不动，新消费方可升级）：
 *   high → 0.9 / med → 0.6 / low → 0.3（档位代表概率区间的事先承诺，
 *   区间边界见 ARCHITECTURE 判定面表；非精确换算，语义是「档位到概率的
 *   保序映射」）。
 */
export function legacyConfidenceToNoul(c: LegacyConfidence): number {
  switch (c) {
    case 'high':
      return 0.9;
    case 'med':
      return 0.6;
    case 'low':
      return 0.3;
  }
}

/** Noul 概率 → 既有三档（反向映射，阈值与正向档位区间一致） */
export function noulToLegacyConfidence(p: number): LegacyConfidence {
  if (p < 0 || p > 1) throw new DecisionPrimitiveError(`概率 ${p} 越界 [0,1]`);
  return p >= 0.75 ? 'high' : p >= 0.45 ? 'med' : 'low';
}
