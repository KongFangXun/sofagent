// ============================================================
// retire.ts · 失效判定 + 退役标记（v1.3.7 交付 3）
//
// L3 组织能力公地的「养护环」——能力失效后退役，但**不删除**（可恢复），
// 保留历史审计轨迹。
//
// 退役触发条件：
//   1. owner 主动下线（owner 确认）
//   2. 长期无人调用（调用量 < 阈值）
//   3. 评价持续走低（平均评分 < 阈值）
//
// 退役只标记 status=retired（manifest.jsonl 追加一条 retired 记录覆盖旧值）。
// 恢复：status 改回 active。
//
// 审计：退役 / 恢复记录 kind=EVOLUTION（dev-prompt L108：养护记录用 EVOLUTION）
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';
import { readCatalog, type CatalogEntry } from './catalog';
import { getOwner, penalizeOnRetire } from './owner';

// ────────────────────────────────────────────────────────────
// 退役判定阈值
// ────────────────────────────────────────────────────────────

/** 低调用量阈值（调用量 < 此值 + 超过 N 天 → 候选退役） */
export const LOW_INVOKE_THRESHOLD = 5;
/** 低评分阈值（平均评分 < 此值 → 候选退役） */
export const LOW_RATING_THRESHOLD = 0.3;
/** 长期无人调用天数阈值 */
export const STALE_DAYS_THRESHOLD = 90;

/** 退役原因 */
export type RetireReason =
  | 'owner_request'   // owner 主动下线
  | 'low_invoke'      // 长期无人调用
  | 'low_rating'      // 评价持续走低
  | 'manual';         // 手动标记

/** 退役判定结果 */
export interface RetireCandidate {
  /** 能力 ID */
  capabilityId: string;
  /** 能力名称 */
  name: string;
  /** 判定退役的原因 */
  reason: RetireReason;
  /** 退役判据详情 */
  detail: string;
}

// ────────────────────────────────────────────────────────────
// 退役判定（扫描候选）
// ────────────────────────────────────────────────────────────

/** 退役状态记录（manifest.jsonl 中覆盖旧条目的 status） */
interface RetireStatusEntry {
  id: string;
  status: 'active' | 'retired';
  retiredReason?: RetireReason;
  retiredAt?: string;
  retiredBy?: string;
}

/**
 * 读取公地能力的状态映射（manifest.jsonl 中 status 字段，末行覆盖）。
 *
 * publisher 写入的条目含 status='active'，retire 追加 status='retired'。
 *
 * @internal
 */
function readStatusMap(dataDir?: string): Map<string, RetireStatusEntry> {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  const manifestPath = join(dir, 'commons', 'manifest.jsonl');
  const map = new Map<string, RetireStatusEntry>();
  if (!existsSync(manifestPath)) return map;

  let content = '';
  try {
    content = readFileSync(manifestPath, 'utf-8');
  } catch {
    return map;
  }

  for (const line of content.trim().split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line) as RetireStatusEntry;
      if (entry.id && entry.status) {
        map.set(entry.id, entry); // 末行覆盖
      }
    } catch {
      // 跳过
    }
  }
  return map;
}

/**
 * 扫描退役候选——满足以下任一条件的能力标记为候选：
 *   - 评价持续走低（平均评分 < LOW_RATING_THRESHOLD）
 *   - 长期无人调用（invokeCount < LOW_INVOKE_THRESHOLD，由调用方传入）
 *
 * 注意：owner 主动下线不经过扫描，直接调 markRetired。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @param invokeStats 可选的调用量统计（capabilityId → invokeCount + avgRating）
 * @returns 退役候选列表
 */
export function scanRetireCandidates(
  dataDir?: string,
  invokeStats?: Map<string, { invokeCount: number; avgRating: number }>,
): RetireCandidate[] {
  const entries = readCatalog(dataDir, true); // includeRetired=true：也扫已退役的（避免重复推荐）
  const candidates: RetireCandidate[] = [];
  const statusMap = readStatusMap(dataDir);

  for (const entry of entries) {
    // 已退役的跳过
    const status = statusMap.get(entry.id)?.status ?? 'active';
    if (status === 'retired') continue;

    const stats = invokeStats?.get(entry.id);
    const invokeCount = stats?.invokeCount ?? 0;
    const avgRating = stats?.avgRating ?? 0;

    // 低评分
    if (invokeCount > 0 && avgRating < LOW_RATING_THRESHOLD) {
      candidates.push({
        capabilityId: entry.id,
        name: entry.name,
        reason: 'low_rating',
        detail: `平均评分 ${avgRating.toFixed(2)} < 阈值 ${LOW_RATING_THRESHOLD}`,
      });
      continue;
    }

    // 低调用量（需有调用量数据才判定）
    if (stats && invokeCount < LOW_INVOKE_THRESHOLD) {
      candidates.push({
        capabilityId: entry.id,
        name: entry.name,
        reason: 'low_invoke',
        detail: `调用量 ${invokeCount} < 阈值 ${LOW_INVOKE_THRESHOLD}`,
      });
    }
  }

  return candidates;
}

// ────────────────────────────────────────────────────────────
// 退役 / 恢复（标记，不删除）
// ────────────────────────────────────────────────────────────

/**
 * 追加一条 status 记录到 manifest.jsonl（覆盖该能力的旧状态——末行覆盖语义）。
 *
 * @internal
 */
function appendStatusRecord(rec: RetireStatusEntry, dataDir?: string): void {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  const commonsDir = join(dir, 'commons');
  const manifestPath = join(commonsDir, 'manifest.jsonl');
  if (!existsSync(commonsDir)) {
    mkdirSync(commonsDir, { recursive: true });
  }
  writeFileSync(manifestPath, JSON.stringify(rec) + '\n', { flag: 'a' });
}

/**
 * 标记一个能力为退役（不删除——保留历史审计轨迹）。
 *
 * 铁律：
 *   - 退役只标记 status=retired，可恢复
 *   - 强制 owner 确认（confirmByOwner=true 才执行）
 *   - 退役触发 trust 下调（penalizeOnRetire）
 *   - 审计 kind=EVOLUTION（dev-prompt L108：养护记录用 EVOLUTION）
 *
 * @param capabilityId 能力 ID
 * @param reason 退役原因
 * @param confirmedByOwner owner 是否确认（必须 true 才执行）
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 退役结果
 */
export function markRetired(
  capabilityId: string,
  reason: RetireReason,
  confirmedByOwner: boolean,
  dataDir?: string,
): { ok: boolean; reason?: string } {
  // 强制 owner 确认
  if (!confirmedByOwner) {
    return { ok: false, reason: '退役必须由 owner 确认（confirmedByOwner=true）' };
  }

  // 能力必须存在
  const entries = readCatalog(dataDir, true);
  const entry = entries.find((e) => e.id === capabilityId);
  if (!entry) {
    return { ok: false, reason: `能力「${capabilityId}」不存在` };
  }

  // 已退役的不重复退役
  const statusMap = readStatusMap(dataDir);
  const currentStatus = statusMap.get(capabilityId)?.status ?? 'active';
  if (currentStatus === 'retired') {
    return { ok: false, reason: `能力「${capabilityId}」已退役（无需重复操作）` };
  }

  // 标记退役
  const retiredAt = new Date().toISOString();
  appendStatusRecord(
    { id: capabilityId, status: 'retired', retiredReason: reason, retiredAt, retiredBy: entry.owner },
    dataDir,
  );

  // trust 下调（owner 信誉分受退役影响）
  let trustAfter = getOwner(entry.owner, dataDir)?.trust ?? 0.5;
  try {
    trustAfter = penalizeOnRetire(entry.owner, dataDir);
  } catch (err) {
    process.stderr.write(
      `[retire] trust 下调失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  // 审计（kind=EVOLUTION——养护记录）
  try {
    emitDecision({
      agentId: entry.owner,
      sessionId: `commons-retire-${capabilityId}`,
      kind: 'EVOLUTION',
      moment: 'EVOLVE',
      // v1.3.6 交付⑮：退役 = 决定不再使用（判断时刻分类 skip）
      category: 'skip',
      why: {
        text: `能力「${entry.name}」(${capabilityId}) 被退役（${reason}）`,
        tags: ['commons', 'retire', reason],
        confidence: 'high',
      },
      artifactRef: capabilityId,
      evidence: [
        `reason: ${reason}`,
        `retiredAt: ${retiredAt}`,
        `trust-after: ${trustAfter.toFixed(2)}`,
      ],
    });
  } catch (err) {
    process.stderr.write(
      `[retire] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return { ok: true };
}

/**
 * 恢复一个已退役能力（status 改回 active）。
 *
 * 退役不删除的精髓：随时可恢复。
 *
 * @param capabilityId 能力 ID
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 恢复结果
 */
export function restoreCapability(
  capabilityId: string,
  dataDir?: string,
): { ok: boolean; reason?: string } {
  const entries = readCatalog(dataDir, true);
  const entry = entries.find((e) => e.id === capabilityId);
  if (!entry) {
    return { ok: false, reason: `能力「${capabilityId}」不存在` };
  }

  const statusMap = readStatusMap(dataDir);
  const currentStatus = statusMap.get(capabilityId)?.status ?? 'active';
  if (currentStatus === 'active') {
    return { ok: false, reason: `能力「${capabilityId}」未退役（无需恢复）` };
  }

  appendStatusRecord(
    { id: capabilityId, status: 'active', retiredAt: undefined, retiredBy: undefined },
    dataDir,
  );

  // 审计（kind=EVOLUTION）
  try {
    emitDecision({
      agentId: entry.owner,
      sessionId: `commons-restore-${capabilityId}`,
      kind: 'EVOLUTION',
      moment: 'EVOLVE',
      // v1.3.6 交付⑮：从退役恢复 = 回到可用状态（判断时刻分类 retry）
      category: 'retry',
      why: {
        text: `能力「${entry.name}」(${capabilityId}) 从退役恢复为 active`,
        tags: ['commons', 'restore'],
        confidence: 'med',
      },
      artifactRef: capabilityId,
      evidence: [`restoredAt: ${new Date().toISOString()}`],
    });
  } catch (err) {
    process.stderr.write(
      `[retire] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return { ok: true };
}

/**
 * 查询能力当前状态（active / retired）。
 *
 * @param capabilityId 能力 ID
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns status（'active' | 'retired'）
 */
export function getCapabilityStatus(
  capabilityId: string,
  dataDir?: string,
): 'active' | 'retired' {
  const statusMap = readStatusMap(dataDir);
  return statusMap.get(capabilityId)?.status ?? 'active';
}
