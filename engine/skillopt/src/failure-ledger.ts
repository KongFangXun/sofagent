// ============================================================
// skillopt/failure-ledger.ts · 失败清单管理（v1.3.2 · P1）
// ============================================================
//
// 失败清单：记录每次 Skill 执行失败的场景 + 原因 + 正确做法。
// 核心假设：**失败清单 > 正向评分**——负面样本的信息量更大。
//
// 数据结构：
//   - 持久化到 {data}/skillopt/failure-ledger.jsonl（append-only JSONL）
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
  return join(env.dataDir, 'skillopt', 'failure-ledger.jsonl');
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
  // 1. 持久化到 JSONL
  const ledgerPath = resolveFailureLedgerPath();
  const dir = dirname(ledgerPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
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
