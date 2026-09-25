// ============================================================
// hmac-key-lifecycle.test.ts · F-48：HMAC 举证链密钥生命周期
// ============================================================
// ① 弱密钥（空/<16B/低熵/弱模式）→ 拒绝签名（fail-closed，原为「告警后继续签」）
// ② 强密钥 → 照常签名
// ③ 无密钥 → 走既有无签名路径（降级 SHA-256，不报错）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { appendHistory, loadHistory } from '../audit-history';

const STRONG_KEY = 'f2a7c9e14b6d8035a9c2e5f7b1d4a6c8e0f2b4d6a8c0e2f4b6d8a0c2e4f6b8d1';

function tmpDir(tag: string): string {
  const dir = join(tmpdir(), `sofagent-f48-${tag}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(ts: string) {
  return {
    timestamp: ts,
    diffRange: 'HEAD~1..HEAD',
    task: 'F-48 密钥生命周期测试',
    exitCode: 0,
    ruleResults: [],
    diffFileCount: 0,
    commitMsg: 'f48 key lifecycle',
  } as Parameters<typeof appendHistory>[0];
}

describe('F-48 · HMAC 密钥生命周期（弱钥拒签）', () => {
  let dataDir: string;
  let keyDir: string;
  let keyPath: string;
  let savedData: string | undefined;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    dataDir = tmpDir('data');
    keyDir = tmpDir('key');
    keyPath = join(keyDir, '.sofagent-key');
    savedData = process.env.SOFAGENT_DATA;
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_DATA = dataDir;
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterEach(() => {
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    for (const d of [dataDir, keyDir]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('弱密钥（含 test-hmac-key 模式）→ 抛错拒签（fail-closed，不再「告警后继续签」）', () => {
    writeFileSync(keyPath, 'test-hmac-key-1234567890', { mode: 0o600 });
    expect(() => appendHistory(makeEntry('2026-09-25T14:00:00Z'))).toThrow(/密钥强度不足|拒绝签名/);
    // 拒签后不得落盘
    expect(existsSync(join(dataDir, 'audit', 'history.jsonl'))).toBe(false);
  });

  it('弱密钥（低熵短钥）→ 同样拒签', () => {
    writeFileSync(keyPath, 'aaaaaaaaaaaa', { mode: 0o600 });
    expect(() => appendHistory(makeEntry('2026-09-25T14:01:00Z'))).toThrow(/密钥强度不足|拒绝签名/);
  });

  it('强密钥 → 照常签名落盘（hmacSig 在位）', () => {
    writeFileSync(keyPath, STRONG_KEY, { mode: 0o600 });
    appendHistory(makeEntry('2026-09-25T14:02:00Z'));
    const hist = join(dataDir, 'audit', 'history.jsonl');
    expect(existsSync(hist)).toBe(true);
    const content = readFileSync(hist, 'utf8');
    expect(content).toContain('hmacSig');
    // 强钥下落盘 + 读回一致
    const loaded = loadHistory();
    expect(loaded.length).toBeGreaterThan(0);
  });

  it('无密钥 → 走既有无签名路径（不抛错）', () => {
    delete process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = join(keyDir, 'nonexistent-key');
    expect(() => appendHistory(makeEntry('2026-09-25T14:03:00Z'))).not.toThrow();
  });
});
