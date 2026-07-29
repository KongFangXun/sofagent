// ============================================================
// audit-history.ts · 审计历史持久化
// v1.2.0 env fingerprint: hash chain 加环境指纹防 Agent 重算整链
// ============================================================
//
// 并发安全说明：appendFileSync 在 POSIX 上对小于 PIPE_BUF (4KB) 的写入是原子的。
// 审计历史条目通常 < 1KB，单次写入安全。多进程同时写入可能导致行交错，
// 但概率极低（审计触发频率 < 1次/分钟）。TODO(v1.3.0): 加 file lock 或改为单 writer 模式。
// 风险：daemon 文件监控 + Agent commit 并发写 history.jsonl 可能产生损坏行
// 触发概率：低（< 1次/分钟），但损坏会导致 hash chain 完整性校验失败
//
// 每次 sofagent-audit 运行后，把结果追加到
// ${SOFAGENT_DATA}/audit/history.jsonl（JSONL 格式；v1.2.2 起默认 data/audit/history.jsonl）。
// 用于根因分析（audit-root-cause）和回归验证（audit-regression）。
//
// JSONL 格式：每行一个 JSON 对象，\n 分隔。
// 最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块。
//
// v1.0.6 安全加固：hash chain 加入环境指纹（hostname+username+git 路径）。
// Agent 重算整链时如果不含指纹，--doctor 校验会不一致。旧格式（无 hashVersion）
// 向后兼容——不做指纹校验，只做链完整性校验。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { createHash, createHmac } from 'crypto';
import { hostname, userInfo, homedir } from 'os';
import { execSync } from 'child_process';
import { loadEnvConfig } from '@sofagent/core';
import { atomicAppendSync, atomicWriteSync } from '@sofagent/core';
import type { RuleCheck, ActionGovernance } from './rules/types';

// v1.2.0: checkHistoryChainIntegrity + helpers sunk to core;
// import for internal use (appendHistory/loadHistory/clearHistory still need them),
// re-export for external backward compat.
import { getHistoryFilePath, getEnvFingerprint, getHmacKey, stableStringify, validateHmacKey } from '@sofagent/core';
export { checkHistoryChainIntegrity, checkHistoryChainDetailed, getHistoryFilePath, getHmacKey, validateHmacKey } from '@sofagent/core';

/**
 * 对 ruleResult 做脱敏处理——避免审计工具自身成为第二泄漏点。
 * A2（密钥泄漏，number=2）和 A9（prompt injection，number=9）的 details
 * 移除命中行原文，替换为脱敏占位文本。
 */
function sanitizeRuleResult(rule: RuleCheck): RuleCheck {
  if (rule.number === 2) {
    return {
      ...rule,
      details: [`检测到密钥泄漏（命中行已脱敏）`],
    };
  }
  if (rule.number === 9) {
    return {
      ...rule,
      details: rule.details.map(() => `检测到 prompt injection 模式（命中行已脱敏）`),
    };
  }
  return rule;
}

/**
 * 单条审计历史记录
 */
export interface AuditHistoryEntry {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** git diff 范围，如 "HEAD~1..HEAD" */
  diffRange: string;
  /** --task 参数传入的任务描述 */
  task?: string;
  /** 退出码：0=PASS / 1=WARN / 2=FAIL */
  exitCode: number;
  /** 每条规则的判定结果 */
  ruleResults: RuleCheck[];
  /** 变更文件数 */
  diffFileCount: number;
  /** commit message */
  commitMsg?: string;
  /** P0-5: 前一条记录的 hash，用于链完整性验证 */
  prevHash?: string;
  /** P1-15: 本次审计对应的 commit SHA（doctor #8 追溯用） */
  commitSha?: string;
  /** hash 算法版本：1 = 无指纹（v1.0.5 及以前），2 = 环境指纹（v1.0.6+） */
  hashVersion?: number;
  /** v1.1.8+: HMAC-SHA256 签名（密钥来自 ~/.sofagent-key，chmod 600）。无密钥时缺省（降级 SHA-256，向后兼容）。用于强防篡改。 */
  hmacSig?: string;
  /** v1.1.3+: 审计引擎标识，用于追溯记录来源 */
  engine?: string;
  /** Action Governance 审计 5 字段 schema + 决策溯源组（A4 研读落地）。可选项——旧记录无此字段时向后兼容。 */
  actionGovernance?: ActionGovernance;
}

/** 是否已配置 HMAC 密钥（供 --doctor 提示完整性校验强度用） */
export function isHmacKeyConfigured(): boolean {
  return getHmacKey() !== null;
}

/**
 * 追加一条审计记录到历史文件
 * 文件不存在时自动创建目录和文件
 * @param entry 审计历史条目
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function appendHistory(entry: AuditHistoryEntry, dataDir?: string): void {
  const filePath = getHistoryFilePath(dataDir);
  const dir = dirname(filePath);
  const fileExists = existsSync(filePath);

  if (!existsSync(dir)) {
    // 权限收紧为 0o700（仅当前用户可读写），防止同机其他用户读取审计日志
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // v1.0.6: 加入环境指纹——Agent 重算整链时不包含指纹则校验不一致
  const fingerprint = getEnvFingerprint(dataDir);

  // P0-5: 计算 prevHash（上一行的 hash）
  let prevHash = 'genesis';
  if (existsSync(filePath)) {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1]!;
      try {
        const lastEntry = JSON.parse(lastLine);
        const lastRecordForHash = { ...lastEntry, prevHash: undefined, hashVersion: undefined };
        prevHash = createHash('sha256')
          .update(JSON.stringify(lastRecordForHash) + '|' + fingerprint)
          .digest('hex').slice(0, 16);
      } catch {
        prevHash = 'unknown';
      }
    }
  }

  // v1.1.8: HMAC-SHA256 签名（密钥来自 ~/.sofagent-key，chmod 600）。
  // 有密钥时签名整条记录（防 Agent 重算整链）；无密钥时降级 SHA-256（不写 hmacSig，向后兼容）。
  // P0-3 修复（含回归修复）：必须先脱敏再签名——HMAC 基于【已脱敏的 baseSanitized】计算，
  // 而非原始 entry.ruleResults。原因：落盘记录经过 sanitizeRuleResult()，它对 A2(number=2)/A9(number=9)
  // 的 details 强制脱敏覆盖；读侧 checkHistoryChainIntegrity 校验的正是「脱敏后」记录。若写侧用 raw
  // ruleResults 签名，含 A2/A9 的条目 HMAC 永远与读侧不匹配，被 hmacAlgo:'stable' 判为篡改 →
  // 干净链误报链断裂（run-09 回归 false-positive）。先脱敏再签名后，写/读两侧 HMAC 输入完全一致。
  const hmacKey = getHmacKey();

  // FLAG-4: HMAC 密钥强度校验——弱密钥（空 / <16 字节）时明确告警，
  // 不静默用弱密钥签名稀释强校验能力。仍照常签名（优于无密钥），但醒目提示。
  const keyStatus = validateHmacKey();
  if (keyStatus.configured && !keyStatus.strong) {
    console.warn(`⚠️ HMAC 密钥强度不足（${keyStatus.reason ?? ''}）——仍使用弱密钥签名审计日志，建议重新生成 ≥16 字节强密钥（如：openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key）`);
  }

  const baseSanitized = {
    ...entry,
    prevHash,
    hashVersion: 2,
    // P0-3: 标记写入侧用 stableStringify 签名（新条目）。读侧据此区分
    // 「旧条目 key 顺序不可复现（HMAC 不匹配不判篡改）」与「新条目被篡改（判链断裂）」。
    hmacAlgo: hmacKey ? 'stable' : undefined,
    ruleResults: entry.ruleResults.map(sanitizeRuleResult),
  };

  // 签名输入排除 prevHash/hashVersion/hmacSig/hmacAlgo（与读侧 recordForSig 一致）；
  // 用 stableStringify（递归按 key 字典序排序）消除 key 顺序敏感。
  const recordForSig = { ...baseSanitized, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey).update(stableStringify(recordForSig) + '|' + fingerprint).digest('hex').slice(0, 32)
    : undefined;

  const sanitizedEntry = { ...baseSanitized, hmacSig: hmacSig ?? undefined };
  // v1.0.5: 使用原子追加（先读+追加+原子写），避免并发写入导致的行交错
  atomicAppendSync(filePath, JSON.stringify(sanitizedEntry));

  // 文件首次创建时收紧权限为 0o600（仅当前用户可读写）
  if (!fileExists) {
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // chmod 失败不影响审计记录写入
    }
  }
}

/**
 * 加载审计历史
 * 读取 history.jsonl，返回按时间倒序的数组
 * @param limit 返回最近 N 条（默认 100）
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function loadHistory(limit?: number, dataDir?: string): AuditHistoryEntry[] {
  const maxLimit = limit ?? 100;
  const filePath = getHistoryFilePath(dataDir);

  if (!existsSync(filePath)) {
    return [];
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const entries: AuditHistoryEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    try {
      const parsed = JSON.parse(trimmed) as AuditHistoryEntry;
      entries.push(parsed);
    } catch {
      // 跳过解析失败的行（容错）
    }
  }

  // P0-3 修复：过滤无 timestamp 的条目后再排序
  const validEntries = entries.filter(
    (e) => e && typeof e.timestamp === 'string' && e.timestamp.length > 0
  );
  validEntries.sort((a, b) => {
    return b.timestamp.localeCompare(a.timestamp);
  });

  return validEntries.slice(0, maxLimit);
}

/**
 * 清空审计历史文件（用于测试）
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function clearHistory(dataDir?: string): void {
  const filePath = getHistoryFilePath(dataDir);

  if (!existsSync(filePath)) {
    return;
  }

  writeFileSync(filePath, '', 'utf-8');
}
