// ============================================================
// peers.ts · 联邦 peer 注册表 + 发现
// v1.3.4 新增
// ============================================================
//
// peer 生命周期：
//   1. 配对（core/crypto/pairing 三条路径）→ 注册进内存表
//   2. 心跳探活（channel.ping）→ 在线/离线状态维护
//   3. 查询路由（query-router）只向在线 peer 广播
//
// key 只存内存（pairedPeers 模块级表）——重启即重新配对（持久化留 v1.1.9）。

import type { PairedPeer } from '@sofagent/core';

/** peer 运行状态 */
export interface PeerState {
  peer: PairedPeer;
  /** 最近一次心跳成功时间（ms since epoch）；从未成功为 null */
  lastSeenAt: number | null;
  /** 连续心跳失败次数 */
  consecutiveFailures: number;
}

/** 内存 peer 注册表（key = peerId） */
const registry = new Map<string, PeerState>();

/** 注册已配对 peer（配对成功后调用） */
export function registerPeer(peer: PairedPeer): void {
  registry.set(peer.peerId, { peer, lastSeenAt: null, consecutiveFailures: 0 });
}

/** 注销 peer（主动解配 / 长期离线清理） */
export function unregisterPeer(peerId: string): boolean {
  return registry.delete(peerId);
}

/** 列出全部已注册 peer（含离线） */
export function listPeers(): PeerState[] {
  return [...registry.values()];
}

/** 取单个 peer 状态 */
export function getPeer(peerId: string): PeerState | undefined {
  return registry.get(peerId);
}

/** 心跳成功：刷新 lastSeenAt + 清零失败计数 */
export function markPeerAlive(peerId: string, now: number = Date.now()): void {
  const state = registry.get(peerId);
  if (!state) return;
  state.lastSeenAt = now;
  state.consecutiveFailures = 0;
}

/** 心跳失败：累加失败计数 */
export function markPeerFailure(peerId: string): void {
  const state = registry.get(peerId);
  if (!state) return;
  state.consecutiveFailures += 1;
}

/** 清空注册表（测试隔离用） */
export function clearPeers(): void {
  registry.clear();
}
