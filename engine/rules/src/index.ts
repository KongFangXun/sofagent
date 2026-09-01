// ── API 分级契约（v1.4.3 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
// ============================================================
// index.ts · @sofagent/rules barrel export
// v1.4.3：导出 21 个公开符号（以 `node tools/check/public-api.mjs` AST 解析为准），内部实现不外露
// Last revised: v1.4.3
// ============================================================

/* @public */ export { RulesEngine } from './engine';
/* @public */ export type { ToolRule, ToolCallContext, InterceptVerdict, RuleStatus, RuleClass } from './types';
/* @public */ export { defaultToolRules } from './rules';
// v1.3.7 (交付 2)：tool-gate 便捷判定 API
/* @public */ export { shouldAllow } from './should-allow';
/* @public */ export type { ShouldAllowResult } from './should-allow';
// v1.3.2 (交付 10)：工具审批四模式
/* @public */ export { shouldApprove } from './approval-mode';
/* @public */ export type { ApprovalMode, ApprovalResult } from './approval-mode';
// v1.3.9（一）：官方 AST 规则引擎（sofagent-ruleset-ast）——@public 公开面
/* @public */ export { AstRuleEngine } from './ast/engine';
/* @public */ export type { AstEngineOptions } from './ast/engine';
/* @public */ export { builtinAstRules, astRuleById } from './ast/rules';
/* @public */ export { buildSbom } from './ast/rules/asi04-sbom';
/* @public */ export type { SbomEntry } from './ast/rules/asi04-sbom';
/* @public */ export type { AstRule, AstFinding, AstScanInput } from './ast/types';
