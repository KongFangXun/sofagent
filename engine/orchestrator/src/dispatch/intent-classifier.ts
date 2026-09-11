// ============================================================
// dispatch/intent-classifier.ts · 纯函数意图分类主判 + LLM 增强层（v1.4.8 扩展三）
// ============================================================
// 「这句话该分给谁」的路由判定 = 纯函数主判（可单测、可回放、可解释）
// + LLM 分类器仅增强层（失败/未配置回落规则）。
// 判定规则的单一事实源在纯函数——「靠 LLM 判定等于没判定」。
// ============================================================

/** 意图类别 */
export type Intent =
  | 'code'        // 写/改代码
  | 'review'      // 审阅/检查
  | 'test'        // 测试验证
  | 'docs'        // 文档
  | 'research'    // 调研/信息检索
  | 'ops'         // 部署/运维
  | 'chat';       // 闲聊/无目标

/** 规则表：正则命中 → 意图（有序——先命中先赢，优先级即表序） */
const INTENT_RULES: Array<{ re: RegExp; intent: Intent }> = [
  { re: /\b(review|审阅|审查|看看代码|pr comment|代码评审)\b/i, intent: 'review' },
  { re: /\b(test|测试|跑一下用例|验证通过|回归)\b/i, intent: 'test' },
  { re: /\b(deploy|部署|发版|上线|rollout|restart|重启)\b/i, intent: 'ops' },
  { re: /\b(doc|文档|readme|changelog|写个说明)\b/i, intent: 'docs' },
  { re: /\b(research|调研|查一下|搜一下|对比|竞品|论文)\b/i, intent: 'research' },
  { re: /\b(fix|bug|refactor|实现|写个|开发|改一下|patch|feat)\b/i, intent: 'code' },
];

/** 规则分类结果（含依据——可解释） */
export interface IntentVerdict {
  intent: Intent;
  /** 判定依据（命中规则原文 / LLM 增强 / 回落说明） */
  basis: string;
  /** 判定来源：rules（纯函数主判）| llm（增强层）| fallback（缺省） */
  source: 'rules' | 'llm' | 'fallback';
}

/**
 * 纯函数意图分类（主判——单一事实源）。
 * 未命中任何规则 → chat（fallback——LLM 增强层可改判）。
 */
export function classifyIntentByRules(message: string): IntentVerdict {
  for (const { re, intent } of INTENT_RULES) {
    if (re.test(message)) {
      return { intent, basis: `规则命中: ${re.source}`, source: 'rules' };
    }
  }
  return { intent: 'chat', basis: '未命中规则——缺省 chat（LLM 增强层可改判）', source: 'fallback' };
}

/** LLM 增强层接口（调用方注入——失败/未配置时 classifyIntent 自动回落规则） */
export type LlmIntentClassifier = (message: string) => Promise<Intent | null>;

/**
 * 完整分类：规则主判 → 规则命中即返回；未命中（fallback）时问 LLM 增强层；
 * LLM 失败/返回 null → 保持规则结果（回落注入可测）。
 */
export async function classifyIntent(
  message: string,
  llmEnhancer?: LlmIntentClassifier,
): Promise<IntentVerdict> {
  const ruleVerdict = classifyIntentByRules(message);
  if (ruleVerdict.source === 'rules') return ruleVerdict;
  if (!llmEnhancer) return ruleVerdict;
  try {
    const llmIntent = await llmEnhancer(message);
    if (llmIntent && llmIntent !== 'chat') {
      return { intent: llmIntent, basis: 'LLM 增强层改判（规则未命中）', source: 'llm' };
    }
  } catch {
    // LLM 失败 → 回落规则结果（不抛——增强层失败不阻断主判）
  }
  return ruleVerdict;
}
