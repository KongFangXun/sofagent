// ============================================================
// audit-history.ts · audit history chain integrity (sunk to core)
//
// v1.2.0: Sunk from @sofagent/audit/audit-history.ts to eliminate
// core's reverse dependency on audit (core → audit is forbidden;
// core is the zero-upper-layer-dependency base package).
//
// Functions moved:
//   getHistoryFilePath, getEnvFingerprint, getHmacKey,
//   checkHistoryChainIntegrity
//
// These functions depend only on node builtins + @sofagent/core,
// so they live naturally in core.
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash, createHmac } from 'crypto';
import { hostname, userInfo, homedir } from 'os';
import { execSync } from 'child_process';
import { loadEnvConfig } from './config-loader';

/**
 * 获取审计历史文件路径
 * 从 loadEnvConfig().dataDir 解析数据目录
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function getHistoryFilePath(dataDir?: string): string {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, 'audit', 'history.jsonl');
}

/**
 * 环境指纹——用于 hash chain 防篡改（v1.0.6+）。
 *
 * Agent 重算 hash chain 时如果不包含这个指纹，--doctor 重新校验会不一致。
 * 不是完美方案（Agent 如果知道算法可以伪造），但把门槛从"会写 JS"提高到
 * "需要逆向 hash 算法且知道本机 hostname/username/git 路径"。
 */
export function getEnvFingerprint(dataDir?: string): string {
  let gitDir = 'unknown';
  try {
    gitDir = execSync('git rev-parse --git-dir 2>/dev/null || echo "unknown"', { encoding: 'utf-8' }).trim();
  } catch {
    // git 不可用或不在 git 仓库中，使用 unknown
  }
  const base = `${hostname()}-${userInfo().username}-${gitDir}-${dataDir ?? ''}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 8);
}

/**
 * HMAC 密钥路径（v1.1.8+）
 * 来自 ~/.sofagent-key（建议 chmod 600，Agent 默认不读取）。
 */
const SOFAGENT_KEY_PATH = join(homedir(), '.sofagent-key');

/**
 * 读取 HMAC 密钥（v1.1.8+）。
 * 密钥来自 ~/.sofagent-key（chmod 600，Agent 默认不读取）。
 * 存在则返回密钥字符串；不存在返回 null（降级为 SHA-256，向后兼容）。
 */
export function getHmacKey(): string | null {
  try {
    if (!existsSync(SOFAGENT_KEY_PATH)) return null;
    return readFileSync(SOFAGENT_KEY_PATH, 'utf-8').trim();
  } catch {
    return null;
  }
}

/** 链校验函数使用的轻量条目类型——仅含校验所需字段 */
interface ChainEntry {
  prevHash?: unknown;
  hashVersion?: unknown;
  hmacSig?: unknown;
}

/**
 * P0-5: 验证 history.jsonl 的 hash chain 完整性
 * 检测中间条目是否被篡改
 * @param dataDir 可选的数据目录覆盖
 * @returns true = 链完整，false = 链断裂
 */
export function checkHistoryChainIntegrity(dataDir?: string): boolean {
  const filePath = getHistoryFilePath(dataDir);

  if (!existsSync(filePath)) {
    return true; // 无历史文件 = 未受损
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }

  const entries: ChainEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    try {
      const parsed = JSON.parse(trimmed) as ChainEntry;
      entries.push(parsed);
    } catch {
      // 跳过解析失败的行
    }
  }

  if (entries.length <= 1) return true; // 0 或 1 条记录无需验证

  // v1.0.6: 逐条判断 hashVersion——支持新旧格式混合
  // 旧用户升级后 history.jsonl 可能混合旧条目（无 hashVersion）和新条目（hashVersion:2）
  // 不用 firstEntry 一刀切，而用每条 curr 自己的 hashVersion 决定算法
  const fingerprint = getEnvFingerprint(dataDir);
  const hmacKey = getHmacKey();
  const keyAvailable = hmacKey !== null;

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]!;
    const curr = entries[i]!;

    // 用当前条目的 hashVersion 决定算法（而非 firstEntry 一刀切）
    // hashVersion === 2：写入时用了环境指纹，校验也用指纹
    // hashVersion 未定义 / === 1：写入时没指纹，校验也不用指纹
    const currUseFingerprint = curr.hashVersion === 2;

    // 计算预期 hash（排除 prevHash 和 hashVersion 字段避免自引用）
    const recordForHash = { ...prev, prevHash: undefined, hashVersion: undefined };
    const hashInput = currUseFingerprint
      ? JSON.stringify(recordForHash) + '|' + fingerprint
      : JSON.stringify(recordForHash);
    const expectedPrevHash = createHash('sha256')
      .update(hashInput)
      .digest('hex').slice(0, 16);

    if (curr.prevHash !== expectedPrevHash && curr.prevHash !== 'unknown') {
      return false; // 链断裂
    }

    // v1.1.8: 验证 HMAC 签名（条目带 hmacSig 且有密钥时）。
    // 有密钥却签名不符 = 篡改；无密钥时不校验（向后兼容降级模式）。
    if (curr.hmacSig && keyAvailable && hmacKey) {
      const recordForSig = { ...curr, prevHash: undefined, hashVersion: undefined, hmacSig: undefined };
      const expectedHmac = createHmac('sha256', hmacKey)
        .update(JSON.stringify(recordForSig) + '|' + fingerprint)
        .digest('hex').slice(0, 32);
      if (curr.hmacSig !== expectedHmac) {
        return false; // HMAC 校验失败 = 篡改
      }
    }
  }

  return true;
}
