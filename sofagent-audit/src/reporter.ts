// ============================================================
// reporter.ts · 审计结果聚合与输出
// ============================================================

import type { DiffFile } from './diff-parser';
import type { LogEntry } from './log-checker';
import { checkRule01 } from './rules/rule-01-read-before-write';
import { checkRule03 } from './rules/rule-03-verify-before-continue';
import { checkRule07 } from './rules/rule-07-careful-modify';
import { checkRule10 } from './rules/rule-10-honest-report';

export interface RuleCheck {
  name: string;
  number: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string[];
}

export interface AuditResult {
  rules: RuleCheck[];
  exitCode: number;
}

/**
 * 运行全部审计规则
 */
export function runRules(
  diffFiles: DiffFile[],
  logEntries: LogEntry[],
  task?: string
): AuditResult {
  const rules: RuleCheck[] = [];

  // 铁律 #1 先读再用
  rules.push(checkRule01(diffFiles, logEntries));

  // 铁律 #3 验证再干
  rules.push(checkRule03(diffFiles, logEntries));

  // 铁律 #7 谨慎修改
  rules.push(checkRule07(diffFiles, task));

  // 铁律 #10 如实汇报
  rules.push(checkRule10());

  // 汇总判定
  let exitCode = 0;
  for (const rule of rules) {
    if (rule.status === 'FAIL') exitCode = 2;
    else if (rule.status === 'WARN' && exitCode === 0) exitCode = 1;
  }

  return { rules, exitCode };
}
