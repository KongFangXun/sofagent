// ============================================================
// trend-aggregator.ts · @weekly 历史趋势聚合（v1.3.9 · P1b）
// ============================================================
//
// @weekly：读 daily-*.json 快照 → 聚合周/月趋势 → 写 weekly-*.json
//
// 数据源：{data}/dashboard/daily-*.json（P1b-pre 产出）
// 产出：{data}/dashboard/weekly-YYYY-WNN.json
//
// schema：
//   {weekLabel, thisWeek, lastWeek, delta, violationTop5, trend}
// ============================================================

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';
import type { DailySnapshot } from './daily-snapshot';

/** 周趋势报告 schema */
export interface WeeklyTrendReport {
  /** 周标识（如 2026-W31） */
  weekLabel: string;
  /** 本周汇总 */
  thisWeek: {
    taskCount: number;
    violations: number;
    warnings: number;
    passes: number;
    cloudCalls: number;
    localOps: number;
    blockedCount: number;
  };
  /** 上周汇总 */
  lastWeek: WeeklyTrendReport['thisWeek'] | null;
  /** 本周 vs 上周差值（正=恶化，负=改善） */
  delta: {
    violations: number | null;
    warnings: number | null;
    taskCount: number | null;
  };
  /** 最常违规 TOP5 */
  violationTop5: Array<{ rule: string; count: number }>;
  /** 趋势方向：improving / degrading / stable */
  trend: 'improving' | 'degrading' | 'stable';
}

/**
 * ISO 周号计算
 */
function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * 读取指定日期范围内的 daily 快照
 */
function loadDailySnapshots(
  dashboardDir: string,
  startDate: string,
  endDate: string,
): DailySnapshot[] {
  const snapshots: DailySnapshot[] = [];

  if (!existsSync(dashboardDir)) return snapshots;

  let files: string[];
  try {
    files = readdirSync(dashboardDir).filter(
      (f) => f.startsWith('daily-') && f.endsWith('.json'),
    );
  } catch {
    return snapshots;
  }

  for (const file of files) {
    // 从文件名提取日期 daily-YYYY-MM-DD.json
    const dateMatch = file.match(/daily-(\d{4}-\d{2}-\d{2})\.json/);
    if (!dateMatch) continue;
    const fileDate = dateMatch[1]!;
    if (fileDate < startDate || fileDate > endDate) continue;

    try {
      const content = readFileSync(join(dashboardDir, file), 'utf-8');
      snapshots.push(JSON.parse(content) as DailySnapshot);
    } catch {
      // skip
    }
  }

  return snapshots;
}

/**
 * 聚合 daily 快照为汇总数据
 */
function aggregateSnapshots(snapshots: DailySnapshot[]) {
  const agg = {
    taskCount: 0,
    violations: 0,
    warnings: 0,
    passes: 0,
    cloudCalls: 0,
    localOps: 0,
    blockedCount: 0,
  };
  const violationMap = new Map<string, number>();

  for (const snap of snapshots) {
    agg.taskCount += snap.taskCount;
    agg.violations += snap.violations;
    agg.warnings += snap.warnings;
    agg.passes += snap.passes;
    agg.cloudCalls += snap.cloudCalls;
    agg.localOps += snap.localOps;
    agg.blockedCount += snap.blockedCount;

    for (const [rule, count] of Object.entries(snap.violationByRule)) {
      violationMap.set(rule, (violationMap.get(rule) ?? 0) + count);
    }
  }

  return { ...agg, violationMap };
}

/**
 * @weekly：读 daily 快照 → 生成 weekly 趋势报告
 *
 * @param _projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function runTrendAggregator(_projectDir: string): InspectorResult {
  const env = loadEnvConfig();
  const dashboardDir = join(env.dataDir, 'dashboard');

  const now = new Date();

  // 本周范围
  const thisWeekEnd = now.toISOString().slice(0, 10);
  const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  // 上周范围
  const lastWeekEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const lastWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const weekLabel = getISOWeek(now);

  // 本周数据
  const thisWeekSnaps = loadDailySnapshots(dashboardDir, thisWeekStart, thisWeekEnd);
  const thisWeekAgg = aggregateSnapshots(thisWeekSnaps);

  // 上周数据
  const lastWeekSnaps = loadDailySnapshots(dashboardDir, lastWeekStart, lastWeekEnd);
  const lastWeekAgg =
    lastWeekSnaps.length > 0 ? aggregateSnapshots(lastWeekSnaps) : null;

  // delta 计算
  const delta = {
    violations: lastWeekAgg
      ? thisWeekAgg.violations - lastWeekAgg.violations
      : null,
    warnings: lastWeekAgg
      ? thisWeekAgg.warnings - lastWeekAgg.warnings
      : null,
    taskCount: lastWeekAgg
      ? thisWeekAgg.taskCount - lastWeekAgg.taskCount
      : null,
  };

  // 趋势判定
  let trend: WeeklyTrendReport['trend'] = 'stable';
  if (delta.violations !== null) {
    if (delta.violations < 0) trend = 'improving';
    else if (delta.violations > 0) trend = 'degrading';
  }

  // TOP5 违规
  const violationTop5 = [...thisWeekAgg.violationMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, count]) => ({ rule, count }));

  const report: WeeklyTrendReport = {
    weekLabel,
    thisWeek: {
      taskCount: thisWeekAgg.taskCount,
      violations: thisWeekAgg.violations,
      warnings: thisWeekAgg.warnings,
      passes: thisWeekAgg.passes,
      cloudCalls: thisWeekAgg.cloudCalls,
      localOps: thisWeekAgg.localOps,
      blockedCount: thisWeekAgg.blockedCount,
    },
    lastWeek: lastWeekAgg
      ? {
          taskCount: lastWeekAgg.taskCount,
          violations: lastWeekAgg.violations,
          warnings: lastWeekAgg.warnings,
          passes: lastWeekAgg.passes,
          cloudCalls: lastWeekAgg.cloudCalls,
          localOps: lastWeekAgg.localOps,
          blockedCount: lastWeekAgg.blockedCount,
        }
      : null,
    delta,
    violationTop5,
    trend,
  };

  // 写入 weekly 报告
  const reportPath = join(dashboardDir, `weekly-${weekLabel}.json`);
  try {
    const dir = dirname(reportPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  } catch (err) {
    return {
      name: 'trend-aggregator',
      triggered: false,
      message: `周趋势报告写入失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }

  const trendIcon = trend === 'improving' ? '改善' : trend === 'degrading' ? '恶化' : '持平';
  const deltaStr = delta.violations !== null
    ? `违规 ${delta.violations > 0 ? '+' : ''}${delta.violations}`
    : '无上周对比';

  return {
    name: 'trend-aggregator',
    triggered: thisWeekAgg.violations > 0,
    message:
      `weekly-${weekLabel}.json 已生成（趋势：${trendIcon}）：` +
      `本周 ${thisWeekAgg.taskCount} 任务 · ${thisWeekAgg.violations} 违规 · ` +
      `(${deltaStr})` +
      (violationTop5.length > 0
        ? ` · TOP: ${violationTop5.map((v) => `${v.rule}(${v.count})`).join(', ')}`
        : ''),
    severity: trend === 'degrading' ? 'warning' : 'info',
  };
}
