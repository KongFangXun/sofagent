// ============================================================
// durable/idempotency-check.ts · 续跑前查重（v1.3.2 交付 4 L2）
// ============================================================
//
// Durable Execution L2 的决策层：续跑时对每个待执行动作查重——
//   已登记（副作用登记簿命中）→ 跳过（幂等，不重复执行外部操作）；
//   未登记 → 正常执行 + 登记。
//
// 与 side-effect-ledger.ts 的分工：
//   ledger = 存储层（append-only JSONL + 索引）
//   本文件 = 决策层（shouldExecute / markExecuted 语义封装）
//
// 坑位预警（dev prompt §五）：
//   - git 操作天然幂等（跑两次结果一样）——**不需要**走本查重
//   - 外部副作用（PR / webhook / 飞书消息）不幂等——**必须**走本查重
//   - LLM 调用不幂等——续跑不能重放 LLM 节点（用缓存结果或跳过，
//     本文件只管工具副作用，不管模型调用）
//
// 零新依赖。
// ============================================================

import type { SideEffectLedger } from './side-effect-ledger';

/** 查重判定结果 */
export interface IdempotencyDecision {
  /** true = 应执行；false = 已执行过，跳过 */
  execute: boolean;
  /** 判定理由（审计/日志引用） */
  reason: string;
}

/**
 * 续跑前查重——已登记动作跳过，未登记正常执行。
 *
 * @param ledger 副作用登记簿
 * @param taskId 任务标识
 * @param action 动作标识（如 'webhook.send'）
 * @param meta 动作摘要（可选，参与幂等键——与登记时一致才命中）
 * @returns IdempotencyDecision
 */
export function shouldExecute(
  ledger: SideEffectLedger,
  taskId: string,
  action: string,
  meta?: Record<string, unknown>,
): IdempotencyDecision {
  if (ledger.has(taskId, action, meta)) {
    return {
      execute: false,
      reason: `副作用已登记（taskId=${taskId}, action=${action}）——续跑跳过，幂等保证`,
    };
  }
  return {
    execute: true,
    reason: `副作用未登记（taskId=${taskId}, action=${action}）——正常执行`,
  };
}

/**
 * 执行前标记（工具副作用执行前的配套调用——先登记再执行）。
 *
 * 与 record 的差异：markExecuted 返回 boolean 语义（是否首次登记）
 * 供调用方决定是否真正执行外部动作。
 *
 * @param ledger 副作用登记簿
 * @param taskId 任务标识
 * @param action 动作标识
 * @param meta 动作摘要（可选）
 * @returns true = 首次登记（应执行）；false = 已登记（应跳过）
 */
export function markExecuted(
  ledger: SideEffectLedger,
  taskId: string,
  action: string,
  meta?: Record<string, unknown>,
): boolean {
  if (ledger.has(taskId, action, meta)) {
    return false; // 已执行过——跳过
  }
  ledger.record(taskId, action, meta);
  return true;
}
