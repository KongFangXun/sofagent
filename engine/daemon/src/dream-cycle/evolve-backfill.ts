// ============================================================
// dream-cycle/evolve-backfill.ts · Stage 5 — 概念回灌 evolve 自进化
// v1.3.7 新增
//
// 输入：Concept[]
// 输出：void（触发 fde.md 优化钩子，回灌自进化）
// 铁律：经 @sofagent/evolve backfill 钩子，不直接调 LLM SDK。
// ============================================================

import { backfill } from '@sofagent/evolve';

import type { Concept, LLMProvider } from './types';

/**
 * Stage 5：把合成的 Concept 回灌给 evolve 自进化能力。
 *
 * - 默认调 @sofagent/evolve 的 backfill 钩子（真实链路）
 * - 测试可注入 backfillHook mock 验证「钩子被调用」
 * - 空 concepts → 空调用（pipeline 空转不报错）
 */
export async function evolveBackfill(
  concepts: Concept[],
  _llm: LLMProvider,
  hook?: (concepts: unknown[]) => Promise<void> | void,
): Promise<void> {
  if (hook) {
    await hook(concepts);
    return;
  }
  await backfill(concepts);
}
