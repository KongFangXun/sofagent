// ============================================================
// domain/data.ts · 数据域（摄取 / 数据源 / 数据集构建与版本 / 校验 / 评测 / 会话 / 蒸馏 / 分级 / 推送）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/train/domain/data），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/data"。
// ============================================================
/* @public */ export {
  DEFAULT_EMPTY_MARKERS,
  parseCsv,
  ingestCsv,
  ingestExcel,
  ingestJson,
  ingestText,
  ingestFile,
  inferCellType,
  normalizeValue,
  unzipEntries,
  parseSharedStrings,
  parseSheetXml,
  excelColumnToIndex,
} from '../data-ingest';
/* @public */ export type {
  CellValue,
  IngestRecord,
  IngestOptions,
  IngestResult,
} from '../data-ingest';
/* @public */ export {
  isReadonlySql,
  inferColumns,
  parseDbFlavor,
  makeDefaultQueryFn,
  pullFromDb,
  pullFromApi,
  extractItems,
  getPath,
  defaultFetchFn,
} from '../db-source';
/* @public */ export type {
  DbQueryResult,
  QueryFn,
  ApiFetchResult,
  FetchFn,
  DbFlavor,
  DbIngestResult,
  PullFromDbInput,
  PullFromApiInput,
} from '../db-source';
/* @public */ export {
  inferColumnMapping,
  sanitizeCell,
  defaultSampleSanitize,
  buildDataset,
  buildAndPersistDataset,
  datasetDir,
  generateDatasetId,
} from '../dataset-builder';
/* @public */ export type {
  DatasetAlgorithm,
  SftSample,
  ChatMessage,
  ChatSample,
  DpoSample,
  RlSample,
  DatasetSample,
  DatasetLine,
  ColumnMapping,
  BuildDatasetOptions,
  BuildDatasetResult,
  BuildAndPersistInput,
  BuildAndPersistResult,
  SampleSanitizeFn,
} from '../dataset-builder';
/* @public */ export {
  datasetVersionsPath,
  recordDatasetVersion,
  readDatasetVersions,
  listDatasetVersions,
  getDatasetVersion,
  diffDatasetVersions,
  reviewDatasetVersion,
} from '../dataset-version';
/* @public */ export type {
  DatasetVersionRecord,
  RecordDatasetVersionInput,
  DatasetVersionDiff,
  ReviewDatasetVersionInput,
  ReviewDatasetVersionResult,
  DatasetReviewStatus,
} from '../dataset-version';
/* @public */ export {
  requiredFieldsOf,
  computeLabelDistribution,
  validateDataset,
} from '../dataset-validator';
/* @public */ export type {
  DatasetValidatorOptions,
  DatasetViolationCode,
  DatasetViolation,
  DatasetWarning,
  DatasetValidationResult,
} from '../dataset-validator';
/* @public */ export {
  DEFAULT_EVAL_THRESHOLDS,
  computeScoreStats,
  decideFromScores,
  runTrainEval,
  compareEvalReports,
} from '../train-eval-loop';
/* @public */ export type {
  EvalThresholds,
  EvalDecision,
  TrainEvalReport,
  TrainEvalLoopDeps,
  RunTrainEvalInput,
  RunTrainEvalResult,
  EvalScoreStats,
  EvalComparison,
} from '../train-eval-loop';
/* @public */ export { stampComplianceOnVersion } from '../dataset-version';
/* @public */ export type { ComplianceStamp, DataProvenance as DatasetProvenance } from '../dataset-version';
/* @public */ export {
  classifyDataForCloud,
  classifyBatchForCloud,
  generateConfidentialityRef,
  applyPreClassification,
  SENSITIVE_PATTERNS,
} from '../sorting-gate';
/* @public */ export type {
  SortingClass,
  SortingDecision,
  SensitivePattern,
  PreClassifiedLevel,
} from '../sorting-gate';
/* @public */ export {
  DataPushSchema,
  validateDataPush,
  gateDataPush,
} from '../data-push';
/* @public */ export type {
  DataPushPayload,
  DataPushValidation,
  DataPushGateResult,
  ComplianceCheck,
} from '../data-push';
/* @public */ export {
  RouterSessionSchema,
  MessageSchema,
  UsageSchema,
  RouteDecisionSchema,
  SessionScopeSchema,
  validateRouterSession,
  windowMessages,
  mapRoles,
  decideContinuation,
  buildHandoffSummary,
  expandSessionToRecords,
  usageToCostEntry,
  aggregateByKeyUsage,
  detectKeyAnomalies,
  formatKeyDisposition,
  DEFAULT_EXPAND_OPTIONS,
  DEFAULT_KEY_ANOMALY_THRESHOLDS,
} from '../session-ingest';
/* @public */ export type {
  RouterSessionPayload,
  SessionMessage,
  SessionUsage,
  RouteDecision,
  SessionScope,
  SessionValidation,
  ExpandOptions,
  ContinuationDecision,
  HandoffSummary,
  SessionIngestRecord,
  SessionExpandResult,
  CostLedgerEntry,
  KeyAnomalyThresholds,
  KeyUsageAggregate,
  KeyAnomalyFinding,
} from '../session-ingest';
/* @public */ export {
  buildDistillPairs,
  distillPairsToRecords,
} from '../distill-pairs';
/* @public */ export type {
  DistillResponse,
  DistillPairOptions,
  DistillPair,
  DistillPairResult,
  DistillIngestRecord,
} from '../distill-pairs';
/* @public */ export {
  ingestInstinctSource,
  mergeForDatasetBuild,
  extractLineageAnchor,
  INSTINCT_SOURCE_COLUMNS,
} from '../instinct-source';
/* @public */ export type {
  InstinctSourceRecord,
  InstinctIngestResult,
  InstinctDatasetAnchor,
} from '../instinct-source';
