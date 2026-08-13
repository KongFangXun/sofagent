// ============================================================
// market-catalog-daily.ts · 能力目录日更生成（v1.3.4 交付 1）
// ============================================================
//
// @daily：读取 market/manifest.jsonl 能力清单，生成人类可读的能力目录
// market/index.md（自动汇总所有已发布能力——名称/类型/标签/owner/版本）。
//
// 与 market-health（@weekly 周检）的区别：
//   - market-catalog-daily：日更目录生成（能力有哪些、最新版本是什么）
//   - market-health：周检健康巡检（目录完整性 / 评分异常 / 退役候选扫描）
//
// 复用：@sofagent/orchestrator 的 readCatalog()（延迟 require 避免 daemon→orchestrator 编译依赖）
// ============================================================

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';

/** 目录条目（从 manifest.jsonl 解析） */
interface CatalogEntry {
  id: string;
  kind: string;
  name: string;
  description: string;
  version: string;
  owner: string;
  tags: string[];
  scanVerdict: string;
  publishedAt: string;
  status: string;
}

/**
 * 读取市场能力清单（market/manifest.jsonl）。
 *
 * @param dataDir 数据目录
 * @returns 能力条目数组
 */
function readCatalogEntries(dataDir: string): CatalogEntry[] {
  const manifestPath = join(dataDir, 'market', 'manifest.jsonl');
  if (!existsSync(manifestPath)) return [];

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
      const entry = JSON.parse(line) as CatalogEntry;
      byId.set(entry.id, entry); // 同一能力取最新
    } catch {
      // 解析失败跳过
    }
  }
  return Array.from(byId.values()).filter((e) => e.status !== 'retired');
}

/**
 * 生成能力目录 Markdown。
 *
 * @param entries 能力条目
 * @returns Markdown 文本
 */
export function generateCatalogMarkdown(entries: CatalogEntry[]): string {
  const lines: string[] = [];
  lines.push('# 能力目录');
  lines.push('');
  lines.push(`> 自动生成 · ${new Date().toISOString().slice(0, 10)} · 共 ${entries.length} 个能力`);
  lines.push('');

  if (entries.length === 0) {
    lines.push('暂无已发布能力。使用 `market_publish` 发布能力后，目录将在此自动更新。');
    return lines.join('\n');
  }

  // 按类型分组
  const byKind = new Map<string, CatalogEntry[]>();
  for (const e of entries) {
    const arr = byKind.get(e.kind) ?? [];
    arr.push(e);
    byKind.set(e.kind, arr);
  }

  for (const [kind, items] of byKind) {
    const kindLabel = kind === 'skill' ? 'Skill' : kind === 'agent' ? 'Agent' : 'Flow';
    lines.push(`## ${kindLabel}（${items.length}）`);
    lines.push('');
    lines.push('| ID | 名称 | 版本 | Owner | 标签 | 扫描 |');
    lines.push('|------|------|------|-------|------|------|');
    for (const e of items) {
      lines.push(
        `| ${e.id} | ${e.name} | ${e.version} | ${e.owner} | ${e.tags.join(', ')} | ${e.scanVerdict} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 能力目录日更生成巡检器（@daily）。
 *
 * 读取 market/manifest.jsonl → 生成 market/index.md。
 *
 * @param _projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT）
 * @returns InspectorResult
 */
export function runMarketCatalogDaily(_projectDir: string): InspectorResult {
  void _projectDir;
  const env = loadEnvConfig();
  const marketDir = join(env.dataDir, 'market');
  const manifestPath = join(marketDir, 'manifest.jsonl');

  // 无清单 → 不生成（info，不告警）
  if (!existsSync(manifestPath)) {
    return {
      name: 'market-catalog-daily',
      triggered: false,
      message: '市场清单不存在（market/manifest.jsonl），跳过目录生成',
      severity: 'info',
    };
  }

  const entries = readCatalogEntries(env.dataDir);
  const markdown = generateCatalogMarkdown(entries);

  // 确保 market 目录存在并写入 index.md
  try {
    if (!existsSync(marketDir)) {
      mkdirSync(marketDir, { recursive: true });
    }
    const indexPath = join(marketDir, 'index.md');
    writeFileSync(indexPath, markdown, 'utf-8');
  } catch (err) {
    return {
      name: 'market-catalog-daily',
      triggered: false,
      message: `目录生成失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }

  return {
    name: 'market-catalog-daily',
    triggered: true,
    message: `能力目录已更新：${entries.length} 个能力（market/index.md）`,
    severity: 'info',
  };
}
