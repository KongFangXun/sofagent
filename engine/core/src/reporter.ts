// ============================================================
// reporter.ts · 审计结果类型定义（v1.4.4 从 audit 迁出）
//
// 本文件专用于 @sofagent/core，仅包含纯类型定义（AuditResult, RuleCheck）。
// 不依赖 audit 的 rules/ 模块，供所有包跨包使用。
// runRules 实现在 audit/src/reporter.ts 中（因为依赖 rules/runner）。
//
// 与 audit/src/reporter.ts 的关系：
//   - core/reporter.ts: 类型契约（跨包共享的类型定义）
//   - audit/reporter.ts: 运行时实现（runRules 函数，依赖 rules/runner）
//   两者故意分置：类型归 core（无运行时依赖），实现归 audit（有规则引擎依赖）。
// ============================================================

/** 规则分级标签 */
export type RuleClass = '业务底线' | '能力拐杖' | '工程规范';

/**
 * 单条规则的检查结果（core 侧最小定义）
 * audit 侧的 RuleCheck 是此类型的超集（多了 evidenceMode 等字段）
 */
export interface RuleCheck {
  name: string;
  number: number;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
  details: string[];
  /** 规则分级标签（用于 reporter 输出 [底线]/[拐杖] 前缀） */
  ruleClass?: RuleClass;
}

/**
 * 审计结果——规则检查结果 + 退出码
 */
export interface AuditResult {
  rules: RuleCheck[];
  exitCode: number;
}
