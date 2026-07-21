// ============================================================
// aes-gcm.test.ts · AES-256-GCM 加解密契约测试
// v1.1.8 新增
//
// 覆盖用例（共 6 case）：
//   1. 加解密往返还原原文
//   2. 篡改 ciphertext → 解密抛错（auth tag 校验失败）
//   3. 篡改 IV → 解密抛错
//   4. 篡改 tag → 解密抛错
//   5. IV 复用检测：同一 key 下两条消息 IV 必须不同
//   6. 参数长度校验：非 32 字节 key / 非 12 字节 IV / 非 16 字节 tag → 抛错
// ============================================================

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

import {
  encryptPayload,
  decryptPayload,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  AES_KEY_BYTES,
} from '../aes-gcm';

/** 测试用固定 key（32 字节随机） */
function testKey(): Buffer {
  return crypto.randomBytes(AES_KEY_BYTES);
}

describe('AES-256-GCM · 加解密往返', () => {
  // 用例 1：加密→解密还原原文
  it('加密后解密还原原文（含空 payload / 中文 / 二进制）', () => {
    const key = testKey();
    const cases = [Buffer.alloc(0), Buffer.from('联邦查询 payload · 中文内容', 'utf-8'), crypto.randomBytes(1024)];
    for (const plaintext of cases) {
      const { iv, ciphertext, tag } = encryptPayload(key, plaintext);
      expect(iv.length).toBe(GCM_IV_BYTES);
      expect(tag.length).toBe(GCM_TAG_BYTES);
      expect(decryptPayload(key, iv, ciphertext, tag).equals(plaintext)).toBe(true);
    }
  });
});

describe('AES-256-GCM · 篡改检测', () => {
  // 用例 2：篡改 ciphertext → 抛错
  it('篡改 ciphertext 任一字节 → 解密抛错（认证失败）', () => {
    const key = testKey();
    const { iv, ciphertext, tag } = encryptPayload(key, Buffer.from('hello federation'));
    ciphertext[0] = ciphertext[0] ^ 0xff;
    expect(() => decryptPayload(key, iv, ciphertext, tag)).toThrow(/认证失败/);
  });

  // 用例 3：篡改 IV → 抛错
  it('篡改 IV → 解密抛错（认证失败）', () => {
    const key = testKey();
    const { iv, ciphertext, tag } = encryptPayload(key, Buffer.from('hello federation'));
    const badIv = Buffer.from(iv);
    badIv[0] = badIv[0] ^ 0xff;
    expect(() => decryptPayload(key, badIv, ciphertext, tag)).toThrow(/认证失败/);
  });

  // 用例 4：篡改 tag → 抛错
  it('篡改 tag → 解密抛错（认证失败）', () => {
    const key = testKey();
    const { iv, ciphertext, tag } = encryptPayload(key, Buffer.from('hello federation'));
    const badTag = Buffer.from(tag);
    badTag[15] = badTag[15] ^ 0xff;
    expect(() => decryptPayload(key, iv, ciphertext, badTag)).toThrow(/认证失败/);
  });
});

describe('AES-256-GCM · IV 管理', () => {
  // 用例 5：同一 key 下两条消息 IV 不复用
  it('同一 key 连续加密 100 条消息，IV 两两不同', () => {
    const key = testKey();
    const ivs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { iv } = encryptPayload(key, Buffer.from(`msg-${i}`));
      ivs.add(iv.toString('hex'));
    }
    expect(ivs.size).toBe(100);
  });
});

describe('AES-256-GCM · 参数校验', () => {
  // 用例 6：非法参数长度 → 抛错
  it('非 32 字节 key / 非 12 字节 IV / 非 16 字节 tag → 抛错', () => {
    const key = testKey();
    const { iv, ciphertext, tag } = encryptPayload(key, Buffer.from('x'));
    expect(() => encryptPayload(crypto.randomBytes(16), Buffer.from('x'))).toThrow(/密钥长度/);
    expect(() => decryptPayload(crypto.randomBytes(16), iv, ciphertext, tag)).toThrow(/密钥长度/);
    expect(() => decryptPayload(key, crypto.randomBytes(8), ciphertext, tag)).toThrow(/IV 长度/);
    expect(() => decryptPayload(key, iv, ciphertext, crypto.randomBytes(8))).toThrow(/标签长度/);
  });
});
