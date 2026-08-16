// ============================================================
// dream-cycle/cluster-patterns.ts · Stage 3 — 原子知识点聚类成模式
// v1.3.5 新增
//
// 输入：Atom[]
// 输出：Pattern[]（聚类模式；保证 M ≤ N，N ≥ 2 时 M < N）
// 铁律：不直接调 LLM SDK，必须经 LLMProvider.cluster。
// ============================================================

import { createHash } from 'crypto';

import type { Atom, LLMProvider, Pattern } from './types';

/** 聚类标签 → 稳定 pattern id */
function patternId(label: string): string {
  return createHash('sha256').update(label).digest('hex').slice(0, 12);
}

/**
 * Stage 3：把 Atom 聚类成 Pattern。
 *
 * 调 llm.cluster 拿到每条 atom 的聚类标签，同标签的 atom 归为一个
 * pattern。MockLLM 的 cluster 按 hash 分桶，保证 N ≥ 2 时 M < N。
 */
export async function clusterPatterns(atoms: Atom[], llm: LLMProvider): Promise<Pattern[]> {
  if (atoms.length === 0) return [];
  const labels = await llm.cluster(atoms.map((a) => a.text));
  const byLabel = new Map<string, string[]>();
  atoms.forEach((atom, i) => {
    const label = labels[i] ?? 'pattern-0';
    const list = byLabel.get(label) ?? [];
    list.push(atom.id);
    byLabel.set(label, list);
  });
  const patterns: Pattern[] = [];
  for (const [label, atomIds] of byLabel) {
    patterns.push({ id: patternId(label), label, atomIds });
  }
  return patterns;
}
