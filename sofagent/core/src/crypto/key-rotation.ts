/**
 * @sofagent/core · crypto/key-rotation —— 24h 密钥轮换
 * v1.1.8 新增
 *
 * 轮换策略：
 *   - 当前 key（current）用于加密 + 解密
 *   - 旧 key（previous）在 24h 过渡窗口内**只解不加**——容忍对端还在用旧 key 加密的在途消息
 *   - 超过 24h：旧 key 销毁，强制重新配对协商
 *   - key 只存内存（本模块不持久化）
 */

import { AES_KEY_BYTES } from './aes-gcm';

/** 旧 key 过渡窗口：24 小时（毫秒） */
export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/** 轮换状态：current 必有，previous 在轮换后 24h 内存在 */
export interface KeySlot {
  /** 当前 key（加密 + 解密） */
  current: Buffer;
  /** 当前 key 生效时间戳（ms since epoch） */
  currentSince: number;
  /** 旧 key（过渡窗口内只解不加），无轮换历史时为 null */
  previous: Buffer | null;
  /** 旧 key 销毁时间戳（ms since epoch）；无旧 key 时为 null */
  previousExpiresAt: number | null;
}

/**
 * 创建初始密钥槽（首次配对成功后调用）
 * @param key 首次协商出的 32 字节 AES key
 * @param now 当前时间戳（默认 Date.now()，测试可注入）
 */
export function createKeySlot(key: Buffer, now: number = Date.now()): KeySlot {
  assertKeyLength(key);
  return { current: key, currentSince: now, previous: null, previousExpiresAt: null };
}

/**
 * 轮换密钥：新 key 上位，旧 key 降级为 previous（24h 过渡窗口）
 * @param slot 当前密钥槽
 * @param newKey 新协商出的 32 字节 AES key
 * @param now 当前时间戳（默认 Date.now()，测试可注入）
 * @returns 新密钥槽（原 slot 不被修改）
 */
export function rotateKey(slot: KeySlot, newKey: Buffer, now: number = Date.now()): KeySlot {
  assertKeyLength(newKey);
  return {
    current: newKey,
    currentSince: now,
    previous: slot.current,
    previousExpiresAt: now + ROTATION_GRACE_MS,
  };
}

/**
 * 取加密用 key——永远是当前 key；旧 key 永不用于加密
 * @param slot 密钥槽
 */
export function getEncryptionKey(slot: KeySlot): Buffer {
  return slot.current;
}

/**
 * 取解密用 key 列表：当前 key + 未过期的旧 key（按新→旧顺序，调用方逐个尝试）
 * 过 24h 窗口的旧 key 被剔除（视同销毁）。
 * @param slot 密钥槽
 * @param now 当前时间戳（默认 Date.now()，测试可注入）
 * @returns 可用解密 key 数组（至少含当前 key）
 */
export function getDecryptionKeys(slot: KeySlot, now: number = Date.now()): Buffer[] {
  const keys: Buffer[] = [slot.current];
  if (slot.previous !== null && slot.previousExpiresAt !== null && now < slot.previousExpiresAt) {
    keys.push(slot.previous);
  }
  return keys;
}

/**
 * 判断旧 key 是否在过渡窗口内（可解密）
 * @param slot 密钥槽
 * @param now 当前时间戳（默认 Date.now()，测试可注入）
 */
export function isPreviousKeyUsable(slot: KeySlot, now: number = Date.now()): boolean {
  return slot.previous !== null && slot.previousExpiresAt !== null && now < slot.previousExpiresAt;
}

/**
 * 判断是否应发起轮换（当前 key 已满 24h）
 * @param slot 密钥槽
 * @param now 当前时间戳（默认 Date.now()，测试可注入）
 */
export function shouldRotate(slot: KeySlot, now: number = Date.now()): boolean {
  return now - slot.currentSince >= ROTATION_GRACE_MS;
}

/** 校验 key 长度（内部辅助） */
function assertKeyLength(key: Buffer): void {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`AES key 长度必须为 ${AES_KEY_BYTES} 字节，实际 ${key.length}`);
  }
}
