// ============================================================
// audit-history.ts · 审计历史持久化
// v1.3.3 env fingerprint: hash chain 加环境指纹防 Agent 重算整链
// ============================================================
//
// ⚠️ 双副本说明（勿混淆）：本仓库有两份同名 audit-history.ts，职责不同、**不可合并**：
//   - 【本文件】engine/audit/src/audit-history.ts —— 业务「审计历史持久化」层。
//     提供 AuditHistoryEntry 类型 + appendHistory/loadHistory/clearHistory/
//     isHmacKeyConfigured，依赖 audit 域的规则结果类型与 sanitize 管道；
//     并 re-export core 的哈希链原语（见下方 import/export）。
//   - engine/core/src/audit-history.ts —— 底层「哈希链完整性」原语层（零上层依赖）：
//     getHistoryFilePath / getEnvFingerprint / getHmacKey / stableStringify /
//     checkHistoryChainDetailed / checkHistoryChainIntegrity / validateHmacKey。
//   依赖方向单向：audit → core（core 绝不反向依赖 audit）。业务持久化含 audit 规则
//   结果域类型，不能下沉到 core 底座（会违反 core「零上层依赖」分层契约），故保持两份。
//
// 并发安全说明：appendFileSync 在 POSIX 上对小于 PIPE_BUF (4KB) 的写入是原子的。
// 审计历史条目通常 < 1KB，单次写入安全。多进程同时写入可能导致行交错，
// 但概率极低（审计触发频率 < 1次/分钟）。
// v1.3.2 #44: 这是已知限制（无文件锁/单 writer），已记录到 docs/LIMITATIONS.md。
// daemon 文件监控 + Agent commit 并发写 history.jsonl 可能产生损坏行，
// 导致 hash chain 完整性校验失败。如需强一致，应加文件锁或改为单 writer 模式（未来版本）。
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
 * 只在规则真正命中（details 非空）时覆写——此前无条件覆写导致
 *   干净提交也被标"检测到密钥泄漏"（1589 条假告警，SIEM 噪声 100%）。
 */
function sanitizeRuleResult(rule: RuleCheck): RuleCheck {
  if (rule.details.length === 0) return rule; // 未命中 → 原样保留（不写假告警）
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
  /** 前一条记录的 hash，用于链完整性验证 */
  prevHash?: string;
  /** 本次审计对应的 commit SHA（doctor #8 追溯用） */
  commitSha?: string;
  /**
   * v1.2.9 commit-msg hook 场景（commit 对象尚未生成）记录的父提交 SHA
   * （= 审计运行时的 HEAD）。--verify-commit 精确 commitSha 未命中时，
   * 对 commitPhase='pre-commit' 的记录按 parentSha fallback 匹配。
   * 旧记录无此字段时 fallback 不生效（向后兼容）。
   */
  parentSha?: string;
  /**
   * v1.2.9 审计所处阶段标记。'pre-commit' = commit-msg hook 场景
   * （审计在 commit 对象生成前运行，commitSha 未知，仅记 parentSha）。
   * 手动 --diff <range> 场景无此字段（保持旧语义）。
   */
  commitPhase?: 'pre-commit';
  /** hash 算法版本：1 = 无指纹（v1.0.5 及以前），2 = 环境指纹（v1.0.6+） */
  hashVersion?: number;
  /** v1.1.8+: HMAC-SHA256 签名（密钥来自 ~/.sofagent-key，chmod 600）。无密钥时缺省（降级 SHA-256，向后兼容）。用于强防篡改。 */
  hmacSig?: string;
  /** v1.2.5 写入时记录的环境指纹——读侧 HMAC 不匹配时用它区分「真篡改（指纹一致）」与「环境漂移（指纹不一致）」 */
  envFingerprint?: string;
  /** v1.1.3+: 审计引擎标识，用于追溯记录来源 */
  engine?: string;
  /**
   * v1.3.1 交付 6: 审计记录关联的 Agent 身份码（AgentIdentity.agentId）。
   * 可选字段——旧记录无此字段时读侧/验链侧全部向后兼容
   *（HMAC 链校验只依赖链字段，新增业务字段天然兼容，先脱敏再签名语义不变）。
   */
  agentId?: string;
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

  // 计算 prevHash（上一行的 hash）
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
      } catch (e) {
        console.error(`[sofagent] 审计历史 JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
        prevHash = 'unknown';
      }
    }
  }

  // v1.1.8: HMAC-SHA256 签名（密钥来自 ~/.sofagent-key，chmod 600）。
  // 有密钥时签名整条记录（防 Agent 重算整链）；无密钥时降级 SHA-256（不写 hmacSig，向后兼容）。
  // 修复（含回归修复）：必须先脱敏再签名——HMAC 基于【已脱敏的 baseSanitized】计算，
  // 而非原始 entry.ruleResults。原因：落盘记录经过 sanitizeRuleResult()，它对 A2(number=2)/A9(number=9)
  // 的 details 强制脱敏覆盖；读侧 checkHistoryChainIntegrity 校验的正是「脱敏后」记录。若写侧用 raw
  // ruleResults 签名，含 A2/A9 的条目 HMAC 永远与读侧不匹配，被 hmacAlgo:'stable' 判为篡改 →
  // 干净链误报链断裂（run-09 回归 false-positive）。先脱敏再签名后，写/读两侧 HMAC 输入完全一致。
  const hmacKey = getHmacKey();

  // HMAC 密钥强度校验——弱密钥（空 / <16 字节）时明确告警，
  // 不静默用弱密钥签名稀释强校验能力。仍照常签名（优于无密钥），但醒目提示。
  const keyStatus = validateHmacKey();
  if (keyStatus.configured && !keyStatus.strong) {
    console.warn(`⚠️ HMAC 密钥强度不足（${keyStatus.reason ?? ''}）——仍使用弱密钥签名审计日志，建议重新生成 ≥16 字节强密钥（如：openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key）`);
  }

  const baseSanitized = {
    ...entry,
    prevHash,
    hashVersion: 2,
    // (2026-08-02 复核修正): 记录写入时的环境指纹——读侧 HMAC 不匹配时
    // 用它区分「真篡改（指纹一致）」与「环境漂移（指纹不一致）」。
    envFingerprint: fingerprint,
    // 标记写入侧用 stableStringify 签名（新条目）。读侧据此区分
    // 「旧条目 key 顺序不可复现（HMAC 不匹配不判篡改）」与「新条目被篡改（判链断裂）」。
    hmacAlgo: hmacKey ? 'stable' : undefined,
    ruleResults: entry.ruleResults.map(sanitizeRuleResult),
  };

  // 签名输入排除 prevHash/hashVersion/hmacSig/hmacAlgo（与读侧 recordForSig 一致）；
  // 用 stableStringify（递归按 key 字典序排序）消除 key 顺序敏感。
  const recordForSig = { ...baseSanitized, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
  // HMAC-SHA256 完整输出 64 hex（256bit），此处 .slice(0, 32) 截断到 128bit。
  // 截断理由：① 每条 history.jsonl 记录都存 hmacSig，截断省约一半存储空间；
  // ② 128bit 防篡改强度充分（伪造需 2^128 次尝试，远超可行算力）；
  // ③ 写侧（此处）与读侧（core/audit-history.ts recordForSig 验签）必须用**同一**
  //    截断长度，否则验签恒不匹配——两侧统一 slice(0, 32)。
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey).update(stableStringify(recordForSig) + '|' + fingerprint).digest('hex').slice(0, 32)
    : undefined;

  const sanitizedEntry = { ...baseSanitized, hmacSig: hmacSig ?? undefined };
  // v1.0.5: 使用原子追加（先读+追加+原子写），避免并发写入导致的行交错
  // v1.2.5 atomicAppendSync 已内置文件锁互斥（O_EXCL + 过期回收），
  //   读-改-写跨进程串行化——不再需要 busy-wait 重试循环（原 189-206 行已移除）。
  const jsonLine = JSON.stringify(sanitizedEntry);
  atomicAppendSync(filePath, jsonLine);
  // 单次读回校验（best-effort——锁已保证互斥，最后一行必然完整；校验失败仅告警）
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      JSON.parse(lines[lines.length - 1]!);
    }
  } catch {
    console.warn('[sofagent] 审计历史最后一行读回校验失败（请检查 history.jsonl 完整性）');
  }

  // P1-B1: 每次写入后确保文件权限为 0o600（不仅首次创建时收紧）
  // 此前只在 !fileExists 时 chmodSync，后续追加写入不校验权限——
  // 如果文件被外部改为 644（如手动 chmod / 恢复备份），权限会保持 644 不收紧。
  // 每次 appendHistory 后都 chmodSync(filePath, 0o600) 确保权限恒为 0600。
  try {
    chmodSync(filePath, 0o600);
  } catch (e) {
    console.error(`[sofagent] 审计历史文件权限设置失败: ${e instanceof Error ? e.message : String(e)}`);
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
  } catch (e) {
    console.error(`[sofagent] 审计历史文件读取失败: ${e instanceof Error ? e.message : String(e)}`);
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
    } catch (e) {
      console.error(`[sofagent] 审计历史行解析失败（跳过）: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 修复：过滤无 timestamp 的条目后再排序
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
