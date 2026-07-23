/**
 * @sofagent/core · crypto/ecdh —— ECDH 密钥交换 + HKDF 派生 AES key
 * v1.1.9 新增
 *
 * 联邦配对的核心原语：人不手打密钥。
 *   - 曲线：prime256v1（NIST P-256，Node 内置支持）
 *   - 双方各自 generateKeyPair() → 交换公钥 → deriveSharedKey() 派生同一把 32 字节 AES key
 *   - 派生链路：ECDH shared secret → HKDF-SHA256（带 info 上下文绑定）→ 32 字节 AES-256 key
 *   - key 只存内存，不落盘明文（持久化留 v1.1.9：OS keychain / age 加密）
 */

import crypto from 'node:crypto';

/** ECDH 曲线：prime256v1（P-256） */
export const ECDH_CURVE = 'prime256v1';

/** HKDF 上下文绑定串（防跨协议重放：本 key 仅用于 sofagent 联邦加密） */
const HKDF_INFO = 'sofagent-federation-aes-key';

/** HKDF 盐（固定盐可接受：ECDH shared secret 本身已是高熵随机源） */
const HKDF_SALT = 'sofagent-federation-v1';

/** 派生的 AES key 长度（32 字节 = 256 bit） */
export const DERIVED_KEY_BYTES = 32;

/** ECDH 密钥对（公钥为压缩格式 33 字节，私钥 32 字节） */
export interface EcdhKeyPair {
  publicKey: Buffer;
  privateKey: Buffer;
}

/**
 * 生成 ECDH 密钥对
 * @returns { publicKey, privateKey } —— 公钥压缩格式（33 字节），可安全传输给对端
 */
export function generateKeyPair(): EcdhKeyPair {
  const ecdh = crypto.createECDH(ECDH_CURVE);
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey(null, 'compressed'),
    privateKey: ecdh.getPrivateKey(),
  };
}

/**
 * 由己方私钥 + 对端公钥派生共享 AES key
 *
 * 流程：ECDH computeSecret → HKDF-SHA256(ikm=secret, salt, info) → 32 字节
 * 双方计算结果一致（ECDH 对称性保证）。
 *
 * @param privateKey 己方私钥（32 字节）
 * @param peerPublicKey 对端公钥（压缩格式 33 字节）
 * @returns 32 字节 AES-256 key（只存内存）
 * @throws Error 公钥格式非法或派生失败
 */
export function deriveSharedKey(privateKey: Buffer, peerPublicKey: Buffer): Buffer {
  const ecdh = crypto.createECDH(ECDH_CURVE);
  ecdh.setPrivateKey(privateKey);
  let secret: Buffer;
  try {
    secret = ecdh.computeSecret(peerPublicKey);
  } catch {
    throw new Error('ECDH 共享密钥协商失败：对端公钥格式非法');
  }
  // HKDF-SHA256 派生固定长度 AES key；info 绑定用途防跨协议重放
  const derived = crypto.hkdfSync(
    'sha256',
    secret,
    Buffer.from(HKDF_SALT, 'utf-8'),
    Buffer.from(HKDF_INFO, 'utf-8'),
    DERIVED_KEY_BYTES,
  );
  return Buffer.from(derived);
}

/**
 * 计算公钥指纹（SHA-256 前 8 字节 hex，用于配对时人工比对）
 * 路径 A 双方各自显示对方公钥指纹，y/N 确认防中间人。
 * @param publicKey 公钥 Buffer
 * @returns 16 字符小写 hex 指纹（如 "a1b2c3d4e5f60708"）
 */
export function publicKeyFingerprint(publicKey: Buffer): string {
  return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
}
