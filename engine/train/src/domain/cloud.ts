// ============================================================
// domain/cloud.ts · 云端与通道域（云注册 / 云命令 / 通道 / 持续训练 / 合规 / 对比 / 服务 / 导出 / 灰度）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/train/domain/cloud），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/cloud"。
// ============================================================
/* @public */ export {
  submitCompareJobs,
  buildCompareReport,
} from '../train-compare';
/* @public */ export type {
  CompareBaseSpec,
  TrainCompareInput,
  CompareBaseResult,
  RoiRankEntry,
  TrainCompareReport,
  TrainCompareDeps,
  BuildCompareReportInput,
} from '../train-compare';
/* @public */ export {
  createTrainServeManager,
  buildServeCommand,
  serveEndpoint,
  serveStatePath,
  computeServeBackoff,
  linkSwitchToServe,
} from '../train-serve';
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
} from '../train-serve';
/* @public */ export {
  scanDatasetCompliance,
  assertComplianceGate,
  scanAndGate,
  markProvenance,
  ComplianceGateError,
} from '../train-compliance';
/* @public */ export type {
  DataProvenance as TrainDataProvenance,
  ComplianceSeverity,
  ComplianceAction,
  ComplianceFindingKind,
  ComplianceFinding,
  ComplianceReport,
  ScanComplianceInput,
} from '../train-compliance';
/* @public */ export {
  DEFAULT_TRIGGER_POLICY,
  collectFlywheelSamples,
  flywheelToIngestRecords,
  shouldTrigger,
  runContinuousTraining,
  continuousStatePath,
} from '../train-continuous';
/* @public */ export type {
  ContinuousTrigger,
  TriggerPolicy,
  FlywheelSnapshot,
  TriggerDecision,
  ContinuousRunResult,
  ContinuousDeps,
  RunContinuousInput,
} from '../train-continuous';
/* @public */ export {
  createCloudRegistry,
} from '../cloud-registry';
/* @public */ export type {
  CloudVmRecord,
  CloudVmStatus,
  CloudRegistrySnapshot,
  CloudRegistry,
} from '../cloud-registry';
/* @public */ export {
  buildCloudSpawnCommand,
  buildCloudUploadCommand,
  buildCloudCleanupCommand,
  buildCloudStopCommand,
  isHeartbeatStale,
  estimateCloudCostUsd,
  isOverBudget,
} from '../train-cloud';
/* @public */ export type {
  CloudCommand,
  HeartbeatVerdict,
} from '../train-cloud';
/* @public */ export { channelAsExecutor } from '../train-channel';
/* @public */ export type {
  TrainChannel,
  ChannelJobSpec,
  ChannelSubmitResult,
  ChannelStatusResult,
  ChannelStatus,
  ChannelEvent,
  ChannelArtifact,
} from '../train-channel';
/* @public */ export { RouterExporter, exporterProtocolSpec } from '../router-exporter';
/* @public */ export type { ExporterTransport, RouterExporterConfig } from '../router-exporter';
/* @public */ export {
  canaryRouteRequest,
  emptyArmMetrics,
  accumulateMetrics,
  deriveRates,
  judgeDeterioration,
  runCanaryCheck,
  DEFAULT_DETERIORATION_THRESHOLDS,
} from '../weight-canary';
/* @public */ export type {
  CanaryConfig,
  RouteVerdict,
  ArmMetrics,
  DeteriorationThresholds,
  DeteriorationVerdict,
  RollbackWeightsFn,
  RollbackAuditPayload,
  RollbackOutcome,
} from '../weight-canary';
