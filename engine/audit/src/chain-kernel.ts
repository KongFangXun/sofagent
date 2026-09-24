// ============================================================
// chain-kernel.ts · HMAC 审计链协议内核（单一事实源 · v1.5.1 第〇批收口）
//
// 背景 / Background：
//   同一条 HMAC 审计链协议此前被复刻在三处，彼此零 import、无跨模块对拍，
//   一致性只靠注释维系：
//     · engine/audit/src/decision-log.ts        —— decision-log.jsonl 写侧
//     · engine/audit/src/decision-chain.ts      —— decision-log.jsonl 验侧
//     · engine/train/src/train-audit.ts —— audit.jsonl 写/验侧（复刻）
//   本文件把「写链（appendChained）」与「验链（verifyChain）」两个方向收口为
//   唯一实现；上述三处改为调用本内核。协议变更此后只需改一处。
//   This file consolidates the duplicated HMAC audit-chain protocol into one
//   implementation; the three call sites above now delegate here.
//
// 五步协议（逐字对齐历史实现）/ The five-step protocol：
//   1) prevHash：读末行 → sha256(JSON.stringify(lastRecordForHash) + '|' + fingerprint).slice(0,16)
//   2) 铁律：先脱敏再签名——脱敏由调用方在调用本函数**之前**完成；
//      内核只签名它收到的 record（不做任何后置脱敏）。
//      Sanitize BEFORE signing; the kernel signs exactly what it receives.
//   3) recordForSig 排除链字段（prevHash / hashVersion / hmacSig / hmacAlgo）
//   4) hmacSig = HMAC-SHA256(key, stableStringify(recordForSig) + '|' + fingerprint).hex.slice(0,32)
//   5) atomicAppendSync（@sofagent/core）+ chmodSync 0o600（权限失败仅告警不阻断）
//
// 四态判定（verifyChain）/ Four-state verdict：
//   'ok'           链完整且可验签（或降级 SHA-256 链自洽）
//   'tampered'     真篡改（红）：指纹一致但 HMAC 不匹配 / 无指纹旧算法 prevHash 不匹配
//   'unverifiable' 不可复验（黄）：环境指纹漂移（密钥轮换 / hostname / git 路径变化）
//   'insufficient' 历史不足（灰）：不存在或不足 2 条
//
// 可扩展性 / Extensibility：
//   内核**不硬编码** kind/event 白名单——由调用方经 validKinds 传入
//   （decision-log 传 VALID_KINDS；train-audit 传 VALID_EVENT_TYPES）。
//   错误类型同样不硬编码——调用方经 onInvalidKind / onWriteError 工厂注入
//   （decision-log 抛 DecisionSchemaError / DecisionWriteError；
//    train-audit 抛 TrainAuditSchemaError / TrainAuditWriteError），
//   保证既有错误契约逐字不变。
// ============================================================

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'fs';
import { dirname } from 'path';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { atomicAppendSync, stableStringify } from '@sofagent/core';

// ════════════════════════════════════════
// 类型 / Types
// ════════════════════════════════════════

/** 链校验结果状态（与 core ChainCheckStatus 同构）/ Chain check status */
export type ChainCheckStatus = 'ok' | 'tampered' | 'unverifiable' | 'insufficient';

/** 链校验结果 / Chain check result */
export interface ChainCheckResult {
  status: ChainCheckStatus;
  /** 人类可读说明（doctor 输出用）/ Human-readable detail */
  detail?: string;
  /** 首个异常条目下标（调试用）/ First anomalous entry index */
  index?: number;
}

/** 记录中由内核生成/接管的链字段 / Chain fields owned by the kernel */
export interface ChainFields {
  prevHash: string;
  hashVersion: 2;
  envFingerprint: string;
  hmacAlgo?: 'stable';
  hmacSig?: string;
}

/**
 * 链条目类型（v1.5.1 第七章·审计输入双通道）/ Chain entry type。
 *
 * - `intent`：调用意图条目（宿主 `tools/pre-execute` 事件——参数级意图：`rm -rf` 的
 *   path、写文件落点、外发 host 全在参数里，结果文本通道看不见）
 * - `result`：结果文本条目（宿主 `tools/result` 事件 / 既有 git diff 审计）
 *
 * 🔴 向后兼容：缺省 `undefined` = 历史条目（无该字段）——既有链结构、prevHash/HMAC
 * 两条哈希输入、既有 golden vector 与双实现差分测试**逐字不变**。
 */
export type ChainEntryType = 'intent' | 'result';

/**
 * appendChained 选项 / Options for appendChained。
 *
 * key / fingerprint 由调用方从 @sofagent/core 解析后显式传入（不在内核内部取
 * 环境值）——如此内核才可在测试中被固定密钥 + 固定指纹锚定（golden vector）。
 */
export interface AppendChainedOptions {
  /** 目标 JSONL 文件绝对路径（append-only）/ Absolute path of the target JSONL file */
  filePath: string;
  /**
   * 合法 kind/event 集合——由调用方自持（内核不硬编码）。
   * decision-log 传 VALID_KINDS；train-audit 传 VALID_EVENT_TYPES。
   * Allowed kind/event values, supplied by the caller (never hard-coded).
   */
  validKinds: readonly string[];
  /** HMAC 密钥（null = 无密钥，降级 SHA-256 链——hmacSig 缺省）/ HMAC key, null to degrade */
  key: string | null;
  /** 环境指纹（写入 envFingerprint 字段并纳入签名输入）/ Environment fingerprint */
  fingerprint: string;
  /** 记录中承载 kind 的字段名（缺省 'kind'；train-audit 传 'type'）/ Kind field name */
  kindField?: string;
  /**
   * 条目类型（v1.5.1 第七章）——内核在**链字段装配之前**把它写入 `kindField` 指定的
   * 字段，故该字段必然落在两条哈希输入之内：
   *   · prevHash 输入 = JSON.stringify(omitHashFields(上一条)) + '|' + fingerprint
   *   · hmacSig  输入 = stableStringify(omitSigFields(本条)) + '|' + fingerprint
   * 两者都按字段全量展开，故注入的条目类型被签名覆盖——事后改条目类型与改业务
   * 内容同判据（指纹一致时判 tampered），不可能「把 intent 条目改标成 result 而不留痕」。
   *
   * 🔴 缺省 `undefined` = 不写入任何字段、不做任何分支——哈希输入逐字不变，
   * 既有 decision-log.jsonl / audit.jsonl 两条链与其 golden vector 零影响。
   */
  entryType?: ChainEntryType;
  /**
   * 非法 kind 时构造的错误（调用方自持错误类型）。
   * 缺省抛 ChainKernelError（内核独立可用场景）。
   */
  onInvalidKind?: (kind: unknown, validKinds: readonly string[]) => Error;
  /**
   * 建目录 / 原子追加失败时构造的错误（调用方自持错误类型）。
   * 缺省抛 ChainKernelError（内核独立可用场景）。
   */
  onWriteError?: (message: string, cause: unknown) => Error;
  /** 权限收紧失败告警前缀（缺省 '[chain-kernel]'）/ Warning log prefix */
  logLabel?: string;
}

/** verifyChain 选项 / Options for verifyChain */
export interface VerifyChainOptions {
  /** HMAC 密钥（null = 无密钥，仅验 prevHash 链）/ HMAC key (null = chain-only) */
  key: string | null;
  /** 环境指纹 / Environment fingerprint */
  fingerprint: string;
  /**
   * 明细文案主语（缺省 '链'）——decision-chain 传 '决策'、train-audit 传 '审计'，
   * 使 detail 文案与收口前逐字一致。仅影响人类可读文案，不影响判定。
   * Display-only label used in detail messages.
   */
  subject?: string;
}

// ════════════════════════════════════════
// 错误 / Errors（内核独立可用时的缺省错误类型）
// ════════════════════════════════════════

/** 内核契约违规（非法 kind）/ Kernel contract violation (invalid kind) */
export class ChainKernelError extends Error {
  constructor(message: string) {
    super(`[chain-kernel] ${message}`);
    this.name = 'ChainKernelError';
  }
}

// ════════════════════════════════════════
// 内部工具 / Internals
// ════════════════════════════════════════

/** 链字段——签名输入必须排除者（prevHash 链的输入只排除 prevHash/hashVersion） */
const SIG_EXCLUDED_FIELDS = ['prevHash', 'hashVersion', 'hmacSig', 'hmacAlgo'] as const;

/** 链校验使用的轻量条目类型——仅含校验所需字段 */
interface ChainEntry {
  prevHash?: unknown;
  hashVersion?: unknown;
  hmacSig?: unknown;
  hmacAlgo?: unknown;
  envFingerprint?: unknown;
  /** 条目类型（v1.5.1 第七章）——历史条目无此字段；校验侧不改判定，仅供举证区分 */
  entryType?: unknown;
}

/**
 * prevHash 输入——仅排除 prevHash / hashVersion。
 *
 * ⚠️ 与签名输入（{@link omitSigFields}）不同：此处的 recordForHash **保留**
 * 前一条目的 hmacSig / hmacAlgo（历史实现如此，改变会破坏既有链的 prevHash 复算）。
 */
function omitHashFields(entry: Record<string, unknown>): Record<string, unknown> {
  return { ...entry, prevHash: undefined, hashVersion: undefined };
}

/** 签名输入——排除全部链字段（prevHash / hashVersion / hmacSig / hmacAlgo） */
function omitSigFields(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entry };
  for (const field of SIG_EXCLUDED_FIELDS) out[field] = undefined;
  return out;
}

/** 计算 prevHash（读末行记录 → sha256(JSON.stringify(recordForHash) + '|' + fingerprint).slice(0,16)） */
function computePrevHash(lastEntry: Record<string, unknown>, fingerprint: string): string {
  return createHash('sha256')
    .update(JSON.stringify(omitHashFields(lastEntry)) + '|' + fingerprint)
    .digest('hex')
    .slice(0, 16);
}

/** 计算 HMAC 签名（stableStringify(recordForSig) + '|' + fingerprint，取前 32 位 hex） */
function computeHmacSig(
  entry: Record<string, unknown>,
  key: string,
  fingerprint: string,
): string {
  return createHmac('sha256', key)
    .update(stableStringify(omitSigFields(entry)) + '|' + fingerprint)
    .digest('hex')
    .slice(0, 32);
}

// ════════════════════════════════════════
// 写链 / appendChained
// ════════════════════════════════════════

/**
 * 追加一条记录到链式 JSONL（受控写唯一入口）。
 *
 * 承载五步协议（见文件头）。调用方须在调用前完成「业务字段校验 + 脱敏」，
 * 并把业务字段（不含任何链字段）作为 record 传入。
 *
 * @param record 业务字段记录（已脱敏、不含链字段）
 * @param options 见 {@link AppendChainedOptions}
 * @returns 落盘的完整条目（业务字段 + 链字段）
 * @throws onInvalidKind 工厂构造的错误（kind ∉ validKinds）
 * @throws onWriteError 工厂构造的错误（建目录 / 原子追加失败）
 */
export function appendChained<T extends object>(
  record: T,
  options: AppendChainedOptions,
): T & ChainFields & { entryType?: ChainEntryType } {
  const {
    filePath,
    validKinds,
    key,
    fingerprint,
    kindField = 'kind',
    entryType,
    onInvalidKind,
    onWriteError,
    logLabel = '[chain-kernel]',
  } = options;

  // ── 条目类型注入（v1.5.1 第七章）——位置在所有既有步骤之前：
  //    ① 先于 kind 门：entryType 本身就是 kindField 的合法值来源（本仓意图通道
  //       以 kindField='entryType' + validKinds=['intent','result'] 接线）；
  //    ② 先于哈希输入装配：注入后的记录才是 prevHash / hmacSig 两条输入的被签对象。
  //    未传 entryType 时 source 即原对象本身，后续每一步与改造前逐字一致。
  //    （浅拷贝注入——绝不改动调用方传入的 record。）
  const recordAsDict: Record<string, unknown> =
    entryType === undefined
      ? (record as Record<string, unknown>)
      : { ...(record as Record<string, unknown>), [kindField]: entryType };

  // ── 0. kind 门（调用方自持白名单——内核不硬编码）──
  const kindValue = recordAsDict[kindField];
  if (typeof kindValue !== 'string' || !validKinds.includes(kindValue)) {
    const makeError =
      onInvalidKind ??
      ((kind: unknown) => new ChainKernelError(`非法 kind "${String(kind)}"——不在调用方提供的 validKinds 内`));
    throw makeError(kindValue, validKinds);
  }

  const makeWriteError =
    onWriteError ?? ((message: string, cause: unknown) => new ChainKernelError(`${message}${cause instanceof Error ? `（${cause.message}）` : ''}`));

  // ── 目录准备（收紧 0o700——与 history.jsonl 同语义）──
  const dir = dirname(filePath);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch (err) {
    throw makeWriteError(`创建目录失败 ${dir}`, err);
  }

  // ── 1. prevHash（读末行——v1.5.2 finding-25：倒序按块读，不再全量 readFileSync）──
  let prevHash = 'genesis';
  if (existsSync(filePath)) {
    try {
      const lastLine = readLastCompleteLine(filePath);
      if (lastLine !== undefined) {
        const lastEntry = JSON.parse(lastLine) as Record<string, unknown>;
        prevHash = computePrevHash(lastEntry, fingerprint);
      }
    } catch {
      // 末行解析失败——无法建立链，保守置 'unknown'（与 appendHistory 同语义）。
      // v1.4.9 审（F05）：不再静默——验侧（no-prevhash 分支）会把该链段黄化，但用户
      // 需要在写入时就被告知链完整性从哪里开始存疑。仅加警告，不改变写入行为。
      prevHash = 'unknown';
      console.error('[sofagent] ⚠️ 审计链末行损坏，新条目 prevHash 已置 unknown——该链段将无法复验，建议运行 sofagent doctor 检查');
    }
  }

  // ── 2-3. 先脱敏再签名（脱敏已在调用方完成）+ 链字段装配 ──
  const base: Record<string, unknown> = {
    ...recordAsDict,
    prevHash,
    hashVersion: 2,
    envFingerprint: fingerprint,
    hmacAlgo: key ? 'stable' : undefined,
  };

  // ── 4. 签名输入排除链字段 + HMAC（slice(0,32)）──
  const hmacSig = key ? computeHmacSig(base, key, fingerprint) : undefined;

  const finalEntry = { ...base, hmacSig } as T & ChainFields;

  // ── 5. 原子追加 + 收紧权限 0o600 ──
  try {
    atomicAppendSync(filePath, JSON.stringify(finalEntry));
  } catch (err) {
    throw makeWriteError(`atomicAppendSync 失败 ${filePath}`, err);
  }
  try {
    chmodSync(filePath, 0o600);
  } catch (err) {
    // 权限设置失败不阻断写入（与 appendHistory 同语义，仅告警）
    console.error(`${logLabel} 审计文件权限设置失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  return finalEntry;
}

// v1.5.2 finding-25：appendChained 取末行不再全量 readFileSync（审计链无轮转，
// 长期运行每次追加 O(n) 变慢、内存峰值线性上涨）。从文件末尾按 4KB 块倒序读，
// 取最后一个「完整且非空」的行；文件小于一块时整体读。兼容性不变：返回值与
// 全量读取 `readFileSync().trim().split('\n').filter(Boolean)` 的末行逐字一致
// （逐行 trim、空行过滤口径相同）。verifyChain / loadChain 全链读取不受影响。
function readLastCompleteLine(filePath: string): string | undefined {
  const CHUNK_SIZE = 4096;
  const size = statSync(filePath).size;
  if (size === 0) return undefined;
  let end = size;
  let windowBuf = Buffer.alloc(0);
  while (end > 0) {
    const chunkSize = Math.min(CHUNK_SIZE, end);
    const start = end - chunkSize;
    const buf = Buffer.alloc(chunkSize);
    const fd = openSync(filePath, 'r');
    try {
      readSync(fd, buf, 0, chunkSize, start);
    } finally {
      closeSync(fd);
    }
    windowBuf = Buffer.concat([buf, windowBuf]);
    end = start;
    const lines = windowBuf.toString('utf-8').split('\n');
    // 未到文件头时，窗口首行是没有以 \n 结束的残行，跳过不取
    const scanEnd = start === 0 ? lines.length : lines.length - 1;
    for (let i = scanEnd - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (line) return line;
    }
    // 本窗口内没有完整非空行——继续向前扩一块
  }
  return undefined;
}

// v1.5.2 修复：常量时间比较，对齐 pairing.ts 范式
// （engine/core/src/crypto/pairing.ts timingSafeEqual）——长度不等直接 false，
// 避免 timingSafeEqual 对不等长输入抛异常。
function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ════════════════════════════════════════
// 验链 / verifyChain
// ════════════════════════════════════════

/**
 * 校验链式 JSONL 的 HMAC 链完整性（四态判定）。
 *
 * 与 core checkHistoryChainDetailed 同判定哲学（篡改优先于不可复验）。
 * 入参为**已解析**的记录数组（JSONL 解析是调用方职责——坏行容错语义各异）。
 *
 * @param records 已解析记录数组
 * @param options 见 {@link VerifyChainOptions}
 * @returns { status, detail?, index? }
 */
export function verifyChain(
  records: readonly unknown[],
  options: VerifyChainOptions,
): ChainCheckResult {
  const { key, fingerprint, subject = '链' } = options;

  if (records.length <= 1) {
    return { status: 'insufficient', detail: `${subject}记录不足 2 条，无法构成可验证的防篡改链` };
  }

  const keyAvailable = key !== null;

  let foundUnverifiable = false;
  // v1.4.9 审（F03）：黄态原因标记——原因码与 core/audit-history noteUnverifiable 对齐，
  // 收口文案按原因分档（签名缺失 / 链接缺失 / 环境漂移），不再无条件断言「非篡改」。
  const unverifiableNotes: { index: number; reason: string }[] = [];
  const noteUnverifiable = (index: number, reason: string) => {
    unverifiableNotes.push({ index, reason });
  };

  // ── 创世条目独立验签（与 history 链一致）──
  const genesisEntry = records[0] as ChainEntry;
  if (
    genesisEntry &&
    typeof genesisEntry.hmacSig === 'string' &&
    genesisEntry.hmacSig &&
    keyAvailable &&
    key
  ) {
    const genesisUseFingerprint = genesisEntry.hashVersion === 2;
    const genesisHashInput = genesisUseFingerprint
      ? stableStringify(omitSigFields(genesisEntry as Record<string, unknown>)) + '|' + fingerprint
      : stableStringify(omitSigFields(genesisEntry as Record<string, unknown>));
    const genesisExpectedHmac = createHmac('sha256', key)
      .update(genesisHashInput)
      .digest('hex')
      .slice(0, 32);
    if (!timingSafeEq(genesisEntry.hmacSig, genesisExpectedHmac)) {
      if (genesisEntry.hmacAlgo === 'stable' && !genesisUseFingerprint) {
        return {
          status: 'tampered',
          index: 0,
          detail: `${subject}创世条目（索引 0）HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改`,
        };
      }
      // 篡改优先：仅 stable 算法 + v2 创世条目记录的 envFingerprint 与当前环境一致时，
      // HMAC 不匹配只能是内容在签名后被改——与主循环（下方 curr 分支 stable 门控）及
      // core/audit-history 创世分支（audit-history.ts:430）同判据。非 stable 创世条目
      // 同证据降为不可复验（黄），不再同证据三处两判（v1.4.9 审 F04）
      if (genesisEntry.hmacAlgo === 'stable' && genesisUseFingerprint) {
        const genesisRecordedFingerprint = genesisEntry.envFingerprint;
        if (
          typeof genesisRecordedFingerprint === 'string' &&
          genesisRecordedFingerprint.length > 0 &&
          genesisRecordedFingerprint === fingerprint
        ) {
          return {
            status: 'tampered',
            index: 0,
            detail: `${subject}创世条目（索引 0）HMAC 签名不匹配（环境指纹一致，确为内容被篡改）`,
          };
        }
      }
      foundUnverifiable = true;
      noteUnverifiable(0, 'genesis-hmac-drift');
    }
  } else if (genesisEntry && keyAvailable && key) {
    // 密钥在场但创世条目无签名：签名被剥离（攻击者无需密钥即可剥掉 hmacSig 重写链）
    // 或 legacy 未签名——无法证明完整性 → 不可复验（黄），不再静默跳过（与 core/audit-history 防签名剥离分支对齐）
    foundUnverifiable = true;
    noteUnverifiable(0, 'genesis-signature-stripped');
  }

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1] as ChainEntry;
    const curr = records[i] as ChainEntry;

    const currUseFingerprint = curr.hashVersion === 2;

    // 1) prevHash 链校验
    // v1.4.9 审（F01 防 prevHash 短路）：原实现对 prevHash 缺失/'unknown' 直接 continue，
    // 且该 continue 位于 HMAC 验签与防签名剥离分支之前——攻击者篡改条目内容后把
    // prevHash 改成 'unknown'（甚至连 hmacSig 一并删掉）即可整条免验，verifyChain
    // 返回 ok（红队三探针复现）。现在：有密钥时链接字段缺失只置黄（原因 no-prevhash），
    // 本条 HMAC 验签与防剥离分支照常执行（内容被改 + 原签名仍在 → tampered）；无密钥
    // 部署维持既有 legacy 跳过（LIMITATIONS.md 既有披露，不扩大行为变更面）。分支语义
    // 与 core/audit-history checkHistoryChainDetailed 的 no-prevhash 分支对齐。
    if (curr.prevHash == null || curr.prevHash === 'unknown') {
      if (!(keyAvailable && key)) continue;
      foundUnverifiable = true;
      noteUnverifiable(i, 'no-prevhash');
    } else {
      const recordForHash = omitHashFields(prev as Record<string, unknown>);
      const hashInput = currUseFingerprint
        ? JSON.stringify(recordForHash) + '|' + fingerprint
        : JSON.stringify(recordForHash);
      const expectedPrevHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

      if (!timingSafeEq(curr.prevHash as string, expectedPrevHash)) {
        if (currUseFingerprint) {
          foundUnverifiable = true;
          noteUnverifiable(i, 'v2-prevhash-drift');
        } else {
          return {
            status: 'tampered',
            index: i,
            detail: `${subject}条目 ${i} prevHash 不匹配（旧算法，环境无关），疑似内容被篡改`,
          };
        }
        continue;
      }
    }

    // 2) HMAC 验签
    if (curr.hmacSig && keyAvailable && key) {
      const expectedHmac = computeHmacSig(curr as Record<string, unknown>, key, fingerprint);
      if (!timingSafeEq(curr.hmacSig as string, expectedHmac)) {
        if (curr.hmacAlgo === 'stable') {
          if (currUseFingerprint) {
            const recordedFingerprint = curr.envFingerprint;
            if (typeof recordedFingerprint === 'string' && recordedFingerprint.length > 0) {
              if (recordedFingerprint === fingerprint) {
                return {
                  status: 'tampered',
                  index: i,
                  detail: `${subject}条目 ${i} HMAC 签名不匹配（环境指纹一致，确为内容被篡改）`,
                };
              }
              foundUnverifiable = true;
              noteUnverifiable(i, 'v2-hmac-fingerprint-drift');
            } else {
              foundUnverifiable = true;
              noteUnverifiable(i, 'v2-hmac-no-fingerprint');
            }
          } else {
            return {
              status: 'tampered',
              index: i,
              detail: `${subject}条目 ${i} HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改`,
            };
          }
        } else {
          foundUnverifiable = true;
          noteUnverifiable(i, 'legacy-hmac-unreproducible');
        }
      }
    } else if (keyAvailable && key && !curr.hmacSig) {
      // 密钥在场但条目无签名：签名被整链剥离伪装 legacy / legacy 未签名条目
      // ——无法证明完整性 → 不可复验（黄），不再静默放行（与 core/audit-history 防签名剥离分支对齐）
      foundUnverifiable = true;
      noteUnverifiable(i, 'signature-stripped');
    }
  }

  if (foundUnverifiable) {
    // v1.4.9 审（F03）：黄态收口文案按置位原因分档——签名缺失（疑似剥离/legacy）、
    // 链接字段缺失、密钥/指纹漂移三档，原因码枚举与 core/audit-history noteUnverifiable
    // 对齐。任何档位都不再出现无条件「非篡改」断言（系统无法做出该断言：门口挂警报，
    // 不进门递定心丸）。
    const SIG_MISSING_REASONS = ['genesis-signature-stripped', 'signature-stripped'];
    const LINK_MISSING_REASONS = ['no-prevhash'];
    const idxByReason = (reasons: readonly string[]) =>
      unverifiableNotes.filter((n) => reasons.includes(n.reason)).map((n) => n.index);
    const sigMissing = idxByReason(SIG_MISSING_REASONS);
    const linkMissing = idxByReason(LINK_MISSING_REASONS);
    const drift = unverifiableNotes
      .filter((n) => !SIG_MISSING_REASONS.includes(n.reason) && !LINK_MISSING_REASONS.includes(n.reason))
      .map((n) => n.index);
    const segs: string[] = [];
    if (sigMissing.length > 0) {
      segs.push(`段内 ${sigMissing.length} 条缺少 HMAC 签名（疑似被剥离或 legacy 未签名条目，索引: ${sigMissing.join(',')}）。该状态不等于确认篡改，也不可视为安全；请运行 sofagent doctor 与 verify 排查密钥与链完整性`);
    }
    if (linkMissing.length > 0) {
      segs.push(`段内 ${linkMissing.length} 条 prevHash 缺失或为 unknown，链链接不可复验（索引: ${linkMissing.join(',')}）；请运行 sofagent doctor 与 verify 排查链完整性`);
    }
    if (drift.length > 0) {
      // ⚠️ prevHash 不匹配有两种成因，**从这一个判据里区分不出来**，故文案必须同时列出：
      //   ① 环境指纹漂移（换机 / 重装 / 密钥轮换 / hostname 或 git 路径变化）——历史证据不可复验；
      //   ② 该条目**之前的留痕缺行或损坏**——坏行被读取方跳过、或有人手工删改过中间行；
      //      此时代替它参与哈希计算的是更早的一条，算出的 expectedPrevHash 自然对不上。
      //   只写①会把「链中段断裂」指向「去核对密钥轮换」，查错方向。实测：把链中段任意一条
      //   故意损坏后，本判据给出的 reason 与密钥漂移**完全相同**（v2-prevhash-drift）。
      segs.push(
        `段内 ${drift.length} 条 prevHash 不匹配（索引: ${drift.join(',')}）——两种成因不可由此区分：` +
          `① ~/.sofagent-key 或环境指纹漂移（换机/重装/密钥轮换）属历史证据不可复验；` +
          `② 该条目之前的留痕缺行或损坏（坏行被跳过或中间行被删改）属链中段断裂。` +
          `请一并核对密钥轮换**与**留痕完整性（sofagent doctor + verify）`,
      );
    }
    return {
      status: 'unverifiable',
      detail: `部分${subject}段无法复验：${segs.join('；')}；原因：${[...new Set(unverifiableNotes.map((n) => n.reason))].join(' / ')}`,
    };
  }

  return { status: 'ok' };
}
