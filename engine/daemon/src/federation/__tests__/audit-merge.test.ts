// ============================================================
// audit-merge.test.ts · 跨设备审计轨迹合并测试（v1.3.1 交付 7）
// ============================================================
//
// 覆盖：
// - 按 agentId 合并为一条完整轨迹（跨设备记录归并 + 时间升序）
// - HMAC 验签：合法签名 ok / 篡改 tampered（丢弃）/ 无密钥降级 unverifiable / 无签名 unsigned
// - trust 优先级裁决：低 trust 设备记录不覆盖高 trust（同 mergeKey）
// - 同 trust 取 timestamp 新者
// - auditMergeKey：agentId+commitSha 优先；无 agentId 不参与跨设备合并
//
// HMAC 确定性：stub SOFAGENT_KEY_PATH 到临时密钥文件——验签可复现（不依赖机器真实密钥）。
// 全部临时目录隔离。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHmac } from 'crypto';

import { getEnvFingerprint, getHmacKey, stableStringify } from '@sofagent/core';
import {
  mergeAuditTrails,
  buildAuditTrailByAgent,
  verifyAuditEntryHmac,
  auditMergeKey,
} from '../audit-merge';
import type { AuditHistoryEntry } from '@sofagent/audit';

/** 构造一条最小审计记录（可带 agentId/commitSha） */
function makeEntry(overrides: Partial<AuditHistoryEntry> = {}): AuditHistoryEntry {
  return {
    timestamp: '2026-08-10T00:00:00.000Z',
    diffRange: 'HEAD~1..HEAD',
    exitCode: 0,
    ruleResults: [],
    diffFileCount: 1,
    ...overrides,
  } as AuditHistoryEntry;
}

/**
 * 用当前环境密钥对记录签名（复刻 audit 写侧算法——先设 envFingerprint
 * 再签，与 audit-history.ts 写侧一致：签名包含 envFingerprint）。
 */
function signEntry(entry: AuditHistoryEntry): AuditHistoryEntry {
  const key = getHmacKey();
  if (!key) return entry;
  const fingerprint = getEnvFingerprint();
  const base = { ...entry, envFingerprint: fingerprint, hashVersion: 2, hmacAlgo: 'stable' as const };
  const recordForSig = {
    ...base,
    prevHash: undefined,
    hashVersion: undefined,
    hmacSig: undefined,
    hmacAlgo: undefined,
  };
  const sig = createHmac('sha256', key)
    .update(stableStringify(recordForSig) + '|' + fingerprint)
    .digest('hex').slice(0, 32);
  return { ...base, hmacSig: sig };
}

describe('audit-merge · 跨设备审计轨迹合并（v1.3.1 交付 7）', () => {
  let tmpDir: string;
  let keyPath: string;
  let origKeyPath: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-auditmerge-'));
    keyPath = path.join(tmpDir, 'test-key');
    fs.writeFileSync(keyPath, 'test-hmac-key-for-audit-merge', 'utf-8');
    origKeyPath = process.env.SOFAGENT_KEY_PATH;
    vi.stubEnv('SOFAGENT_KEY_PATH', keyPath);
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_KEY_PATH', origKeyPath ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('按 agentId 合并为一条完整轨迹（跨设备归并 + 时间升序）', () => {
    const records = [
      { entry: signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z', diffRange: 'a..b', commitSha: 'abc' })), deviceId: 'local', trust: 'internal' as const },
      { entry: signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T02:00:00Z', diffRange: 'b..c', commitSha: 'def' })), deviceId: 'peer-1', trust: 'user' as const },
      { entry: signEntry(makeEntry({ agentId: 'agent-2', timestamp: '2026-08-10T00:30:00Z', diffRange: 'x..y' })), deviceId: 'local', trust: 'internal' as const },
    ];

    const merged = mergeAuditTrails(records);
    // agent-1 两条 + agent-2 一条 = 3 条合并记录
    expect(merged).toHaveLength(3);
    // 时间升序
    expect(merged[0]?.entry.timestamp).toBe('2026-08-10T00:30:00Z');
    expect(merged[1]?.entry.timestamp).toBe('2026-08-10T01:00:00Z');
    expect(merged[2]?.entry.timestamp).toBe('2026-08-10T02:00:00Z');

    // 按 agent 聚合
    const byAgent = buildAuditTrailByAgent(merged);
    expect(Object.keys(byAgent).sort()).toEqual(['agent-1', 'agent-2']);
    expect(byAgent['agent-1']).toHaveLength(2);
    expect(byAgent['agent-2']).toHaveLength(1);
  });

  it('HMAC 验签：合法签名 ok / 篡改 tampered（丢弃）/ 无签名 unsigned', () => {
    const valid = signEntry(makeEntry({ agentId: 'agent-1' }));
    expect(verifyAuditEntryHmac(valid)).toBe('ok');

    // 篡改：改 exitCode 后签名不匹配（环境指纹一致 → tampered）
    const tampered = { ...valid, exitCode: 2 };
    expect(verifyAuditEntryHmac(tampered)).toBe('tampered');

    // 无签名（无密钥降级 SHA-256 时代）→ unsigned
    const unsigned = makeEntry({ agentId: 'agent-1' });
    expect(verifyAuditEntryHmac(unsigned)).toBe('unsigned');
  });

  it('tampered 记录被丢弃（不可信源不进入合并）', () => {
    const records = [
      { entry: signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z', commitSha: 'abc' })), deviceId: 'local', trust: 'internal' as const },
      // 篡改记录（同 mergeKey 但内容被改）
      { entry: { ...signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T09:00:00Z', commitSha: 'abc' })), exitCode: 2 }, deviceId: 'peer-1', trust: 'official' as const },
    ];

    const merged = mergeAuditTrails(records);
    // 篡改记录被丢弃 → 只剩 1 条（合法的那条）
    expect(merged).toHaveLength(1);
    expect(merged[0]?.entry.exitCode).toBe(0);
    expect(merged[0]?.deviceId).toBe('local');
  });

  it('trust 优先级：低 trust 设备记录不覆盖高 trust（同 mergeKey）', () => {
    const records = [
      // local internal（旧但信任高）
      { entry: signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z', commitSha: 'abc' })), deviceId: 'local', trust: 'internal' as const },
      // peer user（新但信任低）——不应覆盖 local
      { entry: signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T08:00:00Z', commitSha: 'abc' })), deviceId: 'peer-1', trust: 'user' as const },
    ];

    const merged = mergeAuditTrails(records);
    expect(merged).toHaveLength(1); // 同 mergeKey 只留一个
    expect(merged[0]?.deviceId).toBe('local'); // internal 胜出
    expect(merged[0]?.entry.timestamp).toBe('2026-08-10T01:00:00Z'); // 未被 peer 覆盖
  });

  it('trust 相同取 timestamp 新者（同 mergeKey）', () => {
    const records = [
      { entry: signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z', commitSha: 'abc' })), deviceId: 'local', trust: 'internal' as const },
      { entry: signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T02:00:00Z', commitSha: 'abc' })), deviceId: 'peer-1', trust: 'internal' as const },
    ];
    const merged = mergeAuditTrails(records);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.entry.timestamp).toBe('2026-08-10T02:00:00Z');
  });

  it('auditMergeKey：agentId+commitSha 优先；无 agentId 不参与跨设备合并', () => {
    expect(auditMergeKey(makeEntry({ agentId: 'a', commitSha: 'sha1' }))).toBe('a:sha1');
    expect(auditMergeKey(makeEntry({ agentId: 'a', diffRange: 'x..y' }))).toBe('a:2026-08-10T00:00:00.000Z:x..y');
    // 无 agentId → null（旧记录不参与跨设备合并）
    expect(auditMergeKey(makeEntry({}))).toBeNull();
  });

  it('无 agentId 记录保留但按 Agent 聚合时跳过', () => {
    const records = [
      { entry: signEntry(makeEntry({ timestamp: '2026-08-10T01:00:00Z' })), deviceId: 'local', trust: 'internal' as const },
      { entry: signEntry(makeEntry({ agentId: 'agent-1', timestamp: '2026-08-10T02:00:00Z' })), deviceId: 'local', trust: 'internal' as const },
    ];
    const merged = mergeAuditTrails(records);
    expect(merged).toHaveLength(2); // 两条都保留
    const byAgent = buildAuditTrailByAgent(merged);
    expect(Object.keys(byAgent)).toEqual(['agent-1']); // 无 agentId 记录不进 Agent 聚合
  });
});
