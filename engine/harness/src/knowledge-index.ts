// ============================================================
// knowledge-index.ts · L4 经验层知识索引构建（v1.3.2 交付 14）
// ============================================================
//
// 渐进加载增强：buildConstrainedSystemPrompt 注入格式改为
// 「热点全文 + 索引」混合——
//   热点 2 篇：全文注入（mtime 最新，保持现有行为）
//   索引 9 条：只注入「文件名 + frontmatter 摘要 + 首行」（每条 ≤150 字符）
//   Agent 需要完整内容时用 read_file 按文件名拉全文。
//
// 本文件只负责**索引构建**（读取 + 摘要 + 格式化）：
//   - buildKnowledgeIndex：扫描 shared/federation/local 三目录，
//     产出 { 文件名, kind, 摘要≤150字符, mtime }
//   - formatKnowledgeIndex：渲染成注入文本（Agent 可读的索引清单）
//
// 零新依赖：frontmatter 提取用正则（只取 name/description 字段，
// 不需要完整 YAML 解析——避免引 js-yaml）。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

/** 索引条目单条摘要最大字符数（铁律：≤150 字符/条） */
export const INDEX_ENTRY_MAX_CHARS = 150;

/** 知识来源类型 */
export type KnowledgeKind = 'shared' | 'federation' | 'local';

/** 知识索引条目 */
export interface KnowledgeIndexEntry {
  /** 文件名（不含 .md 后缀——read_file 拉全文的键） */
  fileName: string;
  /** 来源类型（shared 跨设备共享 / federation 联邦 / local 本机） */
  kind: KnowledgeKind;
  /** 摘要（frontmatter name + description + 首行；≤150 字符） */
  summary: string;
  /** 文件 mtime（ms）——热点排序用 */
  mtimeMs: number;
}

/** buildKnowledgeIndex 选项 */
export interface KnowledgeIndexOptions {
  /** shared/federation 子目录名（默认 'shared' / 'federation'） */
  sharedDirName?: string;
  federationDirName?: string;
}

/**
 * 从 Markdown 内容提取 frontmatter 的 name / description 字段（正则，零依赖）。
 *
 * @param content Markdown 全文
 * @returns { name?, description? }——未找到返回空对象
 */
export function extractFrontmatterSummary(content: string): { name?: string; description?: string } {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return {};
  const fm = match[1];
  const result: { name?: string; description?: string } = {};
  const nameMatch = fm.match(/^\s*name\s*:\s*(.+)$/m);
  if (nameMatch && nameMatch[1]) {
    result.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  const descMatch = fm.match(/^\s*description\s*:\s*(.+)$/m);
  if (descMatch && descMatch[1]) {
    result.description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

/**
 * 提取 Markdown 正文首行（frontmatter 之后的第一个非空行）。
 *
 * @param content Markdown 全文
 * @returns 首行文本（无正文返回 ''）
 */
export function extractFirstBodyLine(content: string): string {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const body = normalized.replace(/^---\n[\s\S]*?\n---\n?/, '');
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/** 截断到 maxChars 字符（超长加省略号） */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

/**
 * 扫描单目录下的知识条目（.md 文件，按 mtime 降序）。
 * 目录不存在 → 空数组（静默跳过）。
 */
function scanDir(dir: string, kind: KnowledgeKind): KnowledgeIndexEntry[] {
  const entries: KnowledgeIndexEntry[] = [];
  try {
    if (!fs.existsSync(dir)) return entries;
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(dir, f))
      .filter((f) => {
        try { return fs.statSync(f).isFile(); } catch { return false; }
      })
      .sort((a, b) => {
        try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
      });

    for (const file of files) {
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* mtime 缺失按 0 */ }

      const fm = extractFrontmatterSummary(content);
      const firstLine = extractFirstBodyLine(content);
      // 摘要 = frontmatter name + description + 首行（≤150 字符）
      const parts = [fm.name, fm.description, firstLine].filter((p): p is string => Boolean(p));
      const summary = truncate(parts.join(' · '), INDEX_ENTRY_MAX_CHARS) || truncate(path.basename(file, '.md'), INDEX_ENTRY_MAX_CHARS);

      entries.push({
        fileName: path.basename(file, '.md'),
        kind,
        summary,
        mtimeMs,
      });
    }
  } catch {
    // 目录异常静默跳过
  }
  return entries;
}

/**
 * 构建知识索引——扫描 knowledge/ 三目录（shared / federation / local）。
 *
 * @param knowledgeDir knowledge/ 目录绝对路径
 * @param options 子目录名覆盖
 * @returns 索引条目数组（按 kind 顺序：shared → federation → local，各目录内按 mtime 降序）
 */
export function buildKnowledgeIndex(
  knowledgeDir: string,
  options: KnowledgeIndexOptions = {},
): KnowledgeIndexEntry[] {
  const sharedDir = path.join(knowledgeDir, options.sharedDirName ?? 'shared');
  const federationDir = path.join(knowledgeDir, options.federationDirName ?? 'federation');

  const shared = scanDir(sharedDir, 'shared');
  const federation = scanDir(federationDir, 'federation');
  const local = scanDir(knowledgeDir, 'local'); // 本机 = knowledge/ 根目录

  return [...shared, ...federation, ...local];
}

/**
 * 渲染知识索引为注入文本（Agent 可读清单；每条一行 ≤150 字符）。
 *
 * @param entries 索引条目
 * @param maxEntries 最多注入条数（默认 9 = shared 3 + federation 3 + local 3）
 * @returns 渲染后的多行文本
 */
export function formatKnowledgeIndex(entries: KnowledgeIndexEntry[], maxEntries = 9): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (lines.length >= maxEntries) break;
    if (seen.has(entry.fileName)) continue;
    seen.add(entry.fileName);
    const kindLabel = entry.kind === 'shared' ? '共享' : entry.kind === 'federation' ? '联邦' : '本机';
    lines.push(`- ${entry.fileName}（${kindLabel}）：${entry.summary}`);
  }
  return lines.join('\n');
}

/**
 * 取知识库中最新的 N 篇（跨 shared/federation/local 按 mtime 降序）——
 * 「热点全文」注入的选文逻辑（保持 mtime 最新语义）。
 *
 * @param knowledgeDir knowledge/ 目录绝对路径
 * @param n 取前 N 篇（默认 2——热点 2 篇全文）
 * @returns 按 mtime 降序的条目（调用方自行读全文）
 */
export function topKnowledgeByMtime(knowledgeDir: string, n = 2): KnowledgeIndexEntry[] {
  const all = buildKnowledgeIndex(knowledgeDir);
  return [...all].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, n);
}
