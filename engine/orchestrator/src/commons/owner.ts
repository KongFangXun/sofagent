// ============================================================
// owner.ts · 能力维护人声明 + trust 信誉分（v1.3.7 交付 3）
//
// L3 组织能力公地的「养护环」核心——每个能力强制声明维护人（owner），
// owner 关联 trust 信誉分（对接 v1.3.1 Agent 身份码 agentId）。
//
// trust 机制（评分公式的第一因子，交付 2 rating.ts 调用）：
//   - 初始值 0.5
//   - 调用成功率 / 能力被采纳数 → 上调
//   - 能力退役 / 低分集中 → 下调
//   - 三态：初始 0.5 → 收到 5 条好评 ≥0.6 → 退役后 ≤0.4
//
// 更新时机（交付 2 / 交付 3 共同维护）：
//   - 每次 commons_rate 评价回流（updateTrustOnRating）
//   - commons_retire 退役时（penalizeOnRetire）
//
// 持久化：<dataDir>/commons/owners.jsonl（append-only，同 ownerId 取末行）
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** trust 信誉分三态阈值 */
export const TRUST_INITIAL = 0.5;      // 初始值
export const TRUST_GOOD_THRESHOLD = 0.6; // 收到好评后上调阈值
export const TRUST_BAD_THRESHOLD = 0.4;  // 退役后下调阈值
export const TRUST_MIN = 0.0;
export const TRUST_MAX = 1.0;

/** trust 上调所需的累计好评数 */
export const TRUST_UPVOTE_COUNT = 5;

/** owner 记录（对接身份码 agentId） */
export interface OwnerRecord {
  /** owner agentId（对接 v1.3.1 身份码） */
  ownerId: string;
  /** 显示名（可选） */
  displayName?: string;
  /** trust 信誉分（0.0 ~ 1.0） */
  trust: number;
  /** 累计好评数（评分 ≥ 0.7 计为好评） */
  upvotes: number;
  /** 累计差评数（评分 < 0.4 计为差评） */
  downvotes: number;
  /** 已发布能力数 */
  capabilityCount: number;
  /** 已退役能力数 */
  retiredCount: number;
  /** 创建时间 ISO */
  createdAt: string;
  /** 最后更新时间 ISO */
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────
// 持久化
// ────────────────────────────────────────────────────────────

/** owners.jsonl 路径解析 */
export function resolveOwnersPath(dataDir?: string): string {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, 'commons', 'owners.jsonl');
}

/**
 * 读取所有 owner 记录（同 ownerId 取末行——最新覆盖）。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns ownerId → OwnerRecord 映射
 */
export function readOwners(dataDir?: string): Map<string, OwnerRecord> {
  const path = resolveOwnersPath(dataDir);
  const map = new Map<string, OwnerRecord>();
  if (!existsSync(path)) return map;

  let content = '';
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return map;
  }

  for (const line of content.trim().split('\n').filter(Boolean)) {
    try {
      const rec = JSON.parse(line) as OwnerRecord;
      map.set(rec.ownerId, rec); // 末行覆盖
    } catch {
      // 解析失败跳过（append-only 不阻断）
    }
  }
  return map;
}

/**
 * 写入（追加）一条 owner 记录。
 *
 * @internal 用 upsertOwner 间接调用，不直接暴露
 */
function appendOwnerRecord(rec: OwnerRecord, dataDir?: string): void {
  const path = resolveOwnersPath(dataDir);
  const dir = join(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(rec) + '\n', { flag: 'a' });
}

// ────────────────────────────────────────────────────────────
// owner 声明 + 查询
// ────────────────────────────────────────────────────────────

/**
 * 声明一个 owner（能力发布时调用）。
 *
 * 如果 owner 已存在 → 增加 capabilityCount，trust 不变。
 * 如果 owner 新建 → 创建初始记录（trust=0.5, upvotes=0）。
 *
 * @param ownerId owner agentId（身份码）
 * @param displayName 可选显示名
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 更新后的 owner 记录
 */
export function declareOwner(
  ownerId: string,
  displayName?: string,
  dataDir?: string,
): OwnerRecord {
  if (!ownerId || ownerId.trim() === '') {
    throw new Error('[owner] ownerId 必填——无 owner 的能力不可发布');
  }

  const owners = readOwners(dataDir);
  const now = new Date().toISOString();
  const existing = owners.get(ownerId);

  const rec: OwnerRecord = existing
    ? {
        ...existing,
        capabilityCount: existing.capabilityCount + 1,
        updatedAt: now,
      }
    : {
        ownerId,
        ...(displayName ? { displayName } : {}),
        trust: TRUST_INITIAL,
        upvotes: 0,
        downvotes: 0,
        capabilityCount: 1,
        retiredCount: 0,
        createdAt: now,
        updatedAt: now,
      };

  appendOwnerRecord(rec, dataDir);

  // 审计（kind=EVOLUTION——owner 声明是能力养护记录）
  try {
    emitDecision({
      agentId: ownerId,
      sessionId: `commons-owner-${ownerId}`,
      kind: 'EVOLUTION',
      moment: 'DEPLOY',
      why: {
        text: existing
          ? `owner「${ownerId}」发布新能力（累计 ${rec.capabilityCount} 个，trust=${rec.trust.toFixed(2)}）`
          : `声明 owner「${ownerId}」（初始 trust=${TRUST_INITIAL}）`,
        tags: ['commons', 'owner', existing ? 'publish' : 'declare'],
        confidence: 'high',
      },
      evidence: [
        `ownerId: ${ownerId}`,
        `trust: ${rec.trust.toFixed(2)}`,
        `capabilities: ${rec.capabilityCount}`,
      ],
    });
  } catch (err) {
    process.stderr.write(
      `[owner] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return rec;
}

// ────────────────────────────────────────────────────────────
// trust 查询（评分公式第一因子）
// ────────────────────────────────────────────────────────────

/**
 * 获取 owner 的 trust 信誉分（评分公式的第一因子）。
 *
 * 交付 2 的 rating.ts 在 getTrustStub 桩替换后调用此函数。
 * 不存在的 owner → 返回初始值 0.5（冷启动）。
 *
 * @param ownerId owner agentId
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns trust 信誉分（0.0 ~ 1.0）
 */
export function getTrust(ownerId: string, dataDir?: string): number {
  const owners = readOwners(dataDir);
  const rec = owners.get(ownerId);
  if (!rec) return TRUST_INITIAL;
  return rec.trust;
}

/**
 * 获取 owner 完整记录（含 upvotes / capabilityCount 等）。
 *
 * @param ownerId owner agentId
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns owner 记录（不存在返回 null）
 */
export function getOwner(ownerId: string, dataDir?: string): OwnerRecord | null {
  return readOwners(dataDir).get(ownerId) ?? null;
}

// ────────────────────────────────────────────────────────────
// trust 更新（评价回流 + 退役）
// ────────────────────────────────────────────────────────────

/**
 * trust 信誉分 clamp 到合法范围 [0.0, 1.0]。
 */
export function clampTrust(value: number): number {
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, value));
}

/**
 * trust 三态判定（单测断言用）。
 *
 * @param trust trust 信誉分
 * @returns 'initial' | 'good' | 'bad'
 */
export function classifyTrust(trust: number): 'initial' | 'good' | 'bad' {
  if (trust >= TRUST_GOOD_THRESHOLD) return 'good';
  if (trust <= TRUST_BAD_THRESHOLD) return 'bad';
  return 'initial';
}

/**
 * 评价回流时更新 trust（commons_rate 后调用）。
 *
 * 逻辑：
 *   - 评分 ≥ 0.7（好评）→ upvotes++，达到 5 条 → trust 上调到 ≥ 0.6
 *   - 评分 < 0.4（差评）→ downvotes++，差评集中 → trust 下调
 *
 * 上调公式：upvotes ≥ 5 时 trust = max(trust, 0.6 + min(upvotes-5, 5) * 0.04)
 * 下调公式：downvotes 增多时 trust -= 0.05 * (1 + downvotes/5)
 *
 * @param ownerId owner agentId
 * @param score 本次评分（0.0 ~ 1.0）
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 更新后的 trust 值
 */
export function updateTrustOnRating(
  ownerId: string,
  score: number,
  dataDir?: string,
): number {
  const owners = readOwners(dataDir);
  const rec = owners.get(ownerId);
  if (!rec) return TRUST_INITIAL; // 不存在的 owner 不更新

  const now = new Date().toISOString();
  let { trust, upvotes, downvotes } = rec;

  if (score >= 0.7) {
    upvotes++;
    // 达到 5 条好评 → 上调到 ≥ 0.6
    if (upvotes >= TRUST_UPVOTE_COUNT) {
      trust = Math.max(trust, TRUST_GOOD_THRESHOLD + Math.min(upvotes - TRUST_UPVOTE_COUNT, 5) * 0.04);
    }
  } else if (score < 0.4) {
    downvotes++;
    // 差评集中 → 下调
    trust -= 0.05 * (1 + downvotes / 5);
  }
  trust = clampTrust(trust);

  const updated: OwnerRecord = { ...rec, trust, upvotes, downvotes, updatedAt: now };
  appendOwnerRecord(updated, dataDir);
  return trust;
}

/**
 * 能力退役时惩罚 trust（commons_retire 后调用）。
 *
 * 退役是负面信号 → trust 下调（向 ≤ 0.4 靠拢）。
 *
 * @param ownerId owner agentId
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 更新后的 trust 值
 */
export function penalizeOnRetire(
  ownerId: string,
  dataDir?: string,
): number {
  const owners = readOwners(dataDir);
  const rec = owners.get(ownerId);
  if (!rec) return TRUST_INITIAL;

  const now = new Date().toISOString();
  // 退役 → trust -= 0.08（向 ≤ 0.4 靠拢），retiredCount++
  const trust = clampTrust(rec.trust - 0.08);
  const updated: OwnerRecord = {
    ...rec,
    trust,
    retiredCount: rec.retiredCount + 1,
    updatedAt: now,
  };
  appendOwnerRecord(updated, dataDir);
  return trust;
}
