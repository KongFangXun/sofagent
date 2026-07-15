// ============================================================
// permission/checker.ts · 权限检查逻辑
// v1.1.2 新增
// ============================================================

import type { MergedPermission } from './types';

export function checkPermission(
  perm: MergedPermission,
  file: string,
  operation: string,
): { allowed: boolean; matchedRule?: string; reason?: string } {
  for (const rule of perm.merged) {
    // 简单 glob 匹配（支持 * 通配符）
    const patternRegex = new RegExp('^' + rule.pattern.replace(/\*/g, '.*') + '$');
    if (patternRegex.test(file) || patternRegex.test(operation)) {
      return {
        allowed: rule.effect === 'allow',
        matchedRule: rule.name,
        reason: rule.effect === 'allow'
          ? `Matched allow rule: ${rule.name}`
          : `Matched deny rule: ${rule.name}`,
      };
    }
  }
  // 无匹配规则 → 默认允许
  return { allowed: true };
}
