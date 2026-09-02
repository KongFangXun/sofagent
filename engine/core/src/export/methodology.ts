// ============================================================
// methodology.ts · v1.4.4 第一章 · FDE 方法论结构化导出（锚点解析）
//
// 定位：训练语料第二件——FDE/GUIDE.md 的方法论（五要素/三问判定/
// 量化公式）机器可读化。GUIDE 更新后重导即同步（锚点驱动——不依赖
// 固定行号，章节挪动锚点跟着走）。
//
// 锚点契约：`<!-- METHODOLOGY: <key> -->` HTML 注释（渲染不可见），
// 语义段 = 锚点行到下一个同级锚点或下一个 `## ` 章节头之间。
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { join } from 'node:path';

/** 方法论语义段键（GUIDE 锚点标记的三件套） */
export const METHODOLOGY_KEYS = ['five-elements', 'three-questions', 'quantification'] as const;
export type MethodologyKey = (typeof METHODOLOGY_KEYS)[number];

/** 单段结构化导出 */
export interface MethodologySection {
  key: MethodologyKey;
  /** 段落原文（markdown——锚点到下一锚点/章节头之间的全部内容） */
  raw: string;
  /** 段落字符数（导入侧的预算参考） */
  length: number;
  /** 段内表格数（五要素/三问/量化都是表格承载——完整性信号） */
  tables: number;
}

/** 方法论语料导出（三段齐全才算完整） */
export interface MethodologyCorpus {
  schemaVersion: 'v1';
  source: string;
  exportedAt: string;
  sections: MethodologySection[];
  /** 完整性判定（三段全在位） */
  complete: boolean;
  /** 缺失段（空数组 = 完整） */
  missing: MethodologyKey[];
}

/** 锚点正则——`<!-- METHODOLOGY: key -->` */
const ANCHOR_RE = /^<!--\s*METHODOLOGY:\s*([a-z-]+)\s*-->$/;

/**
 * 解析 GUIDE markdown 的方法论锚点段。
 *
 * 段边界：锚点行 → 下一锚点行或 `## ` 章节头（取先到者，都不含边界行）。
 * 表格计数：段内以 `|` 开头且以 `|` 结尾的连续块数。
 */
export function parseMethodologySections(markdown: string): MethodologyCorpus {
  const lines = markdown.split('\n');
  const sections: MethodologySection[] = [];
  let currentKey: MethodologyKey | null = null;
  let currentStart = 0;

  const closeSection = (endLine: number): void => {
    if (currentKey === null) return;
    const raw = lines.slice(currentStart + 1, endLine).join('\n').trim();
    const tables = countTables(raw);
    sections.push({ key: currentKey, raw, length: raw.length, tables });
    currentKey = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = line.match(ANCHOR_RE);
    if (m && (METHODOLOGY_KEYS as readonly string[]).includes(m[1] ?? '')) {
      closeSection(i); // 上一段到本锚点前收口
      currentKey = (m[1] ?? '') as MethodologyKey;
      currentStart = i;
      continue;
    }
    // 章节头（## 级）也收口当前段——语义段不跨章
    if (currentKey !== null && /^## /.test(line)) {
      closeSection(i);
    }
  }
  closeSection(lines.length); // 尾段收口

  const present = new Set(sections.map((s) => s.key));
  const missing = METHODOLOGY_KEYS.filter((k) => !present.has(k));
  return {
    schemaVersion: 'v1',
    source: 'FDE/GUIDE.md',
    exportedAt: new Date().toISOString(),
    sections,
    complete: missing.length === 0,
    missing,
  };
}

/** 段内表格块计数（| 开头的连续行算一块） */
function countTables(text: string): number {
  let count = 0;
  let inTable = false;
  for (const line of text.split('\n')) {
    const isRow = line.trimStart().startsWith('|') && line.trimEnd().endsWith('|');
    if (isRow && !inTable) { count++; inTable = true; }
    else if (!isRow) inTable = false;
  }
  return count;
}

/**
 * 从仓库根读 GUIDE 并解析（默认 <cwd>/FDE/GUIDE.md——
 * SOFAGENT_REPO_ROOT 环境变量可覆盖，测试注入用）。
 */
export function exportMethodology(repoRoot?: string): MethodologyCorpus & { guidePath: string } {
  const root = repoRoot ?? process.env.SOFAGENT_REPO_ROOT ?? process.cwd();
  const guidePath = join(root, 'FDE', 'GUIDE.md');
  if (!existsSync(guidePath)) {
    return {
      schemaVersion: 'v1',
      source: 'FDE/GUIDE.md',
      exportedAt: new Date().toISOString(),
      sections: [],
      complete: false,
      missing: [...METHODOLOGY_KEYS],
      guidePath,
    };
  }
  const md = readFileSync(guidePath, 'utf-8');
  return { ...parseMethodologySections(md), guidePath };
}
