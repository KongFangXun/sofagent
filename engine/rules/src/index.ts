// ── API 分级契约（v1.5.1 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
// ============================================================
// index.ts · @sofagent/rules barrel export
// v1.5.2（章五）：新增出口治理面（egress-policy）11 个公开符号 → 累计 32 个
//                （以 `node tools/check/public-api.mjs` AST 解析为准），内部实现不外露
// Last revised: v1.5.2
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
// v1.5.2（章五）：网络出口治理面——host 白名单声明面 + 出站裁决（默认空全拒，opt-in）
//   与 v1.4.9 G10 设备数据面授权读取（「管进」）逐面对称的「管出」翼策略契约面。
//   公开面 = 声明 API + 裁决 API + 匹配原语 + 类型（外部拦截器实现按此接入）。
/* @public */ export {
  normalizeEgressHost,
  hostMatchesEgressRule,
  declareEgressHosts,
  decideEgress,
} from './egress-policy';
/* @public */ export type {
  EgressVerdict,
  EgressDenyReason,
  EgressReason,
  EgressRequest,
  EgressHostRule,
  EgressPolicy,
  EgressDecision,
} from './egress-policy';
// v1.5.2（章五）：声明文件面（<dataDir>/config/egress-policy.json）管道——@internal
//   （等价 G10 config/device-data-policy.json 的 load/save 面；声明写入由 CLI/MCP
//   运行时落点承载，不属外部拦截器契约面）
/* @internal */ export { EGRESS_POLICY_FILE, EGRESS_POLICY_VERSION, egressPolicyPath, loadEgressPolicy, saveEgressPolicy, egressRequestFromUrl } from './egress-policy';
