// ============================================================
// data-sovereignty-daily.ts · 数据主权审计日报 inspector（v1.3.2 · P0）
// ============================================================
//
// @daily：生成昨日数据主权审计报告 → 写入 {企业名}/审计报告/{年}/{月}/daily-YYYY-MM-DD.md
// 同时触发 webhook 推送（配置缺失时跳过 + console 一行，不 fail-fast）。
// ============================================================

import { generateDailyReport } from '@sofagent/audit';
import { pushAuditReport } from '../webhook/audit-report-push';
import type { InspectorResult } from './types';

/**
 * 生成昨日数据主权日报
 * @param projectDir 项目根目录（本 inspector 不直接用，数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function generateDataSovereigntyDaily(projectDir: string): InspectorResult {
  try {
    const report = generateDailyReport('yesterday');
    // webhook 推送（fire-and-forget，配置缺失静默跳过）
    void pushAuditReport(report);

    return {
      name: 'data-sovereignty-daily',
      triggered: report.stats.anomalyCount > 0,
      message:
        `数据主权日报 ${report.label} 已生成：` +
        `${report.stats.total} 条记录 · 异常 ${report.stats.anomalyCount} 条` +
        (report.visiblePath ? ` · ${report.visiblePath}` : ''),
      severity: report.stats.anomalyCount > 0 ? 'warning' : 'info',
    };
  } catch (err) {
    return {
      name: 'data-sovereignty-daily',
      triggered: false,
      message: `数据主权日报生成失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }
}
