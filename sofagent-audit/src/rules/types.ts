// ============================================================
// types.ts · 审计规则统一接口定义
// 所有规则实现 Rule 接口，通过注册表模式被 reporter 调用
// ============================================================

import type { DiffFile } from '../diff-parser';
import type { LogEntry } from '../log-checker';

/**
 * 单条规则的检查结果
 */
export interface RuleCheck {
  name: string;
  number: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string[];
}

/**
 * 审计上下文——传递给每条规则的统一参数
 * 规则从中按需取用，不再各自声明不同的参数签名
 */
export interface AuditContext {
  /** git diff 解析出的文件变更列表 */
  diffFiles: DiffFile[];
  /** .sofagent/task/logs/ 解析出的任务日志条目 */
  logEntries: LogEntry[];
  /** --task 参数传入的任务描述（用于铁律 #7 谨慎修改） */
  task?: string;
}

/**
 * 规则统一接口
 * 新增铁律时只需实现此接口并注册到 rules/index.ts
 */
export interface Rule {
  name: string;
  number: number;
  check(ctx: AuditContext): RuleCheck;
}
