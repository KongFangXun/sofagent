// ============================================================
// knowledge-tools.ts · MCP tools: search_knowledge / read_entity / read_concept / list_entities / stats
// v1.3.6: 从 mcp-server.ts 提取
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { sortByTrust, prepareForPrompt } from '@sofagent/core';
import type { Trust, Sensitivity } from '@sofagent/core';
import type { ToolResult } from './audit-tools';

// ============================================================
// 辅助
// ============================================================

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), '.sofagent');
}

function getKnowledgeDir(): string {
  return join(getSofagentDataDir(), 'knowledge');
}

// ============================================================
// Tool: search_knowledge
// ============================================================

export function searchKnowledge(args: Record<string, unknown>): ToolResult | { error: string } {
  const query = (args.query as string || '').toLowerCase();
  if (!query) {
    return { error: 'Missing required argument: query' };
  }
  const kbDir = getKnowledgeDir();
  const matches: Array<{ path: string; kind: string; firstLine: string; stale?: boolean; trustTier?: string }> = [];
  if (existsSync(kbDir)) {
    for (const kind of ['entities', 'concepts', 'comparisons', 'summaries'] as const) {
      const subDir = join(kbDir, kind);
      if (!existsSync(subDir)) continue;
      let files: string[] = [];
      try {
        files = readdirSync(subDir).filter((f) => f.endsWith('.md'));
      } catch {
        continue;
      }
      for (const f of files) {
        const fullPath = join(subDir, f);
        let content = '';
        try {
          content = readFileSync(fullPath, 'utf-8');
        } catch {
          continue;
        }
        const name = f.replace(/\.md$/, '');
        if (name.toLowerCase().includes(query) || content.toLowerCase().includes(query)) {
          const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('---')) || '';
          // v1.3.7 ⑥ OKF ②：过期条目标注 + 信任分层推导（人审>机审>未审）
          const okf = parseOkfFields(content);
          matches.push({
            path: `${kind}/${f}`, kind, firstLine: firstLine.slice(0, 100),
            stale: okf.stale,
            trustTier: okf.trustTier,
          });
        }
      }
    }
  }
  // OKF ②：过期条目降权（排到末尾——检索时可见但标注，不静默丢弃）
  matches.sort((a, b) => Number(a.stale ?? false) - Number(b.stale ?? false));
  const text = matches.length
    ? `[sofagent] 找到 ${matches.length} 个匹配:\n` + matches.map((m) => {
        const staleTag = m.stale ? ' ⚠️[已过期]' : '';
        const trustTag = m.trustTier ? ` [${m.trustTier}]` : '';
        return `- ${m.path}${staleTag}${trustTag}: ${m.firstLine}`;
      }).join('\n')
    : `[sofagent] 未找到匹配 "${query}" 的知识页`;

  return {
    text,
    data: { query, count: matches.length, matches },
  };
}

/**
 * v1.3.7 ⑥ OKF ②：从 frontmatter 解析信任/时效字段。
 * - stale_after：today ≥ stale_after → stale=true（检索标注/降权）
 * - verified：最新一条 by 前缀推导信任层（human: > process: > 其他/unverified）
 */
export function parseOkfFields(content: string): { stale: boolean; staleAfter?: string; trustTier?: string; status?: string } {
  const fmMatch = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { stale: false };
  let fm: Record<string, unknown>;
  try {
    fm = yamlLoad(fmMatch[1]!) as Record<string, unknown>;
  } catch {
    return { stale: false };
  }
  const staleAfter = typeof fm['stale_after'] === 'string' ? (fm['stale_after'] as string) : undefined;
  const stale = staleAfter ? new Date(staleAfter) <= new Date() : false;
  // 信任分层（OKF §5.2 三级：human > process > unverified）
  let trustTier: string | undefined;
  const verified = fm['verified'];
  if (Array.isArray(verified) && verified.length > 0) {
    const latest = verified[verified.length - 1] as { by?: string } | undefined;
    const by = typeof latest?.by === 'string' ? latest.by : '';
    if (by.startsWith('human:')) trustTier = 'human-verified';
    else if (by.startsWith('process:') || by.startsWith('agent:')) trustTier = 'process-verified';
    else trustTier = 'verified';
  }
  const status = typeof fm['status'] === 'string' ? (fm['status'] as string) : undefined;
  return { stale, staleAfter, trustTier, status };
}

/**
 * v1.1.8 新增：联邦查询异步合并（fire-and-forget）
 */
export async function mergeFederationAsync(query: string): Promise<void> {
  try {
    const fed = (await import('@sofagent/daemon/federation' as string)) as {
      withOfflineFallback?: unknown;
      listPeers?: unknown;
      loadOpenClawChannel?: unknown;
    };
    if (typeof fed.withOfflineFallback !== 'function' || typeof fed.listPeers !== 'function') return;
    const peers = (fed.listPeers as () => Array<{ peer: unknown }>)().map((s) => s.peer);
    if (peers.length === 0) return;
    const channel = typeof fed.loadOpenClawChannel === 'function'
      ? await (fed.loadOpenClawChannel as () => Promise<unknown>)()
      : null;
    if (!channel) return;
    const overrides: string[] = [];
    const merged = await (fed.withOfflineFallback as (
      q: { text: string }, ps: unknown[], local: () => unknown[], ch: unknown,
      audit?: unknown, onPeerOverride?: (peerId: string, id: string) => void,
    ) => Promise<Array<{ id: string; title: string; source: string; trust: string; sensitivity: string; content: string }>>)(
      { text: query }, peers, () => [], channel, undefined,
      (peerId: string, entryId: string) => {
        overrides.push(`${peerId}:${entryId}`);
      },
    );
    const remote = merged.filter((m) => m.source !== 'local');
    if (remote.length > 0) {
      const typed = merged as unknown as Array<{
        id: string; title: string; content: string; source: string;
        trust: Trust; sensitivity: Sensitivity;
      }>;
      const sorted = sortByTrust(typed);
      const protectedRemote = sorted
        .filter((m) => m.source !== 'local')
        .map((m) => ({
          id: m.id,
          title: m.title,
          protectedContent: prepareForPrompt(m.content, { trust: m.trust, sensitivity: m.sensitivity }, 'federation'),
          trust: m.trust,
          source: m.source,
        }));
      if (overrides.length > 0) {
        process.stderr.write(`[sofagent-mcp] ⚠️ 联邦 peer 覆盖本地知识条目: ${overrides.join(', ')}（请确认本地白名单信任配置）\n`);
      }
      process.stderr.write(`[sofagent-mcp] 联邦查询合并 ${remote.length} 条跨设备结果（已按本地 trust 白名单排序 + 脱敏 + <untrusted> 包裹）\n`);
      if (protectedRemote.length > 0) {
        process.stderr.write(`[sofagent-mcp] 联邦结果示例: ${protectedRemote[0]!.id} (trust=${protectedRemote[0]!.trust})\n`);
      }
    }
  } catch {
    // 静默——本地结果已返回，联邦只是增强
  }
}

// ============================================================
// Tool: read_entity
// ============================================================

export function readEntity(args: Record<string, unknown>): ToolResult | { error: string } {
  const name = args.name as string | undefined;
  if (!name) {
    return { error: 'Missing required argument: name' };
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return { error: 'Invalid name: must not contain path separators' };
  }
  const file = join(getKnowledgeDir(), 'entities', `${name}.md`);
  if (!existsSync(file)) {
    return {
      text: `[sofagent] entity "${name}" 不存在`,
      data: { found: false, name },
    };
  }
  const content = readFileSync(file, 'utf-8');
  return {
    text: `[sofagent] entity: ${name}\n\n${content}`,
    data: { found: true, name, content },
  };
}

// ============================================================
// Tool: read_concept
// ============================================================

export function readConcept(args: Record<string, unknown>): ToolResult | { error: string } {
  const name = args.name as string | undefined;
  if (!name) {
    return { error: 'Missing required argument: name' };
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return { error: 'Invalid name: must not contain path separators' };
  }
  const file = join(getKnowledgeDir(), 'concepts', `${name}.md`);
  if (!existsSync(file)) {
    return {
      text: `[sofagent] concept "${name}" 不存在`,
      data: { found: false, name },
    };
  }
  const content = readFileSync(file, 'utf-8');
  return {
    text: `[sofagent] concept: ${name}\n\n${content}`,
    data: { found: true, name, content },
  };
}

// ============================================================
// Tool: list_entities
// ============================================================

export function listEntities(args: Record<string, unknown>): ToolResult {
  const domain = args.domain as string | undefined;
  const dir = join(getKnowledgeDir(), 'entities');
  if (!existsSync(dir)) {
    return {
      text: '[sofagent] knowledge/entities 目录不存在',
      data: { entities: [], count: 0 },
    };
  }
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    files = [];
  }
  let entities = files.map((f) => f.replace(/\.md$/, ''));
  // domain 过滤：读文件检查 frontmatter 的 domain 字段
  if (domain) {
    entities = entities.filter((name) => {
      try {
        const content = readFileSync(join(dir, `${name}.md`), 'utf-8');
        return content.includes(`domain: ${domain}`) || content.includes(`domain:${domain}`);
      } catch {
        return false;
      }
    });
  }
  return {
    text: `[sofagent] entities${domain ? ` (domain: ${domain})` : ''} 共 ${entities.length} 个:\n` + entities.map((e) => `- ${e}`).join('\n'),
    data: { entities, count: entities.length, domain },
  };
}

// ============================================================
// Tool: stats
// ============================================================

export function stats(): ToolResult {
  const kbDir = getKnowledgeDir();
  const count = (sub: string): number => {
    const dir = join(kbDir, sub);
    if (!existsSync(dir)) return 0;
    try {
      return readdirSync(dir).filter((f) => f.endsWith('.md')).length;
    } catch {
      return 0;
    }
  };
  const lastUpdate = (): string | null => {
    if (!existsSync(kbDir)) return null;
    let latest = 0;
    for (const sub of ['entities', 'concepts', 'comparisons', 'summaries']) {
      const dir = join(kbDir, sub);
      if (!existsSync(dir)) continue;
      try {
        for (const f of readdirSync(dir)) {
          try {
            const mtime = statSync(join(dir, f)).mtimeMs;
            if (mtime > latest) latest = mtime;
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
    }
    return latest > 0 ? new Date(latest).toISOString() : null;
  };
  const statsData = {
    entities: count('entities'),
    concepts: count('concepts'),
    comparisons: count('comparisons'),
    summaries: count('summaries'),
    lastUpdate: lastUpdate(),
  };
  return {
    text: `[sofagent] knowledge 统计: entities=${statsData.entities} concepts=${statsData.concepts} comparisons=${statsData.comparisons} summaries=${statsData.summaries} lastUpdate=${statsData.lastUpdate || 'N/A'}`,
    data: statsData,
  };
}

// ============================================================
// v1.3.7 ⑥ OKF ③：index.md 链接化（渐进披露）
// ============================================================

/**
 * 生成/刷新 knowledge/index.md——从纯权限表格升级为链接列表（保留权限列语义）。
 *
 * 渐进披露语义：agent 先读目录（本文件）判断相关性，再按链接读正文——
 * 省上下文窗口。每行含相对链接 + kind + 信任层 + 过期标记。
 *
 * @param kbDir knowledge/ 目录（缺省 getKnowledgeDir()）
 * @returns 写入的 index.md 路径（无条目时返回 null）
 */
export function refreshKnowledgeIndex(kbDir?: string): string | null {
  const dir = kbDir || getKnowledgeDir();
  const rows: Array<{ link: string; kind: string; trust: string; stale: boolean; firstLine: string }> = [];

  for (const kind of ['entities', 'concepts', 'comparisons', 'summaries'] as const) {
    const subDir = join(dir, kind);
    if (!existsSync(subDir)) continue;
    let files: string[] = [];
    try {
      files = readdirSync(subDir).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const f of files.sort()) {
      const rel = `${kind}/${f}`;
      let content = '';
      try {
        content = readFileSync(join(subDir, f), 'utf-8');
      } catch {
        continue;
      }
      const okf = parseOkfFields(content);
      const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('---'))?.slice(0, 60) || '';
      rows.push({
        link: `[${f.replace(/\.md$/, '')}](./${kind}/${f})`,
        kind,
        trust: okf.trustTier || 'unverified',
        stale: okf.stale,
        firstLine,
      });
    }
  }

  if (rows.length === 0) return null;

  const lines: string[] = [];
  lines.push('# Knowledge Index');
  lines.push('');
  lines.push(`> 自动生成（${new Date().toISOString()}）· v1.3.7 OKF ③ 渐进披露：先读本目录判断相关性，再按链接读正文。`);
  lines.push('');
  lines.push('| 条目 | 类型 | 信任 | 时效 | 摘要 |');
  lines.push('|------|------|------|------|------|');
  for (const r of rows) {
    lines.push(`| ${r.link} | ${r.kind} | ${r.trust} | ${r.stale ? '⚠️ 过期' : '有效'} | ${r.firstLine.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  const indexPath = join(dir, 'index.md');
  try {
    writeFileSync(indexPath, lines.join('\n'), 'utf-8');
    return indexPath;
  } catch {
    return null;
  }
}
