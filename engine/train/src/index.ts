// ============================================================
// @sofagent/train · src/index.ts
// ============================================================
// train 是独立包，本 barrel 是 train 域全部 @public 导出的**唯一出口**
// （101 个 export 块 / 562 个符号）。
// 依赖方向单向：train → @sofagent/orchestrator（只经窄入口
// `./model-registry` `./weights-manifest` `./fde-compose` `./fde-quantify-core`
// `./benchmark` `./benchmark-eval` `./sandbox-network-gateway`）；
// orchestrator **不反向依赖** train，故无包级循环。
//
// 仓外消费者迁移：
//   import { createTrainJob } from '@sofagent/orchestrator';   ← 移除
//   import { createTrainJob } from '@sofagent/train';          ← 本包
//
// 公开面完整性：本 barrel 覆盖 train 域全部 @public 符号；29 符号窄入口
// 为本集合的子集（实测 29 ⊆ 562），无遗漏。
// ============================================================

/* @public */ export {
  TrainBudgetSchema,
  TrainJobSchema,
  validateTrainJob,
  buildTrainSpawnArgs,
  parseTrainEvent,
  parseTrainEventStream,
  createSignalController,
} from './train-protocol';
/* @public */ export type {
  TrainBudget,
  TrainJob,
  TrainJobValidation,
  TrainEvent,
  TrainEventParseResult,
  SignalAction,
  SignalController,
  SignalControllerOptions,
} from './train-protocol';
/* @public */ export {
  checkBudget,
  createTrainBudgetMonitor,
  buildBudgetReport,
  trainJobsPath,
  loadTrainJobs,
  saveTrainJobs,
  upsertTrainJob,
  findTrainJob,
  emitBudgetExceededAudit,
} from './train-budget';
/* @public */ export type {
  TrainUsage,
  BudgetViolation,
  BudgetCheckResult,
  BudgetPause,
  BudgetHumanDecision,
  TrainBudgetMonitor,
  TrainBudgetReport,
  TrainJobState,
} from './train-budget';
/* @public */ export {
  TRAIN_JOB_STATUSES,
  TRAIN_JOB_TRANSITIONS,
  canTransition,
  isTerminalStatus,
  trainJobDir,
  trainJobFilePaths,
  generateTrainJobId,
  loadTrainJobRecord,
  saveTrainJobRecord,
  listTrainJobRecords,
  createTrainJob,
  applyTrainJobTransition,
  transitionTrainJob,
  appendTrainEventLine,
  readTrainEvents,
  // v1.4.3 第一章：受守卫查询（MCP train_status/train_list 消费——企业隔离面）
  getJobGuarded,
  readTrainEventsGuarded,
  listJobsGuarded,
} from './train-job';
/* @public */ export type {
  TrainJobStatus,
  TrainJobCheckpoint,
  TrainJobRecord,
  CreateTrainJobInput,
  CreateTrainJobResult,
  TrainJobTransitionPatch,
} from './train-job';
/* @public */ export {
  createTrainScheduler,
  getTrainJobRecord,
  getTrainProgress,
} from './train-scheduler';
/* @public */ export type {
  RegisterHeartbeat,
  SpawnFn,
  TrainSchedulerOptions,
  SubmitTrainJobInput,
  SubmitTrainJobResult,
  TrainRunHandle,
  TrainMonitorSnapshot,
  CancelTrainJobResult,
  ResumeTrainJobResult,
  ResumeTrainJobOutcome,
} from './train-scheduler';
/* @public */ export { createLocalSpawnExecutor } from './train-executor';
/* @public */ export type {
  TrainExecutor,
  TrainExecutorHooks,
  SpawnFn as ExecutorSpawnFn,
  ChildProcess as TrainChildProcess,
} from './train-executor';
/* @public */ export {
  createGpuQueue,
  estimateTrainVramMiB,
} from './gpu-queue';
/* @public */ export type {
  GpuQueueEntry,
  GpuRunningEntry,
  GpuQueueSnapshot,
  GpuSlotRelease,
  GpuQueueOptions,
  GpuQueue,
} from './gpu-queue';
/* @public */ export {
  buildTrainEventMessage,
  extractPayloadFromRecord,
  pushTrainEvent,
} from './train-webhook';
/* @public */ export type {
  TrainWebhookPlatform,
  TrainEventType,
  TrainWebhookTarget,
  TrainEventPayload,
  PushFn,
} from './train-webhook';
/* @public */ export {
  trainStatusSinkPath,
  trainHealthSinkPath,
  buildTrainStatusBoard,
  buildTrainHealthReport,
  flushTrainDashboard,
} from './dashboard-sink';
/* @public */ export type {
  TrainStatusEntry,
  TrainStatusBoard,
  FailureReasonEntry,
  TrainHealthReport,
} from './dashboard-sink';
/* @public */ export {
  createProcessGuard,
  snapshotGpuMemory,
  killProcessGroup,
  abnormalReclaim,
  cleanupTmpFiles,
  emitTrainAbnormalExit,
  detectTrainOrphans,
} from './process-guard';
/* @public */ export type {
  ProcessGuard,
  ProcessGuardOptions,
  KillFn,
  ExecFn,
  NowFn,
  StalledProcess,
  GpuMemorySnapshot,
  ReclaimTarget,
  ReclaimStep,
  ReclaimResult,
  ReclaimOptions,
  ProcessInfo,
  OrphanProcess,
  OrphanDetectOptions,
} from './process-guard';
/* @public */ export {
  runCrashRecoveryScan,
  appendEngineCrashLog,
  readEngineCrashLog,
  engineCrashLogPath,
  applyRecoveryDecision,
  TRAIN_RECOVERY_DECISIONS,
  checkpointManifestPath,
  loadCheckpointManifest,
  recordCheckpointEntry,
} from './crash-recovery';
/* @public */ export type {
  ProbeFn,
  CrashRecoveryFinding,
  CrashRecoveryScanResult,
  TrainRecoveryDecision,
  RecoveryDecisionResult,
  EngineCrashLogEntry,
  CheckpointManifest,
  CheckpointManifestEntry,
} from './crash-recovery';
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
} from './train-audit';
/* @public */ export type {
  TrainAuditEventType,
  TrainAuditEntry,
  EmitTrainAuditInput,
  TrainAuditChainStatus,
  TrainAuditChainResult,
  TrainRollbackResult,
} from './train-audit';
/* @public */ export {
  EnvSnapshotSchema,
  TrainFingerprintBodySchema,
  TrainFingerprintSchema,
  computeDatasetHash,
  resolveDatasetVersion,
  trainFingerprintPath,
  freezeTrainFingerprint,
  loadTrainFingerprint,
  verifyTrainFingerprint,
  reproduceCheck,
  assertDatasetVersionLocked,
  buildDatasetLockEntry,
} from './train-fingerprint';
/* @public */ export type {
  EnvSnapshot,
  TrainFingerprintBody,
  TrainFingerprint,
  FreezeTrainFingerprintInput,
  TrainFingerprintVerifyStatus,
  TrainFingerprintVerifyResult,
  ReproduceContext,
  FingerprintDiff,
  ReproduceCheckResult,
  DatasetVersionLockResult,
} from './train-fingerprint';
/* @public */ export {
  ArtifactFileEntrySchema,
  ArtifactManifestBodySchema,
  ArtifactManifestSchema,
  hashArtifactFile,
  artifactManifestPath,
  signArtifacts,
  loadArtifactManifest,
  ArtifactSigningError,
  ArtifactSigningWriteError,
} from './artifact-signing';
/* @public */ export type {
  ArtifactFileEntry,
  ArtifactManifestBody,
  ArtifactManifest,
} from './artifact-signing';
/* @public */ export {
  verifyArtifacts,
  verifyManifestIntegrity,
} from './artifact-verify';
/* @public */ export type {
  ManifestIntegrity,
  ArtifactFileCheck,
  ArtifactVerifyReport,
} from './artifact-verify';
/* @public */ export {
  registerTrainArtifact,
} from './artifact-register';
/* @public */ export type {
  RegisterTrainArtifactInput,
  ArtifactRegisterResult,
  ArtifactRegisterAction,
  MountSuggestion,
} from './artifact-register';
/* @public */ export {
  submitCompareJobs,
  buildCompareReport,
} from './train-compare';
/* @public */ export type {
  CompareBaseSpec,
  TrainCompareInput,
  CompareBaseResult,
  RoiRankEntry,
  TrainCompareReport,
  TrainCompareDeps,
  BuildCompareReportInput,
} from './train-compare';
/* @public */ export {
  parseCudaVersion,
  parseGpuQueryCsv,
  parseMetalInfo,
  detectCudaGpu,
  detectMetalGpu,
  defaultMlxInstallDir,
  prepareTrainEnv,
  DEFAULT_CUDA_FRAMEWORK,
  DEFAULT_MLX_FRAMEWORK,
} from './train-env';
/* @public */ export type {
  ExecResult,
  ExecFn as TrainEnvExecFn,
  TrainEnvDeps,
  GpuInfo,
  TrainEnvReport,
} from './train-env';
/* @public */ export {
  checkEnterpriseAccess,
  assertEnterpriseAccess,
  isSafePathSegment,
  assertSafePathSegment,
  isPathInside,
  resolveEnterpriseDir,
  EnterpriseAccessDeniedError,
} from './isolation-guard';
/* @public */ export type {
  EnterpriseAccessErrorCode,
  EnterpriseAccessError,
  EnterpriseAccessDecision,
  GuardedRead,
} from './isolation-guard';
/* @public */ export {
  wipeFile,
  wipeDirectoryContents,
  cleanupEnterpriseTrainData,
} from './cleanup';
/* @public */ export type {
  FileCleanupResult,
  SkippedItem,
  DirObfuscation,
  CleanupReport,
  CleanupOptions,
} from './cleanup';
/* @public */ export {
  validateTrainPath,
  TrainPathSchema,
  containsShellMetachars,
  sanitizeHyperparamsForSpawn,
  isCredentialKey,
  maskCredentials,
  runSandboxSelfCheck,
} from './security-baseline';
/* @public */ export type {
  TrainPathRejectionCode,
  TrainPathValidation,
  SanitizedValue,
  HyperparamsSanitizeResult,
} from './security-baseline';
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
} from './data-ingest';
/* @public */ export type {
  CellValue,
  IngestRecord,
  IngestOptions,
  IngestResult,
} from './data-ingest';
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
} from './db-source';
/* @public */ export type {
  DbQueryResult,
  QueryFn,
  ApiFetchResult,
  FetchFn,
  DbFlavor,
  DbIngestResult,
  PullFromDbInput,
  PullFromApiInput,
} from './db-source';
/* @public */ export {
  inferColumnMapping,
  sanitizeCell,
  defaultSampleSanitize,
  buildDataset,
  buildAndPersistDataset,
  datasetDir,
  generateDatasetId,
} from './dataset-builder';
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
} from './dataset-builder';
/* @public */ export {
  datasetVersionsPath,
  recordDatasetVersion,
  readDatasetVersions,
  listDatasetVersions,
  getDatasetVersion,
  diffDatasetVersions,
  reviewDatasetVersion,
} from './dataset-version';
/* @public */ export type {
  DatasetVersionRecord,
  RecordDatasetVersionInput,
  DatasetVersionDiff,
  ReviewDatasetVersionInput,
  ReviewDatasetVersionResult,
  DatasetReviewStatus,
} from './dataset-version';
/* @public */ export {
  requiredFieldsOf,
  computeLabelDistribution,
  validateDataset,
} from './dataset-validator';
/* @public */ export type {
  DatasetValidatorOptions,
  DatasetViolationCode,
  DatasetViolation,
  DatasetWarning,
  DatasetValidationResult,
} from './dataset-validator';
/* @public */ export {
  DEFAULT_EVAL_THRESHOLDS,
  computeScoreStats,
  decideFromScores,
  runTrainEval,
  compareEvalReports,
} from './train-eval-loop';
/* @public */ export type {
  EvalThresholds,
  EvalDecision,
  TrainEvalReport,
  TrainEvalLoopDeps,
  RunTrainEvalInput,
  RunTrainEvalResult,
  EvalScoreStats,
  EvalComparison,
} from './train-eval-loop';
/* @public */ export {
  createTrainServeManager,
  buildServeCommand,
  serveEndpoint,
  serveStatePath,
  computeServeBackoff,
  linkSwitchToServe,
} from './train-serve';
/* @public */ export type {
  ServeBackend,
  ServeOp,
  ServeTarget,
  ServeStatus,
  TrainServeResult,
  TrainServeOptions,
  ServeSpawnFn,
  HealthProbeFn,
  SleepFn,
  SwitchServeLinkResult,
} from './train-serve';
/* @public */ export {
  scanDatasetCompliance,
  assertComplianceGate,
  scanAndGate,
  markProvenance,
  ComplianceGateError,
} from './train-compliance';
/* @public */ export type {
  DataProvenance as TrainDataProvenance,
  ComplianceSeverity,
  ComplianceAction,
  ComplianceFindingKind,
  ComplianceFinding,
  ComplianceReport,
  ScanComplianceInput,
} from './train-compliance';
/* @public */ export { stampComplianceOnVersion } from './dataset-version';
/* @public */ export type { ComplianceStamp, DataProvenance as DatasetProvenance } from './dataset-version';
/* @public */ export {
  DEFAULT_TRIGGER_POLICY,
  collectFlywheelSamples,
  flywheelToIngestRecords,
  shouldTrigger,
  runContinuousTraining,
  continuousStatePath,
} from './train-continuous';
/* @public */ export type {
  ContinuousTrigger,
  TriggerPolicy,
  FlywheelSnapshot,
  TriggerDecision,
  ContinuousRunResult,
  ContinuousDeps,
  RunContinuousInput,
} from './train-continuous';
/* @public */ export {
  makeDefaultExecFn,
} from './train-env';
/* @public */ export {
  TRAIN_ENV_MANIFEST_FILE,
  trainEnvManifestPath,
  trainDoctor,
  DEFAULT_BASE_MODEL_CANDIDATES,
} from './env-manager';
/* @public */ export type {
  TrainEnvManifest,
  EnvCheckStep,
  EnvManagerDeps,
  TrainDoctorReport,
  ModelCacheEntry,
} from './env-manager';
/* @public */ export {
  // v1.4.3 第八章：训练环境反作弊基线（reward hacking 四形态双防线）
  DEFAULT_NETWORK_ALLOWLIST,
  DEFAULT_ANTICHEAT_CONFIG,
  loadAnticheatConfig,
  stripDatasetGitOnMount,
  buildGitDisabledEnv,
  createTrainNetworkGate,
  checkAnticheatBaseline,
} from './env-manager';
/* @public */ export type {
  AnticheatConfig,
  DatasetMountSource,
  AnticheatCheckResult,
} from './env-manager';
/* @public */ export {
  analyzeTrainNeed,
  deriveTrainScenario,
  findInterviewNode,
  pickDefaultTemplate,
  saveTrainAnalyzeReport,
  trainAnalyzeReportPath,
} from './train-analyze';
/* @public */ export type {
  TrainGoalDerivation,
  TrainAnalyzeResult,
  TrainAnalyzeOptions,
} from './train-analyze';
/* @public */ export {
  TRAIN_SCENARIO_TEMPLATES,
  SCENARIO_MATCH_HINTS,
  findTrainTemplate,
  listTrainTemplates,
  loadExternalRecipes,
  instantiateTrainTemplate,
  validateMoeTargetModules,
  MOE_REQUIRED_EXPERT_MODULES,
} from './train-templates';
/* @public */ export type {
  TrainScenario,
  TrainMethod,
  TrainScenarioTemplate,
  InstantiateTrainTemplateInput,
  QloraTemplateInstance,
  PlainTemplateInstance,
  TrainTemplateInstance,
  MoeValidationResult,
  MoeValidationError,
  MoeValidationOk,
  LoadExternalRecipesResult,
} from './train-templates';
/* @public */ export {
  instantiateRlTemplate,
  findRlTemplate,
  listRlTemplates,
  registerRlRecipes,
  SCALE_ADVANTAGE_NORMALIZATION,
  SCALE_CISPO_CLIP_EPS,
  SCALE_SKIP_ZERO_VARIANCE,
  SCALE_WARMUP_RATIO,
} from './rl-templates';
/* @public */ export type {
  RlTemplate,
  RlRecipeId,
  RlTemplateInstance,
  RlTemplateInstantiateInput,
} from './rl-templates';
/* @public */ export {
  buildQloraTemplate,
  DENSE_TARGET_MODULES,
  MOE_TARGET_MODULES,
} from './qlora-template';
/* @public */ export type {
  QloraTemplateInput,
  QloraOumiConfig,
} from './qlora-template';
/* @public */ export {
  diagnoseTrainFailure,
  classifyTrainFailure,
  saveTrainDiagnoseReport,
  trainDiagnoseReportPath,
  FAILURE_CATEGORIES,
  FAILURE_PRESCRIPTIONS,
} from './train-diagnose';
/* @public */ export type {
  TrainFailureCategory,
  FailureCategoryDef,
  FailurePrescription,
  DiagnoseContext,
  TrainDiagnoseReport,
} from './train-diagnose';
/* @public */ export {
  createTrainSandbox,
  createTrainPathGuard,
  trainSandboxOutputDir,
} from './train-sandbox';
/* @public */ export type {
  TrainSandboxOptions,
  TrainPathGuard,
  PathAccess,
  TrainSandbox,
  TrainSandboxProfile,
} from './train-sandbox';
/* @public */ export {
  estimateVram,
  runDryrun,
} from './train-dryrun';
/* @public */ export type {
  VramEstimateInput,
  VramEstimate,
  DryrunCheck,
  DryrunResult,
  DryrunInput,
} from './train-dryrun';
/* @public */ export {
  sigmoid,
  fitSigmoid,
  extrapolate,
  suggestNextPilotCompute,
} from './scale-curve';
/* @public */ export type {
  ScaleCurvePoint,
  SigmoidParams,
  FitQuality,
  FitResult,
  Extrapolation,
} from './scale-curve';
/* @public */ export {
  computeQuantification,
  generateTrainReport,
  trainReportsDir,
  trainReportPaths,
} from './train-report';
/* @public */ export type {
  QuantificationMetrics,
  QuantifyInput,
  TrainReportInput,
  TrainReportResult,
  TrainReportJson,
} from './train-report';
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
} from './retention-policy';
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
} from './retention-policy';
/* @public */ export {
  TRAIN_DELIVERABLE_GENERATOR_VERSION,
  deliverablesDir,
  renderOpsManual,
  generateTrainDeliverable,
  verifyTrainDeliverable,
  TrainDeliverableError,
} from './train-deliverable';
/* @public */ export type {
  DeliverableFileEntry,
  DeliverableManifestBody,
  DeliverableManifest,
  GenerateTrainDeliverableInput,
  DeliverableResult,
  DeliverableEnvCheck,
  DeliverableVerifyReport,
} from './train-deliverable';
/* @public */ export { buildZip, crc32 } from './zip-writer';
/* @public */ export type { ZipEntryInput, BuildZipOptions } from './zip-writer';
/* @public */ export {
  buildMultiGpuLaunch,
  aggregateMultiGpuProgress,
} from './train-multi';
/* @public */ export type {
  MultiGpuLaunch,
  RankProgress,
  MultiGpuProgressSummary,
} from './train-multi';
/* @public */ export {
  createCloudRegistry,
} from './cloud-registry';
/* @public */ export type {
  CloudVmRecord,
  CloudVmStatus,
  CloudRegistrySnapshot,
  CloudRegistry,
} from './cloud-registry';
/* @public */ export {
  buildCloudSpawnCommand,
  buildCloudUploadCommand,
  buildCloudCleanupCommand,
  buildCloudStopCommand,
  isHeartbeatStale,
  estimateCloudCostUsd,
  isOverBudget,
} from './train-cloud';
/* @public */ export type {
  CloudCommand,
  HeartbeatVerdict,
} from './train-cloud';
/* @public */ export { channelAsExecutor } from './train-channel';
/* @public */ export type {
  TrainChannel,
  ChannelJobSpec,
  ChannelSubmitResult,
  ChannelStatusResult,
  ChannelStatus,
  ChannelEvent,
  ChannelArtifact,
} from './train-channel';
/* @public */ export {
  classifyDataForCloud,
  classifyBatchForCloud,
  generateConfidentialityRef,
  applyPreClassification,
  SENSITIVE_PATTERNS,
} from './sorting-gate';
/* @public */ export type {
  SortingClass,
  SortingDecision,
  SensitivePattern,
  PreClassifiedLevel,
} from './sorting-gate';
/* @public */ export {
  DataPushSchema,
  validateDataPush,
  gateDataPush,
} from './data-push';
/* @public */ export type {
  DataPushPayload,
  DataPushValidation,
  DataPushGateResult,
  ComplianceCheck,
} from './data-push';
// T7 session 承接与 router 伴生（v1.4.9 第七章）
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
} from './session-ingest';
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
} from './session-ingest';
/* @public */ export { RouterExporter, exporterProtocolSpec } from './router-exporter';
/* @public */ export type { ExporterTransport, RouterExporterConfig } from './router-exporter';
/* @public */ export {
  buildDistillPairs,
  distillPairsToRecords,
} from './distill-pairs';
/* @public */ export type {
  DistillResponse,
  DistillPairOptions,
  DistillPair,
  DistillPairResult,
  DistillIngestRecord,
} from './distill-pairs';
// T9 权重灰度发布 AB（v1.4.9 第九章）
// v1.5.0 TASK-32 更名避歧：routeRequest → canaryRouteRequest——orchestrator
// 另有同名 routeRequest（语义路由），裸符号 grep 接线断言会假阳性
/* @public */ export {
  canaryRouteRequest,
  emptyArmMetrics,
  accumulateMetrics,
  deriveRates,
  judgeDeterioration,
  runCanaryCheck,
  DEFAULT_DETERIORATION_THRESHOLDS,
} from './weight-canary';
/* @public */ export type {
  CanaryConfig,
  RouteVerdict,
  ArmMetrics,
  DeteriorationThresholds,
  DeteriorationVerdict,
  RollbackWeightsFn,
  RollbackAuditPayload,
  RollbackOutcome,
} from './weight-canary';
