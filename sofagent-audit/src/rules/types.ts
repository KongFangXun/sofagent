// ============================================================
// types.ts · 审计规则统一接口定义
// 所有规则实现 Rule 接口，通过注册表模式被 reporter 调用
// v0.94：新增 evidenceMode / silent / commitMsg 字段
// ============================================================

import type { DiffFile } from '../diff-parser';
import type { LogEntry } from '../log-checker';

/**
 * 证据模式——规则依赖的输入来源
 * - git-diff: 纯 diff 判定，不依赖 Agent 日志
 * - logs: 纯日志判定（预留）
 * - hybrid: 有日志走精确检查，无日志走 diff 启发式回退
 */
export type EvidenceMode = 'git-diff' | 'logs' | 'hybrid';

/**
 * 单条规则的检查结果
 */
export interface RuleCheck {
  name: string;
  number: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string[];
  /** 证据模式标注（用于输出显示） */
  evidenceMode?: EvidenceMode;
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
  /** --strict 模式：无日志时铁律 #1 返回 FAIL 而非 WARN */
  strict?: boolean;
  /** --silent 模式：跳过日志依赖规则，走 diff 启发式回退 */
  silent?: boolean;
  /** commit message（用于 R3/R5 规则及 #10 回退） */
  commitMsg?: string;
}

/**
 * 规则统一接口
 * 新增铁律时只需实现此接口并注册到 rules/index.ts
 */
export interface Rule {
  name: string;
  number: number;
  /** 证据模式标注 */
  evidenceMode: EvidenceMode;
  check(ctx: AuditContext): RuleCheck;
}
