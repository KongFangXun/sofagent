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
  /** P0-3: 写入侧签名算法标记。'stable' = 用 stableStringify 签名（新条目，可正确验签/检测篡改）；缺省 = 旧条目（内存 key 顺序签名，读侧不可复现，HMAC 不匹配不判篡改） */
  hmacAlgo?: unknown;
}

/**
 * 稳定序列化——递归按 key 字典序排序，使 JSON.stringify 输出与对象 key 顺序无关。
 *
 * 用于 HMAC 签名：写入时用「内存对象 key 顺序」构造 recordForSig，读取时从文件
 * 解析得到「文件 key 顺序」，两者 key 顺序不同会让 JSON.stringify 产生不同字符串，
 * 导致历史条目 HMAC 永远验签失败（P0-3 假阳性根因）。统一用稳定序列化消除顺序敏感性。
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortKeys);
  if (input && typeof input === 'object' && input.constructor === Object) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((input as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return input;
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

    // P0-3 修复：跳过无 prevHash 的 legacy 条目。
    // 哈希链引入前（v1.0.5 及更早）写入的历史记录没有 prevHash 字段（undefined），
    // 它们从未参与哈希链。若不做此判断，`undefined !== 计算哈希` 会恒为真，
    // 导致 --doctor 对这些「本就不在链上」的条目误报「hash chain 断裂」（假阳性）。
    // 带 'unknown' 占位（写入时解析失败）的条目同样视为非链上，跳过。
    if (curr.prevHash == null || curr.prevHash === 'unknown') continue;

    if (curr.prevHash !== expectedPrevHash) {
      return false; // 链断裂（真·篡改或无法复现的历史段）
    }

    // v1.1.8: 验证 HMAC 签名（条目带 hmacSig 且有密钥时）。
    // 有密钥却签名不符 = 篡改；无密钥时不校验（向后兼容降级模式）。
    // P0-3 修复：历史条目（v1.2.0 前）的 HMAC 用「内存对象 key 顺序」签名，读取时用
    // 「文件解析 key 顺序」，JSON.stringify 对 key 顺序敏感 → 旧条目必然验签失败。
    // prevHash 链（统一从文件解析，key 顺序无关）才是权威完整性判定，因此 HMAC
    // 不匹配不再判为链断裂，避免正常仓库误报「hash chain 断裂」。新写入的条目改用
    // stableStringify（见 appendHistory），可正确验签。
    if (curr.hmacSig && keyAvailable && hmacKey) {
      // hmacAlgo 仅作标记，不参与 HMAC 计算（写入侧 recordForSig 也不含它），保证两侧一致
      const recordForSig = { ...curr, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
      const expectedHmac = createHmac('sha256', hmacKey)
        .update(stableStringify(recordForSig) + '|' + fingerprint)
        .digest('hex').slice(0, 32);
      if (curr.hmacSig !== expectedHmac) {
        // P0-3 修复：区分「旧条目 key 顺序不可复现（误报）」与「新条目被篡改」。
        // 旧条目（无 hmacAlgo 标记，写入侧用内存对象 key 顺序签名，读侧无法复现）→
        //   HMAC 不匹配属历史/环境签名差异，不判链断裂，避免 --doctor 对旧仓库假阳性。
        // 新条目（hmacAlgo === 'stable'，写入侧用 stableStringify 签名）→
        //   HMAC 不匹配 = 真·篡改，判链断裂（保留审计工具的篡改检测能力）。
        if (curr.hmacAlgo === 'stable') {
          return false; // 新条目 HMAC 验签失败 = 篡改
        }
      }
    }
  }

  return true;
}
