// ============================================================
// evolve/failure-ledger.ts · 失败清单管理（v1.6.0 · P1）
// ============================================================
//
// 失败清单：记录每次 Skill 执行失败的场景 + 原因 + 正确做法。
// 核心假设：**失败清单 > 正向评分**——负面样本的信息量更大。
//
// 数据结构：
//   - 持久化到 {data}/evolve/failure-ledger.jsonl（append-only JSONL）
//   - 进程内缓存 Map<skillId, FailureEntry[]>
//
// 消费者：
//   - auto-trigger.ts：查 failure-ledger，连续 ≥3 次同类失败 → 触发 optimize()
//   - daemon inspectors/failure-pattern.ts：巡检级聚合（月度）
//   - orchestrator checker 节点（P2b）：Checker 失败 → 记录到 failure-ledger
//
// 设计：
//   - 聚类键 = skillId + failureMode 的组合 hash
//   - 同一聚类键的失败记录累计 count
//   - count ≥3 时 auto-trigger 判定为"连续同类失败"
// ============================================================

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { loadEnvConfig } from '@sofagent/core';

/** 单条失败记录 */
export interface FailureRecord {
  /** ISO 时间戳 */
  timestamp: string;
  /** Skill ID（或 Skill 文件路径） */
  skillId: string;
  /** 失败模式描述（如"引用了不存在的文件"、"输出 schema 不匹配"） */
  failureMode: string;
  /** 失败原因详情 */
  reason: string;
  /** 正确做法（如果有） */
  correctApproach?: string;
  /** 来源：auto-trigger / inspector / orchestrator-checker */
  source: string;
  /** 触发的规则（可选） */
  ruleTriggered?: string;
}

/** 聚类后的失败模式 */
export interface FailurePattern {
  /** 聚类键 = hash(skillId + failureMode) */
  key: string;
  /** Skill ID */
  skillId: string;
  /** 失败模式描述 */
  failureMode: string;
  /** 累计出现次数 */
  count: number;
  /** 最近一次出现的时间 */
  lastSeen: string;
  /** 示例失败记录 */
  sample: FailureRecord;
}

/** 进程内缓存 */
const patternCache = new Map<string, FailurePattern>();

/** 获取 failure-ledger 文件路径 */
export function resolveFailureLedgerPath(): string {
  const env = loadEnvConfig();
  return join(env.dataDir, 'evolve', 'failure-ledger.jsonl');
}

/**
 * 计算聚类键
 */
function clusterKey(skillId: string, failureMode: string): string {
  return createHash('md5')
    .update(`${skillId}::${failureMode}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * 记录一条失败到 failure-ledger
 *
 * @param record 失败记录
 */
export function recordFailure(record: FailureRecord): void {
  const ledgerPath = resolveFailureLedgerPath();
  const dir = dirname(ledgerPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // v1.6.0 BUG-37：写入前查重——同 skill|failureMode|reason|source 的记录已存在时
  // 不重复追加（保留首条 + 进程缓存 lastSeen 更新），消灭「巡检器每周重录同一批 ⇒
  // 单调涨到 2707 条」形态。修正口径（经维护者裁定）：只对 source=inspector /
  // daily-recap / weekly-recap 巡检类（重录形态）查重；auto-trigger /
  // orchestrator-checker 等执行时记录（真实每次失败）**不查重**——聚类阈值
  // 触发（连续同类失败计数）依赖执行源的累计语义，吞掉即破坏触发。
  const DEDUP_SOURCES = new Set(['inspector', 'daily-recap', 'weekly-recap']);
  try {
    if (existsSync(ledgerPath) && DEDUP_SOURCES.has(record.source)) {
      const lines = readFileSync(ledgerPath, 'utf-8').split('\n').filter(Boolean);
      const dupKey = (r: FailureRecord): string => `${r.skillId}::${r.failureMode}::${r.reason}::${r.source}`;
      const incoming = dupKey(record);
      for (let i = lines.length - 1; i >= 0; i--) {
        let prev: FailureRecord | null = null;
        try {
          prev = JSON.parse(lines[i]!) as FailureRecord;
        } catch {
          continue;
        }
        if (prev && dupKey(prev) === incoming) {
          // 同聚类同因——去重命中：只更新缓存不落盘
          const key = clusterKey(record.skillId, record.failureMode);
          const cached = patternCache.get(key);
          if (cached) cached.lastSeen = record.timestamp;
          return;
        }
      }
    }
  } catch {
    // 查重读失败——保守照常录入（宁可重复不丢证据）
  }
  // 1. 持久化到 JSONL
  appendFileSync(ledgerPath, JSON.stringify(record) + '\n', 'utf-8');

  // 2. 更新进程内缓存
  const key = clusterKey(record.skillId, record.failureMode);
  const existing = patternCache.get(key);
  if (existing) {
    existing.count++;
    existing.lastSeen = record.timestamp;
  } else {
    patternCache.set(key, {
      key,
      skillId: record.skillId,
      failureMode: record.failureMode,
      count: 1,
      lastSeen: record.timestamp,
      sample: record,
    });
  }
}

/**
 * 查询所有失败聚类（从 JSONL 全量读取）
 *
 * @returns 所有聚类，按 count 降序排列
 */
export function getFailurePatterns(): FailurePattern[] {
  const ledgerPath = resolveFailureLedgerPath();

  if (!existsSync(ledgerPath)) {
    return [];
  }

  let content: string;
  try {
    content = readFileSync(ledgerPath, 'utf-8');
  } catch {
    return [];
  }

  const patterns = new Map<string, FailurePattern>();

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as FailureRecord;
      const key = clusterKey(record.skillId, record.failureMode);
      const existing = patterns.get(key);
      if (existing) {
        existing.count++;
        if (new Date(record.timestamp) > new Date(existing.lastSeen)) {
          existing.lastSeen = record.timestamp;
          existing.sample = record;
        }
      } else {
        patterns.set(key, {
          key,
          skillId: record.skillId,
          failureMode: record.failureMode,
          count: 1,
          lastSeen: record.timestamp,
          sample: record,
        });
      }
    } catch {
      // skip
    }
  }

  return [...patterns.values()].sort((a, b) => b.count - a.count);
}

/**
 * 查询指定 skillId 的失败聚类
 */
export function getFailurePatternsBySkill(skillId: string): FailurePattern[] {
  return getFailurePatterns().filter((p) => p.skillId === skillId);
}

/**
 * 查询连续同类失败 ≥ threshold 次的聚类（auto-trigger 的判定依据）
 *
 * @param threshold 默认 3
 */
export function getRepeatedFailures(threshold = 3): FailurePattern[] {
  return getFailurePatterns().filter((p) => p.count >= threshold);
}

/**
 * 清空进程内缓存（测试用）
 */
export function clearFailureCache(): void {
  patternCache.clear();
}
