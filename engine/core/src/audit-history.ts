// ============================================================
// audit-history.ts · audit history chain integrity (sunk to core)
//
// v1.4.1: Sunk from @sofagent/audit/audit-history.ts to eliminate
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
// ⚠️ 双副本说明（勿混淆）：本仓库有两份同名 audit-history.ts，职责不同、**不可合并**：
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
import { AUDIT_HISTORY, AUDIT_DECISION_LOG } from './data-paths';

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
 * 获取决策审计日志文件路径（v1.3.0 交付 6 T01）
 * 解析链与 getHistoryFilePath 完全一致（显式 dataDir 参数 > SOFAGENT_DATA 环境变量 > data/audit/decision-log.jsonl）。
 * 决策日志与 history.jsonl 同级兄弟文件——共用同一防篡改 HMAC 哈希链语义。
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function getDecisionLogPath(dataDir?: string): string {
  const dir = dataDir ?? process.env.SOFAGENT_DATA;
  if (dir) return join(dir, 'audit', 'decision-log.jsonl');
  return AUDIT_DECISION_LOG;
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
 * 支持 SOFAGENT_KEY_PATH 环境变量覆盖（测试隔离用，避免测试触碰真实密钥）。
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
  /** 写入侧签名算法标记。'stable' = 用 stableStringify 签名（新条目，可正确验签/检测篡改）；缺省 = 旧条目（内存 key 顺序签名，读侧不可复现，HMAC 不匹配不判篡改） */
  hmacAlgo?: unknown;
  /** (2026-08-02 复核修正)：写入时记录的环境指纹。HMAC 不匹配时用它区分「真篡改（指纹一致）」与「环境漂移（指纹不一致）」 */
  envFingerprint?: unknown;
}

/**
 * 稳定序列化——递归按 key 字典序排序，使 JSON.stringify 输出与对象 key 顺序无关。
 *
 * 用于 HMAC 签名：写入时用「内存对象 key 顺序」构造 recordForSig，读取时从文件
 * 解析得到「文件 key 顺序」，两者 key 顺序不同会让 JSON.stringify 产生不同字符串，
 * 导致历史条目 HMAC 永远验签失败(假阳性根因）。统一用稳定序列化消除顺序敏感性。
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
 * 链校验结果状态(修复 +  2026-08-02 复核修正）
 * - 'ok'：链完整且可验签（或降级 SHA-256 通过）
 * - 'tampered'：检测到篡改（红色告警）——「无环境指纹的旧算法 prevHash 不匹配」
 *   或「stable 条目 HMAC 不匹配且环境指纹一致」（环境无关、确为内容被改）
 * - 'unverifiable'：历史段不可复验（黄色提示）——HMAC 验签不匹配且环境指纹不一致
 *   （密钥轮换 / 环境指纹漂移）或旧条目（无法区分「篡改」与「漂移」）
 * - 'insufficient'：历史不存在或不足 2 条(删除/单条不再报 ok，报不可信）
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
 * 验证 history.jsonl 的 hash chain 完整性（详细判定版，修复 + 复核修正）
 *
 * 区分三类异常（篡改优先于不可复验）：
 *   ① 篡改检测（tampered，红）：
 *      - 「无环境指纹的旧算法 prevHash 不匹配」——环境无关、确为内容被改。
 *      - 「stable 条目（hashVersion=2 且记录 envFingerprint）HMAC 不匹配且
 *        envFingerprint 与当前指纹一致」——指纹一致说明运行环境未变，HMAC 不匹配
 *        只能是内容在签名后被改（2026-08-02 复核修正：原方案一刀切判黄导致
 *        v2 条目篡改检测不到，核心缺陷）。
 *      - 「stable 条目（hashVersion 未定义/非 2，无指纹）HMAC 不匹配」——环境无关。
 *   ② 不可复验（unverifiable，黄）：
 *      - stable 条目（hashVersion=2）HMAC 不匹配但 envFingerprint 与当前指纹不一致
 *        （密钥轮换 / hostname / username / git 路径 / dataDir 漂移）——无法区分
 *        「篡改」与「漂移」，属历史证据不可复验，不报「链断裂/篡改」。
 *      - stable 条目（hashVersion=2）HMAC 不匹配但条目未记录 envFingerprint
 *        （旧版写入的 v2 条目）——无法区分，归黄。
 *      - 旧条目（无 hmacAlgo）HMAC 不匹配——写入侧用内存 key 顺序签名，读侧无法复现。
 *   ③ 不可信（insufficient，黄/灰）：history.jsonl 不存在或仅 1 条——无法构成
 *      可验证的防篡改链(删除/单条不再报 ok）。
 *
 * @param dataDir 可选的数据目录覆盖
 * @returns ChainCheckResult
 */
export function checkHistoryChainDetailed(dataDir?: string, maxEntries?: number): ChainCheckResult {
  const filePath = getHistoryFilePath(dataDir);

  if (!existsSync(filePath)) {
    // 无历史文件 = 无法验证（不是「未受损」）。删除整个审计历史不再报 ok。
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
  /** 非标准 schema 行的原始内容（截断展示，结构异常检测用） */
  const malformedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    try {
      const parsed = JSON.parse(trimmed) as ChainEntry;
      entries.push(parsed);
      // 结构异常检测：JSON 合法但字段不符合审计记录 schema——
      // 伪造/篡改者手工追加的行（如 {"tampered":true,"hmacSig":"fake"}）能通过
      // JSON 解析，但缺审计记录必有字段（timestamp/exitCode），属篡改痕迹而非
      // legacy 漂移（legacy 条目仍有 timestamp/exitCode，只是无链字段）。
      // 带 event 字段的行是合法事件记录（如 rule_disabled），schema 天然不同，豁免。
      const rec = parsed as Record<string, unknown>;
      if (rec.event === undefined && (typeof rec.timestamp !== 'string' || typeof rec.exitCode !== 'number')) {
        malformedLines.push(trimmed.slice(0, 60));
      }
    } catch (err) {
      console.error('[audit-history] 解析审计条目 JSON 失败:', err);
      malformedLines.push(trimmed.slice(0, 60));
    }
  }

  // 非标准 schema 行 = 结构异常 = 篡改（红）。区别于 legacy 漂移（黄）：
  // 格式合法但 HMAC 不可复验（旧算法/密钥轮换）仍是 unverifiable。
  if (malformedLines.length > 0) {
    return {
      status: 'tampered',
      detail: `检测到 ${malformedLines.length} 行非标准 schema 记录（如: ${malformedLines[0]}），疑似伪造/篡改`,
    };
  }

  // v1.3.1 #14: 大量历史记录时全量校验性能开销大——支持 maxEntries 限制，
  // 只校验最近 N 条（doctor 默认 500）。--verify-chain 仍全量校验（传 undefined）。
  let entriesToCheck = entries;
  if (maxEntries !== undefined && maxEntries > 0 && entries.length > maxEntries) {
    entriesToCheck = entries.slice(entries.length - maxEntries);
  }

  // v1.3.1 #14: 当使用 maxEntries 截断时，insufficient 判定基于截断后的条目数。
  // entriesToCheck.length <= 1 → 无法构成可验证链
  if (entriesToCheck.length <= 1) {
    // 全量不足的特殊情况：若原始条目本身就 ≤1，报告真实不足；
    // 若是截断后只剩 1 条，报告「截断范围内不足」。
    if (entries.length <= 1) {
      return { status: 'insufficient', detail: '审计历史不足 2 条，无法构成可验证的防篡改链' };
    }
    // 有足够记录但截断范围内不足（极少发生，maxEntries=1 之类）
    return { status: 'insufficient', detail: `最近 ${maxEntries} 条范围内审计历史不足 2 条，无法构成可验证的防篡改链` };
  }

  // v1.0.6: 逐条判断 hashVersion——支持新旧格式混合
  // 旧用户升级后 history.jsonl 可能混合旧条目（无 hashVersion）和新条目（hashVersion:2）
  // 不用 firstEntry 一刀切，而用每条 curr 自己的 hashVersion 决定算法
  const fingerprint = getEnvFingerprint(dataDir);
  const hmacKey = getHmacKey();
  const keyAvailable = hmacKey !== null;

  // 篡改优先于「不可复验」——唯一明确判篡改（红）的是
  // 「无环境指纹的旧算法 prevHash 不匹配」（环境无关、确为内容被改）；
  // 其余 HMAC / v2 指纹相关异常一律归为「历史不可复验（黄）」，
  // 因为这些异常无法在当前侧区分「真·篡改」与「密钥轮换 / 环境漂移」。
  let foundUnverifiable = false;

  // v1.2.6 创世条目（entriesToCheck[0]）HMAC 验签——
  // 主循环从 i=1 开始（校验 prevHash 链），entriesToCheck[0] 从未被独立校验。
  // 攻击者可篡改创世条目内容（如修改初始审计结果）而不被检测。
  // 在主循环之前对创世条目做 HMAC 验签（复用已有逻辑，不引入新字段）。
  const genesisEntry = entriesToCheck[0]!;
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

  for (let i = 1; i < entriesToCheck.length; i++) {
    const prev = entriesToCheck[i - 1]!;
    const curr = entriesToCheck[i]!;

    // 用当前条目的 hashVersion 决定算法（而非 firstEntry 一刀切）
    // hashVersion === 2：写入时用了环境指纹，校验也用指纹
    // hashVersion 未定义 / === 1：写入时没指纹，校验也不用指纹
    const currUseFingerprint = curr.hashVersion === 2;

    // 1) prevHash 链校验（权威完整性判定，key 顺序无关）
    // v1.3.1 #4: 无 prevHash 的 legacy 条目不直接 continue（静默跳过），
    // 而是标记为 unverified——这些条目不在链上，无法验证完整性（可能伪造）。
    // 报告区分: verified（链上） / legacy（旧格式标记） / unverified（无链字段）。
    if (curr.prevHash == null || curr.prevHash === 'unknown') {
      foundUnverifiable = true;
      continue;
    }

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
    // (2026-08-02 复核修正)：HMAC 不匹配时先用「条目记录的环境指纹」与当前指纹比对——
    //   fingerprint 一致但 HMAC 不匹配 = 真篡改（红）；fingerprint 不一致（环境漂移） = 不可复验（黄）。
    //   旧条目（无 hmacAlgo）写入侧用内存 key 顺序签名，读侧无法复现，
    //   HMAC 不匹配归为不可复验（黄）——无法区分「篡改」与「密钥轮换」。
    if (curr.hmacSig && keyAvailable && hmacKey) {
      // hmacAlgo 仅作标记，不参与 HMAC 计算（写入侧 recordForSig 也不含它），保证两侧一致
      const recordForSig = { ...curr, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
      // .slice(0, 32) 截断到 128bit——必须与写侧（audit/audit-history.ts appendHistory
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
      detail: '部分历史段无法复验（含无 prevHash 的 legacy 条目 / v2 含环境指纹条目因 ~/.sofagent-key 或环境指纹漂移），属历史证据不可复验，非篡改',
    };
  }

  return { status: 'ok' };
}

/**
 * 验证 history.jsonl 的 hash chain 完整性（boolean 兼容版）
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
 * HMAC 密钥强度校验(最小安全实现）
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
  // v1.2.9: — 熵检测（弱密钥模式识别）
  // 🔴 v1.3.1 P2 修复：原实现用「唯一字符占比」判断，但 openssl rand -hex 32
  // 生成的密钥是 hex 编码（字符集天然只有 0-9a-f 16 种），64 字符重复度恒 ≥75%，
  // 导致官方推荐的生成方式永远被判「弱密钥」误报。改用 Shannon 熵（bit/char）：
  //   随机 hex ≈ 4.0 bit/char（通过）；手工弱密钥（重复/递增/单词）显著低于 3.0。
  // 示例：aaaaaaaaaaaa = 0；abcdabcdabcd = 2.0；qwertyqwerty = 2.58；
  //       1234567890123456 = 3.32（另有 weakPatterns 拦截）；随机 hex = 4.0。
  const charFreq: Record<string, number> = {};
  for (const c of trimmed) charFreq[c] = (charFreq[c] ?? 0) + 1;
  let shannonEntropy = 0;
  for (const c of Object.keys(charFreq)) {
    const p = charFreq[c]! / trimmed.length;
    shannonEntropy -= p * Math.log2(p);
  }
  if (shannonEntropy < 3.0) {
    return { configured: true, strong: false, reason: `密钥熵过低（${shannonEntropy.toFixed(2)} bit/char，可能为弱密钥）——建议用 openssl rand -hex 32 重新生成` };
  }
  // 检查常见弱密钥
  const weakPatterns = ['test-hmac-key', '1234567890', 'password', 'secret', 'changeme', 'aaaaaaaa'];
  const lowerKey = trimmed.toLowerCase();
  for (const weak of weakPatterns) {
    if (lowerKey.includes(weak)) {
      return { configured: true, strong: false, reason: `检测到弱密钥模式（含 "${weak}"）——建议用 openssl rand -hex 32 重新生成` };
    }
  }
  return { configured: true, strong: true };
}
