// ============================================================
// market-search.ts · MCP tool: market_search（v1.3.5 交付 1）
//
// 能力检索 tool——按标签/关键词搜索市场能力目录。
// 延迟导入 @sofagent/orchestrator 的 searchCatalog / searchByTag。
// ============================================================

import { loadEnvConfig } from '@sofagent/core';

/** market_search tool 入参 */
export interface MarketSearchArgs {
  /** 检索关键词（模糊匹配名称/描述/标签） */
  query?: string;
  /** 按标签精确匹配（与 query 互斥，优先级高于 query） */
  tag?: string;
  /** 按类型过滤（skill / agent / flow） */
  kind?: 'skill' | 'agent' | 'flow';
  /** 可选：覆盖数据目录（测试用） */
  dataDir?: string;
}

/** market_search tool 结果 */
export interface MarketSearchResult {
  text: string;
  data: {
    query: string;
    count: number;
    matches: Array<{
      id: string;
      kind: string;
      name: string;
      description: string;
      version: string;
      owner: string;
      tags: string[];
    }>;
  };
}

/**
 * 检索市场能力目录——延迟导入 orchestrator 的检索函数。
 *
 * @param args 检索入参
 * @returns 检索结果
 */
export function marketSearch(args: MarketSearchArgs): MarketSearchResult {
  const { query, tag, kind, dataDir } = args;

  let searchCatalog: (
    q: string,
    dataDir?: string,
  ) => {
    query: string;
    count: number;
    matches: Array<Record<string, unknown>>;
  };
  let searchByTag: (
    t: string,
    dataDir?: string,
  ) => {
    query: string;
    count: number;
    matches: Array<Record<string, unknown>>;
  };
  let searchByKind: (
    k: string,
    dataDir?: string,
  ) => {
    query: string;
    count: number;
    matches: Array<Record<string, unknown>>;
  };

  try {
    const mod = require('@sofagent/orchestrator') as {
      searchCatalog: typeof searchCatalog;
      searchByTag: typeof searchByTag;
      searchByKind: typeof searchByKind;
    };
    searchCatalog = mod.searchCatalog;
    searchByTag = mod.searchByTag;
    searchByKind = mod.searchByKind;
  } catch {
    return {
      text: '[sofagent] 检索失败：@sofagent/orchestrator 不可用',
      data: { query: '', count: 0, matches: [] },
    };
  }

  const dir = dataDir ?? loadEnvConfig().dataDir;

  // 优先级：kind > tag > query
  let result: { query: string; count: number; matches: Array<Record<string, unknown>> };

  if (kind) {
    result = searchByKind(kind, dir);
  } else if (tag) {
    result = searchByTag(tag, dir);
  } else if (query) {
    result = searchCatalog(query, dir);
  } else {
    // 无参数 → 列出全部
    result = searchCatalog('', dir);
  }

  // 精简输出（只保留检索需要的字段）
  const matches = result.matches.map((m) => ({
    id: String(m.id ?? ''),
    kind: String(m.kind ?? ''),
    name: String(m.name ?? ''),
    description: String(m.description ?? ''),
    version: String(m.version ?? ''),
    owner: String(m.owner ?? ''),
    tags: Array.isArray(m.tags) ? (m.tags as string[]) : [],
  }));

  const text = matches.length
    ? `[sofagent] 找到 ${matches.length} 个能力:\n` +
      matches
        .map((m) => `- ${m.kind}/${m.id}: ${m.name} (v${m.version}) [${m.tags.join(', ')}]`)
        .join('\n')
    : `[sofagent] 未找到匹配 "${result.query}" 的能力`;

  return {
    text,
    data: { query: result.query, count: matches.length, matches },
  };
}
