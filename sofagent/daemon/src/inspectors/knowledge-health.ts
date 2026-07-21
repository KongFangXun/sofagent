// ============================================================
// knowledge-health.ts · knowledge 健康巡检（Ledger-Views-Policy 三层治理）
// v1.1.8 新增
//
// 与 conflict-check 的分工：
//   - conflict-check 管「项目文件矛盾/孤儿/死链」（index.md 表驱动）
//   - knowledge-health 管「知识库健康」——孤立/重复/断链/index 过旧/缺源
// 二者同形态（fail-closed 只读 + InspectorResult），但检查项不重叠。
//
// 5 项检查：
//   1. 孤立页（orphan）：无任何入边的条目（入边=被其他页面/index.md 引用）
//   2. 重复页（duplicate）：normalized key 碰撞
//      （key = slug.toLowerCase().replace(/[-_\s]/g,'')；detail 标注
//      `(detection=normalized-key)`；本版不做 embedding 近邻）
//   3. 断裂链接（broken-link）：wikilink `[[x]]` + markdown 链接目标不存在
//   4. index 过旧（stale-index）：index.md/log.md mtime 早于最新源 >24h
//   5. 缺源（missing-source）：concept 无 `source:` frontmatter
//
// 铁律：
//   - fail-closed 只读知识源数据——只用 readdirSync/readFileSync/existsSync/statSync
//   - 唯一写操作例外：appendFileSync 写 knowledge/health-report.md
//    （新建独立报告，不改源数据，不违反只读铁律）
//   - frontmatter 用最小正则提取（同 conflict-check），不引 gray-matter
//   - finding 级别 warning（健康是建议性的，非 critical）
//   - 只建议不自动删（永不做自动修复）
//   - 单遍扫描 + 邻接表（Map），不引 graphlib
// ============================================================

import { readdirSync, readFileSync, existsSync, statSync, appendFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

import { resolveSensitivity, isSensitivityVisible } from '@sofagent/core';

import { pushKnowledgeSummary } from '../notify';
import { pushToTarget } from '../push-target';
import type { InspectorResult } from './types';

/** knowledge Views 层四个一等子目录（与 conflict-check 对齐） */
const KNOWLEDGE_SUBDIRS = ['entities', 'concepts', 'comparisons', 'summaries'] as const;

/** index 过旧阈值：mtime 早于最新源 24h */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** 单个 knowledge 页面的最小信息 */
interface KnowledgePage {
  /** 相对于 knowledge/ 的路径（如 entities/alice.md） */
  relPath: string;
  /** 页面绝对路径 */
  absPath: string;
  /** 文件名去扩展名（如 alice） */
  slug: string;
  /** 所在子目录 */
  subdir: string;
  /** normalized key（重复检测用） */
  normalizedKey: string;
  /** frontmatter source 字段（缺源检测用） */
  source: string | null;
  /** frontmatter sensitivity（报告过滤用） */
  sensitivity: 'public' | 'internal' | 'restricted';
  /** markdown 正文（断链扫描用） */
  body: string;
  /** 文件 mtime（index 过旧检测用） */
  mtimeMs: number;
}

/** 从 frontmatter 提取指定字段（最小正则，同 conflict-check 范式） */
function extractFrontmatterField(content: string, field: string): string | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1] ?? '';
  const re = new RegExp(`^${field}:\\s*(.+?)\\s*$`, 'm');
  const match = fm.match(re);
  return match ? (match[1] ?? null) : null;
}

/** normalized key：slug.toLowerCase().replace(/[-_\s]/g,'') */
function normalizeKey(slug: string): string {
  return slug.toLowerCase().replace(/[-_\s]/g, '');
}

/** 扫描 knowledge/ 四子目录，收集所有 .md 页面（单遍） */
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
      if (name === 'index.md') continue;
      const absPath = join(subdirAbs, name);
      let body = '';
      let mtimeMs = 0;
      try {
        body = readFileSync(absPath, 'utf-8');
        mtimeMs = statSync(absPath).mtimeMs;
      } catch {
        continue;
      }
      const slug = name.replace(/\.md$/, '');
      const rawSensitivity = extractFrontmatterField(body, 'sensitivity');
      pages.push({
        relPath: `${subdir}/${name}`,
        absPath,
        slug,
        subdir,
        normalizedKey: normalizeKey(slug),
        source: extractFrontmatterField(body, 'source'),
        sensitivity: resolveSensitivity(rawSensitivity ? { sensitivity: rawSensitivity } : {}),
        body,
        mtimeMs,
      });
    }
  }
  return pages;
}

/** 提取 wikilink `[[target]]`（去管道符/锚点） */
function extractWikilinks(body: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = (m[1] ?? '').trim();
    if (target) links.push(target);
  }
  return links;
}

/** 提取 markdown 链接 `[text](target.md)`（仅 knowledge 内部 .md 目标） */
function extractMarkdownLinks(body: string): string[] {
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

/** 解析链接目标到 candidate 绝对路径列表（相对页面目录 + knowledge 根） */
function resolveLinkCandidates(
  target: string,
  fromAbsPath: string,
  knowledgeDir: string,
): string[] {
  const withExt = target.endsWith('.md') ? target : `${target}.md`;
  return [
    join(fromAbsPath, '..', withExt),
    join(knowledgeDir, withExt),
    // wikilink 常不带子目录前缀，尝试四个子目录
    ...KNOWLEDGE_SUBDIRS.map((sub) => join(knowledgeDir, sub, withExt)),
  ];
}

/** 由当前页面重新生成 index.md 内容（--auto-fix 消除 index 过旧用） */
function generateIndexMarkdown(pages: KnowledgePage[]): string {
  const header = `# Knowledge Index\n\n自动生成于 ${new Date().toISOString()}\n\n`;
  const tableHeader = '| 页面 | 子目录 | 来源 | 敏感度 |\n|------|------|------|------|\n';
  const rows = pages
    .map((p) => `| [${p.slug}](${p.relPath}) | ${p.subdir} | ${p.source ?? ''} | ${p.sensitivity} |`)
    .join('\n');
  return header + tableHeader + rows + '\n';
}

/** 向 health-report.md 追加一段报告（唯一允许的写操作） */
function appendHealthReport(knowledgeDir: string, lines: string[]): void {
  try {
    const reportPath = join(knowledgeDir, 'health-report.md');
    const now = new Date().toISOString();
    const block = `\n## ${now} knowledge-health 巡检\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
    appendFileSync(reportPath, block, 'utf-8');
  } catch {
    // 报告写失败不阻断巡检（fail-open on report，fail-closed on source）
  }
}

/**
 * knowledge-health 巡检主入口。
 *
 * @param projectDir 项目根目录
 * @returns InspectorResult（triggered + severity=warning + 五类 finding 汇总）
 */
export function checkKnowledgeHealth(
  projectDir: string,
  options: { autoFix?: boolean } = {},
): InspectorResult {
  const knowledgeDir = join(projectDir, '.sofagent', 'knowledge');

  // 优雅降级：knowledge/ 不存在 → info
  if (!existsSync(knowledgeDir)) {
    return {
      name: 'knowledge-health',
      triggered: false,
      message: 'No knowledge directory',
      severity: 'info',
    };
  }

  const pages = scanPages(knowledgeDir);
  const indexPath = join(knowledgeDir, 'index.md');
  const logPath = join(knowledgeDir, 'log.md');

  // 空 knowledge（四子目录无 .md）→ 不误报（真实仓库当前态）
  if (pages.length === 0) {
    return {
      name: 'knowledge-health',
      triggered: false,
      message: 'Knowledge base is empty (4 subdirs have no .md pages)',
      severity: 'info',
    };
  }

  // ── 构建引用图（邻接表 Map，单遍）──
  // 入边来源：① 其他页面的 wikilink/markdown 链接 ② index.md 的引用
  const inbound = new Map<string, number>();
  for (const page of pages) {
    inbound.set(page.relPath, 0);
  }

  // index.md 引用（表格第一列 + 正文链接）
  const indexRefs = new Set<string>();
  if (existsSync(indexPath)) {
    try {
      const indexContent = readFileSync(indexPath, 'utf-8');
      for (const link of extractMarkdownLinks(indexContent)) {
        indexRefs.add(link);
      }
      // 表格第一列的裸引用（slug 或 relPath）
      for (const rawLine of indexContent.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('|') || !line.endsWith('|')) continue;
        if (/^\|[\s\-|:]+\|$/.test(line)) continue;
        const first = line.slice(1, -1).split('|')[0]?.trim() ?? '';
        if (!first || /^(页面|名称|条目|page|name|entry|slug|title)$/i.test(first)) continue;
        const linkMatch = first.match(/\[([^\]]*)\]\(([^)]+)\)/);
        const ref = linkMatch ? (linkMatch[2] ?? '') : first;
        if (ref) indexRefs.add(ref);
      }
    } catch {
      // index.md 不可读 → 无入边贡献
    }
  }

  // 页面间引用（wikilink + markdown）
  const brokenLinks: string[] = [];
  for (const page of pages) {
    const targets = [...extractWikilinks(page.body), ...extractMarkdownLinks(page.body)];
    for (const target of targets) {
      const candidates = resolveLinkCandidates(target, page.absPath, knowledgeDir);
      const exists = candidates.some((p) => existsSync(p));
      if (!exists) {
        brokenLinks.push(`${page.relPath} → ${target}`);
        continue;
      }
      // 入边计数：把 target 归一到 relPath 形式做匹配
      const targetSlug = target.replace(/\.md$/, '').split('/').pop() ?? '';
      for (const other of pages) {
        if (other.relPath === page.relPath) continue;
        if (other.slug === targetSlug || other.relPath === target || other.relPath === `${target}.md`) {
          inbound.set(other.relPath, (inbound.get(other.relPath) ?? 0) + 1);
        }
      }
    }
  }
  // index.md 引用也计入入边
  for (const page of pages) {
    if (
      indexRefs.has(page.relPath) ||
      indexRefs.has(page.slug) ||
      indexRefs.has(page.relPath.replace(/\.md$/, ''))
    ) {
      inbound.set(page.relPath, (inbound.get(page.relPath) ?? 0) + 1);
    }
  }

  // ── 检查 1：孤立页（入边 0）──
  const orphans = pages.filter((p) => (inbound.get(p.relPath) ?? 0) === 0).map((p) => p.relPath);

  // ── 检查 2：重复页（normalized key 碰撞）──
  const byKey = new Map<string, KnowledgePage[]>();
  for (const page of pages) {
    const list = byKey.get(page.normalizedKey) ?? [];
    list.push(page);
    byKey.set(page.normalizedKey, list);
  }
  const duplicates: string[] = [];
  for (const [key, list] of byKey) {
    if (list.length > 1) {
      const locs = list.map((p) => p.relPath).join(' / ');
      duplicates.push(`${locs} (detection=normalized-key, key=${key})`);
    }
  }

  // ── 检查 3：断裂链接（上面已收集 brokenLinks）──

  // ── 检查 4：index 过旧（mtime 早于最新源 >24h）──
  const staleIndexes: string[] = [];
  const latestSourceMtime = Math.max(...pages.map((p) => p.mtimeMs), 0);
  for (const idxPath of [indexPath, logPath]) {
    if (!existsSync(idxPath)) continue;
    try {
      const idxMtime = statSync(idxPath).mtimeMs;
      if (latestSourceMtime - idxMtime > STALE_THRESHOLD_MS) {
        staleIndexes.push(relative(knowledgeDir, idxPath) || idxPath);
      }
    } catch {
      // 忽略 stat 失败
    }
  }

  // ── 检查 5：缺源（concept 无 source:）──
  // 约定：concepts/ 子目录的页面必须有 source: frontmatter
  const missingSource = pages
    .filter((p) => p.subdir === 'concepts' && !p.source)
    .map((p) => p.relPath);

  // ── 汇总（按 sensitivity 过滤 restricted 不泄露 detail）──
  const filterVisible = (relPaths: string[]): string[] =>
    relPaths.filter((rp) => {
      const page = pages.find((p) => p.relPath === rp);
      if (!page) return true;
      return isSensitivityVisible(page.sensitivity, 'internal');
    });

  const visibleOrphans = filterVisible(orphans);
  const visibleBroken = brokenLinks.filter((bl) => {
    const src = bl.split(' → ')[0] ?? '';
    const page = pages.find((p) => p.relPath === src);
    if (!page) return true;
    return isSensitivityVisible(page.sensitivity, 'internal');
  });
  const visibleMissingSource = filterVisible(missingSource);

  const triggered =
    visibleOrphans.length > 0 ||
    duplicates.length > 0 ||
    visibleBroken.length > 0 ||
    staleIndexes.length > 0 ||
    visibleMissingSource.length > 0;

  if (!triggered) {
    return {
      name: 'knowledge-health',
      triggered: false,
      message: `Knowledge healthy: ${pages.length} page(s), no orphan/duplicate/broken-link/stale-index/missing-source`,
      severity: 'info',
    };
  }

  const parts: string[] = [];
  const reportLines: string[] = [];
  if (visibleOrphans.length > 0) {
    parts.push(`孤立 ${visibleOrphans.length} 项：${visibleOrphans.slice(0, 3).join(', ')}${visibleOrphans.length > 3 ? '…' : ''}`);
    reportLines.push(`孤立页 ${visibleOrphans.length} 项：${visibleOrphans.join(', ')}`);
  }
  if (duplicates.length > 0) {
    parts.push(`重复 ${duplicates.length} 项：${duplicates.slice(0, 2).join('; ')}${duplicates.length > 2 ? '…' : ''}`);
    reportLines.push(`重复页 ${duplicates.length} 项：${duplicates.join('; ')}`);
  }
  if (visibleBroken.length > 0) {
    parts.push(`断链 ${visibleBroken.length} 项：${visibleBroken.slice(0, 3).join('; ')}${visibleBroken.length > 3 ? '…' : ''}`);
    reportLines.push(`断裂链接 ${visibleBroken.length} 项：${visibleBroken.join('; ')}`);
  }
  if (staleIndexes.length > 0) {
    parts.push(`index 过旧 ${staleIndexes.length} 项：${staleIndexes.join(', ')}`);
    reportLines.push(`index 过旧 ${staleIndexes.length} 项（mtime 早于最新源 >24h）：${staleIndexes.join(', ')}`);
  }
  if (visibleMissingSource.length > 0) {
    parts.push(`缺源 ${visibleMissingSource.length} 项：${visibleMissingSource.slice(0, 3).join(', ')}${visibleMissingSource.length > 3 ? '…' : ''}`);
    reportLines.push(`缺源 concept ${visibleMissingSource.length} 项（无 source: frontmatter）：${visibleMissingSource.join(', ')}`);
  }
  // ── [P2-10] 可选自动修复（仅 --auto-fix 开启时，默认关闭）──
  // 低风险管理：① 移除 index.md 中指向断链目标的行 ② index 过旧重新生成。
  // 孤立页 / 重复 normalized-key 仍仅报告、不自动改（避免误删源数据）。
  if (options.autoFix) {
    const autoFixed: string[] = [];
    // 1. 断链：移除 index.md 中指向不存在目标的行（低风险）
    if (existsSync(indexPath)) {
      const indexLines = readFileSync(indexPath, 'utf-8').split('\n');
      const kept = indexLines.filter((line) => {
        const targets = [...extractMarkdownLinks(line), ...extractWikilinks(line)];
        const isBroken = targets.some((t) => {
          const candidates = resolveLinkCandidates(t, indexPath, knowledgeDir);
          return !candidates.some((p) => existsSync(p));
        });
        return !isBroken;
      });
      if (kept.length !== indexLines.length) {
        writeFileSync(indexPath, kept.join('\n'), 'utf-8');
        autoFixed.push('index.md 断链行已移除');
      }
    }
    // 2. index 过旧：重新生成 index.md
    const indexRel = relative(knowledgeDir, indexPath) || 'index.md';
    if (staleIndexes.includes(indexRel)) {
      writeFileSync(indexPath, generateIndexMarkdown(pages), 'utf-8');
      autoFixed.push('index.md 已重新生成（消除过旧）');
    }
    reportLines.push(
      autoFixed.length > 0
        ? `（已自动修复低风险项：${autoFixed.join('；')}；孤立/重复仍仅报告）`
        : '（只建议不自动删——fail-closed 只读，修复留给 Agent + 人）',
    );
  } else {
    reportLines.push('（只建议不自动删——fail-closed 只读，修复留给 Agent + 人）');
  }

  // 唯一写操作：追加 health-report.md（独立报告，不改源数据）
  appendHealthReport(knowledgeDir, reportLines);

  // v1.1.8 新增：health 跑完触发知识摘要主动通知（best-effort，失败静默）
  void pushKnowledgeSummary(projectDir, pushToTarget);

  const relKnowledge = relative(projectDir, knowledgeDir) || '.sofagent/knowledge';
  return {
    name: 'knowledge-health',
    triggered: true,
    message: `Knowledge 健康巡检（${relKnowledge}）：${parts.join('；')}`,
    severity: 'warning',
  };
}
