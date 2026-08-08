// ============================================================
// task-stats.ts · @daily 任务成功率统计（v1.3.0 · P1b）
// ============================================================
//
// @daily：读 history.jsonl → 聚合任务成功率（按 commitSha 或 task 文本聚合）
//
// 数据源：{data}/audit/history.jsonl
// 产出：{data}/dashboard/task-stats-YYYY-MM-DD.json
//
// schema：
//   {date, totalTasks, passRate, warnRate, failRate, failedTasks}
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';

/** 任务统计报告 schema */
export interface TaskStatsReport {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 总任务数 */
  totalTasks: number;
  /** 通过率 (%) */
  passRate: number;
  /** 警告率 (%) */
  warnRate: number;
  /** 失败率 (%) */
  failRate: number;
  /** 失败任务列表（最多 20 条） */
  failedTasks: Array<{
    task: string;
    exitCode: number;
    timestamp: string;
    commitSha?: string;
  }>;
  /** 最常违规 TOP5 规则 */
  topViolationRules: Array<{ rule: string; count: number }>;
}

/**
 * @daily：读 history.jsonl → 聚合任务成功率
 *
 * @param _projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function runTaskStats(_projectDir: string): InspectorResult {
  const env = loadEnvConfig();
  const historyPath = join(env.dataDir, 'audit', 'history.jsonl');
  const dashboardDir = join(env.dataDir, 'dashboard');

  const today = new Date().toISOString().slice(0, 10);

  if (!existsSync(historyPath)) {
    return {
      name: 'task-stats',
      triggered: false,
      message: '审计历史不存在，跳过任务统计',
      severity: 'info',
    };
  }

  let content: string;
  try {
    content = readFileSync(historyPath, 'utf-8');
  } catch {
    return {
      name: 'task-stats',
      triggered: false,
      message: '审计历史读取失败',
      severity: 'info',
    };
  }

  // 统计当日任务
  let totalTasks = 0;
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  const failedTasks: TaskStatsReport['failedTasks'] = [];
  const ruleMap = new Map<string, number>();

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as {
        timestamp: string;
        exitCode: number;
        task?: string;
        commitSha?: string;
        ruleResults?: Array<{ name?: string; number?: number; status?: string }>;
      };
      if (!entry.timestamp?.startsWith(today)) continue;

      totalTasks++;
      if (entry.exitCode === 0) passCount++;
      else if (entry.exitCode === 1) warnCount++;
      else if (entry.exitCode === 2) {
        failCount++;
        if (failedTasks.length < 20) {
          failedTasks.push({
            task: entry.task?.slice(0, 100) ?? '(未命名)',
            exitCode: entry.exitCode,
            timestamp: entry.timestamp,
            commitSha: entry.commitSha,
          });
        }
        // 规则统计
        for (const rule of entry.ruleResults ?? []) {
          if (rule.status === 'FAIL') {
            const ruleName = rule.name ?? `#${rule.number ?? '?'}`;
            ruleMap.set(ruleName, (ruleMap.get(ruleName) ?? 0) + 1);
          }
        }
      }
    } catch {
      // skip
    }
  }

  if (totalTasks === 0) {
    return {
      name: 'task-stats',
      triggered: false,
      message: `当日（${today}）无审计记录`,
      severity: 'info',
    };
  }

  const passRate = Math.round((passCount / totalTasks) * 1000) / 10;
  const warnRate = Math.round((warnCount / totalTasks) * 1000) / 10;
  const failRate = Math.round((failCount / totalTasks) * 1000) / 10;

  const topViolationRules = [...ruleMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, count]) => ({ rule, count }));

  const report: TaskStatsReport = {
    date: today,
    totalTasks,
    passRate,
    warnRate,
    failRate,
    failedTasks,
    topViolationRules,
  };

  // 写入 task-stats-YYYY-MM-DD.json
  const reportPath = join(dashboardDir, `task-stats-${today}.json`);
  try {
    const dir = dirname(reportPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  } catch (err) {
    return {
      name: 'task-stats',
      triggered: false,
      message: `任务统计报告写入失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }

  return {
    name: 'task-stats',
    triggered: failRate > 0,
    message:
      `task-stats-${today}.json 已生成：` +
      `${totalTasks} 任务 · 通过 ${passRate}% · 警告 ${warnRate}% · 失败 ${failRate}%` +
      (failedTasks.length > 0 ? ` · 失败 ${failedTasks.length} 条` : ''),
    severity: failRate > 0 ? 'warning' : 'info',
  };
}
