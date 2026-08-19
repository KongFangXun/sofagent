// ============================================================
// crypto-init.test.ts · v1.3.8 交付二：daemon 首启加密引导测试
// ============================================================
//
// 覆盖：
// - 首次运行（无密钥）交互环境 → 引导生成 + 写 initialized 标记 + ok
// - 首次运行非交互环境（CI）→ 跳过生成 + WARN 不 FAIL
// - 已有密钥 → 直接 ok（幂等，不重复生成）
// - 生成时输出指纹（用户核对备份）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { initDataEncryption } from '../crypto-init';
import { dataKeyPath, initializedMarkerPath, loadDataKey } from '@sofagent/core';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-cryptoinit-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

describe('交付二 · crypto-init（daemon 首启引导）', () => {
  let home: string;
  beforeEach(() => {
    home = tmpHome();
    vi.restoreAllMocks();
  });
  afterEach(() => rmDir(home));

  it('首次运行 + 交互环境 → 引导生成密钥 + initialized 标记 + status ok', () => {
    const result = initDataEncryption(home, { interactive: true });
    expect(result.status).toBe('ok');
    expect(result.action).toBe('generated');
    expect(fs.existsSync(dataKeyPath(home))).toBe(true);
    expect(fs.existsSync(initializedMarkerPath(home))).toBe(true);
    expect(loadDataKey(home)).not.toBeNull();
    expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/); // 指纹带回（打印核对）
  });

  it('首次运行 + 非交互环境（CI）→ 跳过生成，WARN 不 FAIL', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = initDataEncryption(home, { interactive: false });
    expect(result.status).toBe('warn');
    expect(result.action).toBe('skipped-non-interactive');
    expect(fs.existsSync(dataKeyPath(home))).toBe(false); // 未生成
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('已有密钥 → 直接 ok（幂等，不重复生成，不覆盖指纹）', () => {
    const first = initDataEncryption(home, { interactive: true });
    const second = initDataEncryption(home, { interactive: true });
    expect(second.status).toBe('ok');
    expect(second.action).toBe('already-initialized');
    expect(second.fingerprint).toBe(first.fingerprint); // 同一密钥
  });

  it('已生成但未写标记（异常残留）→ 补写标记并 ok', () => {
    initDataEncryption(home, { interactive: true });
    fs.unlinkSync(initializedMarkerPath(home)); // 模拟半程中断
    const result = initDataEncryption(home, { interactive: true });
    expect(result.status).toBe('ok');
    expect(fs.existsSync(initializedMarkerPath(home))).toBe(true);
  });
});
