// ============================================================
// meta-harness/index.ts · barrel export
// v1.4.4（二）：多 harness 统一编排——编排器 + 策略层 + 审计聚合
// ============================================================

export { MetaHarness } from './orchestrator';
export type {
  HarnessDescriptor, MetaTask, MetaTaskResult, TaskExecutor,
  DeliveryListener, ProfileBundle, DescriptorRegistration,
} from './orchestrator';
export { PolicyLayer, fileLockPolicy, concurrencyCapPolicy, profileAllowlistPolicy, sensitiveToolPolicy } from './policy-layer';
export type { MetaAction, MetaPolicy, PolicyVerdict, MetaStateView, MetaActionType } from './policy-layer';
export { AuditAggregator } from './audit-aggregator';
export type { AggregateAuditEntry, AuditQuery, L2EventInput } from './audit-aggregator';
