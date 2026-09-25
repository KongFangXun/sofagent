// ============================================================
// shared/rule-types.ts · 规则触发时机类型单一事实源
// v1.5.3 第一章（双规则引擎统一）：两套规则引擎（tool-level / git-diff）
//   共用同一套规则定义，`ruleType` 描述「这条定义在哪个触发时机执行」。
//   此前该值在两处各写死一个单值字面量（audit `'diff'` / rules `'tool'`），
//   现统一为同一联合类型——单一事实源，两引擎 import 同一来源。
// ============================================================

/**
 * 规则触发时机：
 * - `'tool'`：调用前拦截（engine/rules —— ToolGate 同步上下文）
 * - `'diff'`：提交后审计（engine/audit —— git diff 粒度审计上下文）
 *
 * 同一套规则定义可在两种时机执行（见 {@link RuleDefinition.ruleTypes}）。
 */
export type RuleType = 'tool' | 'diff';
