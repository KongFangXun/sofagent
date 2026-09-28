// ============================================================
// compat/cordis-event-bridge.ts · cordis 兼容层·事件桥——主干事件 → cordis ctx 事件形态
// ============================================================
//
// 形态 = 通道（对齐 TrainChannel 纪律：桥接协议在本仓、插件本体在外）。
// 主干=Hub 的 USB 口「读得出的那半边」：第三方 cordis 插件挂上来能读到
// 主干产生的事件流。
//
// 🔴 兼容面向「接口集」不面向「具体插件」（红线 A-2①）：
//   - 事件名对照 = engine/dsh-plugins/SEAMS.md 词汇表（§1 宿主 seam 表——
//     只有该表内的事件名会出现在映射表；宿主未派发的事件名不凭空造）；
//   - 不为任何具体第三方插件写特例分支——新插件只要消费 SEAMS 词汇表内的
//     事件名就自动可挂。
//
// 订阅机制（plugin-kit 实测口径）：cordis 只有 `ctx.on(event, handler)` 一条
// 订阅路（waterfall/serial 等是派发包装不是订阅面）。本桥把主干事件总线的
// 订阅面转形分发到「桥事件位」（SEAMS 词汇表名）——消费者（插件/测试）经
// attachCordisConsumer 挂到桥上，或宿主把桥事件位再接进自身 ctx.on。
// 桥不复制总线、不改总线判定逻辑（零改动红线）。
// ============================================================

import type { EventBus } from '../events/bus';
import { EVENT_TYPES } from '../events/types';

/**
 * 主干事件 → cordis 事件名的映射表（对照 SEAMS.md §1 宿主 seam 词汇表）。
 *
 * 映射原则（接口集口径）：
 *   - 只映射「语义对应位」且目标名必须存在于 SEAMS 词汇表（防凭空造事件名）；
 *   - 节点工具调用 → `tools/pre-execute`（工具执行前——可拦截、可改参）+
 *     `tools/result`（工具最终结果确定——审计留证落点）；
 *   - 节点出站裁决 → `tools/result`（治理动作的结果确定——留证落点同位）；
 *   - 节点任务完成 → `session/event`（会话事件流——SEAMS §1 明示这是按
 *     event.type 过滤的广播订阅点，turn/任务收尾的真实订阅形态）；
 *   - 节点异常 → `agent/error`（Agent 运行出错——逆序撤销触发点位）。
 */
export const CORDIS_EVENT_MAPPING: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [EVENT_TYPES.AI_NODE_TOOL_CALL]: Object.freeze(['tools/pre-execute', 'tools/result']),
  [EVENT_TYPES.AI_NODE_EGRESS]: Object.freeze(['tools/result']),
  [EVENT_TYPES.AI_NODE_TASK_COMPLETED]: Object.freeze(['session/event']),
  [EVENT_TYPES.ANOMALY_REPORTED]: Object.freeze(['agent/error']),
});

/** cordis 侧事件处理器形态（鸭子类型——适配层红线：不 import cordis 类型） */
export type CordisEventHandler = (...args: unknown[]) => unknown;

/** 事件桥读数（挂载后可观测——「事件桥有读数」验收的机判面） */
export interface CordisEventBridgeStats {
  /** 主干侧捕获并转发的事件总数 */
  forwarded: number;
  /** 按主干事件类型的转发计数 */
  byType: Readonly<Record<string, number>>;
  /** 按 cordis 事件名的分发计数 */
  byCordisEvent: Readonly<Record<string, number>>;
}

/** 事件桥句柄（attachCordisConsumer 挂消费者 / dispose 卸载） */
export interface CordisEventBridge {
  stats: CordisEventBridgeStats;
  /** 挂一个 cordis 形态消费者（返回卸载函数）——插件/测试侧的 ctx.on 等价面 */
  attachCordisConsumer(event: string, handler: CordisEventHandler): () => void;
  dispose(): void;
}

/**
 * 把主干事件流转接为 cordis ctx 事件形态。
 *
 * 工作方式：订阅事件总线的 AI 节点三类 + 异常流，每次捕获按
 * CORDIS_EVENT_MAPPING 把载荷**转形**后分发到桥事件位上的消费者。
 * 转形规则（cordis 侧消费契约——接口集的一部分，稳定勿漂）：
 *   - `tools/pre-execute` / `tools/result`：载荷转 { name, arguments } 形态
 *     （DSH 工具族事件形状：exec.name / exec.arguments——SEAMS 字段名差异警示）；
 *   - `session/event`：载荷转 { type, session, event } 形态
 *     （event.type = 主干类型值——消费方按 event.type 过滤）；
 *   - `agent/error`：载荷原样（异常对象即事件本体）。
 *
 * 🔴 零判定改动：桥只转发不裁决——拦截/改参语义（tools/pre-execute 的
 *   next 不调即否决）留给宿主/插件侧，主干总线行为一字不动。
 *
 * @param bus 主干事件总线（与治理面挂接共用实例——同实例即同链）
 */
export function createCordisEventBridge(bus: EventBus): CordisEventBridge {
  const byType: Record<string, number> = {};
  const byCordisEvent: Record<string, number> = {};
  let forwarded = 0;
  const unsubs: Array<() => void> = [];
  const handlerRegistry = new Map<string, CordisEventHandler[]>();

  /** 把主干载荷转形为 cordis 事件参数（按目标事件名分派形状——接口集契约） */
  const shapeFor = (cordisEvent: string, sourceType: string, payload: unknown): unknown[] => {
    if (cordisEvent === 'tools/pre-execute' || cordisEvent === 'tools/result') {
      const p = (payload ?? {}) as Record<string, unknown>;
      return [{ name: String(p.tool ?? p.host ?? sourceType), arguments: p }];
    }
    if (cordisEvent === 'session/event') {
      const p = (payload ?? {}) as Record<string, unknown>;
      return [
        {
          type: 'node-event',
          session: { id: String(p.nodeId ?? '') },
          event: { type: sourceType, payload: p },
        },
      ];
    }
    return [payload]; // agent/error 等：载荷原样
  };

  const dispatch = (sourceType: string, payload: unknown): void => {
    forwarded += 1;
    byType[sourceType] = (byType[sourceType] ?? 0) + 1;
    const targets = CORDIS_EVENT_MAPPING[sourceType] ?? [];
    for (const evt of targets) {
      byCordisEvent[evt] = (byCordisEvent[evt] ?? 0) + 1;
      for (const h of [...(handlerRegistry.get(evt) ?? [])]) {
        try {
          h(...shapeFor(evt, sourceType, payload));
        } catch {
          // 为何可静默：单 handler 抛错不拖垮转发（适配层降级红线——错误可见性归 handler
          //   自身日志；桥只做形态转发、不复制证据，此处吞错不隐藏本桥自身产生的任何信息）
        }
      }
    }
  };

  const sourceTypes = [
    EVENT_TYPES.AI_NODE_TOOL_CALL,
    EVENT_TYPES.AI_NODE_EGRESS,
    EVENT_TYPES.AI_NODE_TASK_COMPLETED,
    EVENT_TYPES.ANOMALY_REPORTED,
  ];
  for (const t of sourceTypes) {
    // ⚠️ subscribe 的 handler 收到**事件信封** SofagentEvent（bus.ts:213/:434）——
    //   真实载荷在 `event.payload`，转形前须解包（否则 shapeFor 读到空对象）。
    unsubs.push(bus.subscribe(t, (evt) => dispatch(t, evt.payload)));
  }

  return {
    stats: {
      get forwarded() {
        return forwarded;
      },
      get byType() {
        return { ...byType };
      },
      get byCordisEvent() {
        return { ...byCordisEvent };
      },
    },
    attachCordisConsumer(event: string, handler: CordisEventHandler): () => void {
      const list = handlerRegistry.get(event) ?? [];
      list.push(handler);
      handlerRegistry.set(event, list);
      return () => {
        const cur = handlerRegistry.get(event) ?? [];
        const idx = cur.indexOf(handler);
        if (idx >= 0) cur.splice(idx, 1);
      };
    },
    dispose(): void {
      for (const off of unsubs.splice(0)) {
        try {
          off();
        } catch {
          // 为何可静默：卸载幂等——个别 disposer 抛错不阻断其余卸载（dispose 无返回面，
          //   桥不持有可上报对象；重复卸载必须成功，否则清理链断裂）
        }
      }
      handlerRegistry.clear();
    },
  };
}
