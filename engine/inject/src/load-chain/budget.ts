// ============================================================
// load-chain/budget.ts · 加载链 token 预算检测（v1.5.2 第四章）
// ============================================================
// 预算语义：加载链注入内容 ≤ 上下文窗口的 3%（ROADMAP 跟踪口径）。
// 超预算 → 触发压缩（compactor 消费本判定）；未超 → 零开销直通。
//
// ⚠️ harness 零依赖纪律：本文件只用 node 内置 + 纯函数，不 import
// 任何 @sofagent 包；token 估算是启发式（字符数/4——英文近似，中文
// 略高估），精确计量属调用方 LLM 网关侧（usage 回执）。
// ============================================================

/** 预算配置 */
export interface LoadChainBudget {
  /** 上下文窗口总 token（模型侧） */
  contextWindowTokens: number;
  /** 加载链占比上限（缺省 3%） */
  maxRatio?: number;
}

/** 预算检测结果 */
export interface BudgetVerdict {
  /** 估算的加载链 token 占用 */
  estimatedTokens: number;
  /** 预算上限 token */
  budgetTokens: number;
  /** 是否超预算（触发压缩） */
  over: boolean;
  /** 占比（0-1） */
  ratio: number;
}

/**
 * 估算字符串 token 数（启发式：字符数/4，中文按 1.5 倍加权近似）。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // CJK 字符按 ~1.5 token/字近似（中英混合内容的保守估算）
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.5 + rest / 4);
}

/**
 * 预算检测——加载链注入内容是否超预算。
 * 未配置 budget → 永不超（零开销路径，单机默认不破坏）。
 */
export function checkBudget(content: string, budget?: LoadChainBudget): BudgetVerdict {
  const estimatedTokens = estimateTokens(content);
  if (!budget || !budget.contextWindowTokens || budget.contextWindowTokens <= 0) {
    return { estimatedTokens, budgetTokens: Number.POSITIVE_INFINITY, over: false, ratio: 0 };
  }
  const maxRatio = budget.maxRatio ?? 0.03;
  const budgetTokens = Math.floor(budget.contextWindowTokens * maxRatio);
  const ratio = estimatedTokens / budget.contextWindowTokens;
  return { estimatedTokens, budgetTokens, over: estimatedTokens > budgetTokens, ratio };
}
