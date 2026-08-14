// ============================================================
// llm-call-trace.ts · LLM 调用级 Trace（v1.3.4 交付 11）
//
// 每次 LLM 请求写一条调用记录到 data/audit/runtime/llm-calls.jsonl
// （append-only，HMAC 防篡改链）。
//
// 铁律 #1：HMAC 链复用 core/audit-history.ts 的
//   getEnvFingerprint / getHmacKey / stableStringify 原语（与 history.jsonl 同套）。
// 铁律 #2：先脱敏再签名——只记 token/耗时/stopReason/error，
//   绝不记录 messages 原文（白名单字段制，非白名单字段写入前被丢弃）。
//
// 记录格式（dev prompt §十二）：
//   { ts, agentId, taskId, provider, model, tokenInput, tokenOutput,
//     durationMs, stopReason, error, prevHash, hashVersion, hmacSig,
//     hmacAlgo, envFingerprint }
// ============================================================

import { existsSync, readFileSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { createHash, createHmac } from 'crypto';
import { getEnvFingerprint, getHmacKey, stableStringify } from './audit-history';
import type { ChainCheckResult } from './audit-history';
import { resolveAuditDir } from './data-paths';
import { atomicAppendSync } from './shared/atomic-write';
import { REDACTION_PATTERNS } from './shared/secret-patterns';

/** LLM 调用记录写入输入（脱敏白名单字段） */
export interface LlmCallTraceInput {
  /** 发起调用的 Agent 身份码（可选） */
  agentId?: string;
  /** 关联任务 ID（可选） */
  taskId?: string;
  /** 模型提供商标识（如 deepseek / api host） */
  provider: string;
  /** 模型名 */
  model: string;
  /** 输入 token 数 */
  tokenInput: number;
  /** 输出 token 数 */
  tokenOutput: number;
  /** 本次请求耗时（ms） */
  durationMs: number;
  /** 终止原因（交付 12 六值分类） */
  stopReason: string;
  /** 错误信息（正常完成为 null） */
  error?: string | null;
  /** v1.3.2 交付 8：LLM 原始响应（provider 透传，不归一化——OmniMessage fidelity 无损回放） */
  rawResponse?: string;
  /** v1.3.2 交付 7：本地模型客户端协议类型（ollama | openai-compatible，云端模型缺省 null）——数据链 Trace→client_type→语料导出 */
  clientType?: 'ollama' | 'openai-compatible' | null;
}

/** 落盘的完整调用记录（白名单字段 + 链字段） */
export interface LlmCallRecord {
  /** ISO 8601 时间戳 */
  ts: string;
  agentId?: string;
  taskId?: string;
  provider: string;
  model: string;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
  stopReason: string;
  error: string | null;
  /** v1.3.2 交付 8：LLM 原始响应（脱敏后，不归一化） */
  rawResponse?: string | null;
  /** 前一条记录的 hash（链完整性） */
  prevHash: string;
  /** hash 算法版本（恒为 2 = 含环境指纹） */
  hashVersion: number;
  /** HMAC-SHA256 签名（截断 128bit；无密钥时缺省） */
  hmacSig?: string;
  /** 写入侧签名算法标记（'stable' = stableStringify 签名） */
  hmacAlgo?: 'stable';
  /** 写入时环境指纹（读侧区分「篡改」与「环境漂移」） */
  envFingerprint: string;
}

/** readLlmCallTrace 过滤条件 */
export interface LlmCallTraceFilter {
  taskId?: string;
  agentId?: string;
  /** 测试隔离用 SOFAGENT_HOME 覆盖 */
  overrideHome?: string;
}

/** error 字段落盘最大长度（截断，防止大段错误文本入链） */
const ERROR_FIELD_MAX_LEN = 500;

/** v1.3.2 交付 8：rawResponse 字段落盘最大长度（截断，防止超大响应入链） */
const RAW_RESPONSE_MAX_LEN = 50_000;

/**
 * v1.3.2 交付 8：rawResponse 脱敏——复用 v1.3.1 REDACTION_PATTERNS 白名单
 * 对密钥/PII 脱敏（sk-***REDACTED*** / AKIA***REDACTED*** / 手机号），
 * 保留响应原文用于 OmniMessage fidelity 无损回放 + L3 定位推理。
 */
function sanitizeRawResponse(raw: string | undefined): string | null {
  if (raw == null || typeof raw !== 'string' || raw.length === 0) return null;
  let result = raw.slice(0, RAW_RESPONSE_MAX_LEN);
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * 脱敏（白名单制）——只保留统计/诊断必需字段，
 * 杜绝 messages 原文或任意附加字段进入审计链。
 * 铁律 #2「先脱敏再签名」：HMAC 永远基于本函数输出计算。
 */
function sanitizeTraceInput(input: LlmCallTraceInput): {
  agentId?: string;
  taskId?: string;
  provider: string;
  model: string;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
  stopReason: string;
  error: string | null;
  rawResponse?: string | null;
} {
  const sanitized: {
    agentId?: string;
    taskId?: string;
    provider: string;
    model: string;
    tokenInput: number;
    tokenOutput: number;
    durationMs: number;
    stopReason: string;
    error: string | null;
    rawResponse?: string | null;
  } = {
    ...(typeof input.agentId === 'string' && input.agentId.length > 0 ? { agentId: input.agentId } : {}),
    ...(typeof input.taskId === 'string' && input.taskId.length > 0 ? { taskId: input.taskId } : {}),
    provider: String(input.provider ?? 'unknown'),
    model: String(input.model ?? 'unknown'),
    tokenInput: Number.isFinite(input.tokenInput) ? input.tokenInput : 0,
    tokenOutput: Number.isFinite(input.tokenOutput) ? input.tokenOutput : 0,
    durationMs: Number.isFinite(input.durationMs) ? input.durationMs : 0,
    stopReason: String(input.stopReason ?? 'failed'),
    error: input.error == null ? null : String(input.error).slice(0, ERROR_FIELD_MAX_LEN),
  };
  // v1.3.2 交付 8：rawResponse 脱敏后写入（密钥/PII 走 v1.3.1 白名单）
  const raw = sanitizeRawResponse(input.rawResponse);
  if (raw !== null) {
    sanitized.rawResponse = raw;
  }
  return sanitized;
}

/**
 * LLM 调用 Trace 文件路径：data/audit/runtime/llm-calls.jsonl
 * （走 resolveAuditDir，SOFAGENT_HOME 可被环境变量覆盖——测试隔离用）
 */
export function getLlmCallTracePath(overrideHome?: string): string {
  return join(resolveAuditDir(overrideHome), 'runtime', 'llm-calls.jsonl');
}

/** 读取文件最后一行并解析为对象（不存在/为空/解析失败返回 null） */
function readLastRecord(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;
    const lastLine = lines[lines.length - 1];
    if (lastLine === undefined) return null;
    return JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 追加一条 LLM 调用记录（append-only + HMAC 链）。
 *
 * 链语义与 history.jsonl 完全同套（铁律 #1）：
 *   prevHash = sha256(JSON.stringify(prev 去掉链字段) + '|' + 环境指纹) 前 16 位
 *   hmacSig  = HMAC-SHA256(stableStringify(record 去掉链字段) + '|' + 环境指纹) 截断 128bit
 *
 * @param input 调用记录输入（写入前强制白名单脱敏）
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 * @returns 落盘的完整记录
 */
export function appendLlmCallRecord(input: LlmCallTraceInput, overrideHome?: string): LlmCallRecord {
  const filePath = getLlmCallTracePath(overrideHome);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

  const fingerprint = getEnvFingerprint();
  // 铁律 #2：先脱敏（白名单），再参与签名
  const sanitized = sanitizeTraceInput(input);

  // 计算 prevHash（上一行的 hash；创世为 'genesis'）
  let prevHash = 'genesis';
  const last = readLastRecord(filePath);
  if (last) {
    const recordForHash = { ...last, prevHash: undefined, hashVersion: undefined };
    prevHash = createHash('sha256')
      .update(JSON.stringify(recordForHash) + '|' + fingerprint)
      .digest('hex').slice(0, 16);
  }

  const hmacKey = getHmacKey();
  const base: LlmCallRecord = {
    ts: new Date().toISOString(),
    ...sanitized,
    prevHash,
    hashVersion: 2,
    envFingerprint: fingerprint,
    ...(hmacKey ? { hmacAlgo: 'stable' as const } : {}),
  };

  // 签名输入排除链字段（与验链侧 recordForSig 一致）；stableStringify 消除 key 顺序敏感
  const recordForSig = { ...base, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey)
        .update(stableStringify(recordForSig) + '|' + fingerprint)
        .digest('hex').slice(0, 32)
    : undefined;

  const record: LlmCallRecord = { ...base, ...(hmacSig ? { hmacSig } : {}) };
  atomicAppendSync(filePath, JSON.stringify(record));
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // 权限收紧失败不阻断（与 audit-history 同容错语义）
  }
  return record;
}

/**
 * 回读 LLM 调用 Trace（可按 taskId / agentId 过滤）。
 *
 * @param filter 过滤条件（taskId / agentId / overrideHome）
 * @returns 按写入顺序排列的记录数组
 */
export function readLlmCallTrace(filter: LlmCallTraceFilter = {}): LlmCallRecord[] {
  const filePath = getLlmCallTracePath(filter.overrideHome);
  if (!existsSync(filePath)) return [];

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const records: LlmCallRecord[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      records.push(JSON.parse(trimmed) as LlmCallRecord);
    } catch {
      // 损坏行跳过（校验由 verifyLlmCallChain 负责报告）
    }
  }

  return records.filter((r) => {
    if (filter.taskId !== undefined && r.taskId !== filter.taskId) return false;
    if (filter.agentId !== undefined && r.agentId !== filter.agentId) return false;
    return true;
  });
}

/** 单条记录 HMAC 验签——返回 ok / tampered / unverifiable */
function verifyRecordHmac(
  entry: Record<string, unknown>,
  fingerprint: string,
  hmacKey: string | null,
): 'ok' | 'tampered' | 'unverifiable' {
  const sig = entry.hmacSig;
  if (typeof sig !== 'string' || sig.length === 0 || !hmacKey) return 'ok';
  const recordForSig = { ...entry, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
  const expected = createHmac('sha256', hmacKey)
    .update(stableStringify(recordForSig) + '|' + fingerprint)
    .digest('hex').slice(0, 32);
  if (sig === expected) return 'ok';
  // HMAC 不匹配：用条目记录的环境指纹区分「真篡改」与「环境漂移」
  const recordedFp = entry.envFingerprint;
  if (typeof recordedFp === 'string' && recordedFp.length > 0 && recordedFp === fingerprint) {
    return 'tampered';
  }
  return 'unverifiable';
}

/**
 * 验证 llm-calls.jsonl 的 HMAC 链完整性。
 *
 * 判定语义与 core/audit-history.ts checkHistoryChainDetailed 对齐：
 *   ok / tampered / unverifiable / insufficient。
 *
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 * @returns ChainCheckResult
 */
export function verifyLlmCallChain(overrideHome?: string): ChainCheckResult {
  const filePath = getLlmCallTracePath(overrideHome);
  if (!existsSync(filePath)) {
    return { status: 'insufficient', detail: 'LLM 调用 Trace 文件不存在，无法验证防篡改链' };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return { status: 'tampered', detail: 'llm-calls.jsonl 读取失败（疑似权限/损坏）' };
  }

  const entries: Array<Record<string, unknown>> = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      return { status: 'tampered', detail: 'llm-calls.jsonl 存在无法解析的行，疑似被篡改' };
    }
  }

  if (entries.length <= 1) {
    return { status: 'insufficient', detail: 'LLM 调用 Trace 不足 2 条，无法构成可验证的防篡改链' };
  }

  const fingerprint = getEnvFingerprint();
  const hmacKey = getHmacKey();

  // 创世条目 HMAC 验签（防止篡改首条记录）
  const genesis = entries[0];
  if (genesis) {
    const genesisResult = verifyRecordHmac(genesis, fingerprint, hmacKey);
    if (genesisResult === 'tampered') {
      return { status: 'tampered', index: 0, detail: '创世条目 HMAC 签名不匹配（环境指纹一致），疑似内容被篡改' };
    }
  }

  let foundUnverifiable = false;
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    if (!prev || !curr) continue;

    // 1) prevHash 链校验
    if (curr.prevHash == null) {
      foundUnverifiable = true;
      continue;
    }
    const recordForHash = { ...prev, prevHash: undefined, hashVersion: undefined };
    const expectedPrevHash = createHash('sha256')
      .update(JSON.stringify(recordForHash) + '|' + fingerprint)
      .digest('hex').slice(0, 16);
    if (curr.prevHash !== expectedPrevHash) {
      const recordedFp = curr.envFingerprint;
      if (typeof recordedFp === 'string' && recordedFp.length > 0 && recordedFp !== fingerprint) {
        // 环境漂移——无法区分篡改与漂移，归为不可复验
        foundUnverifiable = true;
        continue;
      }
      return { status: 'tampered', index: i, detail: `第 ${i} 条记录 prevHash 不匹配，疑似内容被篡改` };
    }

    // 2) HMAC 验签
    const hmacResult = verifyRecordHmac(curr, fingerprint, hmacKey);
    if (hmacResult === 'tampered') {
      return { status: 'tampered', index: i, detail: `第 ${i} 条记录 HMAC 签名不匹配（环境指纹一致），疑似内容被篡改` };
    }
    if (hmacResult === 'unverifiable') {
      foundUnverifiable = true;
    }
  }

  if (foundUnverifiable) {
    return { status: 'unverifiable', detail: '部分 Trace 记录因环境指纹漂移无法复验（非篡改）' };
  }
  return { status: 'ok' };
}
