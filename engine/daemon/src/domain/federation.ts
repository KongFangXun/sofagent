// ============================================================
// domain/federation.ts · 联邦域（对等发现 / 查询路由 / 合并 / 离线回退 / 审计轨迹聚合）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/federation），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/federation"。
// ============================================================
/* @public */ export { loadOpenClawChannel, createMemoryChannel, filterOnlinePeers } from '../federation/channel';
/* @public */ export type { ChannelMessage, FederationChannel } from '../federation/channel';
/* @public */ export {
  registerPeer,
  unregisterPeer,
  listPeers,
  getPeer,
  markPeerAlive,
  markPeerFailure,
  clearPeers,
} from '../federation/peers';
/* @public */ export type { PeerState } from '../federation/peers';
/* @public */ export {
  broadcastQuery,
  fetchFromPeer,
  encodeFrame,
  decodeFrame,
  validateRemoteResult,
  PEER_QUERY_TIMEOUT_MS,
} from '../federation/query-router';
/* @public */ export type { KnowledgeQuery, KnowledgeQueryResult, FederationResult } from '../federation/query-router';
/* @public */ export { mergeFederationResults, pickWinner } from '../federation/merge';
/* @public */ export type { MergedKnowledge } from '../federation/merge';
/* @public */ export { withOfflineFallback } from '../federation/offline-fallback';
/* @public */ export type { FederationAuditEntry, AuditWriter } from '../federation/offline-fallback';
/* @public */ export {
  mergeAuditTrails,
  buildAuditTrailByAgent,
  verifyAuditEntryHmac,
  auditMergeKey,
  readLocalAuditHistory,
} from '../federation/audit-merge';
/* @public */ export type {
  DeviceAuditRecord,
  MergedAuditEntry,
  EntryHmacStatus,
} from '../federation/audit-merge';
