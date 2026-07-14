// ============================================================
// reporter.ts · 审计结果类型定义（v1.1.0 从 audit 迁出）
//
// 仅包含纯类型定义，不依赖 audit 的 rules/ 模块。
// runRules 实现在 audit/src/reporter.ts 中，因为依赖 rules/runner。
// ============================================================

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
  ruleClass?: string;
}

/**
 * 审计结果——规则检查结果 + 退出码
 */
export interface AuditResult {
  rules: RuleCheck[];
  exitCode: number;
}
