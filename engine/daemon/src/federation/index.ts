// ============================================================
// federation/index.ts · 联邦查询桶文件（@sofagent/daemon/federation 子路径导出）
// v1.2.8 新增
// ============================================================
//
// mcp-server 的 search_knowledge 经此子路径动态 import（mcp 包不直接
// 依赖 daemon——保持包边界；daemon 未安装时 import 失败静默降级本地查）。

export { loadOpenClawChannel, createMemoryChannel, filterOnlinePeers } from './channel';
export type { ChannelMessage, FederationChannel } from './channel';
export {
  registerPeer,
  unregisterPeer,
  listPeers,
  getPeer,
  markPeerAlive,
  markPeerFailure,
  clearPeers,
} from './peers';
export type { PeerState } from './peers';
export {
  broadcastQuery,
  fetchFromPeer,
  encodeFrame,
  decodeFrame,
  validateRemoteResult,
  PEER_QUERY_TIMEOUT_MS,
} from './query-router';
export type { KnowledgeQuery, KnowledgeQueryResult, FederationResult } from './query-router';
export { mergeFederationResults, pickWinner } from './merge';
export type { MergedKnowledge } from './merge';
export { withOfflineFallback } from './offline-fallback';
export type { FederationAuditEntry, AuditWriter } from './offline-fallback';
