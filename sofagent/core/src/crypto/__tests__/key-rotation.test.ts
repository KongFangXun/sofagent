// ============================================================
// key-rotation.test.ts · 24h 密钥轮换契约测试
// v1.1.8 新增
//
// 覆盖用例（共 5 case）：
//   1. 初始密钥槽：只有 current，无 previous
//   2. 轮换后：旧 key 降级为 previous，24h 内可解密
//   3. 旧 key 只解不加：getEncryptionKey 永远返回 current
//   4. 过 24h 窗口：旧 key 被剔除（视同销毁），解密列表只剩 current
//   5. shouldRotate：当前 key 满 24h → true；非 32 字节 key → 抛错
// ============================================================

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

import {
  createKeySlot,
  rotateKey,
  getEncryptionKey,
  getDecryptionKeys,
  isPreviousKeyUsable,
  shouldRotate,
  ROTATION_GRACE_MS,
} from '../key-rotation';
import { encryptPayload, decryptPayload } from '../aes-gcm';

const T0 = 1_700_000_000_000; // 固定基准时间（2023-11-14），测试可复现
const key = (): Buffer => crypto.randomBytes(32);

describe('密钥轮换 · 密钥槽生命周期', () => {
  // 用例 1：初始状态
  it('初始密钥槽：只有 current，previous 为 null', () => {
    const slot = createKeySlot(key(), T0);
    expect(slot.current.length).toBe(32);
    expect(slot.currentSince).toBe(T0);
    expect(slot.previous).toBeNull();
    expect(slot.previousExpiresAt).toBeNull();
    expect(getDecryptionKeys(slot, T0).length).toBe(1);
  });

  // 用例 2：轮换后旧 key 24h 内可解密（端到端：旧 key 加密的密文仍能解开）
  it('轮换后 24h 内：旧 key 加密的在途密文仍可解密', () => {
    const oldKey = key();
    const newKey = key();
    const slot0 = createKeySlot(oldKey, T0);
    // 旧 key 加密的在途消息
    const { iv, ciphertext, tag } = encryptPayload(oldKey, Buffer.from('在途消息'));
    // T0+1h 发生轮换
    const slot1 = rotateKey(slot0, newKey, T0 + 3600_000);
    expect(slot1.current.equals(newKey)).toBe(true);
    expect(slot1.previous?.equals(oldKey)).toBe(true);
    // 解密列表 = [current, previous]，逐个尝试能解开旧密文
    const keys = getDecryptionKeys(slot1, T0 + 3600_000);
    expect(keys.length).toBe(2);
    const plaintext = keys.map((k) => {
      try { return decryptPayload(k, iv, ciphertext, tag); } catch { return null; }
    }).find((p) => p !== null);
    expect(plaintext?.toString('utf-8')).toBe('在途消息');
    expect(isPreviousKeyUsable(slot1, T0 + 3600_000)).toBe(true);
  });

  // 用例 3：旧 key 只解不加
  it('旧 key 只解不加：getEncryptionKey 永远返回 current', () => {
    const oldKey = key();
    const newKey = key();
    const slot = rotateKey(createKeySlot(oldKey, T0), newKey, T0 + 1000);
    // 窗口内任意时刻，加密 key 都是新 key
    for (const t of [T0 + 1000, T0 + 12 * 3600_000, T0 + ROTATION_GRACE_MS - 1]) {
      expect(getEncryptionKey(slot).equals(newKey)).toBe(true);
    }
  });

  // 用例 4：过 24h 窗口旧 key 被剔除
  it('过 24h 过渡窗口：旧 key 被剔除，解密列表只剩 current', () => {
    const oldKey = key();
    const newKey = key();
    const slot = rotateKey(createKeySlot(oldKey, T0), newKey, T0 + 1000);
    const rotatedAt = T0 + 1000;
    // 窗口边界前 1ms 仍可用
    expect(isPreviousKeyUsable(slot, rotatedAt + ROTATION_GRACE_MS - 1)).toBe(true);
    // 窗口到期及之后：剔除
    expect(isPreviousKeyUsable(slot, rotatedAt + ROTATION_GRACE_MS)).toBe(false);
    expect(isPreviousKeyUsable(slot, rotatedAt + ROTATION_GRACE_MS + 1)).toBe(false);
    expect(getDecryptionKeys(slot, rotatedAt + ROTATION_GRACE_MS).length).toBe(1);
  });

  // 用例 5：shouldRotate + 参数校验
  it('当前 key 满 24h → shouldRotate=true；非 32 字节 key → 抛错', () => {
    const slot = createKeySlot(key(), T0);
    expect(shouldRotate(slot, T0 + ROTATION_GRACE_MS - 1)).toBe(false);
    expect(shouldRotate(slot, T0 + ROTATION_GRACE_MS)).toBe(true);
    expect(() => createKeySlot(crypto.randomBytes(16), T0)).toThrow(/长度/);
    expect(() => rotateKey(slot, crypto.randomBytes(16), T0)).toThrow(/长度/);
  });
});
