// ============================================================
// ai-node-governance.ts · AI 节点治理接入的**生产装配点**（v1.5.4 第五章 · A-4 真接线）
// ============================================================
//
// 本文件把第五章六个件（registry / events / egress / 双桥 / 预检）从「单测可达」
// 提升到「生产可达（红线 4）」——集中做一件事：**把它们装到一起，交给真实入口**。
//
// 三处生产消费点（每处都是运行时可执行调用，非类型面）：
//   ① registry —— 本装配点构造/查询默认注册表；被 ④ 探针与 CLI 共用同一实例；
//   ② events   —— node-executor 实跑节点处经本件 publish 三类事件 + tap 进观测面；
//   ③ egress   —— 节点出站经本件 adjudicateEgress（注入 sink 留痕）；
//   ⑤⑥ 双桥 + 预检 —— CLI `plugin-probe` 子命令的真实入口。
//
// 🔴 留痕 sink 的 API 分级（不越红线）：ai-node-egress 的留痕走**注入式 sink**；
//   本装配点注入的**生产 sink** 建在 `@sofagent/audit` 的 **@public** `emitDecision`
//   之上（public-api.ts 明确 `/* @public */ export { emitDecision }`）——因此既做到
//   「装配点真注入」（非 undefined），又不 import `recordEgressDecision` 这类
//   **非 @public** 符号（不触发 public-api 门禁、不改 audit @public 面）。
//
// 🔴 零行为变化：本件只在**经 `ai-node:<id>` 引用的节点**或**显式注入 governance**
//   时被调用；普通企业节点路径不构造治理面、不落 events/、不写 decision-log。
// ============================================================

import { EventBus } from './events/bus';
import { getDataDir } from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';
import { getDefaultAiNodeRegistry, type AiNodeRegistry } from './ai-node-registry';
import {
  tapAiNodeEvents,
  publishAiNodeToolCall,
  publishAiNodeTaskCompleted,
  type AiNodeEventTap,
  type AiNodeToolCallPayload,
  type AiNodeTaskCompletedPayload,
} from './ai-node-events';
import {
  adjudicateNodeEgress,
  type AiNodeEgressAuditSink,
  type AiNodeEgressOptions,
  type AiNodeEgressOutcome,
} from './ai-node-egress';
import type { AiNodeGovernanceProbe } from './crud/workflow-store';
import type { EgressPolicy, EgressRequest } from '@sofagent/rules';

/**
 * 生产留痕 sink——把 ai-node-egress 的裁决事件落 `@sofagent/audit` 的
 * decision-log HMAC 链（kind=TOOL_GATE · moment=ACT · category=select|skip）。
 *
 * 只消费 @public 的 `emitDecision`（受控写唯一入口），不碰 `recordEgressDecision`
 * 等非 @public 符号——API 分级红线不越（对齐 ai-node-egress.ts / egress-interceptor-api.ts
 * 的「实现在外 + 注入式 sink」先例）。
 *
 * 抛错语义：`emitDecision` 入参非法 / 写盘失败会抛（DecisionSchemaError /
 * DecisionWriteError）；由 `adjudicateNodeEgress` 的 try/catch 兜住 → recorded=false，
 * **不阻断裁决返回**（留痕失败不吞裁决）。
 */
export function createDecisionLogEgressSink(dataDir: string): AiNodeEgressAuditSink {
  return ({ subject, request, decision, agentId, sessionId }) => {
    emitDecision(
      {
        agentId: agentId || 'ai-node-egress',
        sessionId: sessionId ?? `ai-node:${subject}`,
        kind: 'TOOL_GATE',
        category: decision.verdict === 'Allow' ? 'select' : 'skip',
        moment: 'ACT',
        why: {
          text: `AI 节点出站裁决 ${decision.verdict}：${decision.reason}`,
          tags: ['egress', decision.verdict, decision.reason],
        },
        artifactRef: `egress/${subject}/${request.host}`,
        evidence: [
          `subject=${subject}`,
          `host=${request.host}`,
          `verdict=${decision.verdict}`,
          `reason=${decision.reason}`,
        ],
      },
      dataDir,
    );
  };
}

/**
 * 由注册表构造 workflow 引用契约探针（`AiNodeGovernanceProbe` 生产实现）。
 *
 * 这是 workflow-store 的 `workflowNodeAdd(..., { aiNodeProbe })` 的生产注入源——
 * 使 `engine/orchestrator/src/crud/workflow-store.ts` 的引用告警分支从
 * 「只被测试注入」变为「生产链路真实注入」（④ inert→live）。
 */
export function buildAiNodeGovernanceProbe(
  registry: AiNodeRegistry = getDefaultAiNodeRegistry(),
): AiNodeGovernanceProbe {
  return (nodeId: string) => {
    const reg = registry.lookup(nodeId);
    return reg ? { registered: true, stack: reg.stack } : { registered: false };
  };
}

/** AI 节点治理句柄（生产装配产物——registry/bus/tap/sink 齐备） */
export interface AiNodeGovernance {
  /** 治理面注册表（① 生产构造/查询；与探针共用同一实例） */
  registry: AiNodeRegistry;
  /** 事件总线（② 与事件桥/观测面共用实例——同实例即同链） */
  bus: EventBus;
  /** 事件观测句柄（② 三类节点事件 + 异常流进观测缓冲） */
  tap: AiNodeEventTap;
  /** 留痕 sink（③ 生产注入实现） */
  sink: AiNodeEgressAuditSink;
  /** workflow 引用契约探针（④ 生产注入源） */
  probe: AiNodeGovernanceProbe;
  /** ② 发布一次节点工具调用事件 */
  recordToolCall(payload: AiNodeToolCallPayload): Promise<void>;
  /** ③ 一次节点出站裁决（注入 sink 留痕 + 事件面） */
  adjudicateEgress(
    nodeId: string,
    request: EgressRequest,
    policy: EgressPolicy | null | undefined,
    options?: AiNodeEgressOptions,
  ): AiNodeEgressOutcome;
  /** ② 发布一次节点任务完成事件 */
  recordTaskCompleted(payload: AiNodeTaskCompletedPayload): Promise<void>;
  /** 卸载观测订阅（dispose 幂等） */
  dispose(): void;
}

/** 治理装配选项（测试可注入独立 bus / registry / sink；缺省全走生产单例） */
export interface AiNodeGovernanceOptions {
  /** 数据目录（缺省 getDataDir()——事件/审计落盘根） */
  dataDir?: string;
  /** 注册表（缺省 getDefaultAiNodeRegistry()——与 ④ 探针同实例） */
  registry?: AiNodeRegistry;
  /** 事件总线（缺省新建 EventBus({ dataDir })） */
  bus?: EventBus;
  /** 留痕 sink（缺省 createDecisionLogEgressSink(dataDir)） */
  sink?: AiNodeEgressAuditSink;
}

/**
 * 装配一个 AI 节点治理句柄（生产装配点）。
 *
 * 装配动作：构造/取用注册表 → 建事件总线 → 挂 `tapAiNodeEvents` 进观测面 →
 * 注入 decision-log 留痕 sink → 备好 workflow 引用探针。
 */
export function createAiNodeGovernance(options: AiNodeGovernanceOptions = {}): AiNodeGovernance {
  const dataDir = options.dataDir ?? getDataDir();
  const registry = options.registry ?? getDefaultAiNodeRegistry();
  const bus = options.bus ?? new EventBus({ dataDir });
  const sink = options.sink ?? createDecisionLogEgressSink(dataDir);
  const tap = tapAiNodeEvents(bus, registry);
  const probe = buildAiNodeGovernanceProbe(registry);

  return {
    registry,
    bus,
    tap,
    sink,
    probe,
    recordToolCall: (payload) => publishAiNodeToolCall(bus, payload),
    adjudicateEgress: (nodeId, request, policy, opts = {}) =>
      adjudicateNodeEgress(nodeId, request, policy, { sink, bus, ...opts }),
    recordTaskCompleted: (payload) => publishAiNodeTaskCompleted(bus, payload),
    dispose(): void {
      tap.dispose();
    },
  };
}

/**
 * 进程内默认治理面（显式单例——与 getDefaultAiNodeRegistry 同款「宿主装配点」模式）。
 *
 * 生产入口（node-executor 的 ai-node 引用路径 / CLI）经此共享同一注册表与事件总线；
 * 测试可 `createAiNodeGovernance({ bus, registry, sink })` 独立造册，或用
 * `resetDefaultAiNodeGovernance()` 清空单例后重建。
 */
let defaultGovernance: AiNodeGovernance | undefined;

export function getDefaultAiNodeGovernance(dataDir?: string): AiNodeGovernance {
  if (!defaultGovernance) defaultGovernance = createAiNodeGovernance(dataDir ? { dataDir } : {});
  return defaultGovernance;
}

/** 测试缝：重置默认治理面（仅测试用——生产面禁调） */
export function resetDefaultAiNodeGovernance(): void {
  defaultGovernance?.dispose();
  defaultGovernance = undefined;
}
