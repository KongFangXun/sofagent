// ============================================================
// index.ts · @sofagent/rules barrel export
// v1.2.0：只导出 5 个公开符号，内部实现不外露
// ============================================================

export { RulesEngine } from './engine';
export type { ToolRule, ToolCallContext, InterceptVerdict, RuleStatus, RuleClass } from './types';
export { defaultToolRules } from './rules';
