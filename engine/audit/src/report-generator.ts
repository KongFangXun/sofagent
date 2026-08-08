// ============================================================
// report-generator.ts · 数据主权审计报告生成器（v1.2.8 · P0）
// ============================================================
//
// 从 data/audit/data-sovereignty/{年}/{月}/*.jsonl 聚合记录，
// 生成 6-section Markdown 报告（日/周/月三档）。
//
// 报告双写：
//   1. 返回值给调用方（daemon inspector / MCP tool）
//   2. 可见目录 {企业名}/审计报告/{年}/{月}/daily-YYYY-MM-DD.md（人读备份）
//
// 企业名来源：data/config/fde-profile.json 的 company 字段；
// 缺失时降级为 data/reports/audit/（不 fail-fast）。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@sofagent/core';
import {
  DataSovereigntyLogger,
  resolveDateArg,
  type DataSovereigntyRecord,
} from './data-sovereignty';
import { renderReport, type ReportStats } from './report-template';

// ============================================================
// 类型
// ============================================================

export type ReportKind = 'daily' | 'weekly' | 'monthly';

export interface GeneratedReport {
  /** 报告类型 */
  kind: ReportKind;
  /** 报告标识（如 2026-07-28 / 2026-W30 / 2026-07） */
  label: string;
  /** Markdown 全文 */
  markdown: string;
  /** 聚合统计（供 webhook 摘要 / MCP tool 复用） */
  stats: ReportStats;
  /** 可见目录写入路径（写成功时存在） */
  visiblePath?: string;
}

// ============================================================
// 统计聚合
// ============================================================

/** 从记录数组聚合 6-section 所需的全部统计 */
export function aggregateStats(records: DataSovereigntyRecord[]): ReportStats {
  const cloudCalls = records.filter((r) => r.dataFlow.destination === 'cloud-api');
  const localActions = records.filter((r) => r.localAction.type !== 'model-inference' || r.dataFlow.destination !== 'cloud-api');
  const outbound = records.filter((r) => r.dataFlow.direction === 'outbound');
  const inbound = records.filter((r) => r.dataFlow.direction === 'inbound');
  const localOnly = records.filter((r) => r.dataFlow.direction === 'local-only');

  // 敏感数据本地处理率 = 敏感（restricted/confidential）且 local-only / 全部敏感
  const sensitive = records.filter(
    (r) => r.dataFlow.sensitivity === 'restricted' || r.dataFlow.sensitivity === 'confidential',
  );
  const sensitiveLocal = sensitive.filter((r) => r.dataFlow.direction === 'local-only');
  const sensitiveLocalRate = sensitive.length > 0 ? sensitiveLocal.length / sensitive.length : 1;

  // 审计异常 = auditResult FAIL 或（restricted/confidential 且 outbound 到 cloud-api）
  const anomalies = records.filter(
    (r) =>
      r.localAction.auditResult === 'FAIL' ||
      ((r.dataFlow.sensitivity === 'restricted' || r.dataFlow.sensitivity === 'confidential') &&
        r.dataFlow.destination === 'cloud-api'),
  );

  // 模型路由分布（按 model 分桶：云端 32B+ / 云端快速 / 本地 7B / 本地 0.5B）
  const routeDist = { cloudStrong: 0, cloudFast: 0, local7b: 0, local05b: 0 };
  for (const r of records) {
    const m = r.cloudCall.model.toLowerCase();
    if (r.dataFlow.destination === 'cloud-api') {
      // 启发式：32b/70b/4o/sonnet/opus 视为强模型，其余快速
      if (/(32b|70b|72b|4o|sonnet|opus|gpt-4|claude-3)/.test(m)) routeDist.cloudStrong++;
      else routeDist.cloudFast++;
    } else if (r.dataFlow.destination === 'local-model') {
      if (/(0\.5b|1b|mini)/.test(m)) routeDist.local05b++;
      else routeDist.local7b++;
    }
  }

  return {
    total: records.length,
    cloudCallCount: cloudCalls.length,
    localActionCount: localActions.length,
    outboundCount: outbound.length,
    inboundCount: inbound.length,
    localOnlyCount: localOnly.length,
    sensitiveLocalRate,
    anomalyCount: anomalies.length,
    routeDist,
    records,
  };
}

// ============================================================
// 可见目录（{企业名}/审计报告/{年}/{月}/）
// ============================================================

/**
 * 解析可见目录根（{企业名}）
 * 读 data/config/fde-profile.json 的 company 字段；缺失降级 data/reports/。
 */
function resolveVisibleRoot(overrideHome?: string): string {
  const dataDir = resolveDataDir(overrideHome);
  const profilePath = join(dataDir, 'config', 'fde-profile.json');
  if (existsSync(profilePath)) {
    try {
      const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
      const company = profile?.company;
      if (typeof company === 'string' && company.trim()) {
        return join(dataDir, company.trim());
      }
    } catch (e) {
      console.warn(`[sofagent] 无法读取 fde-profile.json，报告路径降级为默认: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return join(dataDir, 'reports');
}

/**
 * 把报告写入可见目录 {企业名}/审计报告/{年}/{月}/{kind}-{label}.md
 * @returns 写入路径
 */
function writeVisibleReport(
  kind: ReportKind,
  label: string,
  markdown: string,
  overrideHome?: string,
): string | undefined {
  try {
    // label 可能是 2026-07-28 / 2026-W30 / 2026-07——统一取前 7 位做 {年}/{月}
    const year = label.slice(0, 4);
    const month = label.slice(5, 7);
    const dir = join(resolveVisibleRoot(overrideHome), '审计报告', year, month);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${kind}-${label}.md`);
    writeFileSync(filePath, markdown, 'utf-8');
    return filePath;
  } catch (e) {
    console.warn(`[sofagent] 可见目录写入失败，报告降级为仅返回 undefined: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

// ============================================================
// 三档报告生成
// ============================================================

/**
 * 生成日报
 * @param date 'today' | 'yesterday' | 'YYYY-MM-DD'（默认 yesterday——daemon @daily 场景）
 * @param overrideHome 测试隔离
 */
export function generateDailyReport(
  date: string = 'yesterday',
  overrideHome?: string,
): GeneratedReport {
  const label = resolveDateArg(date);
  const logger = new DataSovereigntyLogger(overrideHome);
  const records = logger.queryRange(label, label);
  const stats = aggregateStats(records);
  const markdown = renderReport('daily', label, stats);
  const visiblePath = writeVisibleReport('daily', label, markdown, overrideHome);
  return { kind: 'daily', label, markdown, stats, visiblePath };
}

/**
 * 生成周报（ISO 周）
 * @param weekLabel 如 '2026-W30'；缺省为上一 ISO 周
 * @param overrideHome 测试隔离
 */
export function generateWeeklyReport(
  weekLabel?: string,
  overrideHome?: string,
): GeneratedReport {
  const label = weekLabel ?? prevISOWeekLabel();
  const { start, end } = isoWeekRange(label);
  const logger = new DataSovereigntyLogger(overrideHome);
  const records = logger.queryRange(start, end);
  const stats = aggregateStats(records);
  const markdown = renderReport('weekly', label, stats);
  // 周报放在本周任意一天所在月目录（取 start 的月份）
  const visiblePath = writeVisibleReport('weekly', label, markdown, overrideHome);
  return { kind: 'weekly', label, markdown, stats, visiblePath };
}

/**
 * 生成月报
 * @param monthLabel 如 '2026-07'；缺省为上月
 * @param overrideHome 测试隔离
 */
export function generateMonthlyReport(
  monthLabel?: string,
  overrideHome?: string,
): GeneratedReport {
  const label = monthLabel ?? prevMonthLabel();
  const start = `${label}-01`;
  // 月末：下个月 1 号减一天
  const [y, m] = label.split('-').map((s) => parseInt(s, 10));
  const lastDay = new Date(y!, m!, 0).getDate();
  const end = `${label}-${String(lastDay).padStart(2, '0')}`;
  const logger = new DataSovereigntyLogger(overrideHome);
  const records = logger.queryRange(start, end);
  const stats = aggregateStats(records);
  const markdown = renderReport('monthly', label, stats);
  const visiblePath = writeVisibleReport('monthly', label, markdown, overrideHome);
  return { kind: 'monthly', label, markdown, stats, visiblePath };
}

/**
 * 统一入口：按 kind 生成报告
 * @param kind 'daily' | 'weekly' | 'monthly'
 * @param label 对应标识（缺省取上一周期）
 */
export function generateReport(
  kind: ReportKind,
  label?: string,
  overrideHome?: string,
): GeneratedReport {
  if (kind === 'daily') return generateDailyReport(label ?? 'yesterday', overrideHome);
  if (kind === 'weekly') return generateWeeklyReport(label, overrideHome);
  return generateMonthlyReport(label, overrideHome);
}

// ============================================================
// ISO 周 / 月 辅助
// ============================================================

/** 上一 ISO 周标识（如 2026-W30） */
function prevISOWeekLabel(): string {
  const now = new Date();
  const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return isoWeekLabel(d);
}

/** 某日期所在 ISO 周标识 */
function isoWeekLabel(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** ISO 周标识 → 起止日期（周一到周日） */
function isoWeekRange(label: string): { start: string; end: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) {
    // 非法标识降级为最近 7 天
    const end = new Date();
    const start = new Date(end.getTime() - 6 * 86400000);
    return { start: toISO(start), end: toISO(end) };
  }
  const year = parseInt(m[1]!, 10);
  const week = parseInt(m[2]!, 10);
  // ISO 周第一天 = 1 月 4 日所在周的周一 + (week-1)*7
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * 86400000 + (week - 1) * 7 * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return { start: toISO(monday), end: toISO(sunday) };
}

/** 上月标识（如 2026-07） */
function prevMonthLabel(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
