/**
 * @sofagent/core · crypto/aes-gcm —— AES-256-GCM payload 加解密
 * v1.1.8 新增
 *
 * 联邦查询的第 3 层防线（应用层加密）：
 *   - 每条消息使用随机 12 字节 IV（96-bit，GCM 推荐长度），绝不复用
 *   - 解密时强制校验 16 字节认证标签（auth tag），tag 不匹配 → 抛错拒绝
 *   - 零 npm 依赖，全部使用 Node.js 内置 crypto
 *
 * 使用方：daemon/src/federation/channel.ts（联邦 payload 加密）
 * key 来源：crypto/ecdh.ts 的 deriveSharedKey()（ECDH + HKDF 派生的 32 字节 AES key）
 */

import crypto from 'node:crypto';

/** GCM 推荐 IV 长度（96 bit = 12 字节） */
export const GCM_IV_BYTES = 12;

/** GCM 认证标签长度（128 bit = 16 字节） */
export const GCM_TAG_BYTES = 16;

/** AES-256 密钥长度（256 bit = 32 字节） */
export const AES_KEY_BYTES = 32;

/** 加密结果：IV + 密文 + 认证标签（三者分开放，由调用方拼装传输帧） */
export interface EncryptedPayload {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

/**
 * AES-256-GCM 加密
 * @param key 32 字节 AES key（来自 ECDH + HKDF 派生）
 * @param plaintext 明文 payload
 * @returns { iv, ciphertext, tag } —— IV 为本次随机生成，绝不复用
 */
export function encryptPayload(key: Buffer, plaintext: Buffer): EncryptedPayload {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`AES-256-GCM 密钥长度必须为 ${AES_KEY_BYTES} 字节，实际 ${key.length}`);
  }
  // 每条消息独立随机 IV——同 key 下 IV 复用会导致 GCM 安全性崩塌
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ciphertext, tag };
}

/**
 * AES-256-GCM 解密（tag 校验失败抛错，不返回部分明文）
 * @param key 32 字节 AES key
 * @param iv 加密时的 12 字节 IV
 * @param ciphertext 密文
 * @param tag 16 字节认证标签
 * @returns 明文 Buffer
 * @throws Error 认证失败（密文/IV/tag 任一被篡改）或参数长度非法
 */
export function decryptPayload(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer): Buffer {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`AES-256-GCM 密钥长度必须为 ${AES_KEY_BYTES} 字节，实际 ${key.length}`);
  }
  if (iv.length !== GCM_IV_BYTES) {
    throw new Error(`GCM IV 长度必须为 ${GCM_IV_BYTES} 字节，实际 ${iv.length}`);
  }
  if (tag.length !== GCM_TAG_BYTES) {
    throw new Error(`GCM 认证标签长度必须为 ${GCM_TAG_BYTES} 字节，实际 ${tag.length}`);
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // final() 在 tag 校验失败时抛错——统一包装为认证失败，不泄露底层细节
    throw new Error('AES-256-GCM 认证失败：payload 被篡改或密钥不匹配');
  }
}
