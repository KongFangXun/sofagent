// ============================================================
// types.ts · 审计规则统一接口定义
// 所有规则实现 Rule 接口，通过注册表模式被 reporter 调用
// v0.95：铁律与审计分离；新增 ruleClass 分级 + AuditContext.config
// ============================================================

import type { DiffFile } from '../diff-parser';
import type { LogEntry } from '../log-checker';
import type { AuditConfig } from '../config-loader';

/**
 * 证据模式——规则依赖的输入来源
 * - git-diff: 纯 diff 判定，不依赖 Agent 日志
 * - logs: 纯日志判定（预留）
 * - hybrid: 有日志走精确检查，无日志走 diff 启发式回退
 */
export type EvidenceMode = 'git-diff' | 'logs' | 'hybrid';

/**
 * 规则分级标签
 * - 业务底线：违反即破坏交付完整性（安全 / 边界 / 追溯）
 * - 能力拐杖：帮助 Agent 走完正确流程，违反不一定是事故
 */
export type RuleClass = '业务底线' | '能力拐杖';

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
  /** 规则分级标签（用于 reporter 输出 [底线]/[拐杖] 前缀） */
  ruleClass?: RuleClass;
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
  /** --task 参数传入的任务描述（用于 A3 不改越界） */
  task?: string;
  /** --strict 模式：无日志时 A7 返回 FAIL 而非 WARN */
  strict?: boolean;
  /** --silent 模式：跳过日志依赖规则，走 diff 启发式回退 */
  silent?: boolean;
  /** commit message（用于 E2/A5 规则） */
  commitMsg?: string;
  /** .sofagent/config.yml 加载的审计配置（三级 fallback） */
  config?: AuditConfig;
}

/**
 * 规则统一接口
 * 新增审计项时只需实现此接口并注册到 rules/index.ts
 */
export interface Rule {
  name: string;
  number: number;
  /** 证据模式标注 */
  evidenceMode: EvidenceMode;
  /** 规则分级标签 */
  ruleClass?: RuleClass;
  check(ctx: AuditContext): RuleCheck;
}
