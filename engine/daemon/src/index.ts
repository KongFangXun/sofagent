// ── API 分级契约（v1.5.1 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/daemon
 *
 * 守护进程 — 持续审计 / 文件监听 / 自动修复循环
 */

// Cron
/* @public */ export { startCron, loadTrainArchiveCronConfig } from './cron';
/* @public */ export type { CronJob } from './cron';

// v1.4.5 第五章：训练产物归档任务（@weekly 冷存 + 90 天覆写销毁 + 磁盘预警）
/* @public */ export {
  DEFAULT_TRAIN_ARCHIVE_CONFIG,
  loadTrainArchiveConfig,
  runTrainArchiveTask,
} from './tasks/train-archive';
/* @public */ export type { TrainArchiveConfig, TrainArchiveTaskResult } from './tasks/train-archive';

// Scheduler（定时任务 · v1.3.8 交付四：cron 三档糖 @daily/@weekly/@monthly）
/* @public */ export { createScheduler, nextCronTime, expandCronSugar } from './scheduler';
/* @public */ export type { ScheduleType, ScheduledTask, TaskRun, CronSugar } from './scheduler';

// Long Tasks（异步长任务自治 · v1.3.8 交付四：依赖图 + WAL 续跑钩子 + 注册表 + 死循环检测 + backoff）
/* @public */ export {
  createLongTaskScheduler,
  expandScheduleMacro,
  isCronMacro,
  loadLongTaskRegistry,
  saveLongTaskRegistry,
  longTasksRegistryPath,
  readUnfinishedWalEntries,
  trackNoProgress,
  appendLongTaskWarning,
  DEFAULT_MAX_NO_CHANGE_RUNS,
} from './long-tasks';
/* @public */ export type {
  CronMacro,
  LongTaskRunStatus,
  LongTaskRun,
  LongTaskSpec,
  LongTaskRegistry,
  CrashRecoveryEvent,
  LongTaskWarning,
  LongTaskRunner,
  CrashRecoveryCallback,
} from './long-tasks';

// File Watcher
/* @public */ export { startWatching } from './fs-watch';
/* @public */ export type { ChangeCallback, FileWatcher } from './fs-watch';

// Filesystem Audit
/* @public */ export { runFilesystemAudit } from './run-fs-audit';

// Snapshot
/* @public */ export { createPostAuditSnapshot, listAllSnapshots, restoreSnapshot } from './snapshot';
/* @public */ export type { SnapshotInfo } from './snapshot';

// Dream Cycle（v1.1.6 新增：6 阶段流水线替换旧散点周报/经验提取脚本）
/* @public */ export { runDreamCycle, loadLedger, loadState } from './dream-cycle/state-machine';
// v1.4.5 第七章五：RealLLM 真脑迁至 real-provider.ts（MockLLM 降级为测试专用）
/* @public */ export { MockLLM } from './dream-cycle/llm-mock';
/* @public */ export {
  RealLLM,
  createDefaultProvider,
  resolveActiveEndpoint,
} from './dream-cycle/real-provider';
/* @public */ export type { ProviderStatus, ProviderResolution } from './dream-cycle/real-provider';
/* @public */ export {
  validateKnowledgeQuality,
  mockExtractForDiff,
  mockSynthesizeForDiff,
} from './dream-cycle/quality-gate';
/* @public */ export type { QualityGateResult } from './dream-cycle/quality-gate';
/* @public */ export type {
  Stage,
  Ledger,
  AuditEntry,
  Fact,
  Atom,
  Pattern,
  Concept,
  Embedding,
  LLMProvider,
  DreamCycleState,
  DreamCycleResult,
} from './dream-cycle/types';
/* @public */ export { DREAM_CYCLE_STAGES } from './dream-cycle/types';
// v1.4.5 第七章一：持续样本采集（≥7 天采样器——evolution report 数据源）
/* @public */ export {
  SAMPLE_TARGET_DAYS,
  collectDailySample,
  loadCursor,
  readAllSamples,
  summarizeSamples,
  readDailyEvalStats,
  countKnowledgeEntities,
  countCorrectionReflows,
  collectDailyDetails,
  evolutionDir,
  sampleFilePath,
  cursorFilePath,
} from './dream-cycle/continuous-sampler';
/* @public */ export type {
  DailySample,
  SamplerCursor,
  SampleResult,
  CorrectionBackflow,
  LowScoreFeedback,
  RepeatFailure,
  ToolUsageStat,
} from './dream-cycle/continuous-sampler';

// Inspectors
/* @public */ export {
  analyzeAuditHistory,
  checkDoctorHealth,
  checkKnowledgeFreshness,
  checkSkillStaleness,
  accumulateWarnings,
  runHealthReport,
  generateDataSovereigntyDaily,
  generateDataSovereigntyWeekly,
  generateDataSovereigntyMonthly,
  // v1.4.8 深模块条目 2：runInspectors / DEFAULT_INSPECTOR_CONFIG 降 @internal
  //（包内外零运行时消费者——活路径是 runLayeredInspection；内部仍导出供测试）
} from './inspectors';
/* @internal */ export { runInspectors, DEFAULT_INSPECTOR_CONFIG } from './inspectors';
/* @public */ export type { InspectorConfig, InspectorResult, DaemonHealth } from './inspectors';

// v1.2.4 P0：分层巡检（L1/L2/L3）+ L3 新 inspector
/* @public */ export {
  runLayeredInspection,
  runAllLayers,
  getLayerInspectorNames,
  LAYER_SCHEDULE,
} from './inspector-layers';
/* @public */ export type { InspectorLayer, LayeredInspectionResult } from './inspector-layers';
/* @public */ export { runFederationDistillation } from './inspectors/federation-distillation';
/* @public */ export { runFailurePattern, getFailureClusters } from './inspectors/failure-pattern';
/* @public */ export type { FailureCluster } from './inspectors/failure-pattern';
/* @public */ export { runOntologyCoverage } from './inspectors/ontology-coverage';

// v1.2.4 P0b：eval 失败检测（进化能力核心闭环）
/* @public */ export { runEvalFailuresCheck } from './inspectors/eval-failures';

// v1.2.4 P1：evolve 自动触发 inspector
/* @public */ export { runEvolveTrigger } from './inspectors/evolve-trigger';

// v1.2.4 P1b：Dashboard 历史趋势 + 任务统计
/* @public */ export { runDailySnapshot } from './inspectors/daily-snapshot';
/* @public */ export type { DailySnapshot } from './inspectors/daily-snapshot';
/* @public */ export { runTrendAggregator } from './inspectors/trend-aggregator';
/* @public */ export type { WeeklyTrendReport } from './inspectors/trend-aggregator';
/* @public */ export { runTaskStats } from './inspectors/task-stats';
/* @public */ export type { TaskStatsReport } from './inspectors/task-stats';

// v1.2.2 P0：审计报告 webhook 推送
/* @public */ export { pushAuditReport } from './webhook/audit-report-push';

// Workspace 变更摘要（v1.2.3 · 交付五 · checkpoint 联动 AD-6）
/* @public */ export {
  runWorkspaceSummary,
  collectWorkspaceChanges,
  appendWorkspaceChange,
  readWorkspaceChanges,
  readLatestCheckpointId,
  resolveWorkspaceChangesPath,
  WORKSPACE_CHANGES_MAX_ENTRIES,
} from './workspace-summary';
/* @public */ export type { WorkspaceChangeRecord, WorkspaceSummaryOptions } from './workspace-summary';

// USB Federation (v1.1.4)
/* @public */ export { detectSofagentUsb } from './usb-detect';
/* @public */ export type { UsbDetectResult } from './usb-detect';

// Webhook 企业平台推送（v1.2.1 · P0 采购阻塞项）
/* @public */ export { createWebhookPusher } from './webhook/index';
/* @public */ export type {
  WebhookPlatform,
  AuditVerdict,
  WebhookPushResult,
  WebhookPusherOptions,
  WebhookPusher,
} from './webhook/index';

// v1.5.2 章一「订阅推送」：审计事件流对外订阅桥（复用既有 webhook 三态通道）
/* @public */ export {
  attachAuditStreamToBus,
  mapEventToAuditPush,
  pushAuditStreamEvent,
  resolveAuditStreamPlatforms,
} from './webhook/audit-stream-push';
/* @public */ export type { AuditStreamPusherOptions, AuditStreamBusPort } from './webhook/audit-stream-push';

// G9 设备注册 / 发现 / 心跳（v1.4.9 T1+T11+T12）
/* @public */ export {
  isOnline,
  DEVICE_HEARTBEAT_TIMEOUT_MS,
  registerDevice,
  gateDevice,
  listDevices,
  reportHeartbeat,
  scanOfflineDevices,
  enqueueDeviceTask,
  claimDeviceTask,
  reassignOrHold,
  appendDeviceEvent,
  verifyDeviceEventsChain,
  deviceRegistryPath,
  deviceEventsPath,
  deviceTasksPath,
} from './device-registry';
/* @public */ export type {
  DeviceKind,
  DeviceRecord,
  DeviceRegistryFile,
  DeviceTask,
  DeviceTasksFile,
  DeviceEventRecord,
  RegisterResult,
  DeviceGateResult,
  HeartbeatResponse,
  EnqueueResult,
  ClaimResult,
  ReassignResult,
} from './device-registry';

// T10 第三项：执行侧模型清单扫描 + skill 快照类型（v1.4.9 批 4）
/* @public */ export {
  DEFAULT_PROBE_ENDPOINTS,
  PROBE_TIMEOUT_MS,
  scanRegistryModels,
  probeEndpoint,
  scanModelInventory,
} from './model-inventory';
/* @public */ export type {
  AvailableModelEntry,
  RuntimeSkillPackage,
  ModelInventory,
} from './model-inventory';

// G11 数据上行 WAL 暂存 + 断点续传（v1.4.9 T3）
/* @public */ export {
  UPLOAD_WAL_FILE,
  uploadWalPath,
  deriveUploadAesKey,
  enqueueUpload,
  ackUpload,
  failUpload,
  readUploadCursor,
  pendingUploads,
  decryptPendingUpload,
  uploadWalStats,
} from './upload-wal';
/* @public */ export type {
  UploadWalType,
  UploadWalRecord,
  EnqueueUploadResult,
  PendingUpload,
} from './upload-wal';

// /health 三态健康巡检端点（v1.4.9 T1 验收 ⑥）
/* @public */ export {
  buildHealthVerdict,
  collectHealthChecks,
  startHealthEndpoint,
} from './health-endpoint';
/* @public */ export type {
  HealthVerdict,
  CheckStatus,
  HealthCheckItem,
  HealthSnapshot,
  HealthEndpointOptions,
  HealthEndpointHandle,
} from './health-endpoint';

// OpenClaw Federation（联邦查询 · v1.1.8 新增）
/* @public */ export { loadOpenClawChannel, createMemoryChannel, filterOnlinePeers } from './federation/channel';
/* @public */ export type { ChannelMessage, FederationChannel } from './federation/channel';
/* @public */ export {
  registerPeer,
  unregisterPeer,
  listPeers,
  getPeer,
  markPeerAlive,
  markPeerFailure,
  clearPeers,
} from './federation/peers';
/* @public */ export type { PeerState } from './federation/peers';
/* @public */ export {
  broadcastQuery,
  fetchFromPeer,
  encodeFrame,
  decodeFrame,
  validateRemoteResult,
  PEER_QUERY_TIMEOUT_MS,
} from './federation/query-router';
/* @public */ export type { KnowledgeQuery, KnowledgeQueryResult, FederationResult } from './federation/query-router';
/* @public */ export { mergeFederationResults, pickWinner } from './federation/merge';
/* @public */ export type { MergedKnowledge } from './federation/merge';
/* @public */ export { withOfflineFallback } from './federation/offline-fallback';
/* @public */ export type { FederationAuditEntry, AuditWriter } from './federation/offline-fallback';

// v1.3.1 交付 7：跨设备审计轨迹聚合（按 agentId 合并 + HMAC 验签 + trust 裁决）
/* @public */ export {
  mergeAuditTrails,
  buildAuditTrailByAgent,
  verifyAuditEntryHmac,
  auditMergeKey,
  readLocalAuditHistory,
} from './federation/audit-merge';
/* @public */ export type {
  DeviceAuditRecord,
  MergedAuditEntry,
  EntryHmacStatus,
} from './federation/audit-merge';
/* @public */ export { runAuditTrailInspector, aggregateAuditTrails } from './inspectors/audit-trail';
/* @public */ export type { AuditTrailInspectorOptions } from './inspectors/audit-trail';

// v1.2.5 §8.2 daemon 可靠性——推送重试 + 健康自检 + outbox 生命周期
/* @public */ export { withRetry, withRetryBestEffort, computeBackoff } from './with-retry';
/* @public */ export type { RetryOptions } from './with-retry';
/* @public */ export {
  writeHealthFile,
  readHealthFile,
  recordDaemonExit,
  checkDaemonHealth,
  resolveHealthFilePath,
} from './daemon-health';
/* @public */ export type { DaemonHealthFile } from './daemon-health';
/* @public */ export {
  deleteOutboxFile,
  moveOutboxToFailed,
  cleanupFailedOutbox,
  drainOutbox,
} from './push-target';

// v1.3.6 交付⑬：Agent 疲劳度检测（3 信号采集 → 评分 → daemon-health.json）
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
} from './fatigue';
/* @public */ export type { FatigueSignals, FatigueReport, FatigueAction } from './fatigue';

// v1.3.5 交付 5 #1：FDE 陪跑期（部署后前 2 周每日 Refine 巡检）
// v1.5.0 章五：期满总结报告（generateCompanionReport——执行统计+终态分布+介入汇总）
/* @public */ export {
  runCompanionDaily,
  getCompanionState,
  generateCompanionReport,
  companionReportPath,
  COMPANION_DAYS,
} from './companion';
/* @public */ export type { CompanionState, CompanionRunResult, CompanionReportStats } from './companion';

// v1.3.5 交付 5 #4：FDE 节点注册表巡检（fde-registry.yaml cadence 调度）
/* @public */ export { runFdeCompanionDaily } from './inspectors/fde-companion-daily';
/* @public */ export { runFdeRegistryDaily } from './inspectors/fde-registry-daily';
/* @public */ export { loadFDERegistry, highRiskNodes } from './fde-registry-loader';
/* @public */ export type {
  FDECadence,
  FDERisk,
  FDERegistryNode,
  FDERegistryParseResult,
} from './fde-registry-types';

// ── G12 设备 OTA 远程升级 + 任务下发推送（v1.5.1 第四/五章）──
// 设备侧订阅登记面与执行器出口：MCP 侧 device-register.ts 的 registerDeviceSubscriptions()
// 经本导出转调 daemon 的订阅登记表（唯一订阅挂载出口）。
/* @public */ export {
  DEVICE_EVENT_TOPICS,
  DEVICE_OTA_SUBSCRIPTIONS,
  registerDeviceOtaSubscriptions,
  executeDeviceUpgrade,
  resumeSuspendedUpgrades,
  deliverTaskDispatch,
  verifyDeliverySignature,
  computeUpgradeDigest,
  emitDeviceAudit,
  loadUpgradePolicy,
  evaluateUpgradePolicy,
  listSuspendedUpgrades,
  getDeviceVersions,
} from './ota';
// 平台侧签名器——**本版不对外承诺**：任务书章四（第 152 行）「验签判定留主干，
// 本版只出执行侧」，设备端只验签不签名，故 signDelivery 在设备侧生产代码零调用点
// （仅单测与验收探针使用）。仓内经 ota 子路径仍可用（验收探针
// playbook/acceptance-node-probes.js 走的是 engine/daemon/dist/ota/index.js），
// 平台（发布）侧落地时再提回 @public。
/* @internal */ export { signDelivery } from './ota';
// v1.5.1 修复批 F2：设备上线钩子收窄为 @internal（同 signDelivery 口径）——
//   · `onDeviceOnline`：设备上线补投钩子，零生产调用点。收窄理由：**本版不构成对外
//     承诺**——宿主装配（设备进程注册该钩子）不在本版落点、零生产调用点；宿主装配
//     落版时随版本 bump 重升 `@public`（届时接线，或按 SDK-face 债务登记）。
//     仓内经 ota 子路径 `/ota/index.ts` 仍可用，仓内消费与测试导入不受影响。
/* @internal */ export { onDeviceOnline } from './ota';
/* @public */ export type {
  DeviceUpgradePayload,
  DeviceDeployPayload,
  DeviceTaskDispatchPayload,
  DeviceSubscriptionOptions,
  DeviceEventBusPort,
  VersionManifest,
  VersionManifestPusher,
  UpgradeOutcome,
} from './ota';
