// ============================================================
// audit-trail.ts · 跨设备审计轨迹聚合（v1.3.7 §3.2）
//
// 目标：多设备审计历史可追溯（配合身份码，轻量版）。
//
// 写入：审计引擎运行后，向 ~/.sofagent/data/audit-trail.jsonl 追加一条 entry
// 聚合：按 agentId / ruleId / deviceFingerprint 分组统计
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { hostname, platform, arch } from 'os';
import { createHash } from 'crypto';
import { DATA_DIR } from '@sofagent/core';

/** 审计轨迹条目 */
export interface AuditTrailEntry {
  /** Agent 身份码（agentId 或 shortCode） */
  agentId: string;
  /** 时间戳（ISO 8601） */
  timestamp: string;
  /** 审计规则 ID（如 A3） */
  ruleId: string;
  /** 审计结果 */
  severity: 'PASS' | 'WARN' | 'FAIL';
  /** 一行摘要 */
  summary: string;
  /** 设备指纹（SHA-256(hostname + platform + arch) 前 8 位） */
  deviceFingerprint: string;
}

/** 聚合统计 */
export interface TrailAggregate {
  /** 总审计次数 */
  total: number;
  /** 通过次数 */
  passed: number;
  /** 失败次数 */
  failed: number;
  /** 命中的规则列表 */
  rulesHit: string[];
}

/**
 * 计算设备指纹。
 *
 * SHA-256(hostname + platform + arch) 前 8 位。
 * 同一台设备的指纹确定不变。
 *
 * @returns 8 位十六进制设备指纹
 */
export function getDeviceFingerprint(): string {
  const raw = `${hostname()}|${platform()}|${arch()}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 8);
}

/**
 * 解析 audit-trail.jsonl 的路径。
 *
 * @param dataDirOverride 可选的数据目录覆盖（测试用）
 * @returns audit-trail.jsonl 文件路径
 */
export function resolveTrailPath(dataDirOverride?: string): string {
  const dataDir = dataDirOverride || process.env.SOFAGENT_DATA || DATA_DIR;
  return join(dataDir, 'audit-trail.jsonl');
}

/**
 * 追加一条审计轨迹到 JSONL 文件。
 *
 * @param entry 审计轨迹条目
 * @param dataDirOverride 可选的数据目录覆盖（测试用）
 */
export function appendAuditTrail(
  entry: Omit<AuditTrailEntry, 'deviceFingerprint' | 'timestamp'> & {
    deviceFingerprint?: string;
    timestamp?: string;
  },
  dataDirOverride?: string,
): void {
  const trailPath = resolveTrailPath(dataDirOverride);
  const dataDir = dataDirOverride || process.env.SOFAGENT_DATA || DATA_DIR;

  const fullEntry: AuditTrailEntry = {
    ...entry,
    deviceFingerprint: entry.deviceFingerprint ?? getDeviceFingerprint(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };

  try {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    appendFileSync(trailPath, JSON.stringify(fullEntry) + '\n', 'utf-8');
  } catch (err) {
    // 写入失败不阻断主流程，但输出告警(原完全静默改为 stderr 告警）
    console.error('[sofagent] audit-trail 写入失败:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * 读取 audit-trail.jsonl 并解析为条目数组。
 *
 * @param opts 可选过滤条件
 * @param opts.dataDirOverride 数据目录覆盖
 * @param opts.since 只返回此时间之后的条目（ISO 8601）
 * @param opts.agentId 只返回指定 agent 的条目
 * @param opts.severity 只返回指定严重级别的条目
 * @returns 审计轨迹条目数组
 */
export function readAuditTrails(opts: {
  dataDirOverride?: string;
  since?: string;
  agentId?: string;
  severity?: AuditTrailEntry['severity'];
} = {}): AuditTrailEntry[] {
  const trailPath = resolveTrailPath(opts.dataDirOverride);
  if (!existsSync(trailPath)) return [];

  let lines: string[];
  try {
    lines = readFileSync(trailPath, 'utf-8').split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }

  const entries: AuditTrailEntry[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as AuditTrailEntry;
      // 过滤条件
      if (opts.since && entry.timestamp < opts.since) continue;
      if (opts.agentId && entry.agentId !== opts.agentId) continue;
      if (opts.severity && entry.severity !== opts.severity) continue;
      entries.push(entry);
    } catch {
      // 跳过解析失败的行
    }
  }

  return entries;
}

/**
 * 按指定维度聚合审计轨迹。
 *
 * @param entries 审计轨迹条目数组
 * @param groupBy 分组维度
 * @returns Map<分组键, 该组的聚合统计>
 */
export function aggregateTrails(
  entries: AuditTrailEntry[],
  groupBy: 'agentId' | 'ruleId' | 'deviceFingerprint',
): Map<string, TrailAggregate> {
  const groups = new Map<string, TrailAggregate>();

  for (const entry of entries) {
    const key = entry[groupBy];
    let agg = groups.get(key);
    if (!agg) {
      agg = { total: 0, passed: 0, failed: 0, rulesHit: [] };
      groups.set(key, agg);
    }

    agg.total++;
    if (entry.severity === 'PASS') agg.passed++;
    if (entry.severity === 'FAIL') agg.failed++;
    if (!agg.rulesHit.includes(entry.ruleId)) {
      agg.rulesHit.push(entry.ruleId);
    }
  }

  return groups;
}

/**
 * 生成审计报告摘要文本。
 *
 * @param entries 审计轨迹条目数组
 * @returns 人类可读的报告摘要
 */
export function formatTrailReport(entries: AuditTrailEntry[]): string {
  if (entries.length === 0) {
    return '审计轨迹为空';
  }

  const byAgent = aggregateTrails(entries, 'agentId');
  const lines: string[] = [];

  lines.push(`审计轨迹报告（共 ${entries.length} 条记录）`);
  lines.push('');

  for (const [agentId, agg] of byAgent) {
    const passRate = agg.total > 0 ? Math.round((agg.passed / agg.total) * 100) : 0;
    lines.push(`Agent: ${agentId}`);
    lines.push(`  总计: ${agg.total} · 通过: ${agg.passed} · 失败: ${agg.failed} · 通过率: ${passRate}%`);
    lines.push(`  命中规则: ${agg.rulesHit.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}
