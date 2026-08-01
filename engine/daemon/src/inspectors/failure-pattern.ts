// ============================================================
// failure-pattern.ts · L3 失败模式聚类（v1.2.4 · P0）
// ============================================================
//
// @monthly：分析审计历史 + LOOP blocked 记录，聚类重复失败模式。
//   - 读 {data}/audit/history.jsonl
//   - 提取近 30 天 exitCode=2（FAIL）+ engine=loop-graph-blocked 的记录
//   - 按 task 中的关键词（skillId / 规则编号 / 文件路径）聚类
//   - 重复出现 ≥3 次的聚类 → warning（P1 skillopt 的输入）
//
// 产出格式：返回 InspectorResult，message 含聚类摘要。
// P1 的 skillopt-trigger inspector 会消费本 inspector 的聚类数据。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';

/** 失败聚类条目 */
export interface FailureCluster {
  /** 聚类键（skillId / 规则编号 / 文件路径片段） */
  key: string;
  /** 出现次数 */
  count: number;
  /** 最近一次出现的时间 */
  lastSeen: string;
  /** 示例描述 */
  sampleDescription: string;
}

/**
 * 分析失败模式聚类
 */
export function runFailurePattern(projectDir: string): InspectorResult {
  const env = loadEnvConfig();
  const historyPath = join(env.dataDir, 'audit', 'history.jsonl');

  if (!existsSync(historyPath)) {
    return {
      name: 'failure-pattern',
      triggered: false,
      message: '审计历史不存在，无法分析失败模式',
      severity: 'info',
    };
  }

  let content: string;
  try {
    content = readFileSync(historyPath, 'utf-8');
  } catch {
    return {
      name: 'failure-pattern',
      triggered: false,
      message: '审计历史读取失败',
      severity: 'info',
    };
  }

  // 近 30 天 FAIL 记录
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  interface FailEntry {
    timestamp: string;
    task: string;
    exitCode: number;
    engine?: string;
    ruleResults?: Array<{ name?: string; number?: number; status?: string }>;
  }

  const clusters = new Map<string, FailureCluster>();

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as FailEntry;
      const entryTime = new Date(entry.timestamp).getTime();
      if (isNaN(entryTime) || entryTime < thirtyDaysAgo) continue;
      // 只看 FAIL（exitCode=2）
      if (entry.exitCode !== 2) continue;

      // 提取规则编号作为聚类键
      const triggeredRules = (entry.ruleResults ?? [])
        .filter((r) => r.status === 'FAIL')
        .map((r) => `${r.name ?? 'unknown'}(#${r.number ?? '?'})`);

      const keys = triggeredRules.length > 0
        ? triggeredRules
        : [entry.task?.slice(0, 60) ?? 'unknown'];

      for (const key of keys) {
        const existing = clusters.get(key);
        if (existing) {
          existing.count++;
          if (entryTime > new Date(existing.lastSeen).getTime()) {
            existing.lastSeen = entry.timestamp;
            existing.sampleDescription = entry.task?.slice(0, 100) ?? existing.sampleDescription;
          }
        } else {
          clusters.set(key, {
            key,
            count: 1,
            lastSeen: entry.timestamp,
            sampleDescription: entry.task?.slice(0, 100) ?? '',
          });
        }
      }
    } catch {
      // 跳过解析失败的行
    }
  }

  if (clusters.size === 0) {
    return {
      name: 'failure-pattern',
      triggered: false,
      message: '近 30 天无失败记录',
      severity: 'info',
    };
  }

  // 排序：次数降序
  const sortedClusters = [...clusters.values()].sort((a, b) => b.count - a.count);

  // 重复 ≥3 次的聚类（P1 skillopt 的输入）
  const repeated = sortedClusters.filter((c) => c.count >= 3);
  const triggered = repeated.length > 0;

  const topPatterns = sortedClusters
    .slice(0, 5)
    .map((c) => `${c.key}(${c.count}次)`)
    .join('; ');

  return {
    name: 'failure-pattern',
    triggered,
    message:
      `失败模式聚类（近 30 天）：${clusters.size} 种模式` +
      (repeated.length > 0
        ? ` · 重复 ≥3 次 ${repeated.length} 种（skillopt 候选）：${repeated.map((c) => c.key).join(', ')}`
        : '') +
      ` · TOP: ${topPatterns}`,
    severity: triggered ? 'warning' : 'info',
  };
}

/**
 * 导出失败聚类数据（供 P1 skillopt-trigger inspector 消费）
 */
export function getFailureClusters(projectDir: string): FailureCluster[] {
  const result = runFailurePattern(projectDir);
  // 从 message 不便解析——直接重新计算返回结构化数据
  const env = loadEnvConfig();
  const historyPath = join(env.dataDir, 'audit', 'history.jsonl');

  if (!existsSync(historyPath)) return [];

  let content: string;
  try {
    content = readFileSync(historyPath, 'utf-8');
  } catch {
    return [];
  }

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const clusters = new Map<string, FailureCluster>();

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as FailEntry;
      const entryTime = new Date(entry.timestamp).getTime();
      if (isNaN(entryTime) || entryTime < thirtyDaysAgo) continue;
      if (entry.exitCode !== 2) continue;

      const triggeredRules = (entry.ruleResults ?? [])
        .filter((r) => r.status === 'FAIL')
        .map((r) => `${r.name ?? 'unknown'}(#${r.number ?? '?'})`);

      const keys = triggeredRules.length > 0
        ? triggeredRules
        : [entry.task?.slice(0, 60) ?? 'unknown'];

      for (const key of keys) {
        const existing = clusters.get(key);
        if (existing) {
          existing.count++;
          if (entryTime > new Date(existing.lastSeen).getTime()) {
            existing.lastSeen = entry.timestamp;
          }
        } else {
          clusters.set(key, {
            key,
            count: 1,
            lastSeen: entry.timestamp,
            sampleDescription: entry.task?.slice(0, 100) ?? '',
          });
        }
      }
    } catch {
      // skip
    }
  }

  return [...clusters.values()].sort((a, b) => b.count - a.count);
}

/** 内部类型（供 getFailureClusters 使用） */
interface FailEntry {
  timestamp: string;
  task: string;
  exitCode: number;
  engine?: string;
  ruleResults?: Array<{ name?: string; number?: number; status?: string }>;
}
