// ============================================================
// decision-query.ts · 决策审计查询层（v1.3.7 交付 6 T04）
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
import type { DecisionCategory, DecisionKind, DecisionLogEntry, LoopPhase } from './decision-schema';

/** 从决策日志加载全部条目（按写入顺序，时间升序）。
 *
 * v1.3.6 交付⑮：导出供新增查询接口复用（同文件内共享，也供测试直接消费）。
 */
export function loadDecisionLog(dataDir?: string): DecisionLogEntry[] {
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

/**
 * 按决策发生时刻查询决策日志（v1.3.6 交付⑮ · 时间升序）。
 * @param moment 决策时刻（LoopPhase 七阶段）
 * @param opts 查询选项
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function queryByMoment(moment: LoopPhase, opts: QueryOptions = {}, dataDir?: string): DecisionLogEntry[] {
  const limit = opts.limit ?? 100;
  return loadDecisionLog(dataDir)
    .filter((e) => e.moment === moment)
    .filter((e) => (opts.since ? e.ts >= opts.since : true))
    .filter((e) => (opts.until ? e.ts <= opts.until : true))
    .slice(0, limit);
}

/**
 * 按 Agent 标识查询决策日志（v1.3.6 交付⑮ · 时间升序）。
 * @param agentId Agent 标识（精确匹配）
 * @param opts 查询选项
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function queryByAgent(agentId: string, opts: QueryOptions = {}, dataDir?: string): DecisionLogEntry[] {
  const limit = opts.limit ?? 100;
  return loadDecisionLog(dataDir)
    .filter((e) => e.agentId === agentId)
    .filter((e) => (opts.since ? e.ts >= opts.since : true))
    .filter((e) => (opts.until ? e.ts <= opts.until : true))
    .slice(0, limit);
}

/**
 * 按判断时刻分类查询决策日志（v1.3.6 交付⑮ · 时间升序）。
 *
 * 只返回带 category 标注的条目（老日志无此字段不参与过滤）。
 * @param category 判断时刻分类（route/select/skip/retry/escalate）
 * @param opts 查询选项
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function queryByCategory(category: DecisionCategory, opts: QueryOptions = {}, dataDir?: string): DecisionLogEntry[] {
  const limit = opts.limit ?? 100;
  return loadDecisionLog(dataDir)
    .filter((e) => e.category === category)
    .filter((e) => (opts.since ? e.ts >= opts.since : true))
    .filter((e) => (opts.until ? e.ts <= opts.until : true))
    .slice(0, limit);
}

/** 组合查询过滤器（v1.3.6 交付⑮——多维度交叉回溯） */
export interface DecisionFilter {
  /** 按决策种类过滤 */
  kind?: DecisionKind;
  /** 按决策时刻过滤 */
  moment?: LoopPhase;
  /** 按 Agent 标识过滤 */
  agentId?: string;
  /** 按判断时刻分类过滤（只匹配带 category 标注的条目） */
  category?: DecisionCategory;
  /** 按会话标识过滤 */
  sessionId?: string;
}

/**
 * 组合查询决策日志（v1.3.6 交付⑮——kind/moment/agentId/category 任意交叉，时间升序）。
 *
 * 验收标准「可按 kind / moment / agentId 查询」的统一入口：
 * 单维度用 queryByKind / queryByMoment / queryByAgent 更直白，
 * 多维度交叉（如「某 Agent 的所有路由决策」）用本接口。
 *
 * @param filter 过滤器（全部可选，空对象 = 不过滤）
 * @param opts 查询选项
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function queryDecisions(filter: DecisionFilter, opts: QueryOptions = {}, dataDir?: string): DecisionLogEntry[] {
  const limit = opts.limit ?? 100;
  return loadDecisionLog(dataDir)
    .filter((e) => (filter.kind !== undefined ? e.kind === filter.kind : true))
    .filter((e) => (filter.moment !== undefined ? e.moment === filter.moment : true))
    .filter((e) => (filter.agentId !== undefined ? e.agentId === filter.agentId : true))
    .filter((e) => (filter.category !== undefined ? e.category === filter.category : true))
    .filter((e) => (filter.sessionId !== undefined ? e.sessionId === filter.sessionId : true))
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

// ============================================================
// 因果链查询（Semantica「决策是一等公民图节点」映射——决策链可追溯）
// ============================================================

/** 因果链节点（回溯路径上的一条决策） */
export interface DecisionChainNode {
  /** 决策条目 */
  entry: DecisionLogEntry;
  /** 该节点在链中的深度（起点 =0，沿 causedBy 每上一级 +1） */
  depth: number;
}

/** traceDecisionChain 结果 */
export interface DecisionChainTrace {
  /** 被追溯的起点条目（ts = 入参 entryId） */
  root: DecisionLogEntry;
  /** 回溯路径（从起点到根因，depth 递增） */
  chain: DecisionChainNode[];
  /** 链式人类可读叙事（A 导致 B，B 触发 C——按因果序） */
  narrative: string;
  /** 回溯中断原因（causedBy 指向不存在的条目时标注——如实呈现不静默） */
  brokenAt?: string;
}

/**
 * 因果链回溯——沿 causedBy 逐级上溯至根因，输出链式叙事。
 *
 * 防环：causedBy 理论上只指向更早的决策（时间倒流不可能），但被篡改
 * 或写入 bug 可能成环——visited 集合拦截，环时在叙事中如实标注。
 *
 * 旧条目无 causedBy 字段：chain 只有起点自身（单节点链，不报错——
 * 向后兼容，老日志照常可查）。
 *
 * @param entryId 起点条目 ts
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function traceDecisionChain(entryId: string, dataDir?: string): DecisionChainTrace | undefined {
  const entries = loadDecisionLog(dataDir);
  const byTs = new Map(entries.map((e) => [e.ts, e]));
  const root = byTs.get(entryId);
  if (!root) return undefined;

  const chain: DecisionChainNode[] = [{ entry: root, depth: 0 }];
  const visited = new Set<string>([entryId]);
  let brokenAt: string | undefined;

  // 沿 causedBy 上溯（支持多父——逐父展开，深度取路径最深）
  const frontier: DecisionChainNode[] = chain.slice();
  while (frontier.length > 0) {
    const node = frontier.shift()!;
    const refs = node.entry.causedBy ?? [];
    for (const ref of refs) {
      if (visited.has(ref)) {
        brokenAt = `因果环：${ref} 已在回溯路径上（疑似写入 bug 或篡改）`;
        continue;
      }
      const parent = byTs.get(ref);
      if (!parent) {
        brokenAt = `causedBy 指向的条目不存在：${ref}（可能已被清理或跨日志引用）`;
        continue;
      }
      visited.add(ref);
      const next: DecisionChainNode = { entry: parent, depth: node.depth + 1 };
      chain.push(next);
      frontier.push(next);
    }
  }

  // 链式叙事（从根因到起点——因果自然序）
  const ordered = [...chain].sort((a, b) => b.depth - a.depth); // 根因在前
  const parts: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const n = ordered[i]!;
    const label = `${n.entry.ts.slice(11, 19)} ${n.entry.kind}${n.entry.causalType ? `（${n.entry.causalType}）` : ''}：${n.entry.why.text}`;
    parts.push(label);
    if (i < ordered.length - 1) {
      const next = ordered[i + 1]!;
      const edge = next.entry.causalType === 'influenced' ? '影响了' : '导致了';
      parts.push(`　↓ ${edge}`);
    }
  }
  if (brokenAt) parts.push(`⚠ ${brokenAt}`);

  return { root, chain, narrative: parts.join('\n'), ...(brokenAt ? { brokenAt } : {}) };
}

/** 先例检索结果条目 */
export interface SimilarDecisionHit {
  entry: DecisionLogEntry;
  /** 匹配得分（tags 交集数 ×2 + triggeredRule 命中 ×3——排序依据） */
  score: number;
  /** 匹配原因（人读——命中了哪些 tag / 规则） */
  matchedOn: string[];
}

/**
 * 先例检索——按 DecisionWhy.tags + triggeredRule 结构化匹配（不用向量，
 * 字段已有，零新依赖）。HITL 审批界面展示「历史类似决策 + 结果」。
 *
 * 打分：tags 交集每命中 +2；triggeredRule 相同 +3；kind 相同 +1。
 * 只返回 score > 0 的条目（零分 = 无结构化相似性），降序。
 *
 * @param query 查询条件（tags / triggeredRule / kind 至少一项）
 * @param opts 查询选项（limit 缺省 10——先例列表够用）
 * @param dataDir 可选的数据目录覆盖（用于测试）
 */
export function findSimilarDecisions(
  query: { tags?: string[]; triggeredRule?: string; kind?: DecisionKind },
  opts: QueryOptions = {},
  dataDir?: string,
): SimilarDecisionHit[] {
  const limit = opts.limit ?? 10;
  const queryTags = new Set(query.tags ?? []);
  const hits: SimilarDecisionHit[] = [];

  for (const entry of loadDecisionLog(dataDir)) {
    let score = 0;
    const matchedOn: string[] = [];
    // tags 交集
    for (const tag of entry.why?.tags ?? []) {
      if (queryTags.has(tag)) {
        score += 2;
        matchedOn.push(`tag:${tag}`);
      }
    }
    // triggeredRule 精确匹配
    if (query.triggeredRule && entry.why?.triggeredRule === query.triggeredRule) {
      score += 3;
      matchedOn.push(`rule:${query.triggeredRule}`);
    }
    // kind 相同（弱信号）
    if (query.kind && entry.kind === query.kind) {
      score += 1;
      matchedOn.push(`kind:${entry.kind}`);
    }
    if (score > 0) hits.push({ entry, score, matchedOn });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
