// ============================================================
// audit-aggregator.ts · 跨 harness 审计聚合
// v1.4.1（二）：多个 harness（各自沙箱）的审计轨迹聚合到同一视图——
// 单 harness 场景不经过本层（直接消费单源审计，见 worklog 三）
//
// 与既有能力的关系：
// - 复用 v1.3.1 身份码：条目携带 agentId/fingerprint，聚合时可验签归因
// - 复用 v1.3.3 L2 协作协议：feedback/conflict 事件经 ingestL2Event 归一化入轨
// - worklog 聚合（三）消费本模块的导出数据——同一数据源的两个消费面
// ============================================================

import { randomUUID } from 'crypto';
import type { FeedbackType } from '../team/protocol';

/** 聚合轨迹条目 */
export interface AggregateAuditEntry {
  /** 条目 ID */
  id: string;
  /** 来源 harness 实例 ID */
  harnessId: string;
  /** 条目类型：工具调用 / 文件写入 / 决策 / L2 协作事件 / 拦截裁决 */
  kind: 'tool_call' | 'file_write' | 'decision' | 'l2_event' | 'interception';
  /** 时间戳（ISO） */
  timestamp: string;
  /** agent 身份码（v1.3.1 identity——agentId 或 shortCode） */
  agentId?: string;
  /** 内容摘要（工具名+参数 / 决策理由 / 反馈内容） */
  summary: string;
  /** 原始载荷（类型各异，聚合只透传） */
  payload?: Record<string, unknown>;
}

/** 查询过滤条件 */
export interface AuditQuery {
  harnessId?: string;
  agentId?: string;
  kind?: AggregateAuditEntry['kind'];
  /** 起始时间（ISO，含） */
  since?: string;
  limit?: number;
}

/** L2 协作事件（v1.3.3 协议形状——feedback 与 conflict 两族） */
export interface L2EventInput {
  /** 来源 harness */
  harnessId: string;
  /** 事件族：feedback（反馈放大）/ conflict（冲突裁决） */
  family: 'feedback' | 'conflict';
  /** feedback 类型（family=feedback 时有效） */
  feedbackType?: FeedbackType;
  /** agentId */
  agentId: string;
  /** 内容 / 裁决说明 */
  content: string;
  /** 时间戳 */
  timestamp?: string;
}

/**
 * 跨 harness 审计聚合器。
 * 单 harness 场景：不经本类，worklog 直接读单源审计日志（三的降级路径）。
 */
export class AuditAggregator {
  private readonly entries: AggregateAuditEntry[] = [];

  /** 从某 harness 吸收一条审计轨迹 */
  ingest(harnessId: string, kind: AggregateAuditEntry['kind'], summary: string, options: {
    agentId?: string;
    timestamp?: string;
    payload?: Record<string, unknown>;
  } = {}): AggregateAuditEntry {
    const entry: AggregateAuditEntry = {
      id: randomUUID(),
      harnessId,
      kind,
      timestamp: options.timestamp ?? new Date().toISOString(),
      summary,
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.payload ? { payload: options.payload } : {}),
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * 吸收 L2 协作协议事件（v1.3.3 兼容面）。
   * feedback 族（amplifyFeedback 产物）与 conflict 族（resolveConflict 产物）
   * 都归一化成 kind='l2_event' 条目。
   */
  ingestL2Event(event: L2EventInput): AggregateAuditEntry {
    return this.ingest(event.harnessId, 'l2_event', `[L2:${event.family}] ${event.content}`, {
      agentId: event.agentId,
      timestamp: event.timestamp,
      payload: {
        family: event.family,
        ...(event.feedbackType ? { feedbackType: event.feedbackType } : {}),
      },
    });
  }

  /** 聚合查询（多 harness 一视图） */
  query(filter: AuditQuery = {}): AggregateAuditEntry[] {
    let out = this.entries;
    if (filter.harnessId) out = out.filter((e) => e.harnessId === filter.harnessId);
    if (filter.agentId) out = out.filter((e) => e.agentId === filter.agentId);
    if (filter.kind) out = out.filter((e) => e.kind === filter.kind);
    if (filter.since) out = out.filter((e) => e.timestamp >= filter.since!);
    out = [...out].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (filter.limit !== undefined) out = out.slice(0, filter.limit);
    return out;
  }

  /** 按 harness 分组统计（Dashboard 波次渲染的输入形态） */
  statsByHarness(): Array<{ harnessId: string; count: number; kinds: Record<string, number> }> {
    const map = new Map<string, Map<string, number>>();
    for (const e of this.entries) {
      let kinds = map.get(e.harnessId);
      if (!kinds) { kinds = new Map(); map.set(e.harnessId, kinds); }
      kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    }
    return [...map.entries()].map(([harnessId, kinds]) => ({
      harnessId,
      count: [...kinds.values()].reduce((a, b) => a + b, 0),
      kinds: Object.fromEntries(kinds),
    }));
  }

  /** 导出全量（worklog 聚合器消费的接口——同一数据源的另一个消费面） */
  exportAll(): AggregateAuditEntry[] {
    return [...this.entries];
  }
}
