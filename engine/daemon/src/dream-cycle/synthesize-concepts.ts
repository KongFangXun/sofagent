// ============================================================
// dream-cycle/synthesize-concepts.ts · Stage 4 — 模式合成概念写 knowledge/entities/
// v1.1.9 新增
//
// 输入：Pattern[] + Atom[]
// 输出：Concept[]（写入 knowledge/entities/<slug>.md）
// 铁律：不直接调 LLM SDK，必须经 LLMProvider.synthesize；
//       写 knowledge/ 是 Dream Cycle 的合法职责（Views 层派生写入）。
// ============================================================
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import { synthesize } from '@sofagent/ontology';

import type { Atom, Concept, LLMProvider, Pattern } from './types';

/**
 * Stage 4：把每个 Pattern 合成一个 Concept，写入 knowledge/entities/。
 *
 * - 概念标题/正文由 llm.synthesize 产出（同组 atom → title+body）
 * - 落盘格式：frontmatter（source/sensitivity）+ 标题 + 正文
 * - sensitivity 缺省 internal（safe-by-default）
 */
export async function synthesizeConcepts(
  patterns: Pattern[],
  atoms: Atom[],
  llm: LLMProvider,
  projectDir: string,
): Promise<Concept[]> {
  const atomById = new Map<string, Atom>(atoms.map((a) => [a.id, a]));
  const concepts: Concept[] = [];
  const entitiesDir = join(projectDir, '.sofagent', 'knowledge', 'entities');

  for (const pattern of patterns) {
    const texts = pattern.atomIds
      .map((id) => atomById.get(id)?.text)
      .filter((t): t is string => typeof t === 'string');
    if (texts.length === 0) continue;

    const { title, body } = await llm.synthesize(texts);
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `concept-${pattern.id}`;

    const concept: Concept = {
      slug,
      title,
      body,
      source: `dream-cycle:${pattern.label}`,
      sensitivity: 'internal',
    };
    concepts.push(concept);

    // 调 @sofagent/ontology synthesize 接口生成交互产物（本体层登记）
    synthesize(concept);

    // 落盘 knowledge/entities/<slug>.md
    mkdirSync(entitiesDir, { recursive: true });
    const fileContent =
      `---\n` +
      `source: ${concept.source}\n` +
      `sensitivity: ${concept.sensitivity}\n` +
      `---\n\n` +
      `# ${title}\n\n${body}\n`;
    writeFileSync(join(entitiesDir, `${slug}.md`), fileContent, 'utf-8');
  }

  return concepts;
}
