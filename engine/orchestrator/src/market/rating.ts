// ============================================================
// rating.ts · 评分聚合（v1.3.6 交付 2）
//
// L3 组织能力市场的「评价」环节——每次调用后累积评分，
// 按加权排序让高频高价值能力自然上浮。
//
// 评分公式（统一定稿）：
//   排序分 = trust(owner) × 平均评分 × log(调用量 + 1)
//   - trust(owner)：owner 信誉分（交付 3 owner.ts 的 getTrust）
//   - 平均评分：所有评价的算术平均（0.0 ~ 1.0）
//   - log(调用量+1)：调用量越大权重越高（自然对数，防止单条评分主导）
//
// 防刷：
//   - 同一 owner 对同一能力仅一票（后评覆盖前评）
//   - 新能力冷启动期（<10 评价）防刷阈值更严
//
// 循环依赖破除：本文件先内建 trust 桩（getTrustStub），
// 交付 3 完成后由 owner.ts 的 getTrust 替换（已实现——下面 try import）。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { getTrust } from './owner';

// ────────────────────────────────────────────────────────────
// trust 桩（交付 2 占位 → 交付 3 替换为真实 getTrust）
// ────────────────────────────────────────────────────────────

/**
 * trust 桩（交付 2 占位）。
 *
 * 交付 2 实现时 owner.ts 尚未完成，用此桩返回固定 0.5。
 * 交付 3 完成后，rating.ts 改用 owner.ts 的 getTrust(agentId)。
 *
 * ⚠️ 已替换：下方 getTrustForRating 优先调用真实 getTrust，
 *    仅在 owner.ts 不可用时降级到桩值 0.5。
 *
 * @param _agentId owner agentId（桩忽略，返回固定值）
 * @returns 固定 0.5
 */
export function getTrustStub(_agentId?: string): number {
  return 0.5;
}

/**
 * 获取 owner 的 trust 信誉分（评分公式第一因子）。
 *
 * 优先调用交付 3 owner.ts 的 getTrust（真实信誉分三态）。
 * 若 owner.ts 不可用（降级）→ 返回桩值 0.5。
 *
 * @param agentId owner agentId
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns trust 信誉分（0.0 ~ 1.0）
 */
export function getTrustForRating(agentId: string, dataDir?: string): number {
  try {
    return getTrust(agentId, dataDir);
  } catch {
    // owner.ts 不可用 → 降级到桩
    return getTrustStub(agentId);
  }
}

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 单条评价记录 */
export interface RatingRecord {
  /** 能力 ID */
  capabilityId: string;
  /** 评价者 agentId（对接身份码） */
  raterId: string;
  /** 评分（0.0 ~ 1.0） */
  score: number;
  /** 评价时间 ISO */
  ratedAt: string;
  /** 可选评论 */
  comment?: string;
}

/** 能力的聚合评分 */
export interface AggregatedRating {
  /** 能力 ID */
  capabilityId: string;
  /** 平均评分（0.0 ~ 1.0） */
  averageScore: number;
  /** 评价总数 */
  count: number;
  /** owner trust */
  trust: number;
  /** 调用量（从 invoke 记录统计） */
  invokeCount: number;
  /** 加权排序分（排序依据） */
  rankScore: number;
  /** 是否冷启动期（<10 评价） */
  coldStart: boolean;
}

// ────────────────────────────────────────────────────────────
// 持久化
// ────────────────────────────────────────────────────────────

/** ratings.jsonl 路径 */
export function resolveRatingsPath(dataDir?: string): string {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, 'market', 'ratings.jsonl');
}

/**
 * 读取所有评价记录。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns RatingRecord 数组（含重复——同 owner 同能力的多条）
 */
export function readRatings(dataDir?: string): RatingRecord[] {
  const path = resolveRatingsPath(dataDir);
  if (!existsSync(path)) return [];

  let content = '';
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }

  const records: RatingRecord[] = [];
  for (const line of content.trim().split('\n').filter(Boolean)) {
    try {
      records.push(JSON.parse(line) as RatingRecord);
    } catch {
      // 跳过
    }
  }
  return records;
}

/** 调用量统计路径 */
export function resolveInvokeCountPath(dataDir?: string): string {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, 'market', 'invoke-counts.jsonl');
}

/**
 * 读取调用量统计（capabilityId → invokeCount）。
 *
 * invoke-counts.jsonl 每行 { id, count }（append-only，同 id 累加——
 * 实际由 invoker.ts 每次 invoke 时 append { id, count:1 }，此处求和）。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns capabilityId → invokeCount 映射
 */
export function readInvokeCounts(dataDir?: string): Map<string, number> {
  const path = resolveInvokeCountPath(dataDir);
  const map = new Map<string, number>();
  if (!existsSync(path)) return map;

  let content = '';
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return map;
  }

  for (const line of content.trim().split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line) as { id: string; count: number };
      map.set(entry.id, (map.get(entry.id) ?? 0) + (entry.count || 0));
    } catch {
      // 跳过
    }
  }
  return map;
}

/**
 * 追加一条调用量记录（invoker.ts 调用成功后调用）。
 *
 * @internal 由 invoker.ts 调用
 */
export function appendInvokeCount(capabilityId: string, dataDir?: string): void {
  const path = resolveInvokeCountPath(dataDir);
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ id: capabilityId, count: 1 }) + '\n', { flag: 'a' });
}

// ────────────────────────────────────────────────────────────
// 评价写入（防刷：同 rater 同能力仅一票，后评覆盖前评）
// ────────────────────────────────────────────────────────────

/**
 * 写入一条评价（防刷：同 raterId 同 capabilityId 仅保留最后一票）。
 *
 * 防刷实现：append-only 写入新评价，读取时同 raterId+capabilityId 取末行。
 * 这样审计轨迹完整（每次评价都留痕），但聚合时只计最新一票。
 *
 * @param record 评价记录
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 写入后的记录
 */
export function addRating(record: RatingRecord, dataDir?: string): RatingRecord {
  // score 合法性校验
  if (typeof record.score !== 'number' || record.score < 0 || record.score > 1) {
    throw new Error(`[rating] score 必须在 [0.0, 1.0] 范围内，收到 ${record.score}`);
  }
  if (!record.capabilityId || !record.raterId) {
    throw new Error('[rating] capabilityId 和 raterId 必填');
  }

  const path = resolveRatingsPath(dataDir);
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const rec: RatingRecord = {
    ...record,
    ratedAt: record.ratedAt || new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(rec) + '\n', { flag: 'a' });

  return rec;
}

/**
 * 读取某能力的去重评价（同 raterId 仅保留最后一票——防刷）。
 *
 * @param capabilityId 能力 ID
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 去重后的评价数组
 */
export function readRatingsForCapability(
  capabilityId: string,
  dataDir?: string,
): RatingRecord[] {
  const all = readRatings(dataDir);
  const filtered = all.filter((r) => r.capabilityId === capabilityId);

  // 同 raterId 仅保留最后一票（防刷——后评覆盖前评）
  const byRater = new Map<string, RatingRecord>();
  for (const r of filtered) {
    byRater.set(r.raterId, r); // 末行覆盖
  }
  return Array.from(byRater.values());
}

// ────────────────────────────────────────────────────────────
// 评分聚合 + 排序分
// ────────────────────────────────────────────────────────────

/** 冷启动阈值（评价数 < 此值 = 冷启动期） */
export const COLD_START_THRESHOLD = 10;

/**
 * 计算单个能力的聚合评分。
 *
 * 公式：
 *   排序分 = trust(owner) × 平均评分 × log(调用量 + 1)
 *
 * @param capabilityId 能力 ID
 * @param ownerAgentId owner agentId（用于查 trust）
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 聚合评分
 */
export function aggregateRating(
  capabilityId: string,
  ownerAgentId: string,
  dataDir?: string,
): AggregatedRating {
  const ratings = readRatingsForCapability(capabilityId, dataDir);
  const count = ratings.length;
  const averageScore =
    count > 0 ? ratings.reduce((sum, r) => sum + r.score, 0) / count : 0;

  const trust = getTrustForRating(ownerAgentId, dataDir);
  const invokeCount = readInvokeCounts(dataDir).get(capabilityId) ?? 0;

  // 排序分 = trust × 平均评分 × log(调用量 + 1)
  const rankScore = computeRankScore(trust, averageScore, invokeCount);

  return {
    capabilityId,
    averageScore,
    count,
    trust,
    invokeCount,
    rankScore,
    coldStart: count < COLD_START_THRESHOLD,
  };
}

/**
 * 计算排序分（核心公式）。
 *
 * 排序分 = trust × averageScore × ln(invokeCount + 1)
 *
 * 防刷：冷启动期（count < 阈值）评分 × 0.8 折扣（防止少量刷分置顶）。
 *
 * @param trust owner trust
 * @param averageScore 平均评分
 * @param invokeCount 调用量
 * @param coldStart 是否冷启动期（默认按 count 判断，此处由调用方传入折扣）
 * @returns 排序分
 */
export function computeRankScore(
  trust: number,
  averageScore: number,
  invokeCount: number,
  coldStartDiscount = 1.0,
): number {
  const logFactor = Math.log(invokeCount + 1); // 自然对数
  let score = trust * averageScore * logFactor;
  // 冷启动折扣
  score *= coldStartDiscount;
  return Math.round(score * 10000) / 10000; // 保留 4 位小数
}

/**
 * 计算冷启动折扣因子。
 *
 * 冷启动期（评价数 < 阈值）→ 折扣 0.8（防刷阈值更严）。
 * 非冷启动 → 折扣 1.0。
 *
 * @param count 评价数
 * @returns 折扣因子
 */
export function coldStartFactor(count: number): number {
  return count < COLD_START_THRESHOLD ? 0.8 : 1.0;
}

/**
 * 排序能力列表（按排序分降序——高频高价值自然上浮）。
 *
 * @param capabilities 能力列表（含 id + owner）
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 按排序分降序排列的能力 + 评分
 */
export function rankCapabilities(
  capabilities: Array<{ id: string; owner: string }>,
  dataDir?: string,
): Array<{ id: string; owner: string; rating: AggregatedRating }> {
  const results = capabilities.map((cap) => ({
    id: cap.id,
    owner: cap.owner,
    rating: aggregateRating(cap.id, cap.owner, dataDir),
  }));

  // 降序排列（排序分高的在前）
  results.sort((a, b) => b.rating.rankScore - a.rating.rankScore);
  return results;
}
