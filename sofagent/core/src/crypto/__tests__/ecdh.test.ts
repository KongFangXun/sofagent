// ============================================================
// ecdh.test.ts · ECDH 密钥交换 + HKDF 派生测试
// v1.1.8 新增
//
// 覆盖用例（共 4 case）：
//   1. 双方派生的 shared key 一致（ECDH 对称性）
//   2. HKDF 派生 AES key 长度 = 32 字节（256 bit）
//   3. 不同密钥对派生不同 shared key
//   4. 非法对端公钥 → 抛错；公钥指纹稳定且为 16 字符 hex
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  generateKeyPair,
  deriveSharedKey,
  publicKeyFingerprint,
  DERIVED_KEY_BYTES,
} from '../ecdh';

describe('ECDH · 密钥协商', () => {
  // 用例 1：双方派生的 shared key 一致
  it('A 用 A 私钥+B 公钥 与 B 用 B 私钥+A 公钥 派生出同一把 key', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const keyA = deriveSharedKey(alice.privateKey, bob.publicKey);
    const keyB = deriveSharedKey(bob.privateKey, alice.publicKey);
    expect(keyA.equals(keyB)).toBe(true);
  });

  // 用例 2：HKDF 派生 key 长度 = 32 字节
  it('派生的 AES key 长度 = 32 字节（256 bit）', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const key = deriveSharedKey(alice.privateKey, bob.publicKey);
    expect(key.length).toBe(DERIVED_KEY_BYTES);
    expect(DERIVED_KEY_BYTES).toBe(32);
  });

  // 用例 3：不同密钥对 → 不同 shared key
  it('不同密钥对派生出不同 shared key', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const carol = generateKeyPair();
    const keyAB = deriveSharedKey(alice.privateKey, bob.publicKey);
    const keyAC = deriveSharedKey(alice.privateKey, carol.publicKey);
    expect(keyAB.equals(keyAC)).toBe(false);
  });

  // 用例 4：非法公钥抛错 + 指纹格式
  it('非法对端公钥 → 抛错；指纹为稳定 16 字符 hex', () => {
    const alice = generateKeyPair();
    expect(() => deriveSharedKey(alice.privateKey, Buffer.from('not-a-key'))).toThrow(/协商失败/);
    const fp1 = publicKeyFingerprint(alice.publicKey);
    const fp2 = publicKeyFingerprint(alice.publicKey);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{16}$/);
  });
});
