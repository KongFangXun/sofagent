// ============================================================
// index.ts · @sofagent/rules barrel export
// v1.3.8：只导出 5 个公开符号，内部实现不外露
// ============================================================

export { RulesEngine } from './engine';
export type { ToolRule, ToolCallContext, InterceptVerdict, RuleStatus, RuleClass } from './types';
export { defaultToolRules } from './rules';
// v1.3.7 (交付 2)：tool-gate 便捷判定 API
export { shouldAllow } from './should-allow';
export type { ShouldAllowResult } from './should-allow';
// v1.3.2 (交付 10)：工具审批四模式
export { shouldApprove } from './approval-mode';
export type { ApprovalMode, ApprovalResult } from './approval-mode';
