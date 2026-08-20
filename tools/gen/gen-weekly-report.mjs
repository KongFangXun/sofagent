#!/usr/bin/env node
// ============================================================
// gen-weekly-report.mjs · 手动生成周度优化报告（sustain 数据源）
// ============================================================
//
// 用途：daemon 未跑过 @daily/@weekly 巡检时，手动从审计历史生成
//   daily-YYYY-MM-DD.json（历史回填）+ weekly-YYYY-WNN.json（周报）
//
// 数据源：{data}/audit/history.jsonl（审计引擎自动写入，5186+ 条真实记录）
// 产出：  {data}/dashboard/daily-*.json + weekly-YYYY-WNN.json
//
// schema 与 engine/daemon/src/inspectors/{daily-snapshot,trend-aggregator}.ts 完全一致
// 运行：node tools/gen-weekly-report.mjs [--weeks N]
// ============================================================

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ── 数据目录（与 serve-dashboard.mjs 同口径）──────────────────
const SOFAGENT_DATA = process.env.SOFAGENT_DATA
  ? process.env.SOFAGENT_DATA
  : join(homedir(), '.sofagent', 'data');

const historyPath = join(SOFAGENT_DATA, 'audit', 'history.jsonl');
const dashboardDir = join(SOFAGENT_DATA, 'dashboard');

// ── ISO 周号（与 trend-aggregator.ts getISOWeek 一致）────────
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ── 按日生成 daily 快照（schema 同 daily-snapshot.ts）────────
function buildDailySnapshots() {
  if (!existsSync(historyPath)) {
    console.error(`✗ 未找到 ${historyPath}`);
    process.exit(1);
  }
  const byDay = {};
  const content = readFileSync(historyPath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      const date = (e.timestamp || '').slice(0, 10);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const snap = byDay[date] || (byDay[date] = {
        date, cloudCalls: 0, localOps: 0, violations: 0,
        violationByRule: {}, warnings: 0, passes: 0, taskCount: 0, blockedCount: 0,
      });
      snap.taskCount++;
      if (e.exitCode === 0) snap.passes++;
      else if (e.exitCode === 1) snap.warnings++;
      else if (e.exitCode === 2) {
        snap.violations++;
        const failRules = (e.ruleResults || [])
          .filter((r) => r.status === 'FAIL')
          .map((r) => r.name || `#${r.number ?? '?'}`);
        for (const rule of failRules) {
          snap.violationByRule[rule] = (snap.violationByRule[rule] || 0) + 1;
        }
      }
      if (e.engine === 'loop-graph' && e.exitCode === 2) snap.blockedCount++;
      if (String(e.task || '').includes('[cloud]')) snap.cloudCalls++;
      else snap.localOps++;
    } catch {}
  }
  return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
}

// ── 聚合周报（schema 同 trend-aggregator.ts WeeklyTrendReport）─
function aggregateSnapshots(snaps) {
  const agg = { violations: 0, warnings: 0, passes: 0, taskCount: 0, cloudCalls: 0, localOps: 0, blockedCount: 0 };
  const ruleCount = {};
  for (const s of snaps) {
    agg.violations += s.violations;
    agg.warnings += s.warnings;
    agg.passes += s.passes;
    agg.taskCount += s.taskCount;
    agg.cloudCalls += s.cloudCalls;
    agg.localOps += s.localOps;
    agg.blockedCount += s.blockedCount;
    for (const [rule, cnt] of Object.entries(s.violationByRule || {})) {
      ruleCount[rule] = (ruleCount[rule] || 0) + cnt;
    }
  }
  return {
    violations: agg.violations,
    warnings: agg.warnings,
    passes: agg.passes,
    taskCount: agg.taskCount,
    cloudCalls: agg.cloudCalls,
    localOps: agg.localOps,
    blockedCount: agg.blockedCount,
    violationTop5: Object.entries(ruleCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([rule, count]) => ({ rule, count })),
  };
}

function buildWeeklyReport(snapshots, now) {
  const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const lastWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weekLabel = getISOWeek(now);

  const thisWeek = snapshots.filter((s) => s.date >= thisWeekStart && s.date <= now.toISOString().slice(0, 10));
  const lastWeek = snapshots.filter((s) => s.date >= lastWeekStart && s.date < thisWeekStart);

  const thisAgg = aggregateSnapshots(thisWeek);
  const lastAgg = lastWeek.length ? aggregateSnapshots(lastWeek) : null;

  const delta = {
    violations: lastAgg ? thisAgg.violations - lastAgg.violations : null,
    warnings: lastAgg ? thisAgg.warnings - lastAgg.warnings : null,
    taskCount: lastAgg ? thisAgg.taskCount - lastAgg.taskCount : null,
  };
  const rate = thisAgg.taskCount ? Math.round((thisAgg.violations + thisAgg.warnings) * 100 / thisAgg.taskCount) : 0;
  const trend = lastAgg
    ? (rate < (lastAgg.taskCount ? Math.round((lastAgg.violations + lastAgg.warnings) * 100 / lastAgg.taskCount) : 0)
      ? 'improving' : rate > 0 ? 'degrading' : 'stable')
    : 'stable';

  return {
    weekLabel,
    generatedAt: now.toISOString(),
    thisWeek: {
      taskCount: thisAgg.taskCount,
      violations: thisAgg.violations,
      warnings: thisAgg.warnings,
      passes: thisAgg.passes,
      cloudCalls: thisAgg.cloudCalls,
      localOps: thisAgg.localOps,
      blockedCount: thisAgg.blockedCount,
    },
    lastWeek: lastAgg
      ? { taskCount: lastAgg.taskCount, violations: lastAgg.violations, warnings: lastAgg.warnings, passes: lastAgg.passes }
      : null,
    delta,
    violationTop5: thisAgg.violationTop5,
    trend,
  };
}

// ── 主流程 ──────────────────────────────────────────────
const now = new Date();
console.log(`┌─ gen-weekly-report · ${now.toISOString().slice(0, 10)}`);
console.log(`│ 数据源：${historyPath}`);

// 1) 生成 daily 快照（历史回填）
const snaps = buildDailySnapshots();
if (!existsSync(dashboardDir)) mkdirSync(dashboardDir, { recursive: true });
let written = 0;
for (const s of snaps) {
  const p = join(dashboardDir, `daily-${s.date}.json`);
  if (!existsSync(p)) {
    writeFileSync(p, JSON.stringify(s, null, 2) + '\n', 'utf-8');
    written++;
  }
}
console.log(`│ daily 快照：${snaps.length} 天（${snaps[0]?.date} ~ ${snaps[snaps.length - 1]?.date}）· 新增 ${written}`);

// 2) 生成 weekly 周报
const report = buildWeeklyReport(snaps, now);
const reportPath = join(dashboardDir, `weekly-${report.weekLabel}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');

const trendIcon = report.trend === 'improving' ? '📈 改善' : report.trend === 'degrading' ? '📉 恶化' : '➡️ 平稳';
console.log(`│ 周报：${reportPath}`);
console.log(`│   本周 ${report.thisWeek.taskCount} 任务 · ${report.thisWeek.violations} 违规 · ${report.thisWeek.warnings} 警告 · ${trendIcon}`);
if (report.violationTop5.length) {
  console.log('│   违规 TOP5：');
  for (const v of report.violationTop5) console.log(`│     ${v.rule} ×${v.count}`);
} else {
  console.log('│   违规 TOP5：（无违规）');
}
console.log(`└─ 完成 ✓`);
