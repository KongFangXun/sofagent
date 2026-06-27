// ============================================================
// reporter.ts · 审计结果聚合与输出
// v0.93 重构：改用注册表模式——从 rules/index.ts 导入规则数组，
// 循环调用 rule.check(ctx)，不再硬编码 import 4 条规则
// v0.94：runRules 签名扩展，支持 silent/commitMsg 参数
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
 * @param diffFiles git diff 解析出的文件变更列表
 * @param logEntries 任务日志条目
 * @param task 任务描述（--task 参数）
 * @param strict 严格模式
 * @param silent 沉默模式（跳过日志依赖规则，走 diff 启发式）
 * @param commitMsg commit message（用于 R3/R5 规则及 #10 回退）
 */
export function runRules(
  diffFiles: DiffFile[],
  logEntries: LogEntry[],
  task?: string,
  strict?: boolean,
  silent?: boolean,
  commitMsg?: string
): AuditResult {
  const ctx: AuditContext = { diffFiles, logEntries, task, strict, silent, commitMsg };
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
