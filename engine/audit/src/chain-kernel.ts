// ============================================================
// chain-kernel.ts · HMAC 审计链协议内核（单一事实源 · v1.4.8 第〇批收口）
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

import { chmodSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { createHash, createHmac } from 'crypto';
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
): T & ChainFields {
  const {
    filePath,
    validKinds,
    key,
    fingerprint,
    kindField = 'kind',
    onInvalidKind,
    onWriteError,
    logLabel = '[chain-kernel]',
  } = options;

  const recordAsDict = record as Record<string, unknown>;

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

  // ── 1. prevHash（读末行）──
  let prevHash = 'genesis';
  if (existsSync(filePath)) {
    try {
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1]!;
        const lastEntry = JSON.parse(lastLine) as Record<string, unknown>;
        prevHash = computePrevHash(lastEntry, fingerprint);
      }
    } catch {
      // 末行解析失败——无法建立链，保守置 'unknown'（与 appendHistory 同语义）
      prevHash = 'unknown';
    }
  }

  // ── 2-3. 先脱敏再签名（脱敏已在调用方完成）+ 链字段装配 ──
  const base: Record<string, unknown> = {
    ...record,
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
    if (genesisEntry.hmacSig !== genesisExpectedHmac) {
      if (genesisEntry.hmacAlgo === 'stable' && !genesisUseFingerprint) {
        return {
          status: 'tampered',
          index: 0,
          detail: `${subject}创世条目（索引 0）HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改`,
        };
      }
      // 篡改优先：v2 创世条目记录的 envFingerprint 与当前环境一致时，HMAC 不匹配
      // 只能是内容在签名后被改——与主循环（下方 curr 分支）及 core/audit-history
      // 创世分支同判据，不误归「不可复验（黄）」（v1.4.9 审：创世/非创世判定对齐）
      if (genesisUseFingerprint) {
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
    }
  } else if (genesisEntry && keyAvailable && key) {
    // 密钥在场但创世条目无签名：签名被剥离（攻击者无需密钥即可剥掉 hmacSig 重写链）
    // 或 legacy 未签名——无法证明完整性 → 不可复验（黄），不再静默跳过（与 core/audit-history 防签名剥离分支对齐）
    foundUnverifiable = true;
  }

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1] as ChainEntry;
    const curr = records[i] as ChainEntry;

    const currUseFingerprint = curr.hashVersion === 2;

    // 1) prevHash 链校验
    if (curr.prevHash == null || curr.prevHash === 'unknown') continue;

    const recordForHash = omitHashFields(prev as Record<string, unknown>);
    const hashInput = currUseFingerprint
      ? JSON.stringify(recordForHash) + '|' + fingerprint
      : JSON.stringify(recordForHash);
    const expectedPrevHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

    if (curr.prevHash !== expectedPrevHash) {
      if (currUseFingerprint) {
        foundUnverifiable = true;
      } else {
        return {
          status: 'tampered',
          index: i,
          detail: `${subject}条目 ${i} prevHash 不匹配（旧算法，环境无关），疑似内容被篡改`,
        };
      }
      continue;
    }

    // 2) HMAC 验签
    if (curr.hmacSig && keyAvailable && key) {
      const expectedHmac = computeHmacSig(curr as Record<string, unknown>, key, fingerprint);
      if (curr.hmacSig !== expectedHmac) {
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
            } else {
              foundUnverifiable = true;
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
        }
      }
    } else if (keyAvailable && key && !curr.hmacSig) {
      // 密钥在场但条目无签名：签名被整链剥离伪装 legacy / legacy 未签名条目
      // ——无法证明完整性 → 不可复验（黄），不再静默放行（与 core/audit-history 防签名剥离分支对齐）
      foundUnverifiable = true;
    }
  }

  if (foundUnverifiable) {
    return {
      status: 'unverifiable',
      detail: `部分${subject}段（v2 含环境指纹条目）因 ~/.sofagent-key 或环境指纹漂移无法复验，属历史证据不可复验，非篡改`,
    };
  }

  return { status: 'ok' };
}
