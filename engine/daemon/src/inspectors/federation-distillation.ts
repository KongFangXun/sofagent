// ============================================================
// federation-distillation.ts · L3 跨设备知识蒸馏趋势（v1.4.0 · P0）
// ============================================================
//
// @monthly：分析联邦查询日志，统计跨设备知识蒸馏趋势。
//   - 读 {data}/federation/audit-log.jsonl（联邦操作审计日志）
//   - 统计本月各来源的知识条目数 + 合并去重率 + 矛盾标记数
//   - 无联邦日志 → info（联邦功能未启用）
// ============================================================
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';

/** 联邦审计日志条目（最小结构） */
interface FederationAuditEntry {
  timestamp?: string;
  peerId?: string;
  action?: string;
  resultCount?: number;
  mergedCount?: number;
  conflictCount?: number;
}

/**
 * 分析联邦蒸馏趋势
 */
export function runFederationDistillation(projectDir: string): InspectorResult {
  const env = loadEnvConfig();
  const logPath = join(env.dataDir, 'federation', 'audit-log.jsonl');

  if (!existsSync(logPath)) {
    return {
      name: 'federation-distillation',
      triggered: false,
      message: '联邦审计日志不存在（联邦功能未启用）',
      severity: 'info',
    };
  }

  let content: string;
  try {
    content = readFileSync(logPath, 'utf-8');
  } catch {
    return {
      name: 'federation-distillation',
      triggered: false,
      message: '联邦审计日志读取失败',
      severity: 'info',
    };
  }

  // 按本月过滤
  const now = new Date();
  const yearMonth = now.toISOString().slice(0, 7);
  const entries: FederationAuditEntry[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as FederationAuditEntry;
      if (entry.timestamp && entry.timestamp.startsWith(yearMonth)) {
        entries.push(entry);
      }
    } catch {
      // 跳过解析失败的行
    }
  }

  if (entries.length === 0) {
    return {
      name: 'federation-distillation',
      triggered: false,
      message: `本月无联邦操作记录（${yearMonth}）`,
      severity: 'info',
    };
  }

  // 聚合统计
  const peerSet = new Set<string>();
  let totalResults = 0;
  let totalMerged = 0;
  let totalConflicts = 0;

  for (const entry of entries) {
    if (entry.peerId) peerSet.add(entry.peerId);
    totalResults += entry.resultCount ?? 0;
    totalMerged += entry.mergedCount ?? 0;
    totalConflicts += entry.conflictCount ?? 0;
  }

  const dedupRate =
    totalResults > 0 ? ((1 - totalMerged / totalResults) * 100).toFixed(1) : '0.0';

  const triggered = totalConflicts > 0;

  return {
    name: 'federation-distillation',
    triggered,
    message:
      `联邦蒸馏月报（${yearMonth}）：${entries.length} 次操作 · ` +
      `${peerSet.size} 个 peer · ` +
      `去重率 ${dedupRate}% · ` +
      `矛盾标记 ${totalConflicts} 项` +
      (totalConflicts > 0 ? '（需人工确认合并冲突）' : ''),
    severity: totalConflicts > 0 ? 'warning' : 'info',
  };
}
