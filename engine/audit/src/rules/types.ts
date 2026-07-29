// ============================================================
// types.ts · 审计规则统一接口定义
// 所有规则实现 Rule 接口，通过注册表模式被 reporter 调用
// v0.95：铁律与审计分离；新增 ruleClass 分级 + AuditContext.config
// ============================================================

import type { DiffFile } from '@sofagent/core';
import type { LogEntry } from '@sofagent/core';
import type { AuditConfig } from '@sofagent/core';

/**
 * 证据模式——规则依赖的输入来源
 * - git-diff: 纯 diff 判定，不依赖 Agent 日志
 * - logs: 纯日志判定（预留）
 * - hybrid: 有日志走精确检查，无日志走 diff 启发式回退
 */
export type EvidenceMode = 'git-diff' | 'logs' | 'hybrid' | 'filesystem';

/**
 * 规则分级标签
 * - 业务底线：违反即破坏交付完整性（安全 / 边界 / 追溯）
 * - 能力拐杖：帮助 Agent 走完正确流程，违反不一定是事故
 */
export type RuleClass = '业务底线' | '能力拐杖' | '工程规范';

/**
 * Action Governance · 决策溯源组
 *
 * 来源：行业五层骨架 / Palantir Action Type 研读（A4）——每条被审计的「动作」
 * 应结构化带决策溯源组，对应 sofagent Ledger 层的「谁在何时基于哪版数据做了什么决策」。
 *
 * - who: 谁做的决策（人类 / Agent / 系统）
 * - when: 决策时间（ISO 8601）
 * - whichDataVersion: 决策所基于的知识 / 本体数据版本（FDE 知识库版本化后回填）
 * - whichApp: 决策发生的 app / Agent 身份
 */
export interface DecisionProvenance {
  who: string;
  when: string;
  /** 知识 / 本体数据版本；当前审计流尚未捕获，FDE 知识库版本化后回填。TODO(v1.x) */
  whichDataVersion?: string;
  /** 决策发生的 app / Agent 身份；当前填审计引擎标识 */
  whichApp?: string;
}

/**
 * Action Governance · 审计 5 字段 schema
 *
 * 来源：行业五层骨架 / Palantir Action Type 研读（A4）——每条被审计的「动作」
 * 结构化带 5 字段 + 决策溯源组，使审计记录从「结果」升级为「可问责的动作凭证」。
 *
 * - actor: 发起方（谁触发了这次变更）
 * - timestamp: 时间（动作发生时间，ISO 8601）
 * - targetEntity: 目标实体（被变更的对象：文件路径 / 实体 ID / 资源）
 * - beforeAfter: 前后值（变更前 / 后摘要）
 * - context: 上下文（任务 / workflow / session）
 */
export interface ActionGovernance {
  actor: string;
  timestamp: string;
  targetEntity: string;
  /** 变更前后值摘要；当前审计流不承载 diff 原文（避免大段写入 history.jsonl，且 A2/A9 需脱敏），按需从 git diff 取。TODO(v1.x) */
  beforeAfter?: { before?: string; after?: string };
  /** 上下文：任务描述 / commit message / workflow */
  context?: string;
  /** 决策溯源组（who / when / which-data-version / which-app） */
  decisionProvenance: DecisionProvenance;
}

/**
 * 单条规则的检查结果
 */
export interface RuleCheck {
  name: string;
  number: number;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
  details: string[];
  /** 证据模式标注（用于输出显示） */
  evidenceMode?: EvidenceMode;
  /** 规则分级标签（用于 reporter 输出 [底线]/[拐杖] 前缀） */
  ruleClass?: RuleClass;
  /** Action Governance 溯源（可选项；单条 finding 默认不带，由 AuditHistoryEntry 统一承载动作级溯源） */
  actionGovernance?: ActionGovernance;
}

/**
 * 审计上下文——传递给每条规则的统一参数
 * 规则从中按需取用，不再各自声明不同的参数签名
 */
export interface AuditContext {
  /** git diff 解析出的文件变更列表 */
  diffFiles: DiffFile[];
  /** data/task/logs/ 解析出的任务日志条目 */
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
  /** v1.0.9: 窗口内历史审计记录（A17 跨审计聚合用） */
  history?: { timestamp: string; diffFileCount: number }[];
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
  /** 规则描述（v1.0.9） */
  description?: string;
  check(ctx: AuditContext): RuleCheck;
}
