/**
 * @sofagent/daemon
 *
 * 守护进程 — 持续审计 / 文件监听 / 自动修复循环
 */

// Cron
export { startCron } from './cron';
export type { CronJob } from './cron';

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
