// ============================================================
// entry-gate.ts · v1.9.0 §三 ⑦ 入口判据——「这件事是否该交给判定」
// ============================================================
// 定位：判据登记时的入口门面（盘查注记：无对应实现，建议落门面函数 + 硬项）。
// 每条判据在进判据集前先回答：这件事适合判定吗？——不适用的**落到代码或
// 生成模型**（JUDGE_INAPPLICABLE_FACES 四类），且**理由留痕**（§三验收第 7 条）。
//
// 判定的价值公式（devlog §三交付表）：输入没法写死、但答案空间可以写死——
// 两侧任一不成立，即回到确定性代码或生成模型。本门面把该公式机械化：
//   shouldJudge(inputDeterminable, answerSpaceWritable) → allow / divert
//   两参任一 false ⇒ divert（不给判定，返回落点与理由）。
// ============================================================

/** 入口判据输入（四要素——判据登记时逐项回答） */
export interface EntryGateInput {
  /** 判据 id（登记侧标识——留痕锚） */
  criterionId: string;
  /** 输入能否写死（true=输入形态稳定可枚举 ⇒ 不需要语义泛化 ⇒ 该走代码） */
  inputDeterminable: boolean;
  /** 答案空间能否写死（true=候选/分值可封闭枚举 ⇒ 判定可判） */
  answerSpaceWritable: boolean;
  /** 延迟预算（ms；≤10 属「十毫秒级」不适用面） */
  latencyBudgetMs?: number;
}

/** 入口裁决 */
export interface EntryGateVerdict {
  criterionId: string;
  /** allow=交给判定；divert=不交（落到 fallback 并留痕理由） */
  decision: 'allow' | 'divert';
  /** divert 时的落点（allow 为 undefined） */
  fallback?: '代码' | '生成模型' | '小分类器';
  /** 理由（divert 必填——§三验收第 7 条「理由留痕」） */
  reason: string;
}

/** 入口判据门面（纯函数——同输入同裁决，可单测可审计） */
export function shouldJudge(input: EntryGateInput): EntryGateVerdict {
  if (input.latencyBudgetMs !== undefined && input.latencyBudgetMs <= 10) {
    return {
      criterionId: input.criterionId,
      decision: 'divert',
      fallback: '小分类器',
      reason: `延迟预算 ${input.latencyBudgetMs}ms ≤ 10ms（十毫秒级延迟类不适用面）——判定件在数百毫秒档，差两个量级`,
    };
  }
  if (input.inputDeterminable && input.answerSpaceWritable) {
    return {
      criterionId: input.criterionId,
      decision: 'divert',
      fallback: '代码',
      reason: '输入可写死且答案空间可写死——纯函数可直接写出，交给判定 = 白增一层不可审计间接',
    };
  }
  if (!input.answerSpaceWritable) {
    return {
      criterionId: input.criterionId,
      decision: 'divert',
      fallback: '生成模型',
      reason: '答案空间无法写死（开放产出）——属生成面，判定不写字',
    };
  }
  // inputDeterminable=false && answerSpaceWritable=true：输入没法写死、答案可写死——判定的正位
  return { criterionId: input.criterionId, decision: 'allow', reason: '输入需语义泛化而答案空间可封闭——判定的价值位（两条件齐备）' };
}

/**
 * 判据登记入口（硬项）：判据集登记每条判据时必经本门面——divert 即拒绝入集
 * （fail-closed），allow 才进判据集。理由全量留痕（登记台账形态返回）。
 */
export function gateCriterionForRegistration(
  inputs: EntryGateInput[],
): { allowed: EntryGateVerdict[]; diverted: EntryGateVerdict[] } {
  const allowed: EntryGateVerdict[] = [];
  const diverted: EntryGateVerdict[] = [];
  for (const i of inputs) {
    const v = shouldJudge(i);
    (v.decision === 'allow' ? allowed : diverted).push(v);
  }
  return { allowed, diverted };
}
