// ============================================================
// skill-staleness.ts · Skill 陈旧度检测
// v1.3.7 新增
// ============================================================

import type { InspectorResult } from './types';

/**
 * Skill 陈旧度检测
 *
 * v1.6.0 BUG-58：无排期未转正——已从巡检注册表移出（registry 不再登记）；
 * 函数保留因 @public 基线承诺（semver 锁定）。转正条件：eval 数据面就绪。
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
