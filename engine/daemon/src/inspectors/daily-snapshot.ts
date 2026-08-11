// ============================================================
// daily-snapshot.ts · @daily 结构化快照生成器（v1.3.2 · P1b-pre）
// ============================================================
//
// @daily：把当日审计/违规/任务数据聚合成结构化 JSON 快照。
//   - 数据源：{data}/audit/history.jsonl（当日记录）
//   - 产出：{data}/dashboard/daily-YYYY-MM-DD.json
//   - schema：{date, cloudCalls, localOps, violations, violationByRule, taskCount, ...}
//
// trend-aggregator 消费这些 daily-*.json 生成周/月趋势。
// ============================================================

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';

/** daily 快照 schema */
export interface DailySnapshot {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 云端调用次数（DataSovereigntyLogger 记录的 cloud 操作） */
  cloudCalls: number;
  /** 本地操作次数 */
  localOps: number;
  /** 违规总数（exitCode=2） */
  violations: number;
  /** 按规则分类的违规数 */
  violationByRule: Record<string, number>;
  /** 警告总数（exitCode=1） */
  warnings: number;
  /** 通过总数（exitCode=0） */
  passes: number;
  /** 任务总数（history 记录条数） */
  taskCount: number;
  /** LOOP blocked 数 */
  blockedCount: number;
}

/**
 * 生成当日结构化快照
 *
 * @param _projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function runDailySnapshot(_projectDir: string): InspectorResult {
  const env = loadEnvConfig();
  const dashboardDir = join(env.dataDir, 'dashboard');
  const historyPath = join(env.dataDir, 'audit', 'history.jsonl');

  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);

  // 读 history.jsonl
  const snapshot: DailySnapshot = {
    date: dateStr,
    cloudCalls: 0,
    localOps: 0,
    violations: 0,
    violationByRule: {},
    warnings: 0,
    passes: 0,
    taskCount: 0,
    blockedCount: 0,
  };

  if (existsSync(historyPath)) {
    try {
      const content = readFileSync(historyPath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as {
            timestamp: string;
            exitCode: number;
            engine?: string;
            task?: string;
            ruleResults?: Array<{ name?: string; number?: number; status?: string }>;
          };
          // 只统计当日
          if (!entry.timestamp?.startsWith(dateStr)) continue;
          snapshot.taskCount++;

          if (entry.exitCode === 0) snapshot.passes++;
          else if (entry.exitCode === 1) snapshot.warnings++;
          else if (entry.exitCode === 2) {
            snapshot.violations++;
            // 按规则分类
            const failRules = (entry.ruleResults ?? [])
              .filter((r) => r.status === 'FAIL')
              .map((r) => r.name ?? `#${r.number ?? '?'}`);
            for (const rule of failRules) {
              snapshot.violationByRule[rule] = (snapshot.violationByRule[rule] ?? 0) + 1;
            }
          }

          // engine 含 loop-graph-blocked
          if (entry.engine === 'loop-graph' && entry.exitCode === 2) {
            snapshot.blockedCount++;
          }

          // 云端/本地操作区分（简化：commitMsg 含 [cloud] 视为云端）
          if (entry.task?.includes('[cloud]')) {
            snapshot.cloudCalls++;
          } else {
            snapshot.localOps++;
          }
        } catch {
          // skip
        }
      }
    } catch {
      // 读失败 → 空 snapshot
    }
  }

  // 写入 dashboard/daily-YYYY-MM-DD.json
  const snapshotPath = join(dashboardDir, `daily-${dateStr}.json`);
  try {
    const dir = dirname(snapshotPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  } catch (err) {
    return {
      name: 'daily-snapshot',
      triggered: false,
      message: `快照写入失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }

  return {
    name: 'daily-snapshot',
    triggered: true,
    message:
      `daily-${dateStr}.json 已生成：` +
      `${snapshot.taskCount} 任务 · ` +
      `${snapshot.passes} 通过 · ${snapshot.warnings} 警告 · ${snapshot.violations} 违规` +
      (snapshot.blockedCount > 0 ? ` · ${snapshot.blockedCount} blocked` : ''),
    severity: snapshot.violations > 0 ? 'warning' : 'info',
  };
}
