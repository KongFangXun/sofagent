// ============================================================
// domain/audit.ts · 审计与验证域（审计历史链 / 联邦 / 跨层对账 / 装后验证 / doctor / 作用域命名）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/core/domain/audit），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/audit"。
// ============================================================
/* @public */ export {
  TRACE_MODEL_SCHEMA_VERSION,
  extractFilePathFromArgs,
  classifyFileOp,
  dshSessionsRoot,
  parseDshSession,
  loadDshSessions,
  TRACE_CACHE_SCHEMA_VERSION,
  traceCachePath,
  loadDshSessionsCached,
  collectTraceWriteSet,
  collectTraceReadSet,
  reconcileTraces,
  buildModelLayerTrace,
} from '../trace-reconcile';
/* @public */ export type {
  TraceEventType,
  FileOpKind,
  TraceEvent,
  TraceModelExport,
  DshRawEvent,
  DecompressFn,
  ReconcileVerdict,
  ReconcileDiscrepancy,
  ReconcileReport,
  ReconcileInput,
  ModelLayerTraceLink,
} from '../trace-reconcile';
/* @public */ export {
  checkConflict,
  mergeFederationResults,
  pickWinner,
} from '../federation';
/* @public */ export type {
  InspectorConfig,
  InspectorResult,
  KnowledgeQueryResult,
  FederationResult,
  MergedKnowledge,
} from '../federation';
/* @public */ export { runDoctor } from '../doctor';
/* @public */ export type { DoctorReport } from '../doctor';
/* @public */ export { runDoctorRefresh } from '../doctor';
/* @public */ export type { DoctorRefreshResult } from '../doctor';
/* @public */ export { getHistoryFilePath, getHistoryAnchorFilePath, getDecisionLogPath, getEnvFingerprint, getHmacKey, checkHistoryChainDetailed, stableStringify, validateHmacKey, archiveHistoryHead } from '../audit-history';
/* @public */ export type { ArchiveHistoryHeadResult } from '../audit-history';
/* @public */ export { verifyEvidence } from '../verify-evidence';
/* @public */ export { Verifier } from '../verify/verifier';
/* @public */ export { runQuickChecks, runWorkBuddyChecks, runAllChecks } from '../verify/checks';
/* @public */ export { HOME, resolveSofagentData } from '../verify/utils';
/* @public */ export type {
  CheckStatus,
  CheckItem,
  VerifyResult,
  Args,
} from '../verify/types';
