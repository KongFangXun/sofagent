// ============================================================
// decision-query.ts · 决策审计查询层（v1.3.2 交付 6 T04）
//
// 意图层审计 MVP 的「kind-wise back」查询：
//   queryByKind       按决策种类查询决策日志
//   getKindSummary    按种类聚合摘要（供 daemon/MA5 回灌用）
//   traceBack         从决策条目反向追溯：decision → specRef → artifactRef → 行为记录
//   traceFromBehavior 从行为（commitSha）反向找决策
//
// join 语义：decision.artifactRef（commitSha）↔ history.jsonl 的 entry.commitSha
// （loadHistory 来自 audit 包 './audit-history'，join 键 = commitSha）
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { getDecisionLogPath } from '@sofagent/core';
import { loadHistory, type AuditHistoryEntry } from './audit-history';
import type { DecisionKind, DecisionLogEntry } from './decision-schema';

/** 从决策日志加载全部条目（按写入顺序，时间升序） */
function loadDecisionLog(dataDir?: string): DecisionLogEntry[] {
  const filePath = getDecisionLogPath(dataDir);
  if (!existsSync(filePath)) return [];

  const entries: DecisionLogEntry[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(JSON.parse(trimmed) as DecisionLogEntry);
    } catch {
      // 跳过损坏行（与 loadHistory 同语义）
    }
  }
  return entries;
}

/** queryByKind 选项 */
export interface QueryOptions {
  /** 起始时间（ISO 8601，含） */
  since?: string;
  /** 结束时间（ISO 8601，含） */
  until?: string;
  /** 返回条数上限（默认 100） */
  limit?: number;
}

/**
 * 按决策种类查询决策日志（时间升序）。
 * @param kind 决策种类
 * @param opts 查询选项
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function queryByKind(kind: DecisionKind, opts: QueryOptions = {}, dataDir?: string): DecisionLogEntry[] {
  const limit = opts.limit ?? 100;
  return loadDecisionLog(dataDir)
    .filter((e) => e.kind === kind)
    .filter((e) => (opts.since ? e.ts >= opts.since : true))
    .filter((e) => (opts.until ? e.ts <= opts.until : true))
    .slice(0, limit);
}

/** 按种类聚合摘要 */
export interface KindSummary {
  kind: DecisionKind;
  /** 该种类决策总数 */
  count: number;
  /** 最近一条决策时间（无则缺省） */
  latestTs?: string;
  /** 高频 tag 聚合（top 5，按出现次数降序） */
  topTags: Array<{ tag: string; count: number }>;
}

/**
 * 按决策种类聚合摘要（供 daemon @daily 回灌 / MA5 高频模式提取）。
 * @param kind 决策种类
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function getKindSummary(kind: DecisionKind, dataDir?: string): KindSummary {
  const entries = loadDecisionLog(dataDir).filter((e) => e.kind === kind);
  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const tag of e.why?.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  const latest = entries.length > 0 ? entries[entries.length - 1]!.ts : undefined;
  return {
    kind,
    count: entries.length,
    ...(latest ? { latestTs: latest } : {}),
    topTags,
  };
}

/** 高频决策模式条目（MA5 回灌用） */
export interface HighFrequencyPattern {
  kind: DecisionKind;
  /** 聚合 key（kind + tags 组合） */
  key: string;
  /** 出现次数（≥3 才算高频） */
  count: number;
  /** 代表条目（最近一条） */
  sample: DecisionLogEntry;
}

/**
 * 提取高频决策模式（MA5 审查历史回灌）——kind+tags 组合出现 ≥3 次。
 *
 * @param minCount 最低出现次数（默认 3）
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function getHighFrequencyPatterns(minCount = 3, dataDir?: string): HighFrequencyPattern[] {
  const entries = loadDecisionLog(dataDir);
  const groups = new Map<string, { kind: DecisionKind; count: number; sample: DecisionLogEntry }>();

  for (const e of entries) {
    const tags = (e.why?.tags ?? []).length > 0 ? e.why!.tags!.join(',') : 'untagged';
    const key = `${e.kind}:${tags}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.sample = e; // 保留最近一条
    } else {
      groups.set(key, { kind: e.kind, count: 1, sample: e });
    }
  }

  return [...groups.values()]
    .filter((g) => g.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .map((g) => ({ kind: g.kind, key: g.sample.why?.tags?.length ? `${g.kind}:${g.sample.why!.tags!.join(',')}` : `${g.kind}:untagged`, count: g.count, sample: g.sample }));
}

/** traceBack 结果 */
export interface TraceResult {
  /** 被追溯的决策条目 */
  decision: DecisionLogEntry;
  /** specRef 解析结果（决策带 specRef 时） */
  spec?: { ref: string; file?: string; ok: boolean };
  /** artifactRef 解析结果（决策带 artifactRef 时） */
  artifact?: { ref: string; commitSha?: string; ok: boolean };
  /** 按 commitSha join history.jsonl 的行为记录（A1-A19 审计结果） */
  behaviorRecords?: AuditHistoryEntry[];
}

/**
 * 从决策条目反向追溯：
 *   decision → specRef（→ spec 文件）→ artifactRef（→ git commit/diff）
 *   → 按 commitSha join history.jsonl 取 A1-A19 行为记录
 *
 * specRef 解析：若看起来是文件路径（含 / 或 .md 等扩展名），file 指向该路径；
 * artifactRef 解析：若为 7-40 位 hex，视为 commitSha，按它 join 行为记录。
 *
 * @param entryId 决策条目标识——用 ts 定位（决策日志无独立 id，以 ts 为准）
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function traceBack(entryId: string, dataDir?: string): TraceResult | undefined {
  const entries = loadDecisionLog(dataDir);
  // entryId = 决策条目的 ts（唯一性由写入串行保证）
  const decision = entries.find((e) => e.ts === entryId);
  if (!decision) return undefined;

  const result: TraceResult = { decision };

  // specRef 解析
  if (decision.specRef) {
    const looksLikePath = /\//.test(decision.specRef) || /\.[a-z0-9]+$/i.test(decision.specRef);
    result.spec = {
      ref: decision.specRef,
      ...(looksLikePath ? { file: decision.specRef } : {}),
      ok: true,
    };
  }

  // artifactRef 解析
  if (decision.artifactRef) {
    const commitMatch = decision.artifactRef.match(/^[0-9a-f]{7,40}$/i);
    result.artifact = {
      ref: decision.artifactRef,
      ...(commitMatch ? { commitSha: commitMatch[0] } : {}),
      ok: true,
    };
  }

  // 按 commitSha join history.jsonl 行为记录
  const commitSha = result.artifact?.commitSha;
  if (commitSha) {
    const behaviorRecords = loadHistory(undefined, dataDir).filter(
      (e) => e.commitSha === commitSha || e.parentSha === commitSha,
    );
    if (behaviorRecords.length > 0) {
      result.behaviorRecords = behaviorRecords;
    }
  }

  return result;
}

/**
 * 反向追溯：给定 commitSha（行为引用），扫描 decision-log 中 artifactRef
 * 含该 commitSha 的决策条目。
 * @param ref commitSha / 引用文本
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function traceFromBehavior(ref: string, dataDir?: string): DecisionLogEntry[] {
  return loadDecisionLog(dataDir).filter(
    (e) => typeof e.artifactRef === 'string' && e.artifactRef.includes(ref),
  );
}
