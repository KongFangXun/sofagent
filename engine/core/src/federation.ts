// ============================================================
// federation.ts · 联邦/巡检共用实现（P1-3 下沉）
// v1.2.5 P1-3: 从 @sofagent/daemon 下沉——audit 此前用变量名 + any 动态 import
//   daemon 的 checkConflict/mergeFederationResults，失去类型安全、运行时才报错。
//   现在实现位于 core（零上层依赖底座），audit 静态 import 获得编译期类型。
//   daemon 侧保留 re-export shim（federation/merge.ts、inspectors/*）保证兼容。
// ============================================================

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import * as Automerge from 'automerge';
import { TRUST_ORDER, type Trust } from './memory-contract';

// ────────────────────────────────────────────────────────────
// 巡检器共享类型（原 daemon/src/inspectors/types.ts）
// ────────────────────────────────────────────────────────────

/** 巡检器配置 */
export interface InspectorConfig {
  enabled: boolean;
  schedule: '@daily' | '@weekly' | '@monthly';
}

/** 巡检结果 */
export interface InspectorResult {
  name: string;
  triggered: boolean;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

// ────────────────────────────────────────────────────────────
// 联邦查询类型（原 daemon/src/federation/query-router.ts 的最小依赖子集）
// ────────────────────────────────────────────────────────────

/** 单条知识结果（peer 返回 + 本地共用的最小结构） */
export interface KnowledgeQueryResult {
  /** 条目 id（entity/concept 名） */
  id: string;
  /** 标题 */
  title: string;
  /** 内容摘要 */
  content: string;
  /** 敏感度 */
  sensitivity: 'public' | 'internal' | 'restricted';
  /** 可信度（缺省按 internal） */
  trust?: Trust;
  /** 最后修改时间 */
  mtime?: number;
}

/** 单个 peer 的返回（含来源与审计信息） */
export interface FederationResult {
  peerId: string;
  results: KnowledgeQueryResult[];
  /** 本次 fetch 的 WARN，无则空数组 */
  warnings: string[];
}

/** 合并后的知识条目（带来源标注） */
export interface MergedKnowledge extends KnowledgeQueryResult {
  /** 来源：'local' 或 peerId */
  source: string;
  /** 归一化后的 trust（必有值） */
  trust: Trust;
}

/** Automerge 文档形态：{ entries: { [id]: KnowledgeQueryResult } } */
interface MergeDoc {
  entries: Record<string, KnowledgeQueryResult>;
}

/**
 * 裁决规则（#3：trust 优先于 mtime）——同 id 两个版本选胜者
 */
export function pickWinner(a: KnowledgeQueryResult, b: KnowledgeQueryResult): KnowledgeQueryResult {
  const trustA = TRUST_ORDER[a.trust ?? 'internal'];
  const trustB = TRUST_ORDER[b.trust ?? 'internal'];
  if (trustA !== trustB) return trustA > trustB ? a : b;
  const mtimeA = a.mtime ?? 0;
  const mtimeB = b.mtime ?? 0;
  return mtimeA >= mtimeB ? a : b;
}

/**
 * 合并本地 + 联邦结果：CRDT 收敛 + 去重 + trust/mtime 排序
 *
 * P0-9: peer 结果覆盖本地条目时触发 onPeerOverride 告警。
 * 「默认不覆盖」由 trust 排序天然保证：本地知识缺省 internal（trust=2），
 * 远端 peer 缺省 user（trust=1）——同 id 冲突时 pickWinner 按 trust 优先，
 * 本地 internal 恒胜远端 user。
 *
 * @param local 本地 knowledge 查询结果（source 标 'local'）
 * @param remote 各 peer 的返回（已经过 query-router 双重校验）
 * @param onPeerOverride 可选告警回调（peerId, id, localTrust, peerTrust）
 * @returns 合并去重后的条目，按 trust 降序 → mtime 降序排列
 */
export function mergeFederationResults(
  local: KnowledgeQueryResult[],
  remote: FederationResult[],
  onPeerOverride?: (peerId: string, id: string, localTrust: Trust, peerTrust: Trust) => void,
): MergedKnowledge[] {
  // 1. 裁决预计算（change 回调外）：id → 胜出版本 + 来源
  const winners = new Map<string, KnowledgeQueryResult>();
  const sourceOf = new Map<string, string>();
  for (const item of local) {
    winners.set(item.id, item);
    sourceOf.set(item.id, 'local');
  }
  for (const fedResult of remote) {
    for (const item of fedResult.results) {
      const existing = winners.get(item.id);
      const winner = existing ? pickWinner(existing, item) : item;
      winners.set(item.id, winner);
      if (winner === item) {
        // P0-9: 远端结果覆盖了本地条目 → 告警（trust 排序已保证默认不覆盖）
        if (sourceOf.get(item.id) === 'local') {
          onPeerOverride?.(
            fedResult.peerId,
            item.id,
            existing?.trust ?? 'internal',
            item.trust ?? 'user',
          );
        }
        sourceOf.set(item.id, fedResult.peerId);
      }
    }
  }

  // 2. 本地文档（基础文档）
  let doc = Automerge.init<MergeDoc>();
  doc = Automerge.change(doc, (d) => {
    d.entries = {};
    for (const item of local) {
      d.entries[item.id] = winners.get(item.id) ?? item;
    }
  });

  // 3. 每个 peer 从当前合并文档分叉（clone）写入自身条目后 merge 回来——
  //    共享版本史的 CRDT 合并才能完整收敛
  for (const fedResult of remote) {
    let peerDoc = Automerge.clone(doc);
    peerDoc = Automerge.change(peerDoc, (d) => {
      for (const item of fedResult.results) {
        d.entries[item.id] = winners.get(item.id) ?? item;
      }
    });
    doc = Automerge.merge(doc, peerDoc);
  }

  // 4. 展开为数组 + source 标注 + 排序（trust 降 → mtime 降）
  const out: MergedKnowledge[] = Object.values(doc.entries).map((raw) => {
    const item = raw as KnowledgeQueryResult;
    return {
      ...item,
      source: sourceOf.get(item.id) ?? 'local',
      trust: item.trust ?? 'internal',
    };
  });
  out.sort((a, b) => {
    const trustDiff = TRUST_ORDER[b.trust] - TRUST_ORDER[a.trust];
    if (trustDiff !== 0) return trustDiff;
    return (b.mtime ?? 0) - (a.mtime ?? 0);
  });
  return out;
}

// ────────────────────────────────────────────────────────────
// checkConflict · knowledge 矛盾/孤儿/死链巡检（原 daemon/inspectors/conflict-check.ts）
// ────────────────────────────────────────────────────────────

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
    // 跳过表头
    if (/^(页面|名称|条目|page|name|entry|slug|title)$/i.test(first)) continue;
    // 提取 markdown 链接 [text](target) 里的 target
    const linkMatch = first.match(/\[([^\]]*)\]\(([^)]+)\)/);
    const ref = linkMatch ? (linkMatch[2] ?? '') : first;
    if (!ref) continue;
    entries.add(ref);
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

  // 空 knowledge 且 index.md 也没条目 → info
  if (pages.length === 0 && indexEntries.size === 0) {
    return {
      name: 'conflict-check',
      triggered: false,
      message: 'Knowledge base is empty',
      severity: 'info',
    };
  }

  // ── 检测一：矛盾（critical）──
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
    if (domains.size >= 2) {
      const locations = list.map((p) => `${p.relPath}(domain=${p.domain ?? '缺'})`).join(' / ');
      conflicts.push(`${slug}: ${locations}`);
    }
  }

  // ── 检测二：孤儿（warning）──
  const orphans: string[] = [];
  for (const page of pages) {
    if (indexEntries.has(page.relPath)) continue;
    if (indexEntries.has(page.slug)) continue;
    if (indexEntries.has(page.relPath.replace(/\.md$/, ''))) continue;
    orphans.push(page.relPath);
  }

  // ── 检测三：死链（warning）──
  const deadlinks: string[] = [];

  // 3a：index.md 表中的 relPath 形条目
  for (const ref of indexEntries) {
    const looksLikePath = ref.includes('/') || ref.endsWith('.md');
    if (!looksLikePath) continue;
    const candidates = [
      join(knowledgeDir, ref),
      join(knowledgeDir, ref.endsWith('.md') ? ref : `${ref}.md`),
    ];
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
      const resolved = join(page.absPath, '..', target);
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

  const relKnowledge = relative(projectDir, knowledgeDir) || '.sofagent/knowledge';

  return {
    name: 'conflict-check',
    triggered: true,
    message: `Knowledge 健康异常（${relKnowledge}）：${parts.join('；')}`,
    severity,
  };
}
