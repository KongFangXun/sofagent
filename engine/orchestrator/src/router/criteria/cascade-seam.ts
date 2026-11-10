// ============================================================
// cascade-seam.ts · v1.9.0 §三 ⑧ 三层级联接缝（类型层断言）
// ============================================================
// 盘查注记：assertConsumableForRouting（decision-output.ts:178）已断言
// 「uncalibrated 不进分流」——那是校准维接缝。本文件补判定维接缝（§三验收第 8 条）：
//   判定输出**只供代码分支**，执行动作与门槛**不经判定**。
//
// 类型层机制（防混装的机械判据）：
//   JudgeAdvice   判定输出（只读建议——含概率/选中项/弃权态）
//   ExecutableAction 执行动作（执行面——判定层**构造不出**本类型实例）
//   Threshold      门槛（确定性数值——只能由代码侧构造）
// 三类型间无隐式转换（brand 字段隔离），判定侧唯一能产出的是 JudgeAdvice；
// 执行侧消费 JudgeAdvice 时必经 assertAdviceOnlyForBranch（断言：advice 不得
// 携带执行语义——门槛与动作字段在类型层就不存在于 JudgeAdvice 上）。
// ============================================================

/** 判定输出（只读建议——brand 隔离：判定层只产出本类型） */
export interface JudgeAdvice {
  readonly __brand: 'judge-advice';
  /** 判定读数（概率/选中/弃权——与三原语输出同构） */
  readonly reading: {
    /** 选中项（choice）或命题真值（noul） */
    selected?: string | boolean;
    /** 概率（校准态——uncalibrated 不得进分流，另由 assertConsumableForRouting 断言） */
    probability?: number;
    /** 弃权态 */
    abstained: boolean;
  };
  /** 建议动作（不具执法力——字面即 suggested，不是 execute） */
  readonly suggestedAction?: 'proceed' | 'review' | 'stop';
}

/** 执行动作（执行面——brand 隔离：仅执行侧代码可构造） */
export interface ExecutableAction {
  readonly __brand: 'executable-action';
  /** 真实副作用动作（写库/发请求/改文件——判定层类型上无此字段族） */
  readonly effect: () => Promise<void>;
}

/** 门槛（确定性数值——brand 隔离：仅代码侧配置面可构造） */
export interface Threshold {
  readonly __brand: 'deterministic-threshold';
  readonly value: number;
  readonly basis: string;
}

/** 接缝断言错误 */
export class CascadeSeamError extends Error {
  constructor(message: string) {
    super(`[cascade-seam] ${message}`);
    this.name = 'CascadeSeamError';
  }
}

/**
 * 接缝断言（§三验收第 8 条）：判定输出只供代码分支。
 *
 * 机械判据：传入对象必须是 JudgeAdvice（brand='judge-advice'）——
 * ExecutableAction / Threshold（brand 不同）传入即抛（类型层防混装：
 * 执行动作与门槛不经判定 = 判定侧拿不到也造不出这两类对象，
 * 消费侧误把执行面对象当判定建议用同样在此被拦）。
 */
export function assertAdviceOnlyForBranch(input: unknown): asserts input is JudgeAdvice {
  const brand = (input as { __brand?: string } | null)?.__brand;
  if (brand !== 'judge-advice') {
    throw new CascadeSeamError(
      `接缝违纪：判定分支消费面只接受 JudgeAdvice（brand='judge-advice'），收到 brand='${String(brand)}'——执行动作与门槛不经判定（三层级联：判定只判断，执行归代码）`,
    );
  }
  // JudgeAdvice 结构校验：reading 在场且无执行面字段
  const advice = input as JudgeAdvice;
  if (typeof advice.reading !== 'object' || advice.reading === null) {
    throw new CascadeSeamError('JudgeAdvice.reading 缺失（判定读数是接缝的最小契约）');
  }
  if ('effect' in advice || 'execute' in advice) {
    throw new CascadeSeamError('JudgeAdvice 不得携带执行面字段（effect/execute——判定输出只供代码分支，不自带执行）');
  }
}

/** 判定侧唯一构造器（建议面——判定层代码只经本函数产出建议） */
export function makeJudgeAdvice(reading: JudgeAdvice['reading'], suggestedAction?: JudgeAdvice['suggestedAction']): JudgeAdvice {
  return { __brand: 'judge-advice', reading, suggestedAction };
}
