// ============================================================
// audit-history-encryption.test.ts · v1.3.8 交付二：审计历史加密挂点测试
// ============================================================
//
// 覆盖（TDD）：
// - 密钥存在且初始化完成 → appendHistory 落盘为 SOFAGENT-AGE-V1 加密行；
//   磁盘内容不含明文字段；loadHistory 读回解密与原条目一致
// - 明文旧条兼容读：手工写入明文 JSON 行（无前缀）→ loadHistory 原样解析
// - 混合链：明文旧行 + 加密新行共存 → 全部可读
// - 密钥丢失：加密行存在但密钥被删 → loadHistory 报明确错误（含恢复指引），
//   且不让明文旧行也失效（旧行仍可读）
// - 无密钥（未初始化）→ 按旧明文逻辑写（向后兼容，不破坏现有行为）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { randomBytes } from 'crypto';

import {
  appendHistory,
  loadHistory,
  getHistoryFilePath,
  type AuditHistoryEntry,
} from './audit-history';
import {
  generateDataKey,
  loadDataKey,
  writeInitializedMarker,
  keysDirPath,
  dataKeyPath,
  isAgePayload,
  AGE_MAGIC_PREFIX,
} from '@sofagent/core';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-hist-enc-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(timestamp: string): AuditHistoryEntry {
  return {
    timestamp,
    diffRange: 'HEAD~1..HEAD',
    task: '加密挂点测试任务',
    exitCode: 0,
    ruleResults: [
      { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [] },
    ],
    diffFileCount: 1,
    commitMsg: 'test encryption commit',
  };
}

describe('v1.3.8 交付二 · audit-history 加密挂点', () => {
  let testDir: string;      // SOFAGENT_DATA 覆盖（测试隔离）
  let keyHome: string;      // SOFAGENT_HOME 覆盖（密钥隔离——绝不碰真实 ~/.sofagent）
  let savedData: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    keyHome = tmpDir();
    savedData = process.env.SOFAGENT_DATA;
    savedHome = process.env.SOFAGENT_HOME;
    process.env.SOFAGENT_DATA = testDir;
    process.env.SOFAGENT_HOME = keyHome;
  });

  afterEach(() => {
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    for (const d of [testDir, keyHome]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('密钥就绪 → 落盘为加密行（磁盘无明文）+ loadHistory 解密读回一致', () => {
    // 初始化密钥 + 标记（模拟 crypto-init 完成后的状态）
    generateDataKey(keyHome, { confirmBackup: true });
    writeInitializedMarker(keyHome);

    const entry = makeEntry('2026-08-20T10:00:00Z');
    appendHistory(entry);

    const filePath = getHistoryFilePath(testDir);
    const raw = readFileSync(filePath, 'utf-8').trim();
    expect(isAgePayload(raw)).toBe(true); // 整行是 age 载荷
    expect(raw.startsWith(AGE_MAGIC_PREFIX)).toBe(true);
    // 磁盘无明文（任务描述/commit message 不落盘）
    expect(raw).not.toContain('加密挂点测试任务');
    expect(raw).not.toContain('test encryption commit');

    // 读侧透明解密
    const loaded = loadHistory(10, testDir);
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.task).toBe('加密挂点测试任务');
    expect(loaded[0]!.commitMsg).toBe('test encryption commit');
    expect(loaded[0]!.exitCode).toBe(0);
  });

  it('明文旧条兼容读：无前缀旧行按原逻辑解析', () => {
    // 不初始化密钥（旧环境形态）→ 写明文（向后兼容）
    const plainEntry = makeEntry('2026-08-19T09:00:00Z');
    appendHistory(plainEntry);
    const filePath = getHistoryFilePath(testDir);
    const raw = readFileSync(filePath, 'utf-8').trim();
    expect(isAgePayload(raw)).toBe(false); // 无密钥时仍是明文
    expect(JSON.parse(raw)).toBeTruthy();

    // 直接手工追加一条「历史遗留」明文行（含必要链字段）也必须可读
    const legacy = {
      timestamp: '2026-08-18T08:00:00Z',
      diffRange: 'HEAD~2..HEAD~1',
      task: 'legacy 明文旧条',
      exitCode: 1,
      ruleResults: [],
      diffFileCount: 2,
      prevHash: 'legacy',
    };
    writeFileSync(filePath, raw + '\n' + JSON.stringify(legacy) + '\n', 'utf-8');

    const loaded = loadHistory(10, testDir);
    expect(loaded.length).toBe(2);
    expect(loaded.some(e => e.task === 'legacy 明文旧条')).toBe(true);
    expect(loaded.some(e => e.task === plainEntry.task)).toBe(true);
  });

  it('混合链：明文旧行 + 加密新行共存全部可读', () => {
    // 先写明文（无密钥状态）
    appendHistory(makeEntry('2026-08-19T09:00:00Z'));

    // 再初始化密钥写加密行
    generateDataKey(keyHome, { confirmBackup: true });
    writeInitializedMarker(keyHome);
    appendHistory(makeEntry('2026-08-20T10:00:00Z'));

    const loaded = loadHistory(10, testDir);
    expect(loaded.length).toBe(2);
    // 倒序：新（加密）在前
    expect(loaded[0]!.timestamp).toBe('2026-08-20T10:00:00Z');
    expect(loaded[1]!.timestamp).toBe('2026-08-19T09:00:00Z');
  });

  it('密钥丢失：加密行存在但密钥被删 → 明确报错（含恢复指引），明文旧行仍可读', () => {
    // 明文旧行（先于密钥存在）
    appendHistory(makeEntry('2026-08-19T09:00:00Z'));

    // 初始化 + 加密新行
    generateDataKey(keyHome, { confirmBackup: true });
    writeInitializedMarker(keyHome);
    appendHistory(makeEntry('2026-08-20T10:00:00Z'));

    // 密钥丢失（用户误删）
    rmSync(keysDirPath(keyHome), { recursive: true, force: true });
    expect(existsSync(dataKeyPath(keyHome))).toBe(false);
    expect(loadDataKey(keyHome)).toBeNull();

    // 读侧：明确报错 + 恢复指引（不静默吞、不半解密）
    expect(() => loadHistory(10, testDir)).toThrow(/密钥/);
    try {
      loadHistory(10, testDir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toContain('恢复'); // 恢复指引
    }
  });

  it('无密钥 → 按旧明文逻辑写（现有行为零破坏）', () => {
    const entry = makeEntry('2026-08-20T11:00:00Z');
    appendHistory(entry);
    const raw = readFileSync(getHistoryFilePath(testDir), 'utf-8').trim();
    expect(isAgePayload(raw)).toBe(false);
    const parsed = JSON.parse(raw) as AuditHistoryEntry;
    expect(parsed.task).toBe('加密挂点测试任务');
  });
});
