// ============================================================
// dream-cycle/extract-atoms.ts · Stage 2 — 从事实提取原子知识点
// v1.3.0 新增
//
// 输入：Fact[]
// 输出：Atom[]（每条原子知识点回指 factId）
// 铁律：不直接调 LLM SDK，必须经 LLMProvider。
// ============================================================

import { createHash } from 'crypto';

import type { Atom, Fact, LLMProvider } from './types';
import { validateExtractOutput } from './injection-guard';

/** 文本 → 稳定 atom id */
function atomId(factId: string, text: string): string {
  return createHash('sha256').update(`${factId}:${text}`).digest('hex').slice(0, 12);
}

/**
 * Stage 2：把每条 Fact 拆成原子知识点。
 *
 * 第一版策略：事实文本按子句切分（逗号/分号/句号），每个子句一条 atom；
 * 无子句可切时整条事实即一条 atom。保证「单条 fact → ≥1 atom」。
 */
export async function extractAtoms(facts: Fact[], llm: LLMProvider): Promise<Atom[]> {
  const atoms: Atom[] = [];
  for (const fact of facts) {
    // 用 llm.extract 对单条事实再切分（mock 按行切，单行事实原样返回）
    // [] 第二层隔离：校验返回 schema，非法时回退按行切分
    const raw = await llm.extract(fact.text);
    const pieces = validateExtractOutput(raw, fact.text);
    const clauses = pieces
      .flatMap((piece) => piece.split(/[，,；;。]/))
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    const finalClauses = clauses.length > 0 ? clauses : [fact.text];
    for (const clause of finalClauses) {
      atoms.push({ id: atomId(fact.id, clause), text: clause, factId: fact.id });
    }
  }
  return atoms;
}
