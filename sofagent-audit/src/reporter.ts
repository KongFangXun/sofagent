// ============================================================
// reporter.ts · 审计结果聚合与输出
// v0.92 重构：改用注册表模式——从 rules/index.ts 导入规则数组，
// 循环调用 rule.check(ctx)，不再硬编码 import 4 条规则
// ============================================================

import type { DiffFile } from './diff-parser';
import type { LogEntry } from './log-checker';
import { rules } from './rules';
import type { AuditContext, RuleCheck } from './rules/types';

// 向后兼容：re-export RuleCheck（index.ts 等模块通过 reporter 导入此类型）
export type { RuleCheck } from './rules/types';

export interface AuditResult {
  rules: RuleCheck[];
  exitCode: number;
}

/**
 * 运行全部审计规则（注册表模式）
 */
export function runRules(
  diffFiles: DiffFile[],
  logEntries: LogEntry[],
  task?: string
): AuditResult {
  const ctx: AuditContext = { diffFiles, logEntries, task };
  const results: RuleCheck[] = [];

  for (const rule of rules) {
    results.push(rule.check(ctx));
  }

  // 汇总判定
  let exitCode = 0;
  for (const rule of results) {
    if (rule.status === 'FAIL') exitCode = 2;
    else if (rule.status === 'WARN' && exitCode === 0) exitCode = 1;
  }

  return { rules: results, exitCode };
}
