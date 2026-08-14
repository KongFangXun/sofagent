// ============================================================
// data-sovereignty-monthly.ts · 数据主权审计月报 inspector（v1.3.4 · P0）
// ============================================================
//
// @monthly：生成上月数据主权审计报告 → 写入 {企业名}/审计报告/{年}/{月}/monthly-YYYY-MM.md
// ============================================================

import { generateMonthlyReport } from '@sofagent/audit';
import { pushAuditReport } from '../webhook/audit-report-push';
import type { InspectorResult } from './types';

/**
 * 生成上月数据主权月报
 * @param projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function generateDataSovereigntyMonthly(projectDir: string): InspectorResult {
  try {
    const report = generateMonthlyReport();
    void pushAuditReport(report);

    return {
      name: 'data-sovereignty-monthly',
      triggered: report.stats.anomalyCount > 0,
      message:
        `数据主权月报 ${report.label} 已生成：` +
        `${report.stats.total} 条记录 · 异常 ${report.stats.anomalyCount} 条` +
        (report.visiblePath ? ` · ${report.visiblePath}` : ''),
      severity: report.stats.anomalyCount > 0 ? 'warning' : 'info',
    };
  } catch (err) {
    return {
      name: 'data-sovereignty-monthly',
      triggered: false,
      message: `数据主权月报生成失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }
}
