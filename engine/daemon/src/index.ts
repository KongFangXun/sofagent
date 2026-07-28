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

// v1.2.2 P0：审计报告 webhook 推送
export { pushAuditReport } from './webhook/audit-report-push';

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
