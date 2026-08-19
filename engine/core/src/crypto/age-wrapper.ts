/**
 * @sofagent/core · crypto/age-wrapper —— 数据静态加密 age 封装（纯 TS 实现）
 * v1.3.8 交付二 新增
 *
 * 对标 age-encryption.org 的文件级加密，但**纯 TS 内建实现**（AES-256-GCM，
 * Node crypto 内建）——不 spawn 外部 age 二进制（CI 环境无 age 会全红，
 * 且外部进程引入供应链/路径注入面）。
 *
 * 载荷格式（单行安全——JSONL 每行一条）：
 *   SOFAGENT-AGE-V1:<iv_b64>:<tag_b64>:<cipher_b64>
 *
 *   - iv：12 字节随机 IV（GCM 推荐 96-bit），每次加密全新随机——绝不复用
 *   - tag：16 字节 GCM 认证标签（128-bit）——解密强制校验，防篡改
 *   - cipher：AES-256-GCM 密文
 *   - 格式中不含 ':' 之外的分隔歧义（iv/tag 是定长 base64，cipher 是最后一段）
 *
 * 透明读写语义：
 *   - encryptWithAge(text, key)：明文 → 载荷字符串（落盘形态）
 *   - decryptWithAge(payload, key)：载荷 → 明文（API 读出形态）
 *   两者均为纯函数（无 IO）——文件落盘由调用方（audit-history 等）负责。
 *
 * 向后兼容（读侧）：isAgePayload() 识别载荷前缀；无前缀的行按明文旧格式解析。
 *
 * 使用方：
 *   - engine/audit/src/audit-history.ts（v1.3.8 主挂点——data/audit/ 主链）
 *   - 后续接线点（v1.3.8 暂不挂，避免一次改四个包爆回归面）：
 *     · data/forge-runs/（FORGE 审查运行数据）
 *     · data/checkpoint/（graph checkpoint）
 *     · data/model-registry/（模型注册表——含内部 endpoint 地址）
 */

import crypto from 'node:crypto';

/** 载荷魔术前缀（版本化——未来算法升级换 V2 前缀，读侧按前缀分发） */
export const AGE_MAGIC_PREFIX = 'SOFAGENT-AGE-V1:';

/** GCM 推荐 IV 长度（96 bit = 12 字节） */
const GCM_IV_BYTES = 12;

/** GCM 认证标签长度（128 bit = 16 字节） */
const GCM_TAG_BYTES = 16;

/** AES-256 密钥长度（256 bit = 32 字节） */
const AGE_KEY_BYTES = 32;

/**
 * AES-256-GCM 加密（纯函数）。
 *
 * @param text 明文（任意 UTF-8——含中文/JSON 行）
 * @param key 32 字节密钥（来自 key-manager 的 data.key）
 * @returns SOFAGENT-AGE-V1:<iv_b64>:<tag_b64>:<cipher_b64> 单行载荷
 * @throws 密钥长度非法时抛错
 */
export function encryptWithAge(text: string, key: Buffer): string {
  assertKeyLength(key);
  // 每次加密全新随机 IV——同 key 下 IV 复用会导致 GCM 安全性崩塌
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${AGE_MAGIC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * AES-256-GCM 解密（纯函数——认证失败抛错，绝不返回部分明文）。
 *
 * @param payload SOFAGENT-AGE-V1 载荷（encryptWithAge 的输出）
 * @param key 32 字节密钥
 * @returns 明文
 * @throws 格式非法 / 认证失败（密文被篡改或密钥不匹配）时抛错
 */
export function decryptWithAge(payload: string, key: Buffer): string {
  assertKeyLength(key);
  if (!payload.startsWith(AGE_MAGIC_PREFIX)) {
    throw new Error(`age 载荷格式非法：缺少 ${AGE_MAGIC_PREFIX} 前缀`);
  }
  const body = payload.slice(AGE_MAGIC_PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) {
    throw new Error('age 载荷格式非法：应为 <iv_b64>:<tag_b64>:<cipher_b64> 三段');
  }
  const [ivB64, tagB64, cipherB64] = parts as [string, string, string];
  let iv: Buffer, tag: Buffer, ciphertext: Buffer;
  try {
    iv = Buffer.from(ivB64, 'base64');
    tag = Buffer.from(tagB64, 'base64');
    ciphertext = Buffer.from(cipherB64, 'base64');
  } catch (e) {
    throw new Error(`age 载荷格式非法：base64 解码失败（${e instanceof Error ? e.message : String(e)}）`);
  }
  if (iv.length !== GCM_IV_BYTES) {
    throw new Error(`age 载荷格式非法：IV 长度 ${iv.length} ≠ ${GCM_IV_BYTES}`);
  }
  if (tag.length !== GCM_TAG_BYTES) {
    throw new Error(`age 载荷格式非法：tag 长度 ${tag.length} ≠ ${GCM_TAG_BYTES}`);
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  } catch (e) {
    // final() 在 tag 校验失败时抛错——统一包装，不泄露底层细节、不返回部分明文
    throw new Error(`age 解密认证失败：载荷被篡改或密钥不匹配（${e instanceof Error ? e.message : String(e)}）`);
  }
}

/**
 * 是否 age 加密载荷（读侧向后兼容判定）：
 * true → 走 decryptWithAge；false → 按明文旧格式解析。
 */
export function isAgePayload(line: string): boolean {
  return typeof line === 'string' && line.startsWith(AGE_MAGIC_PREFIX);
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== AGE_KEY_BYTES) {
    throw new Error(`age 密钥长度必须为 ${AGE_KEY_BYTES} 字节，实际 ${key.length}`);
  }
}
