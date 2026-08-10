// ============================================================
// inspectors/index.ts · 巡检器统一入口
// v1.3.1 新增
// ============================================================

import type { InspectorConfig, InspectorResult } from './types';
import { analyzeAuditHistory } from './audit-history-analyzer';
import { checkConflict } from './conflict-check';
import { checkDoctorHealth } from './doctor-checker';
import { checkKnowledgeFreshness } from './knowledge-freshness';
import { checkKnowledgeHealth } from './knowledge-health';
import { checkSkillStaleness } from './skill-staleness';
import { accumulateWarnings } from './warn-accumulator';
import { runHealthReport } from './health-reporter';
import { generateDataSovereigntyDaily } from './data-sovereignty-daily';
import { generateDataSovereigntyWeekly } from './data-sovereignty-weekly';
import { generateDataSovereigntyMonthly } from './data-sovereignty-monthly';
import { runWorkspaceSummary } from '../workspace-summary';

export { analyzeAuditHistory, checkConflict, checkDoctorHealth, checkKnowledgeFreshness, checkKnowledgeHealth, checkSkillStaleness, accumulateWarnings, runHealthReport, generateDataSovereigntyDaily, generateDataSovereigntyWeekly, generateDataSovereigntyMonthly, workspaceSummaryInspector };
export type { InspectorConfig, InspectorResult } from './types';
export type { DaemonHealth } from './health-reporter';

/** 默认巡检器配置 */
export const DEFAULT_INSPECTOR_CONFIG: Record<string, InspectorConfig> = {
  'audit-history': { enabled: true, schedule: '@daily' },
  'conflict-check': { enabled: true, schedule: '@weekly' },
  'doctor-health': { enabled: true, schedule: '@daily' },
  'knowledge-freshness': { enabled: true, schedule: '@weekly' },
  'knowledge-health': { enabled: true, schedule: '@weekly' },
  'skill-staleness': { enabled: false, schedule: '@weekly' },
  'warn-accumulator': { enabled: true, schedule: '@daily' },
  // v1.2.2 P0：数据主权审计三档报告
  'data-sovereignty-daily': { enabled: true, schedule: '@daily' },
  'data-sovereignty-weekly': { enabled: true, schedule: '@weekly' },
  'data-sovereignty-monthly': { enabled: true, schedule: '@monthly' },
  // v1.2.3 交付五：workspace 变更摘要（checkpoint 联动触发 · AD-6）
  'workspace-summary': { enabled: true, schedule: '@daily' },
};

/**
 * workspace-summary 巡检适配（v1.2.3 · 交付五）。
 * AD-6：checkpoint 联动——发现新 checkpoint 才记一条变更摘要
 * （runId = checkpointId）；无新 checkpoint / 写失败都不告警。
 */
function workspaceSummaryInspector(projectDir: string): InspectorResult {
  try {
    const record = runWorkspaceSummary({ projectDir });
    if (!record) {
      return {
        name: 'workspace-summary',
        triggered: false,
        message: '无新 checkpoint，跳过 workspace 变更记录',
        severity: 'info',
      };
    }
    return {
      name: 'workspace-summary',
      triggered: true,
      message:
        `runId=${record.runId} · created=${record.created.length} ` +
        `modified=${record.modified.length} deleted=${record.deleted.length}`,
      severity: 'info',
    };
  } catch (err) {
    return {
      name: 'workspace-summary',
      triggered: false,
      message: `workspace 摘要失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }
}

/**
 * 运行所有启用的巡检器
 *
 * @param projectDir 项目根目录
 * @param _config 可选巡检器配置覆盖（暂未实现按配置过滤）
 * @returns 巡检结果数组
 */
export function runInspectors(
  projectDir: string,
  _config?: Partial<Record<string, InspectorConfig>>,
): InspectorResult[] {
  return [
    analyzeAuditHistory(projectDir),
    checkConflict(projectDir),
    checkDoctorHealth(projectDir),
    checkKnowledgeFreshness(projectDir),
    checkKnowledgeHealth(projectDir),
    checkSkillStaleness(projectDir),
    accumulateWarnings(projectDir),
    // v1.2.3 交付五：workspace 变更摘要（checkpoint 联动）
    workspaceSummaryInspector(projectDir),
    // v1.2.4 P0 修复预存 bug：data-sovereignty 三档报告之前只注册不执行，补入执行数组
    generateDataSovereigntyDaily(projectDir),
    generateDataSovereigntyWeekly(projectDir),
    generateDataSovereigntyMonthly(projectDir),
  ];
}
