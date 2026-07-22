/**
 * @sofagent/core · crypto/pairing —— 联邦配对三条路径
 * v1.1.9 新增
 *
 * 三条配对路径覆盖全部场景：
 *   - 路径 A（6 位码 + y/N 确认）：一台生成 6 位配对码 + 公钥指纹，另一台输入码 →
 *     双方显示对方指纹 → 各自 y/N 确认 → ECDH 协商。适合人在场的双机配对。
 *   - 路径 B（token）：长 token 带外交换（SOFAGENT_FEDERATION_TOKEN 环境变量），
 *     适合 CI / 无人值守自动化场景。
 *   - 路径 C（预制 federation.json）：手动放置或 USB 携带，复用 v1.1.5 usb-detect
 *     的 HMAC-SHA256 .sig sidecar 验签——验签通过即信任。
 *
 * 安全约束：
 *   - 协商出的 AES key 只存内存（PairedPeer.sharedKey），不落盘明文
 *   - 路径 B 的 token 只经环境变量传入，不写文件、不进命令行参数（防 ps 泄露）
 *   - 路径 C 的验签复用 usb-detect 同范式（HMAC-SHA256 + timingSafeEqual），
 *     core 包不依赖 daemon 包，故验签函数经参数注入（依赖倒置）
 */

import crypto from 'node:crypto';
import {
  generateKeyPair,
  deriveSharedKey,
  publicKeyFingerprint,
} from './ecdh';

/** 路径 B 的环境变量名（token 带外交换的唯一入口） */
export const FEDERATION_TOKEN_ENV = 'SOFAGENT_FEDERATION_TOKEN';

/** 路径 A 配对码长度（6 位数字） */
export const PAIRING_CODE_LENGTH = 6;

/** token 最小长度（防弱 token；32 字符 ≈ 128 bit 熵的下限） */
export const MIN_TOKEN_LENGTH = 32;

/** 配对成功的 peer（sharedKey 只存内存） */
export interface PairedPeer {
  /** peer 标识（路径 A/B 为指纹，路径 C 为 federation.json 中的 node name） */
  peerId: string;
  /** ECDH 协商出的 32 字节 AES key（只存内存）；路径 C 无 ECDH 协商时为 null */
  sharedKey: Buffer | null;
  /** 对端公钥指纹（路径 C 无公钥时为 null） */
  fingerprint: string | null;
  /** 配对路径 */
  via: 'code' | 'token' | 'federation-file';
}

/** 路径 A 配对会话（生成侧） */
export interface PairingSession {
  /** 6 位配对码（给对端输入用） */
  code: string;
  /** 己方公钥（随码带外传给对端） */
  publicKey: Buffer;
  /** 己方公钥指纹（显示给用户比对） */
  fingerprint: string;
}

/** HMAC 验签函数签名（与 daemon/usb-detect.ts 的 verifySignature 一致，注入使用） */
export type VerifySignatureFn = (content: string, signature: string, key: Buffer) => boolean;

/** 密钥加载函数签名（与 daemon/usb-detect.ts 的 loadOrCreateSecretKey 一致，注入使用） */
export type LoadSecretKeyFn = () => Buffer;

/**
 * 生成 6 位配对码（路径 A 第一步）
 * 密码学安全随机，范围 000000-999999。
 */
export function generatePairingCode(): string {
  // randomInt 上界开区间 → [0, 1000000)
  return crypto.randomInt(0, 1_000_000).toString().padStart(PAIRING_CODE_LENGTH, '0');
}

/**
 * 路径 A 第一步：创建配对会话（生成配对码 + 己方密钥对）
 * 调用方把 code + publicKey 经带外通道（扫码/手输）发给对端。
 */
export function createPairingSession(): PairingSession & { privateKey: Buffer } {
  const { publicKey, privateKey } = generateKeyPair();
  return {
    code: generatePairingCode(),
    publicKey,
    privateKey,
    fingerprint: publicKeyFingerprint(publicKey),
  };
}

/**
 * 路径 A 第二步：确认配对（输入对端公钥，人工确认指纹后完成协商）
 *
 * @param myPrivateKey 己方私钥（createPairingSession 返回的）
 * @param peerPublicKey 对端公钥（经带外通道收到）
 * @param confirmFingerprint 人工确认回调——显示对端指纹，返回 true=y / false=N
 * @returns 配对成功的 PairedPeer
 * @throws Error 用户拒绝（confirmFingerprint 返回 false）
 */
export async function pairByCode(
  myPrivateKey: Buffer,
  peerPublicKey: Buffer,
  confirmFingerprint: (fingerprint: string) => Promise<boolean>,
): Promise<PairedPeer> {
  const fingerprint = publicKeyFingerprint(peerPublicKey);
  // y/N 确认是防中间人的关键一步——指纹不匹配说明公钥被调包
  const confirmed = await confirmFingerprint(fingerprint);
  if (!confirmed) {
    throw new Error(`配对被用户拒绝：对端指纹 ${fingerprint} 未确认`);
  }
  const sharedKey = deriveSharedKey(myPrivateKey, peerPublicKey);
  return { peerId: fingerprint, sharedKey, fingerprint, via: 'code' };
}

/**
 * 路径 B：token 配对（自动化场景）
 *
 * token 经 SOFAGENT_FEDERATION_TOKEN 环境变量带外交换——
 * 不写文件、不进命令行参数。token 本身作为 ECDH 的"预认证"：
 * 双方各自生成密钥对后，用 token 派生公钥交换的认证标签（HMAC），
 * 防 token 持有者之外的第三方注入假公钥。
 *
 * 为保持 core 零 IO，本函数接收"对端公钥 + 其 HMAC 标签"，
 * 传输由 daemon 层负责。
 *
 * @param token 配对 token（缺省读 SOFAGENT_FEDERATION_TOKEN）
 * @param myPrivateKey 己方私钥
 * @param peerPublicKey 对端公钥
 * @param peerTag 对端公钥的 HMAC 标签（对端用同一 token 计算）
 * @returns 配对成功的 PairedPeer
 * @throws Error token 缺失/过短、标签不匹配（公钥被调包）
 */
export async function pairByToken(
  token: string | undefined,
  myPrivateKey: Buffer,
  peerPublicKey: Buffer,
  peerTag: string,
): Promise<PairedPeer> {
  const resolved = token ?? process.env[FEDERATION_TOKEN_ENV];
  if (!resolved) {
    throw new Error(`路径 B 配对失败：未提供 token（环境变量 ${FEDERATION_TOKEN_ENV} 未设置）`);
  }
  if (resolved.length < MIN_TOKEN_LENGTH) {
    throw new Error(`路径 B 配对失败：token 长度不足 ${MIN_TOKEN_LENGTH} 字符`);
  }
  // 用 token 认证对端公钥——标签不匹配说明公钥非 token 持有者所发
  const expectedTag = computeTokenTag(resolved, peerPublicKey);
  if (expectedTag.length !== peerTag.length ||
      !crypto.timingSafeEqual(Buffer.from(expectedTag, 'utf-8'), Buffer.from(peerTag, 'utf-8'))) {
    throw new Error('路径 B 配对失败：对端公钥认证标签不匹配（疑似中间人调包）');
  }
  const sharedKey = deriveSharedKey(myPrivateKey, peerPublicKey);
  const fingerprint = publicKeyFingerprint(peerPublicKey);
  return { peerId: fingerprint, sharedKey, fingerprint, via: 'token' };
}

/**
 * 路径 B 辅助：计算己方公钥的 token 认证标签（发给对端校验用）
 * @param token 配对 token
 * @param publicKey 己方公钥
 */
export function computeTokenTag(token: string, publicKey: Buffer): string {
  return crypto.createHmac('sha256', token).update(publicKey).digest('hex');
}

/**
 * 路径 C：预制 federation.json 配对（复用 v1.1.5 USB federation 范式）
 *
 * 验签逻辑与 daemon/usb-detect.ts 同范式（HMAC-SHA256 + timingSafeEqual），
 * 但 core 包不依赖 daemon 包——验签函数与密钥加载函数经参数注入。
 *
 * @param fileContent federation.json 的原始文本内容（读取由调用方负责，core 零 IO）
 * @param signature .sig sidecar 的签名 hex；缺失传 null → 拒绝
 * @param verifySignature 验签函数（通常直接传 usb-detect 的 verifySignature）
 * @param loadSecretKey 密钥加载函数（通常直接传 usb-detect 的 loadOrCreateSecretKey）
 * @returns 配对成功的 PairedPeer（路径 C 无 ECDH 协商，sharedKey 为 null——
 *          加密 key 由双方后续走路径 A/B 补齐，或直接用 HMAC key 派生）
 * @throws Error 签名缺失 / 验签失败 / JSON 非法 / schema 不含 nodes
 */
export async function pairByFederationFile(
  fileContent: string,
  signature: string | null,
  verifySignature: VerifySignatureFn,
  loadSecretKey: LoadSecretKeyFn,
): Promise<PairedPeer> {
  if (signature === null) {
    throw new Error('路径 C 配对失败：federation.json.sig 缺失（拒绝信任未签名配置）');
  }
  const key = loadSecretKey();
  if (!verifySignature(fileContent, signature, key)) {
    throw new Error('路径 C 配对失败：federation.json 验签不通过（文件被篡改或密钥不匹配）');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new Error('路径 C 配对失败：federation.json 不是合法 JSON');
  }
  const cfg = parsed as { nodes?: Array<{ name?: unknown }> };
  const firstNode = Array.isArray(cfg.nodes) && cfg.nodes.length > 0 ? cfg.nodes[0] : null;
  const peerId = firstNode && typeof firstNode.name === 'string' ? firstNode.name : 'federation-file';
  // 路径 C 信任来源 = HMAC 验签，无 ECDH 协商 → sharedKey 为 null
  return { peerId, sharedKey: null, fingerprint: null, via: 'federation-file' };
}
