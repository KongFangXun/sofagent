// ============================================================
// vault/index.ts · v1.5.8 章三 · 凭证隔离 Vault barrel
// ============================================================
//
// 汇总凭证隔离 Vault 三件：托管（credential-vault）/ 轮换吊销（credential-rotation）/
// 范围声明（scope-declaration）。挂载点：engine/orchestrator/src/index.ts 从此导出，
// 沙箱 HTTP 出口（harness-sdk/wrap.ts）消费注入器实际调用。
// ============================================================

export { CredentialVault, createCredentialVault, CredentialVaultError } from './credential-vault';
export type {
  CredentialInjectSpec,
  CredentialStoreInput,
  CredentialView,
  CredentialVaultDeps,
  SandboxEgressRequest,
  SandboxEgressInjection,
  SandboxCredentialInjector,
} from './credential-vault';

export { CredentialRotator, createCredentialRotator } from './credential-rotation';
export type {
  RotationPolicy,
  CredentialRotatorDeps,
  RotationOutcome,
  LeakResponseRecord,
} from './credential-rotation';

export {
  produceScopeDeclaration,
  declareAndReconcile,
  compareRequestedIssued,
} from './scope-declaration';
export type {
  ScopeDim,
  ScopeComparison,
  ScopeDeclarationInput,
  ScopeDeclarationResult,
  DeclareAndReconcileResult,
} from './scope-declaration';
