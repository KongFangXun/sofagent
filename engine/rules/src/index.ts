// ============================================================
// index.ts · @sofagent/rules barrel export
// v1.3.0：只导出 5 个公开符号，内部实现不外露
// ============================================================

export { RulesEngine } from './engine';
export type { ToolRule, ToolCallContext, InterceptVerdict, RuleStatus, RuleClass } from './types';
export { defaultToolRules } from './rules';
// v1.3.0 (交付 2)：tool-gate 便捷判定 API
export { shouldAllow } from './should-allow';
export type { ShouldAllowResult } from './should-allow';
