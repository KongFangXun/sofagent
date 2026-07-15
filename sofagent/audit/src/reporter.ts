// ============================================================
// reporter.ts · 审计结果聚合与输出
// v0.93 重构：改用注册表模式——从 rules/index.ts 导入规则数组，
// 循环调用 rule.check(ctx)，不再硬编码 import 4 条规则
// v0.94：runRules 签名扩展，支持 silent/commitMsg 参数
// v0.95：支持 config 注入 AuditContext + extendedRules 开关
// v1.1.2：fast-fail 优化——委托到 rules/runner.ts
// ============================================================

import type { DiffFile } from '@sofagent/core';
import type { LogEntry } from '@sofagent/core';
import type { AuditConfig } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './rules/types';
import { runRules as runRulesWithFastFail } from './rules/runner';

// 向后兼容：re-export RuleCheck（index.ts 等模块通过 reporter 导入此类型）
export type { RuleCheck } from './rules/types';

export interface AuditResult {
  rules: RuleCheck[];
  exitCode: number;
  /** v1.1.0：权限拒绝列表（permission 集成审计） */
  permissionDenials?: string[];
}

/**
 * 运行全部审计规则（fast-fail 模式，v1.0.7）
 * 委托到 rules/runner.ts 的 runRules，内部按 AUDIT_PRIORITY 分组执行。
 *
 * @param diffFiles git diff 解析出的文件变更列表
 * @param logEntries 任务日志条目
 * @param task 任务描述（--task 参数）
 * @param strict 严格模式
 * @param silent 沉默模式（跳过日志依赖规则，走 diff 启发式）
 * @param commitMsg commit message（用于 E2/A5 规则及 #10 回退）
 * @param config 审计配置（.sofagent/config.yml 加载，三级 fallback）
 */
export function runRules(
  diffFiles: DiffFile[],
  logEntries: LogEntry[],
  task?: string,
  strict?: boolean,
  silent?: boolean,
  commitMsg?: string,
  config?: AuditConfig
): AuditResult {
  return runRulesWithFastFail(diffFiles, logEntries, task, strict, silent, commitMsg, config);
}
