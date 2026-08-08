// ============================================================
// dream-cycle/skillopt-backfill.ts · Stage 5 — 概念回灌 skillopt 自进化
// v1.3.0 新增
//
// 输入：Concept[]
// 输出：void（触发 fde.md 优化钩子，回灌自进化）
// 铁律：经 @sofagent/skillopt backfill 钩子，不直接调 LLM SDK。
// ============================================================

import { backfill } from '@sofagent/skillopt';

import type { Concept, LLMProvider } from './types';

/**
 * Stage 5：把合成的 Concept 回灌给 skillopt 自进化引擎。
 *
 * - 默认调 @sofagent/skillopt 的 backfill 钩子（真实链路）
 * - 测试可注入 backfillHook mock 验证「钩子被调用」
 * - 空 concepts → 空调用（pipeline 空转不报错）
 */
export async function skilloptBackfill(
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
