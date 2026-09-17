// ============================================================
// dream-cycle/synthesize-concepts.ts · Stage 4 — 模式合成概念写 knowledge/entities/
// v1.3.7 新增
//
// 输入：Pattern[] + Atom[]
// 输出：Concept[]（写入 knowledge/entities/<slug>.md）
// 铁律：不直接调 LLM SDK，必须经 LLMProvider.synthesize；
//       写 knowledge/ 是 Dream Cycle 的合法职责（Views 层派生写入）。
// ============================================================
import { mkdirSync } from 'fs';
import { join } from 'path';

import { synthesize } from '@sofagent/ontology';
import { resolveKnowledgeDir, atomicWriteWithMergeSync, mergeAppendMissing } from '@sofagent/core';

import type { Atom, Concept, LLMProvider, Pattern } from './types';
import { validateKnowledgeQuality, mockSynthesizeForDiff } from './quality-gate';

/**
 * Stage 4：把每个 Pattern 合成一个 Concept，写入 knowledge/entities/。
 *
 * - 概念标题/正文由 llm.synthesize 产出（同组 atom → title+body）
 * - 落盘格式：frontmatter（source/sensitivity）+ 标题 + 正文
 * - sensitivity 缺省 internal（safe-by-default）
 * - 质量门槛（落盘边界兜底）：任何 provider 的产出过不了
 *   validateKnowledgeQuality 三轴校验即跳过落盘 + stderr warn——
 *   RealLLM 路径门槛抛错在前，这里是第二道防线，覆盖 mock 降级 /
 *   测试注入等绕过 RealLLM 的路径（占位输出绝不进 knowledge/）。
 */
export async function synthesizeConcepts(
  patterns: Pattern[],
  atoms: Atom[],
  llm: LLMProvider,
  projectDir: string,
): Promise<Concept[]> {
  const atomById = new Map<string, Atom>(atoms.map((a) => [a.id, a]));
  const concepts: Concept[] = [];
  // v1.2.1：knowledge/ 从 .sofagent/ 迁移到 data/
  const entitiesDir = join(resolveKnowledgeDir(), 'entities');

  for (const pattern of patterns) {
    const texts = pattern.atomIds
      .map((id) => atomById.get(id)?.text)
      .filter((t): t is string => typeof t === 'string');
    if (texts.length === 0) continue;

    const { title, body } = await llm.synthesize(texts);

    // 质量门槛（落盘边界）：不达标跳过该 pattern，不落盘不计数。
    // 跳过而非抛错——mock 降级是显式已知态（周报已带标注），
    // 抛错会让 state-machine 卡死在 synthesize 重试循环。
    const gate = validateKnowledgeQuality(
      `${title}\n${body}`,
      texts.join('\n'),
      (() => {
        const mock = mockSynthesizeForDiff(texts);
        return `${mock.title}\n${mock.body}`;
      })(),
    );
    if (!gate.ok) {
      process.stderr.write(
        `[dream-cycle] 质量门槛拦截（不落盘）pattern=${pattern.id}：${gate.reasons.join('；')}\n`,
      );
      continue;
    }

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
    // v1.3.0 (交付 11)：knowledge/ 概念文件接入原子写 + 写前 mtime 检测。
    // 若其他进程已写入同名实体，用 mergeAppendMissing 保留已有内容（不覆盖丢失经验沉淀）。
    atomicWriteWithMergeSync(join(entitiesDir, `${slug}.md`), fileContent, mergeAppendMissing);
  }

  return concepts;
}
