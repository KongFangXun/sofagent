// ============================================================
// federation.test.ts · 联邦查询契约测试（双 mock peer）
// v1.1.8 新增
//
// 覆盖用例（共 9 case，门禁 ≥8）：
//   1. 两台 mock peer 互查 → 各自返回结果，合并成功（帧加解密往返）
//   2. 一台 peer 离线 → 该 peer 跳过，另一台正常返回
//   3. 全部 peer 离线 → 降级本地 knowledge/，不抛异常
//   4. peer 返回 restricted 条目 → 本地端二次过滤丢弃
//   5. peer 返回篡改 sensitivity 标签（internal 标 public 且内容敏感）
//      → 降权 trust=web + 审计 WARN，不直接丢弃
//   6. query 超时（mock peer 永不响应）→ 按离线处理
//   7. Automerge 合并：两 peer 返回同名 concept 不同版本 → CRDT 收敛，
//      trust 优先于 mtime（裁决 #3）
//   8. federation 模块整块抛错 → withOfflineFallback 退化本地查
//   9. 审计：每次查询记 federation_query{peers, merged, onlinePeers}
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';

import { createMemoryChannel, type FederationChannel } from '../channel';
import { clearPeers, registerPeer, getPeer } from '../peers';
import {
  broadcastQuery,
  fetchFromPeer,
  encodeFrame,
  decodeFrame,
  validateRemoteResult,
  type KnowledgeQuery,
  type KnowledgeQueryResult,
} from '../query-router';
import { mergeFederationResults, pickWinner } from '../merge';
import { withOfflineFallback, type FederationAuditEntry } from '../offline-fallback';
import { generateKeyPair, deriveSharedKey, type PairedPeer } from '@sofagent/core';

// ── 测试基座：两台共享 AES key 的 mock peer ──
function makePeerPair(): { peerA: PairedPeer; peerB: PairedPeer; keyA: Buffer; keyB: Buffer } {
  const a = generateKeyPair();
  const b = generateKeyPair();
  const keyA = deriveSharedKey(a.privateKey, b.publicKey);
  const keyB = deriveSharedKey(b.privateKey, a.publicKey);
  return {
    peerA: { peerId: 'peer-a', sharedKey: keyA, fingerprint: 'aaaabbbbccccdddd', via: 'code' },
    peerB: { peerId: 'peer-b', sharedKey: keyB, fingerprint: 'eeeeffff00001111', via: 'code' },
    keyA,
    keyB,
  };
}

function item(id: string, overrides: Partial<KnowledgeQueryResult> = {}): KnowledgeQueryResult {
  return { id, title: id, content: `${id} 的内容`, sensitivity: 'internal', trust: 'internal', mtime: 1000, ...overrides };
}

const QUERY: KnowledgeQuery = { text: '部署', viewerLevel: 'internal', limit: 10 };

beforeEach(() => clearPeers());

describe('联邦查询 · 帧编解码与双 peer 互查', () => {
  // 用例 1：两台 mock peer 互查（加密帧往返 + 合并）
  it('双 peer 各自返回结果，广播后合并成功', async () => {
    const { peerA, peerB, keyA, keyB } = makePeerPair();
    // peer-a 应答：解帧 → 回结果帧
    const channelA = createMemoryChannel(async (_peerId, frame) => {
      const req = decodeFrame<KnowledgeQuery>(keyA, frame);
      expect(req.text).toBe('部署');
      return encodeFrame(keyA, { results: [item('a-1', { trust: 'official', mtime: 500 })] });
    });
    const channelB = createMemoryChannel(async (_peerId, frame) => {
      decodeFrame<KnowledgeQuery>(keyB, frame);
      return encodeFrame(keyB, { results: [item('b-1', { trust: 'user', mtime: 900 })] });
    });
    // 合并 channel：按 peerId 路由
    const channel: FederationChannel = {
      send: (msg, t) => (msg.peerId === 'peer-a' ? channelA : channelB).send(msg, t),
      ping: async () => true,
    };
    const remote = await broadcastQuery(QUERY, [peerA, peerB], channel);
    expect(remote.length).toBe(2);
    const merged = mergeFederationResults([item('local-1', { mtime: 100 })], remote);
    // trust 排序：official(peer-a) > internal(local) > user(peer-b)
    expect(merged.map((m) => m.id)).toEqual(['a-1', 'local-1', 'b-1']);
    expect(merged.find((m) => m.id === 'a-1')?.source).toBe('peer-a');
  });

  // 用例 2：一台离线 → 跳过不阻塞
  it('一台 peer 离线 → 该 peer 跳过，另一台正常返回', async () => {
    const { peerA, peerB, keyB } = makePeerPair();
    const online = new Set(['peer-b']);
    const channel = createMemoryChannel(
      async (_p, frame) => encodeFrame(keyB, { results: [item('b-1')] }),
      online,
    );
    const remote = await broadcastQuery(QUERY, [peerA, peerB], channel);
    expect(remote.length).toBe(1);
    expect(remote[0]!.peerId).toBe('peer-b');
  });

  // 用例 3：全部离线 → 降级本地，不抛异常
  it('全部 peer 离线 → withOfflineFallback 降级本地查，不抛异常', async () => {
    const { peerA, peerB } = makePeerPair();
    const channel = createMemoryChannel(async () => { throw new Error('offline'); }, new Set());
    const audits: FederationAuditEntry[] = [];
    const merged = await withOfflineFallback(
      QUERY, [peerA, peerB],
      () => [item('local-1'), item('local-2')],
      channel, (e) => audits.push(e),
    );
    expect(merged.map((m) => m.id).sort()).toEqual(['local-1', 'local-2']);
    expect(merged.every((m) => m.source === 'local')).toBe(true);
    expect(audits[0]!.onlinePeers).toBe(0);
  });
});

describe('联邦查询 · sensitivity 双重保护', () => {
  // 用例 4：restricted 丢弃
  it('peer 返回 restricted 条目 → 本地端二次过滤丢弃', () => {
    const { result, warning } = validateRemoteResult('peer-x', item('r-1', { sensitivity: 'restricted' }));
    expect(result).toBeNull();
    expect(warning).toBeNull(); // 静默丢弃（peer 端违约，不算篡改告警）
  });

  // 用例 5：篡改标签降权 + WARN
  it('标 public 但内容含 API key → 降权 trust=web + WARN，不丢弃', () => {
    const tampered = item('evil-1', { sensitivity: 'public', content: '配置：sk-abcdef1234567890' });
    const { result, warning } = validateRemoteResult('peer-x', tampered);
    expect(result).not.toBeNull();
    expect(result!.trust).toBe('web');
    expect(warning).toContain('降权');
    expect(warning).toContain('evil-1');
    // 标 public 且内容干净 → 原样通过
    const clean = validateRemoteResult('peer-x', item('ok-1', { sensitivity: 'public', content: '公开文档' }));
    expect(clean.result!.trust).toBe('internal');
    expect(clean.warning).toBeNull();
  });

  // 用例 6：超时按离线
  it('mock peer 永不响应 → 5s 超时按离线（测试用 50ms 超时加速）', async () => {
    const { peerA } = makePeerPair();
    registerPeer(peerA);
    const slowChannel: FederationChannel = {
      send: () => new Promise(() => { /* 永不 resolve */ }),
      ping: async () => true,
    };
    const result = await fetchFromPeer(peerA, QUERY, slowChannel, 50);
    expect(result).toBeNull();
    expect(getPeer('peer-a')?.consecutiveFailures).toBe(1);
  });
});

describe('联邦查询 · CRDT 合并与裁决', () => {
  // 用例 7：同名 concept 两版本收敛，trust 优先于 mtime（裁决 #3）
  it('两 peer 返回同名 concept 不同版本 → CRDT 收敛，trust 优先于 mtime', () => {
    const older = item('concept-x', { trust: 'user', mtime: 9999 });
    const trusted = item('concept-x', { trust: 'official', mtime: 1 });
    // pickWinner：official mtime=1 仍胜 user mtime=9999（trust 优先）
    expect(pickWinner(older, trusted).trust).toBe('official');
    // 同 trust 取 mtime 新者
    expect(pickWinner(item('c', { trust: 'user', mtime: 5 }), item('c', { trust: 'user', mtime: 9 })).mtime).toBe(9);
    const merged = mergeFederationResults([], [
      { peerId: 'p1', results: [older], warnings: [] },
      { peerId: 'p2', results: [trusted], warnings: [] },
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0]!.trust).toBe('official');
  });

  // 用例 8：整块抛错 → 退化本地查
  it('federation 模块整块抛错 → withOfflineFallback 退化本地查，不抛异常', async () => {
    const { peerA } = makePeerPair();
    const boomChannel: FederationChannel = {
      send: () => { throw new Error('OpenClaw 未启动'); },
      ping: () => { throw new Error('OpenClaw 未启动'); },
    };
    const merged = await withOfflineFallback(QUERY, [peerA], () => [item('local-only')], boomChannel, () => {});
    expect(merged.map((m) => m.id)).toEqual(['local-only']);
    // 本地查询函数本身抛错 → 空结果也不炸
    const empty = await withOfflineFallback(QUERY, [peerA], () => { throw new Error('本地也挂'); }, boomChannel, () => {});
    expect(empty).toEqual([]);
  });

  // 用例 9：审计记录
  it('每次联邦查询记 federation_query{peers, merged, onlinePeers}', async () => {
    const { peerA, peerB, keyA, keyB } = makePeerPair();
    const online = new Set(['peer-a']);
    // peer-a 用 keyA 应答；peer-b 离线由 onlinePeers 拦截
    const channel = createMemoryChannel(async (p, frame) =>
      encodeFrame(p === 'peer-a' ? keyA : keyB, { results: [item('a-1')] }), online);
    const audits: FederationAuditEntry[] = [];
    await withOfflineFallback(QUERY, [peerA, peerB], () => [item('l-1')], channel, (e) => audits.push(e));
    expect(audits.length).toBe(1);
    expect(audits[0]!.action).toBe('federation_query');
    expect(audits[0]!.peers).toEqual(['peer-a', 'peer-b']);
    expect(audits[0]!.onlinePeers).toBe(1);
    expect(audits[0]!.merged).toBe(2);
  });
});
