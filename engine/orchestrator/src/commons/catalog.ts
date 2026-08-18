// ============================================================
// catalog.ts · 能力目录生成/检索（v1.3.7 交付 1）
//
// L3 组织能力公地的「发现」环节——读取 commons/manifest.jsonl 能力清单，
// 按标签 / 关键词 / 类型检索，复用 searchKnowledge 的模糊匹配链路。
//
// 复用机制（不重写）：
//   - 检索链路：knowledge-tools.ts 的 searchKnowledge() 模糊匹配（名称 + 内容 contains）
//   - 清单数据：publisher.ts 写入的 commons/manifest.jsonl
//   - 日更目录：daemon commons-catalog-daily inspector（@daily 生成 commons/index.md）
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { CapabilityKind } from './publisher';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 目录中的能力条目（从 manifest.jsonl 读取） */
export interface CatalogEntry {
  /** 能力 ID */
  id: string;
  /** 能力类型 */
  kind: CapabilityKind;
  /** 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 版本 */
  version: string;
  /** 维护人 */
  owner: string;
  /** 标签 */
  tags: string[];
  /** 源文件/目录路径（publisher 写入——调用时 SkillScan + executor 需要） */
  sourcePath: string;
  /** 扫描判定 */
  scanVerdict: string;
  /** 扫描原因 */
  scanReason: string;
  /** 发布时间 ISO */
  publishedAt: string;
  /** 状态（active / retired） */
  status: string;
}

/** 检索结果 */
export interface CatalogSearchResult {
  /** 检索查询 */
  query: string;
  /** 匹配数量 */
  count: number;
  /** 匹配的能力列表 */
  matches: CatalogEntry[];
}

// ────────────────────────────────────────────────────────────
// 读取清单
// ────────────────────────────────────────────────────────────

/**
 * 读取公地能力清单（commons/manifest.jsonl）。
 *
 * 清单格式：每行一个 JSON 对象（append-only）。
 * 同一能力多次发布 → 取最后一条（最新版本）。
 * 已退役（status=retired）的能力默认排除，includeRetired=true 时包含。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @param includeRetired 是否包含已退役能力（默认 false）
 * @returns 能力条目数组
 */
export function readCatalog(
  dataDir?: string,
  includeRetired = false,
): CatalogEntry[] {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  const manifestPath = join(dir, 'commons', 'manifest.jsonl');
  if (!existsSync(manifestPath)) {
    return [];
  }

  let content = '';
  try {
    content = readFileSync(manifestPath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.trim().split('\n').filter(Boolean);
  const byId = new Map<string, CatalogEntry>();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Partial<CatalogEntry>;
      // retire.ts 追加的是 status-only 记录（{ id, status, retiredReason, ... }），
      // 不含 name/description/tags 等完整字段。用 merge 而非整体覆盖——
      // 把 status 字段合并到已有的完整条目上（保留完整元数据）。
      const existing = byId.get(entry.id ?? '');
      if (existing) {
        byId.set(entry.id!, { ...existing, ...entry } as CatalogEntry);
      } else {
        byId.set(entry.id!, entry as CatalogEntry);
      }
    } catch {
      // 解析失败跳过（append-only 不阻断）
    }
  }

  let entries = Array.from(byId.values());
  if (!includeRetired) {
    entries = entries.filter((e) => e.status !== 'retired');
  }
  return entries;
}

// ────────────────────────────────────────────────────────────
// 检索
// ────────────────────────────────────────────────────────────

/**
 * 按标签 / 关键词检索能力（复用 searchKnowledge 的模糊匹配模式）。
 *
 * 匹配逻辑（与 searchKnowledge 一致）：
 *   - 名称（name）包含查询词 → 命中
 *   - 描述（description）包含查询词 → 命中
 *   - 标签（tags）包含查询词 → 命中
 *   - 大小写不敏感
 *
 * @param query 检索关键词
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 检索结果
 */
export function searchCatalog(
  query: string,
  dataDir?: string,
): CatalogSearchResult {
  const q = (query || '').toLowerCase().trim();
  const entries = readCatalog(dataDir);

  if (!q) {
    return { query, count: entries.length, matches: entries };
  }

  const matches = entries.filter((e) => {
    const inName = e.name.toLowerCase().includes(q);
    const inDesc = e.description.toLowerCase().includes(q);
    const inTags = e.tags.some((t) => t.toLowerCase().includes(q));
    const inId = e.id.toLowerCase().includes(q);
    return inName || inDesc || inTags || inId;
  });

  return { query, count: matches.length, matches };
}

/**
 * 按标签精确匹配检索能力。
 *
 * @param tag 标签（精确匹配，大小写不敏感）
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 检索结果
 */
export function searchByTag(
  tag: string,
  dataDir?: string,
): CatalogSearchResult {
  const t = (tag || '').toLowerCase().trim();
  const entries = readCatalog(dataDir);
  const matches = entries.filter((e) =>
    e.tags.some((tg) => tg.toLowerCase() === t),
  );
  return { query: `tag:${tag}`, count: matches.length, matches };
}

/**
 * 按类型过滤检索能力。
 *
 * @param kind 能力类型（skill / agent / flow）
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 检索结果
 */
export function searchByKind(
  kind: CapabilityKind,
  dataDir?: string,
): CatalogSearchResult {
  const entries = readCatalog(dataDir);
  const matches = entries.filter((e) => e.kind === kind);
  return { query: `kind:${kind}`, count: matches.length, matches };
}

/**
 * 获取单个能力详情（按 ID）。
 *
 * @param id 能力 ID
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 能力条目（不存在返回 null）
 */
export function getCapability(
  id: string,
  dataDir?: string,
): CatalogEntry | null {
  const entries = readCatalog(dataDir);
  return entries.find((e) => e.id === id) ?? null;
}
