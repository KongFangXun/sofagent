// ============================================================
// offline-fallback.ts · 联邦查询离线降级
// v1.3.3 新增
// ============================================================
//
// 降级语义（best-effort，故障静默）：
//   - 任一 peer 离线 → 该 peer 结果跳过，不阻塞其余 peer
//   - 全部 peer 离线 / federation 整块抛错 → 退化为纯本地查询
//   - 每次联邦查询记一条审计（action: federation_query, peers, merged）
import type { PairedPeer } from '@sofagent/core';
import type { FederationChannel } from './channel';
import { broadcastQuery, type KnowledgeQuery, type KnowledgeQueryResult } from './query-router';
import { mergeFederationResults, type MergedKnowledge } from './merge';

/** 联邦查询审计记录（追加到 audit history 的最小结构） */
export interface FederationAuditEntry {
  action: 'federation_query';
  /** 参与查询的 peer id 列表（含离线的） */
  peers: string[];
  /** 合并后的条目数 */
  merged: number;
  /** 实际返回结果的在线 peer 数 */
  onlinePeers: number;
  /** 时间戳（ISO） */
  at: string;
}

/** 审计写入回调（生产：追加 audit history；测试：收集数组） */
export type AuditWriter = (entry: FederationAuditEntry) => void;

/** 默认审计：stderr 一行 JSON（不阻塞主流程） */
const defaultAudit: AuditWriter = (entry) => {
  try {
    process.stderr.write(`[sofagent-audit] ${JSON.stringify(entry)}\n`);
  } catch { /* 静默 */ }
};

/**
 * 带离线降级的联邦查询一站式入口
 *
 * 流程：广播查询（内部已做单 peer 超时/离线跳过）→ 合并本地+联邦结果
 * → 写审计。任何环节抛错 → 退化为纯本地查询（不抛异常）。
 *
 * @param query 查询
 * @param peers 已配对 peer 列表（可为空——直接本地查）
 * @param localFallback 本地查询函数（search_knowledge 的本地路径）
 * @param channel 传输 channel（可选；缺省/为空时按"无联邦能力"本地查）
 * @param audit 审计写入回调
 * @param onPeerOverride 远端结果覆盖本地条目时的告警回调（默认静默）
 * @returns 合并结果（纯本地时 source 全为 'local'）
 */
export async function withOfflineFallback(
  query: KnowledgeQuery,
  peers: PairedPeer[],
  localFallback: () => KnowledgeQueryResult[],
  channel?: FederationChannel,
  audit: AuditWriter = defaultAudit,
  onPeerOverride?: (peerId: string, id: string) => void,
): Promise<MergedKnowledge[]> {
  const localResults = safeLocal(localFallback);

  // 无联邦能力（无 channel / 无 peer）→ 直接本地查
  if (!channel || peers.length === 0) {
    audit({ action: 'federation_query', peers: [], merged: localResults.length, onlinePeers: 0, at: new Date().toISOString() });
    return mergeFederationResults(localResults, [], onPeerOverride);
  }

  try {
    const remote = await broadcastQuery(query, peers, channel);
    const merged = mergeFederationResults(localResults, remote, onPeerOverride);
    audit({
      action: 'federation_query',
      peers: peers.map((p) => p.peerId),
      merged: merged.length,
      onlinePeers: remote.length,
      at: new Date().toISOString(),
    });
    return merged;
  } catch {
    // federation 整块失败 → 退化纯本地（故障静默，不影响 MCP server）
    audit({ action: 'federation_query', peers: peers.map((p) => p.peerId), merged: localResults.length, onlinePeers: 0, at: new Date().toISOString() });
    return mergeFederationResults(localResults, [], onPeerOverride);
  }
}

/** 本地查询保护：本地函数抛错也不阻塞（返回空数组） */
function safeLocal(localFallback: () => KnowledgeQueryResult[]): KnowledgeQueryResult[] {
  try {
    return localFallback();
  } catch {
    return [];
  }
}
