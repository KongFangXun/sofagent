// ============================================================
// data-sovereignty.ts · 数据主权审计三档报告工厂（v1.4.9 深模块条目 2 批三）
// ============================================================
// 三档（daily/weekly/monthly）曾互为复制（diff 仅 generate 函数与文案）。
// 收敛为 makeSovereigntyInspector 工厂——generate 入参与档名注入。
// name/severity 契约与三个原文件逐字等价（金名单与既有测试消费面不变）。
// ============================================================

import {
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
} from '@sofagent/audit';
import { pushAuditReport } from '../webhook/audit-report-push';
import type { InspectorResult } from './types';

/** 档位中文文案 */
const PERIOD_LABEL: Record<string, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
};

/**
 * 构造数据主权审计 inspector（三档共用形态）。
 * @param kind 档位（daily 用 'yesterday' 入参；weekly/monthly 无参）
 */
export function makeSovereigntyInspector(kind: 'daily' | 'weekly' | 'monthly') {
  const name = `data-sovereignty-${kind}`;
  const label = PERIOD_LABEL[kind] ?? kind;
  return function sovereigntyInspector(_projectDir: string): InspectorResult {
    try {
      const report =
        kind === 'daily' ? generateDailyReport('yesterday')
        : kind === 'weekly' ? generateWeeklyReport()
        : generateMonthlyReport();
      void pushAuditReport(report);
      return {
        name,
        triggered: report.stats.anomalyCount > 0,
        message:
          `数据主权${label} ${report.label} 已生成：` +
          `${report.stats.total} 条记录 · 异常 ${report.stats.anomalyCount} 条` +
          (report.visiblePath ? ` · ${report.visiblePath}` : ''),
        severity: report.stats.anomalyCount > 0 ? 'warning' : 'info',
      };
    } catch (err) {
      return {
        name,
        triggered: false,
        message: `数据主权${label}生成失败：${err instanceof Error ? err.message : String(err)}`,
        severity: 'warning',
      };
    }
  };
}
