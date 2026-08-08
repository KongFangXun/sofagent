// ============================================================
// knowledge-tools.ts · MCP tools: search_knowledge / read_entity / read_concept / list_entities / stats
// v1.2.9: 从 mcp-server.ts 提取
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
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
  const matches: Array<{ path: string; kind: string; firstLine: string }> = [];
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
          matches.push({ path: `${kind}/${f}`, kind, firstLine: firstLine.slice(0, 100) });
        }
      }
    }
  }
  const text = matches.length
    ? `[sofagent] 找到 ${matches.length} 个匹配:\n` + matches.map((m) => `- ${m.path}: ${m.firstLine}`).join('\n')
    : `[sofagent] 未找到匹配 "${query}" 的知识页`;

  return {
    text,
    data: { query, count: matches.length, matches },
  };
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
