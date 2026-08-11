// ============================================================
// agent-identity.ts · Agent 独立身份码（v1.3.2 Ed25519 完整版，自 v1.2.5 轻量版升级）
//
// 企业 SubAgent 注册后（activate 写入 subagents/*.yml）即带独立身份码。
//
// v1.2.5 轻量版（保留，向后兼容）：
//   - agentId = UUID v4
//   - shortCode = 6 位 Base36（hash 前 6 位）
//   - fingerprint = SHA-256(agentName + systemPrompt + tools + constraints
//                   + hostname + sofagent-key) 前 16 位
//
// v1.3.2 升级（交付 6）：
//   - Ed25519 keypair（Node.js crypto.generateKeyPairSync，零新依赖）
//   - signature = Ed25519 签名（对 委托人 + 约束版本 + 责任声明 的稳定序列化）
//   - 绑定信息：principal（委托人）/ constraintVersion（约束版本）/
//     responsibility（责任声明）
//   - 保留全部旧导出（computeFingerprint / computeShortCode /
//     generateAgentIdentity / extractConstraintsFromPrompt），不破坏既有调用方
//
// 确定性：相同 systemPrompt + tools + constraints → 相同 fingerprint（幂等性）
// ============================================================

import {
  createHash,
  randomUUID,
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';
import type { KeyObject } from 'crypto';
import { hostname } from 'os';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Agent 身份码（v1.3.1 Ed25519 完整版——旧字段全部保留，新字段可选向后兼容） */
export interface AgentIdentity {
  /** 唯一标识（UUID v4） */
  agentId: string;
  /** 显示名（如 customer-intake） */
  displayName: string;
  /** 委托人（企业标识） */
  principal: string;
  /** 约束摘要（从 SubAgentDefinition.systemPrompt 提取关键约束） */
  constraints: string[];
  /** 签发时间（ISO 8601） */
  createdAt: string;
  /** SHA-256(systemPrompt + tools + constraints) 前 16 位 */
  fingerprint: string;
  /** 6 位短码（Base36，hash 前 6 位，便于人类识别） */
  shortCode: string;
  /** v1.3.1 新增：Ed25519 公钥（hex，DER 编码） */
  publicKey?: string;
  /** v1.3.1 新增：Ed25519 私钥（hex，PKCS8 编码）——仅本地存储，绝不出域 */
  privateKey?: string;
  /** v1.3.1 新增：对签名载荷（委托人+约束版本+责任声明）的 Ed25519 签名（hex） */
  signature?: string;
  /** v1.3.1 新增：约束版本（约束集变更时递增，签名随之失效重签） */
  constraintVersion?: number;
  /** v1.3.1 新增：责任声明（该 Agent 的责任边界描述） */
  responsibility?: string;
}

/** 责任声明默认文案 */
const DEFAULT_RESPONSIBILITY =
  '本 Agent 在委托人授权与约束版本限定范围内行动，行为可审计、责任可追溯。';

/**
 * 读取 sofagent-key（HMAC 密钥文件）。
 *
 * 密钥文件位置：~/.sofagent-key（由 init.ts 生成）。
 * 如果文件不存在，使用 hostname 作为 fallback（不强制依赖密钥文件存在）。
 *
 * @returns 密钥字符串
 */
function readSofagentKey(): string {
  const keyPath = join(process.env.HOME || process.env.USERPROFILE || '~', '.sofagent-key');
  try {
    if (existsSync(keyPath)) {
      return readFileSync(keyPath, 'utf-8').trim();
    }
  } catch (err) {
    // 密钥文件缺失或不可读，降级到 hostname 弱标识
    console.warn(
      `[sofagent] agent-identity: 密钥文件读取失败，降级到 hostname 弱标识。` +
      `fingerprint 安全强度降低。原因: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  // ⚠️ 弱标识路径：hostname 可预测/可伪造，仅用于开发环境降级
  return hostname();
}

/**
 * 生成确定性指纹。
 *
 * SHA-256(agentName + systemPrompt + tools + constraints + hostname + sofagent-key) 前 16 位。
 * 相同输入 → 相同指纹（幂等性验证）。
 *
 * @param agentName Agent 名称
 * @param systemPrompt 系统提示
 * @param tools 工具列表
 * @param constraints 约束列表
 * @returns 16 位十六进制指纹
 */
export function computeFingerprint(
  agentName: string,
  systemPrompt: string,
  tools: string[],
  constraints: string[],
): string {
  const host = hostname();
  const key = readSofagentKey();
  const raw = [agentName, systemPrompt, tools.join(','), constraints.join(','), host, key].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * 生成 6 位短码（Base36）。
 *
 * 从 agentName + fingerprint 的 hash 取前 6 位 Base36 编码。
 * 用于人类识别（如 `a3f2k9`），非安全用途。
 *
 * @param agentName Agent 名称
 * @param fingerprint 16 位指纹
 * @returns 6 位 Base36 短码
 */
export function computeShortCode(agentName: string, fingerprint: string): string {
  const hash = createHash('sha256').update(`${agentName}:${fingerprint}`).digest('hex');
  // 取前 8 位 hex → 转 BigInt → 转 Base36 → 取前 6 位
  const num = BigInt('0x' + hash.slice(0, 8));
  const base36 = num.toString(36);
  return base36.padStart(6, '0').slice(0, 6);
}

// ============================================================
// v1.3.1 交付 6：Ed25519 签发 / 验证
// ============================================================

/** Ed25519 密钥对（hex 编码字符串） */
export interface Ed25519KeyPair {
  /** 公钥 hex（DER 编码） */
  publicKey: string;
  /** 私钥 hex（PKCS8 编码）——仅本地保存 */
  privateKey: string;
}

/**
 * 签发 Ed25519 密钥对（Node.js 内置 crypto，零新依赖）。
 *
 * @returns hex 编码的公私钥对
 */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
  };
}

/** 从 hex DER 恢复公钥 KeyObject */
function publicKeyFromHex(publicKeyHex: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyHex, 'hex'),
    format: 'der',
    type: 'spki',
  });
}

/** 从 hex PKCS8 恢复私钥 KeyObject */
function privateKeyFromHex(privateKeyHex: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(privateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
}

/** 签名载荷——委托人 + 约束版本 + 责任声明（稳定拼接，两侧一致） */
export function buildSignaturePayload(identity: {
  principal: string;
  constraintVersion?: number;
  responsibility?: string;
}): string {
  return [
    `principal=${identity.principal}`,
    `constraintVersion=${identity.constraintVersion ?? 1}`,
    `responsibility=${identity.responsibility ?? DEFAULT_RESPONSIBILITY}`,
  ].join('|');
}

/**
 * 用 Ed25519 私钥对签名载荷签名。
 *
 * @param payload 签名载荷（buildSignaturePayload 产物）
 * @param privateKeyHex 私钥 hex（PKCS8/DER）
 * @returns 签名 hex
 */
export function signIdentityPayload(payload: string, privateKeyHex: string): string {
  const key = privateKeyFromHex(privateKeyHex);
  return cryptoSign(null, Buffer.from(payload, 'utf-8'), key).toString('hex');
}

/**
 * 验证 Agent 身份签名。
 *
 * 校验内容：signature 是否由 publicKey 对「委托人 + 约束版本 + 责任声明」
 * 的稳定载荷签出。任一绑定信息被篡改（principal / constraintVersion /
 * responsibility）或签名被替换，验证即失败。
 *
 * @param identity 身份码对象（需含 publicKey + signature）
 * @returns true = 签名有效
 */
export function verifyAgentIdentity(identity: AgentIdentity): boolean {
  if (!identity.publicKey || !identity.signature) return false;
  try {
    const key = publicKeyFromHex(identity.publicKey);
    const payload = buildSignaturePayload(identity);
    return cryptoVerify(
      null,
      Buffer.from(payload, 'utf-8'),
      key,
      Buffer.from(identity.signature, 'hex'),
    );
  } catch {
    // 密钥/签名格式非法——视为验证失败（不抛异常）
    return false;
  }
}

/**
 * 生成 Agent 身份码。
 *
 * v1.3.1 升级：内部签发 Ed25519 密钥对并对绑定信息（委托人 + 约束版本 +
 * 责任声明）签名；旧字段（agentId/displayName/principal/constraints/
 * createdAt/fingerprint/shortCode）语义不变，既有调用方零改动。
 *
 * @param agentName Agent 名称（如 customer-intake）
 * @param opts 可选参数
 * @param opts.systemPrompt 系统提示（影响 fingerprint）
 * @param opts.tools 工具列表（影响 fingerprint）
 * @param opts.constraints 约束列表（影响 fingerprint）
 * @param opts.principal 委托人/企业标识（默认 'enterprise'）
 * @param opts.constraintVersion 约束版本（默认 1）
 * @param opts.responsibility 责任声明（默认标准文案）
 * @returns AgentIdentity 身份码对象（含 Ed25519 公钥 + 签名）
 */
export function generateAgentIdentity(
  agentName: string,
  opts: {
    systemPrompt?: string;
    tools?: string[];
    constraints?: string[];
    principal?: string;
    constraintVersion?: number;
    responsibility?: string;
  } = {},
): AgentIdentity {
  const systemPrompt = opts.systemPrompt ?? '';
  const tools = opts.tools ?? [];
  const constraints = opts.constraints ?? [];

  const fingerprint = computeFingerprint(agentName, systemPrompt, tools, constraints);
  const shortCode = computeShortCode(agentName, fingerprint);

  // v1.3.1：Ed25519 签发 + 绑定信息签名
  const { publicKey, privateKey } = generateEd25519KeyPair();
  const principal = opts.principal ?? 'enterprise';
  const constraintVersion = opts.constraintVersion ?? 1;
  const responsibility = opts.responsibility ?? DEFAULT_RESPONSIBILITY;
  const payload = buildSignaturePayload({ principal, constraintVersion, responsibility });
  const signature = signIdentityPayload(payload, privateKey);

  return {
    agentId: randomUUID(),
    displayName: agentName,
    principal,
    constraints,
    createdAt: new Date().toISOString(),
    fingerprint,
    shortCode,
    publicKey,
    privateKey,
    signature,
    constraintVersion,
    responsibility,
  };
}

/**
 * 从 systemPrompt 中提取关键约束摘要。
 *
 * 提取 ## 知识域约束 段落中的关键条目，
 * 截取前 5 条作为 constraints 摘要。
 *
 * @param systemPrompt 系统提示
 * @param maxLength 最大提取条数（默认 5）
 * @returns 约束摘要列表
 */
export function extractConstraintsFromPrompt(
  systemPrompt: string,
  maxLength: number = 5,
): string[] {
  const constraints: string[] = [];

  // 提取 "## 知识域约束" 段落
  const kdMatch = systemPrompt.match(/##\s*知识域约束\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (kdMatch && kdMatch[1]) {
    const lines = kdMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && (trimmed.includes('允许') || trimmed.includes('禁止'))) {
        constraints.push(trimmed);
        if (constraints.length >= maxLength) break;
      }
    }
  }

  return constraints;
}
