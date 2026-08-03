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
//
// ⚠️ F-24 双副本说明（勿混淆）：本仓库有两份同名 audit-history.ts，职责不同、**不可合并**：
//   - 【本文件】engine/core/src/audit-history.ts —— 底层「哈希链完整性」原语层。
//     零上层依赖（只用 node 内置 + core 自身），提供 getHistoryFilePath /
//     getEnvFingerprint / getHmacKey / stableStringify / checkHistoryChainDetailed /
//     checkHistoryChainIntegrity / validateHmacKey。供 doctor、daemon 等任意包直接复用。
//   - engine/audit/src/audit-history.ts —— 业务「审计历史持久化」层。re-export 本文件
//     的原语，并叠加 AuditHistoryEntry 类型 + appendHistory/loadHistory/clearHistory
//     （依赖 audit 域的规则结果类型与 sanitize 管道）。
//   依赖方向单向：audit → core（core 绝不反向依赖 audit）。若把业务持久化下沉到 core，
//   会把 audit 的规则结果域类型拖进底座，违反 core「零上层依赖」分层契约，故保持两份。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash, createHmac } from 'crypto';
import { hostname, userInfo, homedir } from 'os';
import { execSync } from 'child_process';
import { AUDIT_HISTORY } from './data-paths';

/**
 * 获取审计历史文件路径
 * 解析链（v1.2.1）：显式 dataDir 参数 > SOFAGENT_DATA 环境变量 > data/audit/history.jsonl
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function getHistoryFilePath(dataDir?: string): string {
  const dir = dataDir ?? process.env.SOFAGENT_DATA;
  if (dir) return join(dir, 'audit', 'history.jsonl');
  // v1.2.1：默认路径从 .sofagent/audit/ 迁移到 data/audit/
  return AUDIT_HISTORY;
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
  } catch (err) {
    console.error('[audit-history] 获取环境指纹失败（git 不可用）:', err);
  }
  const base = `${hostname()}-${userInfo().username}-${gitDir}-${dataDir ?? ''}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 8);
}

/**
 * HMAC 密钥路径（v1.1.8+）
 * 来自 ~/.sofagent-key（建议 chmod 600，Agent 默认不读取）。
 * P1-4: 支持 SOFAGENT_KEY_PATH 环境变量覆盖（测试隔离用，避免测试触碰真实密钥）。
 */
function getSofagentKeyPath(): string {
  return process.env.SOFAGENT_KEY_PATH || join(homedir(), '.sofagent-key');
}

/**
 * 读取 HMAC 密钥（v1.1.8+）。
 * 密钥来自 ~/.sofagent-key（chmod 600，Agent 默认不读取）。
 * 存在则返回密钥字符串；不存在返回 null（降级为 SHA-256，向后兼容）。
 */
export function getHmacKey(): string | null {
  try {
    const keyPath = getSofagentKeyPath();
    if (!existsSync(keyPath)) return null;
    return readFileSync(keyPath, 'utf-8').trim();
  } catch (err) {
    console.error('[audit-history] 读取 HMAC 密钥失败:', err);
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
  /** P0-3 (2026-08-02 复核修正)：写入时记录的环境指纹。HMAC 不匹配时用它区分「真篡改（指纹一致）」与「环境漂移（指纹不一致）」 */
  envFingerprint?: unknown;
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
 * 链校验结果状态（FLAG-2 修复 + P0-3 2026-08-02 复核修正）
 * - 'ok'：链完整且可验签（或降级 SHA-256 通过）
 * - 'tampered'：检测到篡改（红色告警）——「无环境指纹的旧算法 prevHash 不匹配」
 *   或「stable 条目 HMAC 不匹配且环境指纹一致」（环境无关、确为内容被改）
 * - 'unverifiable'：历史段不可复验（黄色提示）——HMAC 验签不匹配且环境指纹不一致
 *   （密钥轮换 / 环境指纹漂移）或旧条目（无法区分「篡改」与「漂移」）
 * - 'insufficient'：历史不存在或不足 2 条（P0-3：删除/单条不再报 ok，报不可信）
 */
export type ChainCheckStatus = 'ok' | 'tampered' | 'unverifiable' | 'insufficient';

export interface ChainCheckResult {
  status: ChainCheckStatus;
  /** 人类可读说明（doctor 输出用） */
  detail?: string;
  /** 首个异常条目下标（调试用） */
  index?: number;
}

/**
 * P0-5: 验证 history.jsonl 的 hash chain 完整性（详细判定版，FLAG-2 修复 + P0-3 复核修正）
 *
 * 区分三类异常（篡改优先于不可复验）：
 *   ① 篡改检测（tampered，红）：
 *      - 「无环境指纹的旧算法 prevHash 不匹配」——环境无关、确为内容被改。
 *      - 「stable 条目（hashVersion=2 且记录 envFingerprint）HMAC 不匹配且
 *        envFingerprint 与当前指纹一致」——指纹一致说明运行环境未变，HMAC 不匹配
 *        只能是内容在签名后被改（2026-08-02 复核修正：原方案一刀切判黄导致
 *        v2 条目篡改检测不到，P0-3 核心缺陷）。
 *      - 「stable 条目（hashVersion 未定义/非 2，无指纹）HMAC 不匹配」——环境无关。
 *   ② 不可复验（unverifiable，黄）：
 *      - stable 条目（hashVersion=2）HMAC 不匹配但 envFingerprint 与当前指纹不一致
 *        （密钥轮换 / hostname / username / git 路径 / dataDir 漂移）——无法区分
 *        「篡改」与「漂移」，属历史证据不可复验，不报「链断裂/篡改」。
 *      - stable 条目（hashVersion=2）HMAC 不匹配但条目未记录 envFingerprint
 *        （旧版写入的 v2 条目）——无法区分，归黄。
 *      - 旧条目（无 hmacAlgo）HMAC 不匹配——写入侧用内存 key 顺序签名，读侧无法复现。
 *   ③ 不可信（insufficient，黄/灰）：history.jsonl 不存在或仅 1 条——无法构成
 *      可验证的防篡改链（P0-3：删除/单条不再报 ok）。
 *
 * @param dataDir 可选的数据目录覆盖
 * @returns ChainCheckResult
 */
export function checkHistoryChainDetailed(dataDir?: string): ChainCheckResult {
  const filePath = getHistoryFilePath(dataDir);

  if (!existsSync(filePath)) {
    // P0-3：无历史文件 = 无法验证（不是「未受损」）。删除整个审计历史不再报 ok。
    return { status: 'insufficient', detail: '审计历史文件不存在，无法验证防篡改链' };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('[audit-history] 读取审计历史文件失败:', err);
    return { status: 'tampered', detail: 'history.jsonl 读取失败（疑似权限/损坏）' };
  }

  const entries: ChainEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    try {
      const parsed = JSON.parse(trimmed) as ChainEntry;
      entries.push(parsed);
    } catch (err) {
      console.error('[audit-history] 解析审计条目 JSON 失败:', err);
    }
  }

  // P0-3：0 或 1 条记录无法构成可验证链 → insufficient（不再报 ok）
  if (entries.length <= 1) {
    return { status: 'insufficient', detail: '审计历史不足 2 条，无法构成可验证的防篡改链' };
  }

  // v1.0.6: 逐条判断 hashVersion——支持新旧格式混合
  // 旧用户升级后 history.jsonl 可能混合旧条目（无 hashVersion）和新条目（hashVersion:2）
  // 不用 firstEntry 一刀切，而用每条 curr 自己的 hashVersion 决定算法
  const fingerprint = getEnvFingerprint(dataDir);
  const hmacKey = getHmacKey();
  const keyAvailable = hmacKey !== null;

  // FLAG-2：篡改优先于「不可复验」——唯一明确判篡改（红）的是
  // 「无环境指纹的旧算法 prevHash 不匹配」（环境无关、确为内容被改）；
  // 其余 HMAC / v2 指纹相关异常一律归为「历史不可复验（黄）」，
  // 因为这些异常无法在当前侧区分「真·篡改」与「密钥轮换 / 环境漂移」。
  let foundUnverifiable = false;

  // v1.2.6 F22: 创世条目（entries[0]）HMAC 验签——
  // 主循环从 i=1 开始（校验 prevHash 链），entries[0] 从未被独立校验。
  // 攻击者可篡改创世条目内容（如修改初始审计结果）而不被检测。
  // 在主循环之前对创世条目做 HMAC 验签（复用已有逻辑，不引入新字段）。
  const genesisEntry = entries[0]!;
  if (
    genesisEntry &&
    typeof genesisEntry.hmacSig === 'string' &&
    genesisEntry.hmacSig &&
    keyAvailable &&
    hmacKey
  ) {
    const genesisUseFingerprint = genesisEntry.hashVersion === 2;
    const genesisRecordForSig = {
      ...genesisEntry,
      prevHash: undefined,
      hashVersion: undefined,
      hmacSig: undefined,
      hmacAlgo: undefined,
    };
    const genesisHashInput = genesisUseFingerprint
      ? stableStringify(genesisRecordForSig) + '|' + fingerprint
      : stableStringify(genesisRecordForSig);
    const genesisExpectedHmac = createHmac('sha256', hmacKey)
      .update(genesisHashInput)
      .digest('hex')
      .slice(0, 32);
    if (genesisEntry.hmacSig !== genesisExpectedHmac) {
      if (genesisEntry.hmacAlgo === 'stable' && !genesisUseFingerprint) {
        // stable 条目（无环境指纹）：HMAC 不匹配 = 内容被改 → tampered（红）
        return { status: 'tampered', index: 0, detail: `创世条目（索引 0）HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改` };
      }
      // 其余情况（v2 指纹条目或旧条目）归为不可复验（黄）
      foundUnverifiable = true;
    }
  }

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]!;
    const curr = entries[i]!;

    // 用当前条目的 hashVersion 决定算法（而非 firstEntry 一刀切）
    // hashVersion === 2：写入时用了环境指纹，校验也用指纹
    // hashVersion 未定义 / === 1：写入时没指纹，校验也不用指纹
    const currUseFingerprint = curr.hashVersion === 2;

    // 1) prevHash 链校验（权威完整性判定，key 顺序无关）
    // P0-3 修复：跳过无 prevHash 的 legacy 条目（本就不在链上，避免假阳性）。
    if (curr.prevHash == null || curr.prevHash === 'unknown') continue;

    const recordForHash = { ...prev, prevHash: undefined, hashVersion: undefined };
    const hashInput = currUseFingerprint
      ? JSON.stringify(recordForHash) + '|' + fingerprint
      : JSON.stringify(recordForHash);
    const expectedPrevHash = createHash('sha256')
      .update(hashInput)
      .digest('hex').slice(0, 16);

    if (curr.prevHash !== expectedPrevHash) {
      if (currUseFingerprint) {
        // v2 段（含环境指纹）prevHash 不匹配：环境指纹 / hostname / username /
        // git 路径或 ~/.sofagent-key 已漂移，无法复现写入时签名 →
        // 属历史证据不可复验（黄），非篡改，不报「链断裂/篡改」。
        foundUnverifiable = true;
      } else {
        // 无环境指纹的旧算法 prevHash 不匹配：环境无关，属真·篡改（红）。
        return { status: 'tampered', index: i, detail: `历史条目 ${i} prevHash 不匹配（旧算法，环境无关），疑似内容被篡改` };
      }
      // v2 漂移：已记 unverifiable，跳过本条 HMAC，进入下一条
      continue;
    }

    // 2) HMAC 验签（仅当条目带 hmacSig 且有密钥时）
    // v1.2.1: hmacAlgo==='stable' 的条目用 stableStringify 签名，读侧可正确复现。
    // P0-3 (2026-08-02 复核修正)：HMAC 不匹配时先用「条目记录的环境指纹」与当前指纹比对——
    //   fingerprint 一致但 HMAC 不匹配 = 真篡改（红）；fingerprint 不一致（环境漂移） = 不可复验（黄）。
    //   旧条目（无 hmacAlgo）写入侧用内存 key 顺序签名，读侧无法复现，
    //   HMAC 不匹配归为不可复验（黄）——无法区分「篡改」与「密钥轮换」。
    if (curr.hmacSig && keyAvailable && hmacKey) {
      // hmacAlgo 仅作标记，不参与 HMAC 计算（写入侧 recordForSig 也不含它），保证两侧一致
      const recordForSig = { ...curr, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
      // F-08：.slice(0, 32) 截断到 128bit——必须与写侧（audit/audit-history.ts appendHistory
      // 的 hmacSig 生成）使用**同一**截断长度，否则验签恒不匹配。128bit 防篡改强度充分
      // （伪造需 2^128 尝试），截断同时节省每条记录的存储空间。
      const expectedHmac = createHmac('sha256', hmacKey)
        .update(stableStringify(recordForSig) + '|' + fingerprint)
        .digest('hex').slice(0, 32);
      if (curr.hmacSig !== expectedHmac) {
        if (curr.hmacAlgo === 'stable') {
          if (currUseFingerprint) {
            // hashVersion===2（带环境指纹）：HMAC 不匹配可能因「篡改」或「环境指纹漂移」。
            // 用条目记录的环境指纹区分：
            const recordedFingerprint = curr.envFingerprint;
            if (typeof recordedFingerprint === 'string' && recordedFingerprint.length > 0) {
              if (recordedFingerprint === fingerprint) {
                // 指纹一致 + HMAC 不匹配 → 运行环境未变，只能是内容在签名后被改 → 真篡改（红）
                return { status: 'tampered', index: i, detail: `历史条目 ${i} HMAC 签名不匹配（环境指纹一致，确为内容被篡改）` };
              }
              // 指纹不一致（hostname/git 路径/dataDir/密钥漂移）→ 不可复验（黄）
              foundUnverifiable = true;
            } else {
              // hashVersion=2 但条目未记录 envFingerprint（旧版写入的 v2 条目）：
              // 无法区分「篡改」与「漂移」→ 不可复验（黄）
              foundUnverifiable = true;
            }
          } else {
            // hashVersion 未定义/非2（无指纹但用了 stable 签名）：环境无关，HMAC 不匹配 = 内容被改 → tampered（红）
            return { status: 'tampered', index: i, detail: `历史条目 ${i} HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改` };
          }
        } else {
          // 旧条目（无 hmacAlgo）：写入侧用内存 key 顺序签名，读侧无法复现 → 归为不可复验（黄）
          foundUnverifiable = true;
        }
      }
    }
  }

  if (foundUnverifiable) {
    return {
      status: 'unverifiable',
      detail: '部分历史段（v2 含环境指纹条目）因 ~/.sofagent-key 或环境指纹漂移无法复验，属历史证据不可复验，非篡改',
    };
  }

  return { status: 'ok' };
}

/**
 * P0-5: 验证 history.jsonl 的 hash chain 完整性（boolean 兼容版）
 * @deprecated 布尔语义无法区分「篡改」「历史不可复验」与「不可信」，新代码请用 checkHistoryChainDetailed
 * @returns true = 链完整（含可降级），false = 存在篡改、不可复验段或历史不足（insufficient）
 */
export function checkHistoryChainIntegrity(dataDir?: string): boolean {
  // 向后兼容：保留 boolean 契约（audit 包外部 API / acceptance-test.sh 依赖）。
  // 注：'unverifiable' 与 'insufficient' 均返回 false——不可复验段 / 历史不足同样
  //     视为「非完整」，但 doctor 已改用 checkHistoryChainDetailed 单独归类为黄色提示而非红色篡改。
  return checkHistoryChainDetailed(dataDir).status === 'ok';
}

/**
 * HMAC 密钥强度校验（FLAG-4 最小安全实现）
 * 密钥来自 ~/.sofagent-key（chmod 600）。空密钥或长度不足（<16 字节）视为弱密钥，
 * 用于签名会稀释强校验能力——调用方应在启动时告警，避免静默使用弱密钥。
 * @returns HmacKeyStatus
 */
export interface HmacKeyStatus {
  /** 密钥文件是否存在 */
  configured: boolean;
  /** 密钥是否足够强（非空且 ≥16 字节） */
  strong: boolean;
  /** 弱密钥/异常原因（configured=true 且 strong=false 时有值） */
  reason?: string;
}

export function validateHmacKey(): HmacKeyStatus {
  const key = getHmacKey();
  if (key === null) return { configured: false, strong: false };
  const trimmed = key.trim();
  const byteLen = Buffer.byteLength(trimmed, 'utf-8');
  if (byteLen === 0) {
    return { configured: true, strong: false, reason: '密钥为空（~/.sofagent-key 仅含空白）' };
  }
  if (byteLen < 16) {
    return { configured: true, strong: false, reason: `密钥长度不足（${byteLen} 字节，建议 ≥16 字节 / 128-bit）` };
  }
  return { configured: true, strong: true };
}
