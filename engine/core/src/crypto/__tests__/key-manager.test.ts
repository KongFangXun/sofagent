// ============================================================
// key-manager.test.ts · v1.3.8 交付二：数据密钥管理测试
// ============================================================
//
// 覆盖：
// - 生成：32 字节随机密钥落盘 0600 + 打印 SHA-256 指纹前 16 位
// - 备份确认流：confirmBackup !== true → 抛错（强制备份）
// - 加载：loadKey 读回与生成一致
// - 轮换：旧密钥归档（keys/ 目录留 data.key.YYYYMMDD.bak），新密钥生效
// - 初始化标记：initialized 标记文件写入
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  generateDataKey,
  loadDataKey,
  rotateDataKey,
  keyFingerprint,
  dataKeyPath,
  keysDirPath,
  initializedMarkerPath,
  writeInitializedMarker,
  isInitialized,
  DATA_KEY_RECOVERY_HINT,
} from '../../crypto/key-manager';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-keys-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

describe('交付二 · key-manager（~/.sofagent/keys/data.key）', () => {
  let home: string;
  beforeEach(() => { home = tmpHome(); });
  afterEach(() => rmDir(home));

  it('生成：32 字节随机密钥落盘 + 文件权限 0600 + 指纹 = SHA-256 前 16 位', () => {
    const res = generateDataKey(home, { confirmBackup: true });
    expect(res.key.length).toBe(32);

    const kp = dataKeyPath(home);
    expect(fs.existsSync(kp)).toBe(true);
    const mode = fs.statSync(kp).mode & 0o777;
    expect(mode).toBe(0o600);

    // 指纹 = SHA-256(密钥) 前 16 hex
    expect(res.fingerprint).toBe(keyFingerprint(res.key));
    expect(res.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // base64 密钥内容可被 loadKey 读回（roundtrip 一致）
    expect(loadDataKey(home)).toEqual(res.key);
  });

  it('备份确认流：confirmBackup 未 true → 抛错且不落盘（强制备份确认）', () => {
    expect(() => generateDataKey(home, { confirmBackup: false })).toThrow(/备份/);
    expect(() => generateDataKey(home)).toThrow(/备份/);
    expect(fs.existsSync(keysDirPath(home))).toBe(false); // 未确认不落任何文件
  });

  it('加载：无密钥时返回 null；有密钥时读回一致', () => {
    expect(loadDataKey(home)).toBeNull();
    const res = generateDataKey(home, { confirmBackup: true });
    expect(loadDataKey(home)).toEqual(res.key);
  });

  it('轮换：旧密钥归档为 .bak，新密钥生效且与旧密钥不同', () => {
    const first = generateDataKey(home, { confirmBackup: true });
    const second = rotateDataKey(home, { confirmBackup: true });

    expect(loadDataKey(home)).toEqual(second.key);
    expect(second.key.equals(first.key)).toBe(false);

    // 归档：keys/ 下存在 data.key.*.bak 文件，内容 = 旧密钥
    const files = fs.readdirSync(keysDirPath(home)).filter(f => f.endsWith('.bak'));
    expect(files.length).toBe(1);
    const archived = fs.readFileSync(path.join(keysDirPath(home), files[0]!), 'utf-8').trim();
    expect(Buffer.from(archived, 'base64')).toEqual(first.key);
  });

  it('轮换也要求备份确认（confirmBackup 未 true 抛错）', () => {
    generateDataKey(home, { confirmBackup: true });
    expect(() => rotateDataKey(home, { confirmBackup: false })).toThrow(/备份/);
  });

  it('初始化标记：writeInitializedMarker 后 isInitialized=true', () => {
    expect(isInitialized(home)).toBe(false);
    writeInitializedMarker(home);
    expect(fs.existsSync(initializedMarkerPath(home))).toBe(true);
    expect(isInitialized(home)).toBe(true);
  });

  it('恢复指引：常量含明确的密钥丢失恢复说明', () => {
    expect(DATA_KEY_RECOVERY_HINT).toContain('data.key');
    expect(DATA_KEY_RECOVERY_HINT.length).toBeGreaterThan(20);
  });
});
