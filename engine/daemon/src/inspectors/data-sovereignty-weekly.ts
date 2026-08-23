// ============================================================
// data-sovereignty-weekly.ts · 数据主权审计周报 inspector（v1.4.0 · P0）
// ============================================================
//
// @weekly：生成上一 ISO 周数据主权审计报告 → 写入 {企业名}/审计报告/{年}/{月}/weekly-YYYY-Www.md
// ============================================================

import { generateWeeklyReport } from '@sofagent/audit';
import { pushAuditReport } from '../webhook/audit-report-push';
import type { InspectorResult } from './types';

/**
 * 生成上一 ISO 周数据主权周报
 * @param projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function generateDataSovereigntyWeekly(projectDir: string): InspectorResult {
  try {
    const report = generateWeeklyReport();
    void pushAuditReport(report);

    return {
      name: 'data-sovereignty-weekly',
      triggered: report.stats.anomalyCount > 0,
      message:
        `数据主权周报 ${report.label} 已生成：` +
        `${report.stats.total} 条记录 · 异常 ${report.stats.anomalyCount} 条` +
        (report.visiblePath ? ` · ${report.visiblePath}` : ''),
      severity: report.stats.anomalyCount > 0 ? 'warning' : 'info',
    };
  } catch (err) {
    return {
      name: 'data-sovereignty-weekly',
      triggered: false,
      message: `数据主权周报生成失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }
}
