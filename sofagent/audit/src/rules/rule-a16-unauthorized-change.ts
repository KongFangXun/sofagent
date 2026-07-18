// ============================================================
// A16 非授权文件变更（安全层 · 工程规范）
// 检测敏感目录/文件类型被修改或删除——行为级检测
// evidenceMode: git-diff
// v1.1.4 新增
// ============================================================

import type { AuditContext, RuleCheck } from './types';

export function checkRuleA16(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A16 非授权文件变更',
    number: 16,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '工程规范',
  };

  const config = ctx.config?.A16;
  if (!config?.enabled) return rule;

  const protectedDirs: string[] = config.protected_dirs || [];
  const sensitiveTypes: string[] = config.sensitive_types || [];
  const violations: string[] = [];

  for (const file of ctx.diffFiles) {
    // 检查保护目录
    for (const dir of protectedDirs) {
      if (file.path.startsWith(dir) && (file.status === 'modified' || file.status === 'deleted')) {
        violations.push(`${file.status} 保护目录文件: ${file.path}`);
      }
    }
    // 检查敏感类型删除
    for (const ext of sensitiveTypes) {
      if (file.path.endsWith(ext) && file.status === 'deleted') {
        violations.push(`删除敏感文件: ${file.path}`);
      }
    }
  }

  if (violations.length > 0) {
    rule.status = 'WARN';
    rule.details.push(violations.join('; '));
  }

  return rule;
}
