// ============================================================
// domain/sandbox.ts · 安全域（sandbox/vault/permission/gateway）——域级 barrel（v1.5.7 F32）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/orchestrator/domain/sandbox），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/sandbox"。
// ============================================================
/* @public */ export {
  CredentialVault,
  createCredentialVault,
  CredentialVaultError,
  CredentialRotator,
  createCredentialRotator,
  produceScopeDeclaration,
  declareAndReconcile,
  compareRequestedIssued,
} from '../vault';
/* @public */ export type {
  CredentialInjectSpec,
  CredentialStoreInput,
  CredentialView,
  CredentialVaultDeps,
  SandboxEgressRequest,
  SandboxEgressInjection,
  SandboxCredentialInjector,
  RotationPolicy,
  CredentialRotatorDeps,
  RotationOutcome,
  LeakResponseRecord,
  ScopeDim,
  ScopeComparison,
  ScopeDeclarationInput,
  ScopeDeclarationResult,
  DeclareAndReconcileResult,
} from '../vault';
/* @public */ export {
  createProxyGateway,
  classifyRequestRisk,
  sanitizeForAudit,
  GATEWAY_AUDIT_REL,
  GATEWAY_PENDING_DIR_REL,
} from '../gateway/proxy-gateway';
/* @public */ export type {
  ProxyRequest,
  ProxyResult,
  ProxyDecision,
  ProxyAction,
  ProxyRisk,
  GatewayHITLDecision,
  GatewayPendingCheckpoint,
  GatewayWalHook,
  RateLimitConfig,
  ProxyGatewayOptions,
  ProxyGateway,
} from '../gateway/proxy-gateway';
/* @public */ export {
  createPermissionCeiling,
  DEFAULT_VIOLATION_THRESHOLD,
} from '../gateway/permission-ceiling';
/* @public */ export type {
  PermissionCeilingOptions,
  PermissionCeiling,
  CeilingCheckResult,
} from '../gateway/permission-ceiling';
/* @public */ export {
  createPolicyEngine,
  createScenarioRouter,
  classifyRisk,
  riskToDefaultAction,
  BUILTIN_SCENARIOS,
} from '../permission';
/* @public */ export type {
  PermissionRequest,
  PolicyAction,
  DecisionLogEntry,
  ElevationGrant,
  TeamPolicy,
  CommonsPolicy,
  Scenario,
  ScenarioMatchRequest,
  ScenarioMatchResult,
  TaskType,
  DataDomain,
  ActionType,
  RiskLevel,
} from '../permission';
