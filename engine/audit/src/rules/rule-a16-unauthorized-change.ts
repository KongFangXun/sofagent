// ============================================================
// A16 非授权文件变更（安全层 · 工程规范）
// 检测敏感目录/文件类型被修改或删除——行为级检测
// v1.3.7 新增
// v1.4.2: 审计引擎源码自保护——检测 engine/audit/src/ 核心文件被修改
// evidenceMode: git-diff
// ============================================================

import type { AuditContext, RuleCheck } from './types';
/**
 * v1.2.5 §4.9.3: 审计引擎核心源码——Agent 不可修改
 *
 * 这些路径如果被 Agent 修改，可能意味着审计引擎被篡改
 * （如从 critical 列表里删除规则、修改检测逻辑）。
 * 硬编码在规则内，零配置即生效。
 */
const AUDIT_ENGINE_PROTECTED_PATHS: string[] = [
  // 审计引擎核心——runner / index / types
  'engine/audit/src/rules/runner.ts',
  'engine/audit/src/rules/index.ts',
  'engine/audit/src/rules/types.ts',
  // 审计规则实现（所有 rule-a*.ts）
  'engine/audit/src/rules/rule-a1-sensitive-files.ts',
  'engine/audit/src/rules/rule-a2-secret-leak.ts',
  'engine/audit/src/rules/rule-a3-careful-modify.ts',
  'engine/audit/src/rules/rule-a4-config-deleted.ts',
  'engine/audit/src/rules/rule-a5-honest-report.ts',
  'engine/audit/src/rules/rule-a6-build-broken.ts',
  'engine/audit/src/rules/rule-a7-read-before-write.ts',
  'engine/audit/src/rules/rule-a8-verify-before-continue.ts',
  'engine/audit/src/rules/rule-a9-no-injection.ts',
  'engine/audit/src/rules/rule-a10-no-poison.ts',
  'engine/audit/src/rules/rule-a11-no-abuse.ts',
  'engine/audit/src/rules/rule-a16-unauthorized-change.ts',
  'engine/audit/src/rules/rule-a17-bulk-change.ts',
  'engine/audit/src/rules/rule-a18-junk-file.ts',
  'engine/audit/src/rules/rule-a19-commit-msg-quality.ts',
  'engine/audit/src/rules/rule-a20-network-exfiltration.ts',
  'engine/audit/src/rules/rule-a21-persistence.ts',
  'engine/audit/src/rules/rule-a22-privilege-escalation.ts',
  'engine/audit/src/rules/rule-a23-path-traversal.ts',
  // 共享密钥正则（§4.8.5 真实文件路径）
  'engine/core/src/shared/secret-patterns.ts',
  // 规则常量
  'engine/core/src/shared/rule-constants.ts',
];

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

    // v1.2.5 §4.9.3: 审计引擎源码自保护
    // 检测 diff 文件是否命中审计引擎核心源码路径
    if (file.status === 'added' || file.status === 'modified') {
      if (AUDIT_ENGINE_PROTECTED_PATHS.includes(file.path)) {
        violations.push(`审计引擎源码被修改: ${file.path}（审计规则源码不应被 Agent 修改，请人工审查）`);
      }
    }
  }

  if (violations.length > 0) {
    rule.status = 'WARN';
    rule.details.push(violations.join('; '));
  }

  return rule;
}
