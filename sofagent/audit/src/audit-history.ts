// ============================================================
// audit-history.ts · 审计历史持久化
// v0.98 新增：审计闭环六步——历史持久化层
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
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { loadEnvConfig } from './config-loader';
import type { RuleCheck } from './rules/types';

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
 * 追加一条审计记录到历史文件
 * 文件不存在时自动创建目录和文件
 * @param entry 审计历史条目
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function appendHistory(entry: AuditHistoryEntry, dataDir?: string): void {
  const filePath = getHistoryFilePath(dataDir);
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // P0-5: 计算 prevHash（上一行的 hash）
  let prevHash = 'genesis';
  if (existsSync(filePath)) {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1]!;
      try {
        const lastEntry = JSON.parse(lastLine);
        // hash = SHA-256(record without hash fields + prevHash)
        const lastRecordForHash = { ...lastEntry, prevHash: undefined };
        prevHash = createHash('sha256').update(JSON.stringify(lastRecordForHash)).digest('hex').slice(0, 16);
      } catch {
        prevHash = 'unknown';
      }
    }
  }

  // P0-1: 写入前脱敏——避免 A2/A9 拦截结果中存密钥明文
  const sanitizedEntry = {
    ...entry,
    prevHash,
    ruleResults: entry.ruleResults.map(sanitizeRuleResult),
  };
  const line = JSON.stringify(sanitizedEntry) + '\n';
  appendFileSync(filePath, line, 'utf-8');
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

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]!;
    const curr = entries[i]!;
    const expectedPrevHash = createHash('sha256')
      .update(JSON.stringify({ ...prev, prevHash: undefined }))
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
