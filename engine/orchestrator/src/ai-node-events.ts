// ============================================================
// ai-node-events.ts · 事件挂接——节点运行事件进审计链
// ============================================================
//
// 设计约束（对齐 v1.5.1 双通道同款纪律）：
//   - **复用** engine/orchestrator/src/events/bus.ts（v1.5.1 事件总线）——
//     真实 API：new EventBus(...) 之后 `.subscribe(type, handler)`（:213）/
//     `.publish(input)`（:251）。**规则判定逻辑零改动**（只扩输入面）；
//   - 事件类型必须取自 EVENT_TYPES 注册表（types.ts 单一事实源）——
//     落盘 kind 门 fail-closed：未登记类型 publish 即抛 ChainKernelError，
//     故本章消费的三类节点事件须先在注册表登记（ANOMALY_REPORTED 既有复用 +
//     AI_NODE_TOOL_CALL / AI_NODE_EGRESS / AI_NODE_TASK_COMPLETED 三新键同批登记）；
//   - 节点运行事件三类（任务书原文）：工具调用 / 出站请求 / 任务完成——
//     本文件提供「节点侧产事件 → 总线 → 审计链」的挂接件，不造第二总线。
//
// 与 ai-node-egress.ts 的分工：本文件管「事件进链」（观测面）；
// 出站裁决（管控面）在 ai-node-egress.ts（消费 rules 的 decideEgress +
// audit 的 recordEgressDecision），两者经同一 EventBus 实例共享事件流。
// ============================================================

import type { EventBus } from './events/bus';
import { EVENT_TYPES } from './events/types';
import type { AiNodeRegistry } from './ai-node-registry';

/** 节点工具调用事件载荷（工具名 / 参数摘要 / 结果态） */
export interface AiNodeToolCallPayload {
  nodeId: string;
  tool: string;
  /** 参数摘要（脱敏后——禁携凭证明文进事件流） */
  argsDigest: string;
  /** 结果态：ok / error / denied（denied = 治理面拦截） */
  outcome: 'ok' | 'error' | 'denied';
  /** 调用关联链（correlationId 透传） */
  correlationId?: string;
}

/** 节点出站请求事件载荷（裁决摘要——与 ai-node-egress 的裁决留痕对账） */
export interface AiNodeEgressPayload {
  nodeId: string;
  host: string;
  verdict: 'Allow' | 'Deny';
  reason: string;
  correlationId?: string;
}

/** 节点任务完成事件载荷 */
export interface AiNodeTaskCompletedPayload {
  nodeId: string;
  /** 任务标识（编排侧的 task/run id） */
  taskId: string;
  /** 完成态：done / failed / stopped */
  outcome: 'done' | 'failed' | 'stopped';
  correlationId?: string;
}

/** 节点事件进链的审计订阅句柄（dispose = 卸载全部订阅） */
export interface AiNodeEventTap {
  /** 已处理事件计数（观测面读数——事件桥/测试消费） */
  readonly handled: number;
  /** 已捕获的事件快照（有界环形——只保最近 maxBuffer 条，防内存无界） */
  readonly recent: readonly AiNodeObservedEvent[];
  dispose(): void;
}

/** 观测到的事件快照（订阅侧捕获形态） */
export interface AiNodeObservedEvent {
  type: string;
  payload: unknown;
  ts: string;
}

/** 订阅缓冲上界（环形截断——观测面不是存储面） */
const RECENT_BUFFER_MAX = 256;

/**
 * 把节点运行事件三类挂进审计链（复用事件总线——不造第二总线）。
 *
 * 挂接形态：订阅 EVENT_TYPES.AI_NODE_* 三键 + 既有 ANOMALY_REPORTED，
 * 捕获进观测缓冲（供事件桥 cordis-event-bridge / 预检探针读取）。
 * 落盘与 HMAC 挂链由 EventBus.publish 自带的 appendChained 承载——
 * 本函数零改动总线判定逻辑（shouldRunGate 等既有机制原样生效）。
 *
 * @param bus 既有事件总线实例（宿主装配点传入——同实例即同链）
 * @param registry 治理面注册表（未注册节点的事件标 unregistered 进观测快照——
 *                 治理面外产事件可观测可对账，不静默丢弃）
 */
export function tapAiNodeEvents(
  bus: EventBus,
  registry?: AiNodeRegistry,
): AiNodeEventTap {
  const recent: AiNodeObservedEvent[] = [];
  let handled = 0;
  const unsubs: Array<() => void> = [];

  const capture = (type: string, payload: unknown): void => {
    handled += 1;
    recent.push({ type, payload, ts: new Date().toISOString() });
    if (recent.length > RECENT_BUFFER_MAX) recent.splice(0, recent.length - RECENT_BUFFER_MAX);
  };

  const nodeTypes = [
    EVENT_TYPES.AI_NODE_TOOL_CALL,
    EVENT_TYPES.AI_NODE_EGRESS,
    EVENT_TYPES.AI_NODE_TASK_COMPLETED,
  ] as readonly string[];
  // ⚠️ subscribe 的 handler 收到的是**总线事件信封** SofagentEvent（见 bus.ts:213/:434
  //   `sub.handler(attemptEvent)`）——真实载荷在内层 `event.payload`，须解包（否则
  //   观测面会把信封当载荷，字段读空）。
  for (const t of nodeTypes) {
    unsubs.push(bus.subscribe(t, (evt) => capture(t, evt.payload)));
  }
  // 异常流（既有键复用——节点失败若无来源事件，异常仍需带事件上下文）
  unsubs.push(
    bus.subscribe(EVENT_TYPES.ANOMALY_REPORTED, (evt) => {
      const p = evt.payload as { nodeId?: string } | null | undefined;
      if (p && typeof p.nodeId === 'string' && registry && !registry.isRegistered(p.nodeId)) {
        // 未注册节点产异常：观测面记录但不入治理面（unregistered 标记可对账）
        capture('anomaly.reported:unregistered', evt.payload);
        return;
      }
      capture(EVENT_TYPES.ANOMALY_REPORTED, evt.payload);
    }),
  );

  return {
    get handled() {
      return handled;
    },
    get recent() {
      return recent;
    },
    dispose(): void {
      for (const off of unsubs.splice(0)) off();
    },
  };
}

/**
 * 节点侧发布工具调用事件（进总线即进审计链——publish 落盘 + HMAC 挂链）。
 * publish 是 async（总线投递语义），本包装保持 async 透传结果。
 */
export async function publishAiNodeToolCall(
  bus: EventBus,
  payload: AiNodeToolCallPayload,
  opts: { correlationId?: string; causationId?: string } = {},
): Promise<void> {
  await bus.publish({
    type: EVENT_TYPES.AI_NODE_TOOL_CALL,
    source: 'ai-node',
    payload,
    correlationId: opts.correlationId,
    causationId: opts.causationId,
  });
}

/** 节点侧发布出站请求事件（裁决摘要——与 recordEgressDecision 留痕同源对账） */
export async function publishAiNodeEgress(
  bus: EventBus,
  payload: AiNodeEgressPayload,
  opts: { correlationId?: string; causationId?: string } = {},
): Promise<void> {
  await bus.publish({
    type: EVENT_TYPES.AI_NODE_EGRESS,
    source: 'ai-node',
    payload,
    correlationId: opts.correlationId,
    causationId: opts.causationId,
  });
}

/** 节点侧发布任务完成事件 */
export async function publishAiNodeTaskCompleted(
  bus: EventBus,
  payload: AiNodeTaskCompletedPayload,
  opts: { correlationId?: string; causationId?: string } = {},
): Promise<void> {
  await bus.publish({
    type: EVENT_TYPES.AI_NODE_TASK_COMPLETED,
    source: 'ai-node',
    payload,
    correlationId: opts.correlationId,
    causationId: opts.causationId,
  });
}
