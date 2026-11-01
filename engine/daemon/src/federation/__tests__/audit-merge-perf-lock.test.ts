// ============================================================
// audit-merge-perf-lock.test.ts · R1 性能回归锁
// ============================================================
//
// 锁点：mergeAuditTrails 处理 N 条记录时，getEnvFingerprint 只被调用 **1 次**。
//
// 背景（R1 性能债）：verifyAuditEntryHmac 内部调 getEnvFingerprint()，后者每次
// 执行 execSync('git rev-parse --git-dir')——每条记录起一个 git 子进程。
// 11,172 条记录实测 189.66s（机器相关）。修法：指纹提到 mergeAuditTrails
// 循环外算一次，作为可选入参传入 verifyAuditEntryHmac。
//
// 本用例一旦回归为「每条记录一次」，count 会变成 N 而不是 1，立刻红。
//
// 注意：本文件用 vi.mock 包装 @sofagent/core 的 getEnvFingerprint 计数（行为
// 透传真实实现），避免污染 audit-merge.test.ts 的既有用例，故单独成文件。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHmac } from 'crypto';

import type { AuditHistoryEntry } from '@sofagent/audit';
import type { DeviceAuditRecord } from '../audit-merge';

// vi.mock 被提升到 import 之前：计数器必须用 vi.hoisted 声明
const counter = vi.hoisted(() => ({ fingerprintCalls: 0 }));

vi.mock('@sofagent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sofagent/core')>();
  return {
    ...actual,
    getEnvFingerprint: (...args: Parameters<typeof actual.getEnvFingerprint>): string => {
      counter.fingerprintCalls += 1;
      return actual.getEnvFingerprint(...args);
    },
  };
});

// 被测模块必须在 vi.mock 之后 import（vi.mock 已提升，顺序安全）
import { getEnvFingerprint, getHmacKey, stableStringify } from '@sofagent/core';
import { mergeAuditTrails, verifyAuditEntryHmac } from '../audit-merge';

/** 构造一条最小审计记录（带 agentId 参与跨设备合并） */
function makeEntry(index: number, fingerprint: string): AuditHistoryEntry {
  return {
    timestamp: new Date(Date.UTC(2026, 7, 10) + index * 60_000).toISOString(),
    diffRange: `HEAD~${index + 1}..HEAD~${index}`,
    exitCode: 0,
    ruleResults: [],
    diffFileCount: 1,
    agentId: `agent-${index % 5}`,
    commitSha: `sha-${index}`,
    envFingerprint: fingerprint,
    hashVersion: 2,
    hmacAlgo: 'stable',
  } as AuditHistoryEntry;
}

/** 复刻写侧签名算法（签名含 envFingerprint） */
function signEntry(entry: AuditHistoryEntry, fingerprint: string): AuditHistoryEntry {
  const key = getHmacKey();
  if (!key) return entry;
  const recordForSig = {
    ...entry,
    prevHash: undefined,
    hashVersion: undefined,
    hmacSig: undefined,
    hmacAlgo: undefined,
  };
  const sig = createHmac('sha256', key)
    .update(stableStringify(recordForSig) + '|' + fingerprint)
    .digest('hex').slice(0, 32);
  return { ...entry, hmacSig: sig };
}

describe('audit-merge · 环境指纹调用次数回归锁（R1 性能债）', () => {
  let tmpDir: string;
  let keyPath: string;
  let origKeyPath: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-auditmerge-fp-'));
    keyPath = path.join(tmpDir, 'test-key');
    fs.writeFileSync(keyPath, 'test-hmac-key-for-audit-merge', 'utf-8');
    origKeyPath = process.env.SOFAGENT_KEY_PATH;
    vi.stubEnv('SOFAGENT_KEY_PATH', keyPath);
    counter.fingerprintCalls = 0;
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_KEY_PATH', origKeyPath ?? '');
    counter.fingerprintCalls = 0;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('mergeAuditTrails 处理 100 条记录时 getEnvFingerprint 只调用 1 次', () => {
    const fingerprint = getEnvFingerprint();
    const records: DeviceAuditRecord[] = [];
    for (let i = 0; i < 100; i += 1) {
      records.push({
        entry: signEntry(makeEntry(i, fingerprint), fingerprint),
        deviceId: i % 2 === 0 ? 'local' : 'peer-1',
        trust: i % 2 === 0 ? 'internal' : 'user',
      });
    }
    expect(records).toHaveLength(100);

    // 造数阶段的调用不计入：只数 mergeAuditTrails 内部的
    counter.fingerprintCalls = 0;
    const merged = mergeAuditTrails(records);

    expect(merged).toHaveLength(100); // 全部合入（无 tampered 丢弃）
    expect(counter.fingerprintCalls).toBe(1);
  });

  it('传入的 fingerprint 与模块内自算一致——验签结果不变（行为等价）', () => {
    const fingerprint = getEnvFingerprint();
    const entry = signEntry(makeEntry(0, fingerprint), fingerprint);

    counter.fingerprintCalls = 0;
    expect(verifyAuditEntryHmac(entry, fingerprint)).toBe('ok');
    expect(counter.fingerprintCalls).toBe(0); // 传入即不自算

    expect(verifyAuditEntryHmac(entry)).toBe('ok'); // 缺省路径仍自算
    expect(counter.fingerprintCalls).toBe(1);
  });
});
