// ============================================================
// inspectors/index.ts · 巡检器统一入口
// v1.1.9 新增
// ============================================================

import type { InspectorConfig, InspectorResult } from './types';
import { analyzeAuditHistory } from './audit-history-analyzer';
import { checkConflict } from './conflict-check';
import { checkDoctorHealth } from './doctor-checker';
import { checkKnowledgeFreshness } from './knowledge-freshness';
import { checkKnowledgeHealth } from './knowledge-health';
import { checkSkillStaleness } from './skill-staleness';
import { accumulateWarnings } from './warn-accumulator';

export { analyzeAuditHistory, checkConflict, checkDoctorHealth, checkKnowledgeFreshness, checkKnowledgeHealth, checkSkillStaleness, accumulateWarnings };
export type { InspectorConfig, InspectorResult } from './types';

/** 默认巡检器配置 */
export const DEFAULT_INSPECTOR_CONFIG: Record<string, InspectorConfig> = {
  'audit-history': { enabled: true, schedule: '@daily' },
  'conflict-check': { enabled: true, schedule: '@weekly' },
  'doctor-health': { enabled: true, schedule: '@daily' },
  'knowledge-freshness': { enabled: true, schedule: '@weekly' },
  'knowledge-health': { enabled: true, schedule: '@weekly' },
  'skill-staleness': { enabled: false, schedule: '@weekly' },
  'warn-accumulator': { enabled: true, schedule: '@daily' },
};

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
  ];
}
