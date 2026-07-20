// ============================================================
// audit-history.ts · 审计历史持久化
// v1.1.6 env fingerprint: hash chain 加环境指纹防 Agent 重算整链
// ============================================================
//
// 并发安全说明：appendFileSync 在 POSIX 上对小于 PIPE_BUF (4KB) 的写入是原子的。
// 审计历史条目通常 < 1KB，单次写入安全。多进程同时写入可能导致行交错，
// 但概率极低（审计触发频率 < 1次/分钟）。TODO: v1.x 加 file lock 或改为单 writer 模式。
//
// 每次 sofagent-audit 运行后，把结果追加到
// ${SOFAGENT_DATA}/audit/history.jsonl（JSONL 格式）。
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
import { createHash } from 'crypto';
import { hostname, userInfo } from 'os';
import { execSync } from 'child_process';
import { loadEnvConfig } from '@sofagent/core';
import { atomicAppendSync, atomicWriteSync } from '@sofagent/core';
import type { RuleCheck, ActionGovernance } from './rules/types';

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
  /** v1.1.3+: 审计引擎标识，用于追溯记录来源 */
  engine?: string;
  /** Action Governance 审计 5 字段 schema + 决策溯源组（A4 研读落地）。可选项——旧记录无此字段时向后兼容。 */
  actionGovernance?: ActionGovernance;
}

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
function getEnvFingerprint(dataDir?: string): string {
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

  // P0-5: 计算 prevHash（上一行的 hash）
  let prevHash = 'genesis';
  if (existsSync(filePath)) {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1]!;
      try {
        const lastEntry = JSON.parse(lastLine);
  // 计算 hash：SHA-256(record_without_hash + env_fingerprint)
  // v1.0.6: 加入环境指纹——Agent 重算整链时不包含指纹则校验不一致
  const fingerprint = getEnvFingerprint(dataDir);
  const lastRecordForHash = { ...lastEntry, prevHash: undefined, hashVersion: undefined };
  prevHash = createHash('sha256')
    .update(JSON.stringify(lastRecordForHash) + '|' + fingerprint)
    .digest('hex').slice(0, 16);
      } catch {
        prevHash = 'unknown';
      }
    }
  }

  // 写入前脱敏——避免 A2/A9 拦截结果中存密钥明文
  // v1.0.6: hashVersion: 2 标记使用环境指纹算法
  const sanitizedEntry = {
    ...entry,
    prevHash,
    hashVersion: 2,
    ruleResults: entry.ruleResults.map(sanitizeRuleResult),
  };
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

  const entries: AuditHistoryEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    try {
      const parsed = JSON.parse(trimmed) as AuditHistoryEntry;
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
  }

  return true;
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
