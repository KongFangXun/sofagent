// ============================================================
// benchmark/evaluation-log.ts · Benchmark 评测日志（v1.3.6 交付 9）
// ============================================================
//
// evaluation-log.jsonl 读写 + HMAC 防篡改链。
//
// 铁律 #1：HMAC 链复用 engine/core/src/audit-history.ts 的
//   getEnvFingerprint / getHmacKey / stableStringify（与 history.jsonl 同套）。
// 铁律 #2：先脱敏再签名——只记统计/诊断字段（benchmarkId/caseId/revision/
//   score/failureCode/durationMs），不记 statement/rubric/输出原文。
//
// 文件布局：data/<project>/benchmarks/<benchmark_id>/evaluation-log.jsonl
//   （与 benchmark_config.toml 同目录——CASE 目录平级）
// ============================================================

import { existsSync, mkdirSync, readFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { createHash, createHmac } from 'crypto';
import {
  getEnvFingerprint,
  getHmacKey,
  stableStringify,
} from '@sofagent/core';
import { loadEnvConfig, atomicAppendSync } from '@sofagent/core';

/**
 * 链校验结果（本地定义——core 未从 index 导出 ChainCheckResult；
 * 结构与 core/audit-history.ts 的 ChainCheckResult 对齐）。
 */
export interface EvaluationChainCheckResult {
  /** 链状态：ok / tampered / unverifiable / insufficient */
  status: 'ok' | 'tampered' | 'unverifiable' | 'insufficient';
  /** 违规记录索引（tampered 时） */
  index?: number;
  /** 判定详情 */
  detail?: string;
}

/** 评测日志写入输入（脱敏白名单字段） */
export interface EvaluationLogInput {
  /** Benchmark ID */
  benchmarkId: string;
  /** Case ID（如 CASE-001-xxx） */
  caseId: string;
  /** Benchmark revision（Freeze 后递增；version_changed 检测用） */
  revision: number;
  /** 协议化评分 0..100 */
  score: number;
  /** 失败码（null = 正常完成） */
  failureCode?: string | null;
  /** 被测 Agent 身份码（可选） */
  agentId?: string;
  /** 评测耗时（ms） */
  durationMs: number;
}

/** 落盘的完整评测记录（白名单字段 + 链字段） */
export interface EvaluationLogRecord {
  /** ISO 8601 时间戳 */
  ts: string;
  benchmarkId: string;
  caseId: string;
  revision: number;
  score: number;
  failureCode: string | null;
  agentId?: string;
  durationMs: number;
  /** 前一条记录的 hash（链完整性） */
  prevHash: string;
  /** hash 算法版本（恒为 2 = 含环境指纹） */
  hashVersion: number;
  /** HMAC-SHA256 签名（截断 128bit；无密钥时缺省） */
  hmacSig?: string;
  /** 写入侧签名算法标记 */
  hmacAlgo?: 'stable';
  /** 写入时环境指纹 */
  envFingerprint: string;
}

/**
 * 解析评测日志路径：{dataDir}/benchmarks/<benchmark_id>/evaluation-log.jsonl
 * dataDir 默认 loadEnvConfig().dataDir（SOFAGENT_DATA 可覆盖——测试隔离）；
 * overrideDataDir 显式覆盖（测试用）。
 */
export function getEvaluationLogPath(benchmarkId: string, overrideDataDir?: string): string {
  const dataDir = overrideDataDir ?? loadEnvConfig().dataDir;
  return join(dataDir, 'benchmarks', benchmarkId, 'evaluation-log.jsonl');
}

/** 读取文件最后一行并解析（不存在/为空/解析失败返回 null） */
function readLastRecord(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) return null;
    return JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 脱敏（白名单制）——只保留统计字段，杜绝 statement/rubric/输出原文入链 */
function sanitizeLogInput(input: EvaluationLogInput): {
  benchmarkId: string;
  caseId: string;
  revision: number;
  score: number;
  failureCode: string | null;
  agentId?: string;
  durationMs: number;
} {
  const score = Number.isFinite(input.score) ? Math.max(0, Math.min(100, Math.round(input.score))) : 0;
  return {
    benchmarkId: String(input.benchmarkId ?? 'unknown'),
    caseId: String(input.caseId ?? 'unknown'),
    revision: Number.isInteger(input.revision) ? input.revision : 1,
    score,
    failureCode: input.failureCode == null ? null : String(input.failureCode).slice(0, 100),
    ...(typeof input.agentId === 'string' && input.agentId.length > 0 ? { agentId: input.agentId } : {}),
    durationMs: Number.isFinite(input.durationMs) ? input.durationMs : 0,
  };
}

/**
 * 追加一条评测记录（append-only + HMAC 链）。
 * 链语义与 history.jsonl / llm-calls.jsonl 完全同套（铁律 #1）。
 *
 * @param input 评测输入（写入前强制白名单脱敏）
 * @param overrideDataDir 测试隔离用数据目录覆盖
 * @returns 落盘的完整记录
 */
export function appendEvaluationRecord(input: EvaluationLogInput, overrideDataDir?: string): EvaluationLogRecord {
  const filePath = getEvaluationLogPath(input.benchmarkId, overrideDataDir);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

  const fingerprint = getEnvFingerprint(overrideDataDir);
  const sanitized = sanitizeLogInput(input);

  // prevHash（上一行的 hash；创世为 'genesis'）
  let prevHash = 'genesis';
  const last = readLastRecord(filePath);
  if (last) {
    const recordForHash = { ...last, prevHash: undefined, hashVersion: undefined };
    prevHash = createHash('sha256')
      .update(JSON.stringify(recordForHash) + '|' + fingerprint)
      .digest('hex').slice(0, 16);
  }

  const hmacKey = getHmacKey();
  const base: EvaluationLogRecord = {
    ts: new Date().toISOString(),
    ...sanitized,
    prevHash,
    hashVersion: 2,
    envFingerprint: fingerprint,
    ...(hmacKey ? { hmacAlgo: 'stable' as const } : {}),
  };

  const recordForSig = { ...base, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey)
        .update(stableStringify(recordForSig) + '|' + fingerprint)
        .digest('hex').slice(0, 32)
    : undefined;

  const record: EvaluationLogRecord = { ...base, ...(hmacSig ? { hmacSig } : {}) };
  atomicAppendSync(filePath, JSON.stringify(record));
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // 权限收紧失败不阻断
  }
  return record;
}

/** 回读评测日志（可按 benchmarkId / caseId / agentId 过滤） */
export function readEvaluationLog(
  filter: { benchmarkId?: string; caseId?: string; agentId?: string } = {},
  overrideDataDir?: string,
): EvaluationLogRecord[] {
  if (!filter.benchmarkId) return []; // 必须指定 benchmarkId（文件按 benchmark 分目录）
  const filePath = getEvaluationLogPath(filter.benchmarkId, overrideDataDir);
  if (!existsSync(filePath)) return [];

  const records: EvaluationLogRecord[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as EvaluationLogRecord);
    } catch {
      // 损坏行跳过
    }
  }
  return records.filter((r) => {
    if (filter.caseId !== undefined && r.caseId !== filter.caseId) return false;
    if (filter.agentId !== undefined && r.agentId !== filter.agentId) return false;
    return true;
  });
}

/** 单条记录 HMAC 验签（与 llm-call-trace 同逻辑） */
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
  const recordedFp = entry.envFingerprint;
  if (typeof recordedFp === 'string' && recordedFp.length > 0 && recordedFp === fingerprint) {
    return 'tampered';
  }
  return 'unverifiable';
}

/**
 * 验证 evaluation-log.jsonl 的 HMAC 链完整性。
 * 判定语义与 checkHistoryChainDetailed 对齐：ok / tampered / unverifiable / insufficient。
 */
export function verifyEvaluationChain(benchmarkId: string, overrideDataDir?: string): EvaluationChainCheckResult {
  const filePath = getEvaluationLogPath(benchmarkId, overrideDataDir);
  if (!existsSync(filePath)) {
    return { status: 'insufficient', detail: 'evaluation-log.jsonl 不存在，无法验证防篡改链' };
  }

  const entries: Array<Record<string, unknown>> = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      return { status: 'tampered', detail: 'evaluation-log.jsonl 存在无法解析的行，疑似被篡改' };
    }
  }
  if (entries.length <= 1) {
    return { status: 'insufficient', detail: '评测日志不足 2 条，无法构成可验证的防篡改链' };
  }

  const fingerprint = getEnvFingerprint(overrideDataDir);
  const hmacKey = getHmacKey();
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
        foundUnverifiable = true;
        continue;
      }
      return { status: 'tampered', index: i, detail: `第 ${i} 条记录 prevHash 不匹配，疑似内容被篡改` };
    }
    const hmacResult = verifyRecordHmac(curr, fingerprint, hmacKey);
    if (hmacResult === 'tampered') {
      return { status: 'tampered', index: i, detail: `第 ${i} 条记录 HMAC 签名不匹配（环境指纹一致），疑似内容被篡改` };
    }
    if (hmacResult === 'unverifiable') {
      foundUnverifiable = true;
    }
  }

  if (foundUnverifiable) {
    return { status: 'unverifiable', detail: '部分评测记录因环境指纹漂移无法复验（非篡改）' };
  }
  return { status: 'ok' };
}
