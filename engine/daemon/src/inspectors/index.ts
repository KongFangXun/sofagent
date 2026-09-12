// ============================================================
// inspectors/index.ts · 巡检器统一入口
// v1.3.7 新增
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
// v1.3.2 交付 7：审计轨迹聚合巡检器（@daily）
import { runAuditTrailInspector } from './audit-trail';
// v1.4.8 深模块条目 2：注册表单源（分层/配置/执行全派生）
import { INSPECTORS, runAll } from './registry';
import { LAYER_SCHEDULE } from '../inspector-layers';
// v1.3.4 交付 1：能力目录日更生成（@daily）
import { runCommonsCatalogDaily } from './commons-catalog-daily';
// v1.3.4 交付 3：公地健康周检（@weekly）
import { runCommonsHealth } from './commons-health';

export { analyzeAuditHistory, checkConflict, checkDoctorHealth, checkKnowledgeFreshness, checkKnowledgeHealth, checkSkillStaleness, accumulateWarnings, runHealthReport, generateDataSovereigntyDaily, generateDataSovereigntyWeekly, generateDataSovereigntyMonthly, workspaceSummaryInspector, runAuditTrailInspector, runCommonsCatalogDaily, runCommonsHealth };
export type { InspectorConfig, InspectorResult } from './types';
export type { DaemonHealth } from './health-reporter';

/**
 * 默认巡检器配置（v1.4.8 深模块条目 2：从注册表派生——enabled 与层级来自
 * ./registry.ts 的 INSPECTORS 单源，schedule 由 LAYER_SCHEDULE 映射）。
 */
export const DEFAULT_INSPECTOR_CONFIG: Record<string, InspectorConfig> = Object.fromEntries(
  Object.entries(INSPECTORS).map(([name, entry]) => [
    name,
    { enabled: entry.enabled, schedule: LAYER_SCHEDULE[entry.layer] },
  ]),
);

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
  // v1.4.8 深模块条目 2：扁平执行表已死路径化——统一走注册表（单源）
  return runAll(projectDir);
}
