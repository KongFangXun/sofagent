// ============================================================
// protocol.ts · L2 团队协作协议核心（v1.3.5 交付 T02）
//
// 五大机制的协议核心实现：
//   1. 共享态（SharedState）—— team-state.ts（CRDT 文档）
//   2. 意图广播（IntentBroadcast）—— intent-bus.ts（事件总线）
//   3. 触发反应（TriggerReaction）—— 订阅匹配 → 回调（intent-bus 已含）
//   4. 冲突消解（ConflictResolution）—— 本文件 resolveConflict
//   5. 反馈放大（FeedbackAmplify）—— 本文件 amplifyFeedback
//
// ⚠️ 铁律：trust 只是冲突消解排序权重，不出现在任何 if 条件分支。
// ============================================================

import { randomUUID } from 'crypto';
import type { TeamStateDoc, FeedbackEntry, MemberState } from './team-state';
import { appendFeedback } from './team-state';
import type { Doc } from '@automerge/automerge';

// ────────────────────────────────────────────────────────────
// 冲突消解（协议设计 §3）
// ────────────────────────────────────────────────────────────

/** 冲突方（协议设计 §3.3） */
export interface TeamConflictParty {
  agentId: string;
  /** trust 值（0.0–1.0）——冲突消解排序权重，非权限 */
  trust: number;
  /** ISO 8601 时间戳 */
  ts: string;
  /** 角色：leader / member */
  role: 'leader' | 'member';
  /** 该方的修改内容 */
  change: unknown;
}

/** 冲突消解结果 */
export interface ConflictResolutionResult {
  /** 胜出方 */
  winner: TeamConflictParty;
  /** 裁决理由（人类可读） */
  reason: string;
  /** 被覆盖方列表 */
  losers: TeamConflictParty[];
  /** 全部参与方 */
  parties: TeamConflictParty[];
}

/** 角色优先级（leader > member） */
const ROLE_PRIORITY: Record<'leader' | 'member', number> = { leader: 1, member: 0 };

/**
 * 冲突消解裁决——trust → 时间戳 → 角色 → agentId 字典序。
 *
 * 裁决优先级（从高到低）：
 *   1. trust 值高者胜（team.yml 声明的 0.0–1.0）
 *   2. trust 相同时，时间戳早者胜（先到先得——避免活锁）
 *   3. 时间戳相同时，角色优先级高者胜（leader > member）
 *   4. 以上都相同时，agentId 字典序小者胜（确定性兜底）
 *
 * ⚠️ trust 仅用于此排序比较，不出现在任何 if 权限判定分支。
 *
 * @param parties 冲突方列表（≥2）
 * @returns 裁决结果（胜出方 + 理由 + 被覆盖方）
 */
export function resolveConflict(parties: TeamConflictParty[]): ConflictResolutionResult {
  if (parties.length < 2) {
    throw new Error(`冲突消解需要至少 2 方，收到 ${parties.length} 方`);
  }

  const sorted = [...parties].sort((a, b) => {
    // 1. trust 降序（高者胜）
    if (a.trust !== b.trust) return b.trust - a.trust;
    // 2. 时间戳升序（早者胜）
    const tsDiff = new Date(a.ts).getTime() - new Date(b.ts).getTime();
    if (tsDiff !== 0) return tsDiff;
    // 3. 角色优先级降序（leader 胜）
    const roleDiff = ROLE_PRIORITY[b.role] - ROLE_PRIORITY[a.role];
    if (roleDiff !== 0) return roleDiff;
    // 4. agentId 字典序升序（确定性兜底）
    return a.agentId.localeCompare(b.agentId);
  });

  const winner = sorted[0]!;
  const losers = sorted.slice(1);

  // 生成裁决理由
  const reasons: string[] = [];
  if (losers.some((l) => l.trust < winner.trust)) {
    reasons.push(`trust 最高（${winner.trust}）`);
  } else {
    // trust 相同，看时间戳
    const earliestTs = Math.min(...parties.map((p) => new Date(p.ts).getTime()));
    const winnerTs = new Date(winner.ts).getTime();
    if (winnerTs === earliestTs) {
      reasons.push('时间戳最早');
    }
  }
  if (reasons.length === 0) {
    reasons.push('角色优先级高 / agentId 字典序最小');
  }

  return {
    winner,
    reason: `${winner.agentId} 胜出：${reasons.join('，')}`,
    losers,
    parties: [...parties],
  };
}

/**
 * 检测文件锁冲突——Agent 尝试写文件时，检查是否已有其他 Agent 持有锁。
 *
 * @param doc 团队共享态
 * @param filePath 要写入的文件路径
 * @param writerAgentId 写入者 agentId
 * @returns 持有锁的成员（冲突方），无冲突返回 null
 */
export function detectFileLockConflict(
  doc: Doc<TeamStateDoc>,
  filePath: string,
  writerAgentId: string,
): MemberState | null {
  const lock = doc.fileLocks[filePath];
  if (!lock) return null;
  if (lock.holder === writerAgentId) return null; // 自己持有，无冲突
  const holderMember = doc.members[lock.holder];
  return holderMember ?? null;
}

// ────────────────────────────────────────────────────────────
// 反馈放大（协议设计 §4）
// ────────────────────────────────────────────────────────────

/** 反馈类型 */
export type FeedbackType = 'correction' | 'confirmation' | 'quality_rule';

/** 反馈放大入参 */
export interface AmplifyFeedbackInput {
  /** 产生反馈的 Agent */
  agentId: string;
  /** 反馈类型 */
  type: FeedbackType;
  /** 反馈内容 */
  content: string;
}

/**
 * 反馈放大——把单 Agent 的纠正/确认写入团队级反馈池。
 *
 * 链路（协议设计 §4.1）：
 *   单 Agent 纠正 → 判定为团队可复用经验？(quality_rule / correction)
 *     → 是 → 写入 team-state.feedback[] → 分发给团队其他成员
 *
 * 此函数只负责写入 team-state.feedback[]（CRDT）。
 * 分发到各成员 think.md 的逻辑由 team-manager 协调（经 atomicAppendSync）。
 *
 * @param doc 当前 CRDT 文档
 * @param input 反馈入参
 * @returns 更新后的文档（feedback[] 已追加）
 */
export function amplifyFeedback(
  doc: Doc<TeamStateDoc>,
  input: AmplifyFeedbackInput,
): Doc<TeamStateDoc> {
  const entry: FeedbackEntry = {
    id: randomUUID(),
    agentId: input.agentId,
    type: input.type,
    content: input.content,
    ts: new Date().toISOString(),
  };
  return appendFeedback(doc, entry);
}

// ────────────────────────────────────────────────────────────
// 共享态查询辅助
// ────────────────────────────────────────────────────────────

/**
 * 获取团队全部反馈条目（按时间升序）。
 */
export function getFeedback(doc: Doc<TeamStateDoc>): FeedbackEntry[] {
  return [...doc.feedback].sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * 获取指定类型的反馈条目（如 quality_rule 用于 Refine Agent 质量规则集）。
 */
export function getFeedbackByType(
  doc: Doc<TeamStateDoc>,
  type: FeedbackType,
): FeedbackEntry[] {
  return doc.feedback.filter((f) => f.type === type).sort((a, b) => a.ts.localeCompare(b.ts));
}
