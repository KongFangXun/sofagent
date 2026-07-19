// ============================================================
// conflict-check.ts · knowledge 矛盾/孤儿/死链巡检
// v1.1.6 新增
//
// 周期性检测 `.sofagent/knowledge/` 的三类健康问题：
//   - 矛盾（critical）：同名 entity/concept 在多目录出现且 frontmatter
//     `domain` 字段互相冲突
//   - 孤儿（warning）：文件系统有页面，但 `index.md` 目录表没对应行
//   - 死链（warning）：`index.md` 目录表列了页面，或页面 markdown 链接
//     指向另一页面，但目标文件不存在
//
// 铁律：
//   - fail-closed 只读——只用 readdirSync / readFileSync / existsSync，
//     绝不调用 fs.writeFile / fs.unlink
//   - frontmatter 用最小正则提取（/^domain:\s*(.+)$/m），不引入 gray-matter
//   - index.md 只解析 markdown 表格（| ... | ... |），其他格式忽略并 WARN
//   - 三类问题同发时取最严重 severity（critical > warning > info）
// ============================================================

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

import type { InspectorResult } from './types';

/** knowledge Views 层四个一等子目录（与 MCP server 对齐） */
const KNOWLEDGE_SUBDIRS = ['entities', 'concepts', 'comparisons', 'summaries'] as const;

/** 单个 knowledge 页面的最小信息 */
interface KnowledgePage {
  /** 相对于 knowledge/ 的路径（如 entities/alice.md） */
  relPath: string;
  /** 页面绝对路径 */
  absPath: string;
  /** 文件名去扩展名（如 alice） */
  slug: string;
  /** 所在子目录（entities/concepts/comparisons/summaries） */
  subdir: string;
  /** frontmatter 提取的 domain（可能为空） */
  domain: string | null;
  /** markdown 正文（用于死链扫描） */
  body: string;
}

/**
 * 最小化 frontmatter domain 提取
 * 只在文件头 `---\n...\n---` 区间内匹配 `domain:` 行
 */
function extractDomain(content: string): string | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1] ?? '';
  const domainMatch = fm.match(/^domain:\s*(.+?)\s*$/m);
  return domainMatch ? (domainMatch[1] ?? null) : null;
}

/**
 * 扫描 knowledge/ 下四个一等子目录，收集所有 .md 页面
 */
function scanPages(knowledgeDir: string): KnowledgePage[] {
  const pages: KnowledgePage[] = [];
  for (const subdir of KNOWLEDGE_SUBDIRS) {
    const subdirAbs = join(knowledgeDir, subdir);
    if (!existsSync(subdirAbs)) continue;
    let entries: string[];
    try {
      entries = readdirSync(subdirAbs);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      if (name === 'index.md') continue; // index.md 是目录表，不算页面
      const absPath = join(subdirAbs, name);
      let body = '';
      try {
        body = readFileSync(absPath, 'utf-8');
      } catch {
        continue;
      }
      const slug = name.replace(/\.md$/, '');
      pages.push({
        relPath: `${subdir}/${name}`,
        absPath,
        slug,
        subdir,
        domain: extractDomain(body),
        body,
      });
    }
  }
  return pages;
}

/**
 * 解析 index.md 的目录表（markdown 表格）
 * 只识别 `| xxx | ... |` 形式，收集第一列里出现的页面引用
 *
 * 返回值：
 *   - entries: 表格第一列提到的页面标识（slug 或 relPath）
 *   - foundTable: 是否解析到任何表格（用于"无表格"WARN 提示）
 */
function parseIndexTable(indexPath: string): { entries: Set<string>; foundTable: boolean } {
  const entries = new Set<string>();
  if (!existsSync(indexPath)) {
    return { entries, foundTable: false };
  }
  let content = '';
  try {
    content = readFileSync(indexPath, 'utf-8');
  } catch {
    return { entries, foundTable: false };
  }
  let foundTable = false;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    // 跳过分隔行（|---|---|）
    if (/^\|[\s\-|:]+\|$/.test(line)) continue;
    foundTable = true;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    const first = cells[0];
    if (!first) continue;
    // 跳过表头（含「页面」「名称」「entry」「page」「name」等关键字）
    if (/^(页面|名称|条目|page|name|entry|slug|title)$/i.test(first)) continue;
    // 提取 markdown 链接 [text](target) 里的 target
    const linkMatch = first.match(/\[([^\]]*)\]\(([^)]+)\)/);
    const ref = linkMatch ? (linkMatch[2] ?? '') : first;
    if (!ref) continue;
    entries.add(ref);
    // 同时把 slug（去目录 + 去扩展名）也加进去，方便文件系统对比
    const slug = ref.replace(/\.md$/, '').split('/').pop();
    if (slug) entries.add(slug);
  }
  return { entries, foundTable };
}

/**
 * 从页面正文里提取指向 knowledge/ 内部的 markdown 链接
 * 只关心 .md 目标，外部 URL 忽略
 */
function extractInternalLinks(body: string): string[] {
  const links: string[] = [];
  const re = /\[[^\]]*\]\(([^)]+\.md)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = m[1] ?? '';
    if (target.startsWith('http://') || target.startsWith('https://')) continue;
    if (target.startsWith('#')) continue;
    links.push(target);
  }
  return links;
}

/**
 * 三类检测主入口
 */
export function checkConflict(projectDir: string): InspectorResult {
  const knowledgeDir = join(projectDir, '.sofagent', 'knowledge');

  // 优雅降级：knowledge/ 不存在 → info
  if (!existsSync(knowledgeDir)) {
    return {
      name: 'conflict-check',
      triggered: false,
      message: 'No knowledge directory',
      severity: 'info',
    };
  }

  const pages = scanPages(knowledgeDir);
  const indexPath = join(knowledgeDir, 'index.md');
  const { entries: indexEntries, foundTable } = parseIndexTable(indexPath);

  // 空 knowledge（四个子目录都不存在或都没 .md）且 index.md 也没条目 → info
  if (pages.length === 0 && indexEntries.size === 0) {
    return {
      name: 'conflict-check',
      triggered: false,
      message: 'Knowledge base is empty',
      severity: 'info',
    };
  }

  // ── 检测一：矛盾（critical）──
  // 同名 slug 出现在多个子目录，且 frontmatter domain 都存在但互不相同
  const conflicts: string[] = [];
  const bySlug = new Map<string, KnowledgePage[]>();
  for (const page of pages) {
    const list = bySlug.get(page.slug) ?? [];
    list.push(page);
    bySlug.set(page.slug, list);
  }
  for (const [slug, list] of bySlug) {
    if (list.length < 2) continue;
    const domains = new Set<string>();
    for (const p of list) {
      if (p.domain) domains.add(p.domain);
    }
    // 至少两个不同 domain 才算冲突；缺 domain 不算（v1.1.6 决策）
    if (domains.size >= 2) {
      const locations = list.map((p) => `${p.relPath}(domain=${p.domain ?? '缺'})`).join(' / ');
      conflicts.push(`${slug}: ${locations}`);
    }
  }

  // ── 检测二：孤儿（warning）──
  // 文件系统有页面，但 index.md 表里没有对应行（relPath 或 slug 都不在）
  const orphans: string[] = [];
  for (const page of pages) {
    if (indexEntries.has(page.relPath)) continue;
    if (indexEntries.has(page.slug)) continue;
    // index.md 里可能写 `entities/alice`（不带 .md）
    if (indexEntries.has(page.relPath.replace(/\.md$/, ''))) continue;
    orphans.push(page.relPath);
  }

  // ── 检测三：死链（warning）──
  // 3a. index.md 表列了页面，但文件系统没有
  // 3b. 页面正文 markdown 链接指向另一页面，但目标文件不存在
  const deadlinks: string[] = [];

  // 3a：index.md 表中的 relPath 形条目（含 `/` 或以 .md 结尾）
  for (const ref of indexEntries) {
    // 只对形如 entities/alice.md / entities/alice / alice.md 的引用做检查
    const looksLikePath = ref.includes('/') || ref.endsWith('.md');
    if (!looksLikePath) continue;
    // 解析目标绝对路径
    const candidates = [
      join(knowledgeDir, ref),
      join(knowledgeDir, ref.endsWith('.md') ? ref : `${ref}.md`),
    ];
    // 如果 ref 不带子目录（如 alice.md），尝试在所有子目录下找
    if (!ref.includes('/')) {
      for (const subdir of KNOWLEDGE_SUBDIRS) {
        candidates.push(join(knowledgeDir, subdir, ref));
        if (!ref.endsWith('.md')) {
          candidates.push(join(knowledgeDir, subdir, `${ref}.md`));
        }
      }
    }
    const exists = candidates.some((p) => existsSync(p));
    if (!exists) {
      deadlinks.push(`index.md → ${ref}`);
    }
  }

  // 3b：页面正文内部链接
  for (const page of pages) {
    for (const target of extractInternalLinks(page.body)) {
      // 相对页面所在目录解析
      const resolved = join(page.absPath, '..', target);
      // 也尝试相对 knowledge/ 根解析
      const resolvedFromRoot = join(knowledgeDir, target);
      if (!existsSync(resolved) && !existsSync(resolvedFromRoot)) {
        deadlinks.push(`${page.relPath} → ${target}`);
      }
    }
  }

  // ── 汇总报告 ──
  const triggered = conflicts.length > 0 || orphans.length > 0 || deadlinks.length > 0;
  if (!triggered) {
    const extra = foundTable ? '' : '（index.md 未含目录表）';
    return {
      name: 'conflict-check',
      triggered: false,
      message: `Knowledge healthy: ${pages.length} page(s), no conflict/orphan/deadlink ${extra}`.trim(),
      severity: 'info',
    };
  }

  const parts: string[] = [];
  if (conflicts.length > 0) {
    parts.push(`矛盾 ${conflicts.length} 项：${conflicts.slice(0, 3).join('; ')}${conflicts.length > 3 ? '…' : ''}`);
  }
  if (orphans.length > 0) {
    parts.push(`孤儿 ${orphans.length} 项：${orphans.slice(0, 3).join(', ')}${orphans.length > 3 ? '…' : ''}`);
  }
  if (deadlinks.length > 0) {
    parts.push(`死链 ${deadlinks.length} 项：${deadlinks.slice(0, 3).join('; ')}${deadlinks.length > 3 ? '…' : ''}`);
  }

  const severity: InspectorResult['severity'] =
    conflicts.length > 0 ? 'critical' : 'warning';

  // 计算相对项目根的路径用于提示（避免泄露绝对路径到日志）
  const relKnowledge = relative(projectDir, knowledgeDir) || '.sofagent/knowledge';

  return {
    name: 'conflict-check',
    triggered: true,
    message: `Knowledge 健康异常（${relKnowledge}）：${parts.join('；')}`,
    severity,
  };
}
