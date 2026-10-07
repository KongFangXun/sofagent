// ============================================================
// domain/health.ts · 可靠性与健康域（健康端点 / 健康自检 / 推送重试 / outbox / 疲劳度 / FDE 陪跑）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/health），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/health"。
// ============================================================
/* @public */ export {
  buildHealthVerdict,
  collectHealthChecks,
  startHealthEndpoint,
} from '../health-endpoint';
/* @public */ export type {
  HealthVerdict,
  CheckStatus,
  HealthCheckItem,
  HealthSnapshot,
  HealthEndpointOptions,
  HealthEndpointHandle,
} from '../health-endpoint';
/* @public */ export { withRetry, withRetryBestEffort, computeBackoff } from '../with-retry';
/* @public */ export type { RetryOptions } from '../with-retry';
/* @public */ export {
  writeHealthFile,
  readHealthFile,
  recordDaemonExit,
  checkDaemonHealth,
  resolveHealthFilePath,
} from '../daemon-health';
/* @public */ export type { DaemonHealthFile } from '../daemon-health';
/* @public */ export {
  deleteOutboxFile,
  moveOutboxToFailed,
  cleanupFailedOutbox,
  drainOutbox,
} from '../push-target';
/* @public */ export {
  FatigueTracker,
  computeFatigueScore,
  recommendAction,
  outputSimilarity,
  writeFatigueReport,
  readFatigueReport,
  FAILURE_SATURATION,
  COMPACT_THRESHOLD,
  RESTART_THRESHOLD,
} from '../fatigue';
/* @public */ export type { FatigueSignals, FatigueReport, FatigueAction } from '../fatigue';
/* @public */ export {
  runCompanionDaily,
  getCompanionState,
  generateCompanionReport,
  companionReportPath,
  COMPANION_DAYS,
} from '../companion';
/* @public */ export type { CompanionState, CompanionRunResult, CompanionReportStats } from '../companion';
