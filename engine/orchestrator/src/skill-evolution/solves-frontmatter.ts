// ============================================================
// skill-evolution/solves-frontmatter.ts · SKILL.md solves: 溯源字段
// v1.4.5 第七章四新增（WikiSkill PURPOSE 溯源机制收编）
// ============================================================
//
// PURPOSE 溯源：SKILL.md frontmatter 增 solves: 字段——技能回链所
// 解决的 pattern/问题（「为什么存在」）。修改技能时先理解设计意图，
// 而非对孤立 SKILL.md 盲目打补丁。
//
// 落地边界（实测口径）：SKILL/ 子树 26 个 .md 中带 frontmatter 的
// 仅 5 个（SKILL/SKILL.md + agents/{reviewer,audit,fde,engineer}/
// SKILL.md）——只补这 5 个；其余 21 个为 harness 模板/知识文档，
// 无 frontmatter 不加。
// ============================================================

import { readFileSync, writeFileSync } from 'fs';

/** frontmatter solves: 字段名（固定——台账 solvesPattern 与之同源） */
export const SOLVES_FIELD = 'solves';

/** 解析结果 */
export interface FrontmatterSolves {
  /** 是否有 frontmatter（--- 包裹块） */
  hasFrontmatter: boolean;
  /** solves: 值（无则 null；数组取全部，字符串原样） */
  solves: string[] | null;
  /** frontmatter 结束行号（0 = 无 frontmatter；追加字段的插入位） */
  frontmatterEndLine: number;
}

/**
 * 解析 SKILL.md frontmatter 的 solves: 字段（只读，不写）。
 * YAML 数组形态（- 项列表）与行内数组形态（[a, b]）都支持。
 */
export function parseSolvesField(content: string): FrontmatterSolves {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { hasFrontmatter: false, solves: null, frontmatterEndLine: 0 };
  }
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endLine = i;
      break;
    }
  }
  if (endLine === -1) {
    return { hasFrontmatter: false, solves: null, frontmatterEndLine: 0 };
  }

  // 行内数组形态：solves: [a, b]
  for (let i = 1; i < endLine; i++) {
    const inline = lines[i]?.match(/^solves:\s*\[(.*)\]\s*$/);
    if (inline) {
      const items = inline[1]!.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      return { hasFrontmatter: true, solves: items.length > 0 ? items : null, frontmatterEndLine: endLine };
    }
  }
  // 列表形态：solves: 后跟 - 项
  for (let i = 1; i < endLine; i++) {
    if (lines[i]?.match(/^solves:\s*$/)) {
      const items: string[] = [];
      for (let j = i + 1; j < endLine; j++) {
        const m = lines[j]?.match(/^\s+-\s+(.+)$/);
        if (!m) break;
        items.push(m[1]!.trim().replace(/^['"]|['"]$/g, ''));
      }
      return { hasFrontmatter: true, solves: items.length > 0 ? items : null, frontmatterEndLine: endLine };
    }
  }
  return { hasFrontmatter: true, solves: null, frontmatterEndLine: endLine };
}

/**
 * 给 SKILL.md 追加/校验 solves: 字段（幂等——已有合法值不重写）。
 *
 * @returns true = 写入完成 / false = 无需写入（已有值）或无 frontmatter（不加）
 */
export function ensureSolvesField(
  filePath: string,
  patterns: string[],
): { changed: boolean; reason: string } {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parseSolvesField(content);
  if (!parsed.hasFrontmatter) {
    return { changed: false, reason: '无 frontmatter——harness 模板/知识文档不加 solves 字段' };
  }
  if (parsed.solves !== null && parsed.solves.length > 0) {
    return { changed: false, reason: `已有 solves 字段（${parsed.solves.length} 项）——不重写` };
  }
  // frontmatter 结束行（---）前插入 solves: 列表
  const lines = content.split('\n');
  const insertAt = parsed.frontmatterEndLine;
  const block = [`${SOLVES_FIELD}:`, ...patterns.map((p) => `  - ${p}`)];
  lines.splice(insertAt, 0, ...block);
  writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return { changed: true, reason: `已插入 solves 字段（${patterns.length} 项）` };
}
