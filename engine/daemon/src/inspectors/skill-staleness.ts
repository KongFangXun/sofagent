// ============================================================
// skill-staleness.ts · Skill 陈旧度检测
// v1.3.6 新增
// ============================================================

import type { InspectorResult } from './types';

/**
 * Skill 陈旧度检测
 *
 * 当前默认禁用，需要 eval 数据支持后才启用。
 */
export function checkSkillStaleness(_projectDir: string): InspectorResult {
  return {
    name: 'skill-staleness',
    triggered: false,
    message:
      'Skill staleness detection disabled by default (requires eval data)',
    severity: 'info',
  };
}
