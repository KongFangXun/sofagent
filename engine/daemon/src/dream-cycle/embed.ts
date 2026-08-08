// ============================================================
// dream-cycle/embed.ts · Stage 6 — 概念向量化（供未来检索）
// v1.2.9 新增
//
// 输入：Concept[]
// 输出：Embedding[]（本版只产出向量，检索服务见 v1.2.9+「明确不做」）
// 铁律：不直接调 LLM SDK，必须经 LLMProvider.embed。
// ============================================================

import type { Concept, Embedding, LLMProvider } from './types';

/**
 * Stage 6：为每个 Concept 产出向量。
 *
 * 本版只产出向量（内存返回），不落盘、不建检索 server（v1.1.8+）。
 * knowledge-health 的重复检测本版用 normalized key 碰撞，不依赖本产出。
 */
export async function embedConcepts(
  concepts: Concept[],
  llm: LLMProvider,
): Promise<Embedding[]> {
  const embeddings: Embedding[] = [];
  for (const concept of concepts) {
    const vector = await llm.embed(`${concept.title}\n${concept.body}`);
    embeddings.push({ slug: concept.slug, vector });
  }
  return embeddings;
}
