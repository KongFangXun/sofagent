// ============================================================
// trace-reconcile/index.ts · barrel（v1.5.1 章八）
// ============================================================

export {
  TRACE_MODEL_SCHEMA_VERSION,
  extractFilePathFromArgs,
  classifyFileOp,
} from './trace-model';
export type {
  TraceEventType,
  FileOpKind,
  TraceEvent,
  TraceModelExport,
  DshRawEvent,
} from './trace-model';

export {
  dshSessionsRoot,
  parseDshSession,
  loadDshSessions,
} from './dsh-adapter';
export type { DecompressFn } from './dsh-adapter';

export {
  TRACE_CACHE_SCHEMA_VERSION,
  traceCachePath,
  loadDshSessionsCached,
} from './trace-cache';

export {
  collectTraceWriteSet,
  collectTraceReadSet,
  reconcileTraces,
  buildModelLayerTrace,
} from './reconcile';
export type {
  ReconcileVerdict,
  ReconcileDiscrepancy,
  ReconcileReport,
  ReconcileInput,
  ModelLayerTraceLink,
} from './reconcile';
