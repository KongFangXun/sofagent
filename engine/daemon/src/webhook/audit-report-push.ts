// ============================================================
// audit-report-push.ts · 数据主权审计报告 webhook 推送（v1.3.8 · P0）
// ============================================================
//
// 审计报告生成后推送到企业 IM（飞书/钉钉/企微），复用现有 createWebhookPusher。
//
// 配置：data/config/audit-report.json
//   { "target": "feishu" | "dingtalk" | "wecom", "schedule": "daily", "format": "summary" }
//
// 行为（主理人决策 R6）：
//   配置文件缺失 / target 未配置 → 跳过推送 + console 一行日志，不 fail-fast、不 throw。
//   推送本体永不 reject（webhook/index.ts 铁律），失败自动降级本地 jsonl。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@sofagent/core';
import { createWebhookPusher } from './index';
import type { WebhookPlatform } from './index';
import type { GeneratedReport } from '@sofagent/audit';

/** 推送配置结构（data/config/audit-report.json） */
interface AuditReportPushConfig {
  /** 推送目标平台 */
  target?: WebhookPlatform;
  /** 推送频率（目前仅 daily 实装；weekly/monthly 预留） */
  schedule?: 'daily' | 'weekly' | 'monthly';
  /** 推送格式：summary = 只推概要，full = 推完整 Markdown */
  format?: 'summary' | 'full';
}

/**
 * 读取推送配置。缺失/解析失败返回 null（调用方据此跳过）。
 */
function loadPushConfig(overrideHome?: string): AuditReportPushConfig | null {
  const configPath = join(resolveDataDir(overrideHome), 'config', 'audit-report.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as AuditReportPushConfig;
  } catch {
    return null;
  }
}

/**
 * 推送审计报告到企业 IM
 *
 * @param report 已生成的报告（generateDailyReport / generateWeeklyReport / generateMonthlyReport）
 * @param overrideHome 测试隔离用 fake home
 * @returns true = 已发起推送（不保证送达）；false = 跳过（配置缺失）
 */
export async function pushAuditReport(
  report: GeneratedReport,
  overrideHome?: string,
): Promise<boolean> {
  const config = loadPushConfig(overrideHome);
  if (!config?.target) {
    // 主理人决策 R6：配置缺失跳过 + console 一行，不 fail-fast
    console.log('[sofagent] audit-report webhook 未配置 target，跳过推送');
    return false;
  }

  // 组装推送消息（summary = 6 项概要指标；full = 完整 Markdown）
  const message =
    config.format === 'full'
      ? report.markdown
      : buildSummaryMessage(report);

  const pusher = createWebhookPusher();
  const verdict = report.stats.anomalyCount > 0 ? 'WARN' : 'PASS';
  // push() 永不 reject（webhook/index.ts 铁律），失败自动降级
  await pusher.push(config.target, verdict, message);
  return true;
}

/**
 * 组装概要推送消息（6 项核心指标 + 可见目录路径）
 */
function buildSummaryMessage(report: GeneratedReport): string {
  const lines: string[] = [];
  lines.push(`数据主权审计${report.kind === 'daily' ? '日报' : report.kind === 'weekly' ? '周报' : '月报'} · ${report.label}`);
  lines.push('');
  lines.push(`记录总数：${report.stats.total}`);
  lines.push(`云端调用：${report.stats.cloudCallCount}`);
  lines.push(`本地执行：${report.stats.localActionCount}`);
  lines.push(`数据流出：${report.stats.outboundCount}`);
  lines.push(`敏感数据本地处理率：${(report.stats.sensitiveLocalRate * 100).toFixed(1)}%`);
  lines.push(`审计异常：${report.stats.anomalyCount}`);
  if (report.visiblePath) {
    lines.push('');
    lines.push(`完整报告：${report.visiblePath}`);
  }
  return lines.join('\n');
}
