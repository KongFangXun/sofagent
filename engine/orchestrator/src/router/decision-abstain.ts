// decision-abstain.ts · v1.7.0 §四 · 弃权语义独立化（一等输出态 + 三源留痕 + 三维聚合）
// ============================================================
// 定位：把「判不了」从三原语取值里独立出来——弃权（ABSTAIN）是**一等
// 输出态**，与 choice / score / noul **并列**（不是三者的取值之一）。
// 把「判不了」硬塞进某个选项或压成 0.5 概率，下游就无法区分「真的
// 势均力敌」（有效信息）与「模型没把握」（必须转人工的信号）——
// 本文件让这两者在类型层可区分。
//
// 0.5 语义（NoulSemantics 常量写死，类型层与文档同源）：
//   noul 的概率是**真值概率**而非「把握程度」——0.5 表示成立与不成立
//   **势均力敌**，不表示「中等可信」。把概率当置信度消费是判定模型
//   最容易被误用的地方（与 §三「confidence 值的语义陷阱」同族防线）。
//
// 三源分别留痕（处置口径各异——三源不可合并成一个「弃权」计数）：
//   'low-confidence'    置信不足（概率落在弃权带内）→ 可调阈
//   'out-of-domain'     域外（输入不在判据域内——OOD）→ 要人接
//   'criterion-missing' 判据缺失（该问题当前无对应判据）→ 要补判据
//
// 弃权率三维聚合：byCriterion / byDomain / byTime 三个读取入口——
// 弃权率是校准质量的先行指标（异常低 = 阈值过松或概率未校准，
// 比 ECE 更早暴露问题；异常高 = 判据不可用——两个方向都要报）。
//
// 与 decision-primitives.AbstainAttribution 的分界（防双 SSOT）：
// 那是 v1.6.0 DecisionResult 上的**结果级归因枚举**（三值近似）；
// 本文件是 §四的**输出态语义面**——独立 AbstainOutput 类型 + 三源
// 结构化留痕字段 + 处置口径 + 聚合面。前者在请求-结果对上随答案走，
// 本文件供分流/路由/观测面消费；两者语义对齐（v1.6.0 的
// 'evidence-insufficient' ≈ 本文件 'criterion-missing' 族的粗粒度
// 前身，§四起消费面以本文件为准）。
// ============================================================

/** 弃权件错误（fail-closed 载体） */
export class DecisionAbstainError extends Error {
  constructor(message: string) {
    super(`[decision-abstain] ${message}`);
    this.name = 'DecisionAbstainError';
  }
}

// ── 0.5 语义写死（类型层常量——文档与代码同源）──────────

/**
 * Noul 0.5 语义声明（§四验收第 2 条——「类型层写死」的落点）。
 *
 * 语义：noul 的概率是**真值概率**，0.5 = 成立与不成立**势均力敌**，
 * **不是**「中等可信」、不是「没把握」、不是「弃权」——
 * 没把握走 ABSTAIN（本文件的一等输出态），势均力敌走 0.5 真值概率。
 */
export const NOUL_SEMANTICS = {
  /** 0.5 的准确含义 */
  0.5: '真值概率——命题成立与不成立势均力敌（证据恰好平衡）',
  /** 显式否定项（防误用——把 0.5 当把握程度消费是已知误用面） */
  NOT_MEANS: [
    '中等可信',
    '把握程度一半',
    '弃权（没把握走 ABSTAIN 一等输出态，不走 0.5）',
  ],
} as const;

/** Noul 语义注释载体（类型层写死的文档面——消费方可引用此常量对账） */
export type NoulSemantics = typeof NOUL_SEMANTICS;

// ── 弃权三源（分别留痕——处置口径各异）──────────────────

/** 弃权三源（闭合枚举——处置口径各异，不可合并计数） */
export type AbstainSource =
  | 'low-confidence' // ① 置信不足：概率落在弃权带内 → 处置=可调阈
  | 'out-of-domain' // ② 域外：输入不在判据域内（OOD）→ 处置=要人接
  | 'criterion-missing'; // ③ 判据缺失：该问题当前无对应判据 → 处置=要补判据

/** 三源处置口径表（留痕的「为什么三源不可合并」——处置不同） */
export const ABSTAIN_SOURCE_DISPOSITION: Readonly<
  Record<AbstainSource, { disposition: string; action: string }>
> = {
  'low-confidence': {
    disposition: '概率落在弃权带内（§四分档门槛面）',
    action: '可调阈——阈值按原语分档重标（abstain-policy），非人力问题',
  },
  'out-of-domain': {
    disposition: '输入不在判据域内（OOD）',
    action: '要人接——域外输入无判据可依，转人工处置',
  },
  'criterion-missing': {
    disposition: '该问题当前无对应判据',
    action: '要补判据——登记为判据候选池（与 §四「判据覆盖检测」候选项同源）',
  },
};

// ── AbstainOutput（一等输出态——与三原语并列）────────────

/**
 * 弃权输出态（§四验收首条）——**不在三原语取值内**：
 * 与 ChoiceAnswer / ScoreAnswer / NoulAnswer 并列的第四种输出态。
 * 下游据 kind 字段区分「势均力敌」（noul probability≈0.5）与
 * 「没把握」（本态）——两者处置完全不同。
 */
export interface AbstainOutput {
  /** 输出态标记（与三原语 'choice'|'score'|'noul' 并列的第四态） */
  kind: 'abstain';
  /** 对应问句 id */
  questionId: string;
  /** 弃权源（三源之一——分别留痕的归因面） */
  source: AbstainSource;
  /**
   * 留痕字段（三源分别留痕——source 决定语义，本字段记触发时读数）：
   *   low-confidence：触发时的置信读数与门槛（越带详情）
   *   out-of-domain：域判定依据（如判据域边界检查结论）
   *   criterion-missing：判据反查结果（请求面问题 × 判据 question 比对）
   */
  trace: {
    /** 触发时观测（置信读数/域检查结论/反查结果——按 source 语义填） */
    observed: string;
    /** 触发时刻（ISO 8601——byTime 聚合的时间锚） */
    at: string;
  };
  /** 处置口径（构造时从 ABSTAIN_SOURCE_DISPOSITION 带出——留痕即留处置） */
  disposition: { disposition: string; action: string };
}

/**
 * 弃权输出构造器（fail-closed：source 非三源之一即拒载；trace.observed
 * 为空即拒载——留痕不留空的记录等于没留）。
 */
export function makeAbstainOutput(input: {
  questionId: string;
  source: AbstainSource;
  observed: string;
  at: string;
}): AbstainOutput {
  if (!input.questionId || input.questionId.trim() === '') {
    throw new DecisionAbstainError('弃权输出缺 questionId（留痕须可指认到问句）');
  }
  const known: AbstainSource[] = ['low-confidence', 'out-of-domain', 'criterion-missing'];
  if (!known.includes(input.source)) {
    throw new DecisionAbstainError(
      `弃权源「${String(input.source)}」不在三源枚举内（low-confidence / out-of-domain / criterion-missing——闭合枚举 fail-closed）`,
    );
  }
  if (!input.observed || input.observed.trim() === '') {
    throw new DecisionAbstainError(
      `问句 ${input.questionId} 弃权留痕 observed 为空（三源分别留痕——留空等于没留）`,
    );
  }
  if (!input.at || input.at.trim() === '') {
    throw new DecisionAbstainError(`问句 ${input.questionId} 弃权留痕缺触发时刻（byTime 聚合锚）`);
  }
  return {
    kind: 'abstain',
    questionId: input.questionId,
    source: input.source,
    trace: { observed: input.observed, at: input.at },
    disposition: ABSTAIN_SOURCE_DISPOSITION[input.source],
  };
}

// ── 弃权率三维聚合（byCriterion / byDomain / byTime）────

/** 弃权事件（聚合输入单元——一次弃权发生的结构化记录） */
export interface AbstainEvent {
  /** 弃权源（三源分别计数——不合并） */
  source: AbstainSource;
  /** 判据 id（byCriterion 聚合键——criterion-missing 源时为「缺的判据位」占位 id） */
  criterionId: string;
  /** 域（byDomain 聚合键——判据域标识） */
  domain: string;
  /** 发生时刻（ISO 8601——byTime 聚合键） */
  at: string;
}

/**
 * 弃权率聚合器（§四验收第 4 条——三维各有读取入口）。
 *
 * 弃权率是双刃数字（SSOT §四风险段）：
 *   - 异常低（几乎不弃权）= 阈值过松或概率未校准（比 ECE 更早暴露）
 *   - 异常高 = 判据不可用（模型只会说「判不了」）
 * 两个方向的异常都要报——abstainRateBy* 不做阈值判定（只聚合），
 * 阈值判定属观测消费面；本类的义务是让三维都可查。
 */
export class AbstainRateAggregator {
  private readonly events: AbstainEvent[] = [];

  /** 记录一次弃权事件（事件不可变——追加式留痕） */
  record(event: AbstainEvent): void {
    const known: AbstainSource[] = ['low-confidence', 'out-of-domain', 'criterion-missing'];
    if (!known.includes(event.source)) {
      throw new DecisionAbstainError(`弃权事件 source 非法（${String(event.source)}）`);
    }
    if (!event.criterionId || !event.domain || !event.at) {
      throw new DecisionAbstainError('弃权事件缺聚合键（criterionId / domain / at 三键必填）');
    }
    this.events.push({ ...event });
  }

  /** 总事件数（分母面——各维比率计算基准） */
  get total(): number {
    return this.events.length;
  }

  /** 维度一：按判据聚合（criterionId → 事件数；分源子计） */
  abstainRateByCriterion(): Map<string, { count: number; bySource: Record<AbstainSource, number> }> {
    const out = new Map<string, { count: number; bySource: Record<AbstainSource, number> }>();
    for (const e of this.events) {
      const cur = out.get(e.criterionId) ?? {
        count: 0,
        bySource: { 'low-confidence': 0, 'out-of-domain': 0, 'criterion-missing': 0 },
      };
      cur.count += 1;
      cur.bySource[e.source] += 1;
      out.set(e.criterionId, cur);
    }
    return out;
  }

  /** 维度二：按域聚合（domain → 事件数；分源子计） */
  abstainRateByDomain(): Map<string, { count: number; bySource: Record<AbstainSource, number> }> {
    const out = new Map<string, { count: number; bySource: Record<AbstainSource, number> }>();
    for (const e of this.events) {
      const cur = out.get(e.domain) ?? {
        count: 0,
        bySource: { 'low-confidence': 0, 'out-of-domain': 0, 'criterion-missing': 0 },
      };
      cur.count += 1;
      cur.bySource[e.source] += 1;
      out.set(e.domain, cur);
    }
    return out;
  }

  /**
   * 维度三：按时间聚合（窗口键 → 事件数）。
   * 窗口粒度由调用方给 windowOf（如 t => t.slice(0, 7) 按周、
   * t => t.slice(0, 13) 按小时——聚合粒度属观测配置不属语义层）。
   */
  abstainRateByTime(
    windowOf: (iso: string) => string,
  ): Map<string, { count: number; bySource: Record<AbstainSource, number> }> {
    const out = new Map<string, { count: number; bySource: Record<AbstainSource, number> }>();
    for (const e of this.events) {
      const w = windowOf(e.at);
      const cur = out.get(w) ?? {
        count: 0,
        bySource: { 'low-confidence': 0, 'out-of-domain': 0, 'criterion-missing': 0 },
      };
      cur.count += 1;
      cur.bySource[e.source] += 1;
      out.set(w, cur);
    }
    return out;
  }
}
