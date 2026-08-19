// ============================================================
// age-wrapper.test.ts · v1.3.8 交付二：age 纯 TS 实现测试
// ============================================================
//
// 覆盖：
// - roundtrip：encrypt → decrypt 还原明文（中文 / 空串 / 长文本）
// - 格式：SOFAGENT-AGE-V1:<iv_b64>:<tag_b64>:<cipher_b64>
// - 加密不落明文：密文中不含原文
// - 随机 IV：同 key 同明文两次加密产生不同密文（IV 不复用）
// - 篡改检测：cipher/tag 改动 → 解密抛错（GCM 认证）
// - 密钥错误：错误 key 解密抛错
// ============================================================

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';

import {
  encryptWithAge,
  decryptWithAge,
  AGE_MAGIC_PREFIX,
  isAgePayload,
} from '../../crypto/age-wrapper';

function newKey(): Buffer {
  return randomBytes(32);
}

describe('交付二 · age-wrapper（纯 TS AES-256-GCM）', () => {
  it('roundtrip：中文/ASCII/空串/长文本 加密后解密还原', () => {
    const key = newKey();
    const cases = [
      'hello sofagent',
      '中文内容——审计历史加密',
      '',
      'x'.repeat(10_000),
      JSON.stringify({ timestamp: '2026-08-20', exitCode: 2, ruleResults: [] }),
    ];
    for (const plain of cases) {
      const payload = encryptWithAge(plain, key);
      expect(decryptWithAge(payload, key)).toBe(plain);
    }
  });

  it('格式：SOFAGENT-AGE-V1:<iv>:<tag>:<cipher> 四段', () => {
    const payload = encryptWithAge('payload-check', newKey());
    expect(payload.startsWith(AGE_MAGIC_PREFIX)).toBe(true);
    const parts = payload.split(':');
    // 前缀本身含一个冒号（SOFAGENT-AGE-V1:）→ 共 4 段
    expect(parts.length).toBe(4);
    expect(isAgePayload(payload)).toBe(true);
    expect(isAgePayload('{"plain":"old-line"}')).toBe(false);
    expect(isAgePayload('')).toBe(false);
  });

  it('密文不落明文 + 随机 IV（同 key 同明文两次加密不同密文）', () => {
    const key = newKey();
    const plain = 'secret-plaintext-content';
    const c1 = encryptWithAge(plain, key);
    const c2 = encryptWithAge(plain, key);
    expect(c1).not.toContain(plain);
    expect(c2).not.toContain(plain);
    expect(c1).not.toBe(c2); // IV 随机——密文必然不同
    // 两个密文都能解回原文
    expect(decryptWithAge(c1, key)).toBe(plain);
    expect(decryptWithAge(c2, key)).toBe(plain);
  });

  it('篡改检测：cipher 段或 tag 段被改 → 解密抛错（不返回部分明文）', () => {
    const key = newKey();
    const payload = encryptWithAge('integrity-check', key);
    const [, iv, tag, cipher] = payload.split(':') as [string, string, string, string];

    const tamperedCipher = Buffer.from(cipher, 'base64');
    tamperedCipher[0] = (tamperedCipher[0]! + 1) % 256;
    const badCipher = `${AGE_MAGIC_PREFIX}${iv}:${tag}:${tamperedCipher.toString('base64')}`;
    expect(() => decryptWithAge(badCipher, key)).toThrow(/认证失败|篡改/);

    const tamperedTag = Buffer.from(tag, 'base64');
    tamperedTag[0] = (tamperedTag[0]! + 1) % 256;
    const badTag = `${AGE_MAGIC_PREFIX}${iv}:${tamperedTag.toString('base64')}:${cipher}`;
    expect(() => decryptWithAge(badTag, key)).toThrow(/认证失败|篡改/);
  });

  it('密钥错误：不同 key 解密抛错', () => {
    const payload = encryptWithAge('key-mismatch', newKey());
    expect(() => decryptWithAge(payload, newKey())).toThrow(/认证失败|密钥不匹配/);
  });

  it('非法输入：格式坏/密钥长度错 → 明确报错', () => {
    const key = newKey();
    expect(() => decryptWithAge('not-an-age-payload', key)).toThrow(/格式/);
    expect(() => decryptWithAge(`${AGE_MAGIC_PREFIX}only:two:parts`, key)).toThrow(/格式/);
    expect(() => decryptWithAge(encryptWithAge('a', key), randomBytes(16))).toThrow(/密钥长度/);
  });
});
