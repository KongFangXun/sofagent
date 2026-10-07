// ============================================================
// domain/observe.ts · 可观测与审计域（事件外发 / 看板 / 审计链）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/train/domain/observe），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/observe"。
// ============================================================
/* @public */ export {
  buildTrainEventMessage,
  extractPayloadFromRecord,
  pushTrainEvent,
} from '../train-webhook';
/* @public */ export type {
  TrainWebhookPlatform,
  TrainEventType,
  TrainWebhookTarget,
  TrainEventPayload,
  PushFn,
} from '../train-webhook';
/* @public */ export {
  trainStatusSinkPath,
  trainHealthSinkPath,
  buildTrainStatusBoard,
  buildTrainHealthReport,
  flushTrainDashboard,
} from '../dashboard-sink';
/* @public */ export type {
  TrainStatusEntry,
  TrainStatusBoard,
  FailureReasonEntry,
  TrainHealthReport,
} from '../dashboard-sink';
/* @public */ export {
  STATUS_TO_EVENT,
  sanitizeDeep,
  computeDataSourceHash,
  trainAuditPath,
  emitTrainAudit,
  readTrainAudit,
  checkTrainAuditChain,
  rollbackFailedTrainJob,
  failTrainJobWithRollback,
} from '../train-audit';
/* @public */ export type {
  TrainAuditEventType,
  TrainAuditEntry,
  EmitTrainAuditInput,
  TrainAuditChainStatus,
  TrainAuditChainResult,
  TrainRollbackResult,
} from '../train-audit';
