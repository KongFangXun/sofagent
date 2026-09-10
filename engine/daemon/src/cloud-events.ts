// cloud-events.ts · 章十二 双通道事件归一（daemon 接线批）
//
// 本地 executor 与云通道两类事件流 → 统一归一 → train_status 更新 +
// train-audit HMAC 挂链（emitTrainAudit——链上可查）。
//
// 「双通道同链可查」验收口径：无论 job 跑在本地（LocalSpawnExecutor）
// 还是云上（TrainChannel 适配器），事件归一后进同一条 train-audit 链
// （同一 enterprise/trainJob 维度 jsonl），readTrainAudit 一次可查全。

import {
  emitTrainAudit,
  type TrainAuditEventType,
  type EmitTrainAuditInput,
} from '@sofagent/orchestrator';
import type { TrainEvent } from '@sofagent/orchestrator';

/** 归一输入事件（本地协议② 或云通道事件） */
export type DualChannelEvent =
  | { source: 'local'; event: TrainEvent }
  | { source: 'cloud'; event: TrainEvent; remoteJobId: string };

/** 事件归一结果 */
export interface NormalizeResult {
  /** train-audit 事件类型（null = 不挂链——progress 心跳不记） */
  auditType: TrainAuditEventType | null;
  /** 状态迁移（null = 无迁移） */
  statusTransition: { from?: string; to: string } | null;
  /** 人类可读摘要 */
  summary: string;
}

/**
 * 双通道事件归一——协议② TrainEvent → train-audit 事件类型 + 状态迁移。
 *
 * 归一规则：
 *   done   → train_job_completed（→ completed）
 *   failed → train_job_failed（→ failed）
 *   checkpoint → train_job_checkpoint（→ checkpointing）
 *   progress → null（心跳不挂链——train_status 面由 status 查询承载）
 */
export function normalizeDualChannelEvent(ev: DualChannelEvent): NormalizeResult {
  const e = ev.event;
  const suffix = ev.source === 'cloud' ? `（云通道 ${ev.remoteJobId}）` : '（本地通道）';
  switch (e.type) {
    case 'done':
      return {
        auditType: 'train_job_completed',
        statusTransition: { to: 'completed' },
        summary: `训练完成${suffix}`,
      };
    case 'failed':
      return {
        auditType: 'train_job_failed',
        statusTransition: { to: 'failed' },
        summary: `训练失败：${e.reason}${suffix}`,
      };
    case 'checkpoint':
      return {
        auditType: 'train_job_checkpoint',
        statusTransition: { to: 'checkpointing' },
        summary: `存档暂停：${e.path} @step ${e.step}${suffix}`,
      };
    case 'progress':
      return { auditType: null, statusTransition: null, summary: `进度 step=${e.step}` };
  }
}

/** 事件挂链入参（emitTrainAudit 的薄包装——双通道同链） */
export interface ChainEventInput {
  enterpriseId: string;
  trainJobId: string;
  dataSourceHash: string;
  event: DualChannelEvent;
  dataDir: string;
}

/**
 * 归一 + 挂链（一次调用完成「归一 → train-audit HMAC 链」）。
 *
 * @returns 挂链结果（null = 心跳类不挂链；auditEntry = 已挂链条目）
 */
export function chainDualChannelEvent(input: ChainEventInput): NormalizeResult & {
  chained: boolean;
} {
  const normalized = normalizeDualChannelEvent(input.event);
  if (normalized.auditType === null) {
    return { ...normalized, chained: false };
  }
  const auditInput: EmitTrainAuditInput = {
    type: normalized.auditType,
    trainJobId: input.trainJobId,
    enterpriseId: input.enterpriseId,
    dataSourceHash: input.dataSourceHash,
    ...(normalized.statusTransition?.from ? { fromStatus: normalized.statusTransition.from as never } : {}),
    ...(normalized.statusTransition ? { toStatus: normalized.statusTransition.to as never } : {}),
    reason: normalized.summary,
  };
  try {
    emitTrainAudit(auditInput, input.dataDir);
    return { ...normalized, chained: true };
  } catch {
    // 挂链失败显式可见（不静默）——事件本身已归一，链写入失败返回 chained=false
    return { ...normalized, chained: false };
  }
}
