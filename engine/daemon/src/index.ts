/**
 * @sofagent/daemon
 *
 * 守护进程 — 持续审计 / 文件监听 / 自动修复循环
 */

// Cron
export { startCron } from './cron';
export type { CronJob } from './cron';

// Scheduler（定时任务 · v1.3.8 交付四：cron 三档糖 @daily/@weekly/@monthly）
export { createScheduler, nextCronTime, expandCronSugar } from './scheduler';
export type { ScheduleType, ScheduledTask, TaskRun, CronSugar } from './scheduler';

// Long Tasks（异步长任务自治 · v1.3.8 交付四：依赖图 + WAL 续跑钩子 + 注册表 + 死循环检测 + backoff）
export {
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
export type {
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
export { startWatching } from './fs-watch';
export type { ChangeCallback, FileWatcher } from './fs-watch';

// Filesystem Audit
export { runFilesystemAudit } from './run-fs-audit';

// Snapshot
export { createPostAuditSnapshot, listAllSnapshots, restoreSnapshot } from './snapshot';
export type { SnapshotInfo } from './snapshot';

// Dream Cycle（v1.1.6 新增：6 阶段流水线替换旧散点周报/经验提取脚本）
export { runDreamCycle, loadLedger, loadState } from './dream-cycle/state-machine';
export { MockLLM, RealLLM } from './dream-cycle/llm-mock';
export type {
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
export { DREAM_CYCLE_STAGES } from './dream-cycle/types';

// Inspectors
export {
  analyzeAuditHistory,
  checkDoctorHealth,
  checkKnowledgeFreshness,
  checkSkillStaleness,
  accumulateWarnings,
  runInspectors,
  runHealthReport,
  DEFAULT_INSPECTOR_CONFIG,
  generateDataSovereigntyDaily,
  generateDataSovereigntyWeekly,
  generateDataSovereigntyMonthly,
} from './inspectors';
export type { InspectorConfig, InspectorResult, DaemonHealth } from './inspectors';

// v1.2.4 P0：分层巡检（L1/L2/L3）+ L3 新 inspector
export {
  runLayeredInspection,
  runAllLayers,
  getLayerInspectorNames,
  LAYER_SCHEDULE,
} from './inspector-layers';
export type { InspectorLayer, LayeredInspectionResult } from './inspector-layers';
export { runFederationDistillation } from './inspectors/federation-distillation';
export { runFailurePattern, getFailureClusters } from './inspectors/failure-pattern';
export type { FailureCluster } from './inspectors/failure-pattern';
export { runOntologyCoverage } from './inspectors/ontology-coverage';

// v1.2.4 P0b：eval 失败检测（进化引擎核心闭环）
export { runEvalFailuresCheck } from './inspectors/eval-failures';

// v1.2.4 P1：skillopt 自动触发 inspector
export { runSkilloptTrigger } from './inspectors/skillopt-trigger';

// v1.2.4 P1b：Dashboard 历史趋势 + 任务统计
export { runDailySnapshot } from './inspectors/daily-snapshot';
export type { DailySnapshot } from './inspectors/daily-snapshot';
export { runTrendAggregator } from './inspectors/trend-aggregator';
export type { WeeklyTrendReport } from './inspectors/trend-aggregator';
export { runTaskStats } from './inspectors/task-stats';
export type { TaskStatsReport } from './inspectors/task-stats';

// v1.2.2 P0：审计报告 webhook 推送
export { pushAuditReport } from './webhook/audit-report-push';

// Workspace 变更摘要（v1.2.3 · 交付五 · checkpoint 联动 AD-6）
export {
  runWorkspaceSummary,
  collectWorkspaceChanges,
  appendWorkspaceChange,
  readWorkspaceChanges,
  readLatestCheckpointId,
  resolveWorkspaceChangesPath,
  WORKSPACE_CHANGES_MAX_ENTRIES,
} from './workspace-summary';
export type { WorkspaceChangeRecord, WorkspaceSummaryOptions } from './workspace-summary';

// USB Federation (v1.1.4)
export { detectSofagentUsb } from './usb-detect';
export type { UsbDetectResult } from './usb-detect';

// Webhook 企业平台推送（v1.2.1 · P0 采购阻塞项）
export { createWebhookPusher } from './webhook/index';
export type {
  WebhookPlatform,
  AuditVerdict,
  WebhookPushResult,
  WebhookPusherOptions,
  WebhookPusher,
} from './webhook/index';

// OpenClaw Federation（联邦查询 · v1.1.8 新增）
export { loadOpenClawChannel, createMemoryChannel, filterOnlinePeers } from './federation/channel';
export type { ChannelMessage, FederationChannel } from './federation/channel';
export {
  registerPeer,
  unregisterPeer,
  listPeers,
  getPeer,
  markPeerAlive,
  markPeerFailure,
  clearPeers,
} from './federation/peers';
export type { PeerState } from './federation/peers';
export {
  broadcastQuery,
  fetchFromPeer,
  encodeFrame,
  decodeFrame,
  validateRemoteResult,
  PEER_QUERY_TIMEOUT_MS,
} from './federation/query-router';
export type { KnowledgeQuery, KnowledgeQueryResult, FederationResult } from './federation/query-router';
export { mergeFederationResults, pickWinner } from './federation/merge';
export type { MergedKnowledge } from './federation/merge';
export { withOfflineFallback } from './federation/offline-fallback';
export type { FederationAuditEntry, AuditWriter } from './federation/offline-fallback';

// v1.3.1 交付 7：跨设备审计轨迹聚合（按 agentId 合并 + HMAC 验签 + trust 裁决）
export {
  mergeAuditTrails,
  buildAuditTrailByAgent,
  verifyAuditEntryHmac,
  auditMergeKey,
  readLocalAuditHistory,
} from './federation/audit-merge';
export type {
  DeviceAuditRecord,
  MergedAuditEntry,
  EntryHmacStatus,
} from './federation/audit-merge';
export { runAuditTrailInspector, aggregateAuditTrails } from './inspectors/audit-trail';
export type { AuditTrailInspectorOptions } from './inspectors/audit-trail';

// v1.2.5 §8.2 daemon 可靠性——推送重试 + 健康自检 + outbox 生命周期
export { withRetry, withRetryBestEffort, computeBackoff } from './with-retry';
export type { RetryOptions } from './with-retry';
export {
  writeHealthFile,
  readHealthFile,
  checkDaemonHealth,
  resolveHealthFilePath,
} from './daemon-health';
export type { DaemonHealthFile } from './daemon-health';
export {
  deleteOutboxFile,
  moveOutboxToFailed,
  cleanupFailedOutbox,
} from './push-target';

// v1.3.6 交付⑬：Agent 疲劳度检测（3 信号采集 → 评分 → daemon-health.json）
export {
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
export type { FatigueSignals, FatigueReport, FatigueAction } from './fatigue';

// v1.3.5 交付 5 #1：FDE 陪跑期（部署后前 2 周每日 Refine 巡检）
export {
  runCompanionDaily,
  getCompanionState,
  COMPANION_DAYS,
} from './companion';
export type { CompanionState, CompanionRunResult } from './companion';

// v1.3.5 交付 5 #4：FDE 节点注册表巡检（fde-registry.yaml cadence 调度）
export { runFdeCompanionDaily } from './inspectors/fde-companion-daily';
export { runFdeRegistryDaily } from './inspectors/fde-registry-daily';
export { loadFDERegistry, highRiskNodes } from './fde-registry-loader';
export type {
  FDECadence,
  FDERisk,
  FDERegistryNode,
  FDERegistryParseResult,
} from './fde-registry-types';
