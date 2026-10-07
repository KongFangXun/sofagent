// ============================================================
// domain/deliver.ts · 交付与保留域（报告 / 保留策略 / 交付包 / ZIP 打包）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/train/domain/deliver），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/deliver"。
// ============================================================
/* @public */ export {
  computeQuantification,
  generateTrainReport,
  trainReportsDir,
  trainReportPaths,
} from '../train-report';
/* @public */ export type {
  QuantificationMetrics,
  QuantifyInput,
  TrainReportInput,
  TrainReportResult,
  TrainReportJson,
} from '../train-report';
/* @public */ export {
  DEFAULT_RETENTION_CONFIG,
  retentionConfigPath,
  loadRetentionConfig,
  saveRetentionConfig,
  retentionMarkersPath,
  markRollbackPoint,
  readRetentionMarkers,
  queryRetentionDecision,
  trainArchiveDir,
  archiveExpired,
  purgeExpiredArchives,
  checkDiskPressure,
} from '../retention-policy';
/* @public */ export type {
  RetentionConfig,
  RollbackPointRef,
  RetentionMarker,
  MarkRollbackPointInput,
  RetentionItem,
  RetentionDecision,
  ArchiveReport,
  PurgeReport,
  DiskPressureReport,
} from '../retention-policy';
/* @public */ export {
  TRAIN_DELIVERABLE_GENERATOR_VERSION,
  deliverablesDir,
  renderOpsManual,
  generateTrainDeliverable,
  verifyTrainDeliverable,
  TrainDeliverableError,
} from '../train-deliverable';
/* @public */ export type {
  DeliverableFileEntry,
  DeliverableManifestBody,
  DeliverableManifest,
  GenerateTrainDeliverableInput,
  DeliverableResult,
  DeliverableEnvCheck,
  DeliverableVerifyReport,
} from '../train-deliverable';
/* @public */ export { buildZip, crc32 } from '../zip-writer';
/* @public */ export type { ZipEntryInput, BuildZipOptions } from '../zip-writer';
