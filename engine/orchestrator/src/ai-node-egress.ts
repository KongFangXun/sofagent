// ============================================================
// ai-node-egress.ts · 出站管控消费——节点出站过白名单裁决 + 裁决留痕
// ============================================================
//
// 本章（AI 节点治理接入）是 v1.5.2 第五章（出口治理）的**第一个实装消费方**：
// AI 节点 = 网络出口治理的首个治理对象，出站裁决与审计挂接是节点纳入治理面的
// 最小闭环。消费方排在提供方之后，时序自洽。
//
// 三处真实面（勘误 A1 归属，落笔前已逐符号 git grep -w 复核）：
//   ① 策略 SSOT：engine/rules/src/egress-policy.ts
//      - declareEgressHosts（:195）——声明面：host 清单规范化为 EgressPolicy
//      - decideEgress（:257）——裁决面：纯函数白名单判定（fail-closed 逐层收口）
//      ——两者均为 @public（rules/src/index.ts:36-37），经 `@sofagent/rules` 顶层可导入。
//   ② 留痕面：engine/audit/src/egress-audit.ts
//      - recordEgressDecision（:187）——裁决进审计链 decision-log（HMAC 挂链）
//      ⚠️ 该函数**不在 `@sofagent/audit` 的 @public 面**（public-api.ts 未转发
//         egress-audit 的任何符号，全仓零外部消费——v1.5.2 设计「实现在外」）。
//         若直接 import 即跨包消费非 @public 符号（违 API 分级契约）且触发
//         public-api 门禁（符号集变更须 bump 版本）。
//   ③ 接口形态参考：engine/orchestrator/src/egress-interceptor-api.ts
//      ——出站拦截器通道：**sink 注入**模式（`EgressAuditSink` 是注入的契约，
//      通道不 import 任何具体 sink 实现——马鞍边界「实现在外」）。
//
// 🔴 本文件的留痕接线决策（对齐 ③ 的既有先例，非新建特例）：
//   采用**注入式 sink**（`AiNodeEgressAuditSink`），不 import 具体
//   `recordEgressDecision` 实现——与 `EgressChannel` 同款契约：
//   生产装配点把 audit 的 `recordEgressDecision` 适配成 sink 注入，
//   测试/自定义部署可注入假 sink（如外部 SIEM 推送）。这样：
//     · 判定面（decideEgress）是真实 @public 依赖——生产可达；
//     · 留痕面是注入契约——不越 API 分级红线、不改 audit @public 面；
//     · 边界干净：本文件不发明第二套留痕实现，只做「裁决 → 送 sink」编排。
//
// 分工边界：本文件**只做消费与编排**（策略/审计零改动）——节点声明出站域 →
// 策略裁决 → 送注入的留痕 sink → 事件进总线（与 ai-node-events 的观测面对账）。
// ============================================================

import {
  decideEgress,
  declareEgressHosts,
  type EgressDecision,
  type EgressHostRule,
  type EgressPolicy,
  type EgressRequest,
} from '@sofagent/rules';
import type { EventBus } from './events/bus';
import { EVENT_TYPES } from './events/types';
import type { AiNodeEgressPayload } from './ai-node-events';

/**
 * 出站裁决留痕钩子（**注入的契约**——马鞍边界：本文件不 import 任何具体 sink 实现）。
 *
 * 生产装配点注入 audit 的 `recordEgressDecision` 适配：
 *   sink: (evt) => recordEgressDecision({ subject, request, decision, agentId, sessionId }, dataDir)
 * （engine/audit/src/egress-audit.ts——写 decision-log.jsonl HMAC 链）；
 * 测试 / 自定义部署可注入任意实现（如推送外部 SIEM）。
 * 字段形态与 `EgressDecisionEventInput`（egress-audit.ts:78）对齐——适配为恒等映射。
 */
export interface AiNodeEgressAuditSink {
  (event: {
    /** 裁决主体（节点 id） */
    subject: string;
    /** 被裁决的出站请求 */
    request: EgressRequest;
    /** 策略裁决结果（Allow/Deny + 理由） */
    decision: EgressDecision;
    /** 归属 Agent（留痕 agentId） */
    agentId: string;
    /** 会话标识（留痕 sessionId，可选） */
    sessionId?: string;
  }): void;
}

/** 节点出站裁决结果（裁决 + 留痕 + 事件三面齐备的收纳） */
export interface AiNodeEgressOutcome {
  /** 策略裁决（decideEgress 原样——verdict/reason/message/matchedRule） */
  decision: EgressDecision;
  /** 裁决是否为放行（verdict === 'Allow'）——调用方执行/拦截的分叉点 */
  allowed: boolean;
  /**
   * 留痕是否成功落链（有 sink 且 sink 未抛错 = true；
   * 无 sink / sink 抛错 = false——**不阻断裁决返回**，对齐 EgressChannel.audited 语义）。
   */
  recorded: boolean;
}

/** 节点出站管控选项 */
export interface AiNodeEgressOptions {
  /**
   * 留痕钩子（注入的契约；缺省 = 不留痕只裁决——`recorded=false`）。
   * 生产装配点注入 audit `recordEgressDecision` 适配；测试可注入假 sink 或省略。
   */
  sink?: AiNodeEgressAuditSink;
  /** 归属 Agent（留痕 agentId，缺省 'ai-node-egress'） */
  agentId?: string;
  /** 会话标识（留痕 sessionId） */
  sessionId?: string;
  /** 事件总线（发布 ai-node.egress 观测事件——未传则跳过事件面） */
  bus?: EventBus;
  /** correlationId 透传（事件链追溯） */
  correlationId?: string;
}

/**
 * 节点声明出站域（声明面包装）——把节点能力面声明的 egressHosts 规范化为
 * EgressPolicy（策略 SSOT 的 declareEgressHosts 原样转发，主体钉节点 id）。
 */
export function declareNodeEgress(
  nodeId: string,
  hosts: Array<string | EgressHostRule>,
): EgressPolicy {
  return declareEgressHosts(hosts, { subject: nodeId });
}

/**
 * 一次节点出站请求的裁决 + 留痕 + 事件（消费面三拍）。
 *
 * 判定序（fail-closed 链路完整性由 decideEgress 内建——空策略即全拒）：
 *   1. decideEgress(request, policy)——纯函数裁决（无策略/清单空/结构非法均 Deny）
 *   2. options.sink({ subject, request, decision, agentId, sessionId })——注入的留痕
 *      钩子（生产装配点传 audit `recordEgressDecision` 适配）。Deny 不静默——
 *      拒绝同样送 sink，治理面可对账「哪些节点想出站被拒」；sink 抛错不阻断裁决
 *      （recorded=false 显式标注，对齐 EgressChannel.emitAudit 语义）。
 *   3. bus.publish(ai-node.egress)——观测事件（与留痕同源同判，供事件桥消费）
 *
 * ⚠️ 本函数不做网络请求、不执行拦截——「裁决」与「执行」分离：执行归节点
 * 运行时（它拿到 allowed=false 自行放弃请求），治理面只持有判定与证据。
 */
export function adjudicateNodeEgress(
  nodeId: string,
  request: EgressRequest,
  policy: EgressPolicy | null | undefined,
  options: AiNodeEgressOptions = {},
): AiNodeEgressOutcome {
  const decision = decideEgress(request, policy);

  let recorded = false;
  if (options.sink) {
    try {
      options.sink({
        subject: nodeId,
        request,
        decision,
        agentId: options.agentId ?? 'ai-node-egress',
        sessionId: options.sessionId,
      });
      recorded = true;
    } catch {
      // 留痕失败不阻断裁决返回（recorded=false 显式标注，留痕失败不吞裁决）
      recorded = false;
    }
  }

  if (options.bus) {
    const payload: AiNodeEgressPayload = {
      nodeId,
      host: decision.host ?? request.host,
      verdict: decision.verdict,
      reason: decision.reason,
      correlationId: options.correlationId,
    };
    // 观测事件发布（async 总线语义——此处不 await，裁决路径保持同步纯度；
    // 落盘失败会按总线死信语义处理，不拖垮裁决主路径）
    void options.bus
      .publish({
        type: EVENT_TYPES.AI_NODE_EGRESS,
        source: 'ai-node',
        payload,
        correlationId: options.correlationId,
      })
      .catch(() => {
        // 事件面失败不影响裁决结果（裁决与留痕已成立）——吞错仅限观测事件分支
      });
  }

  return { decision, allowed: decision.verdict === 'Allow', recorded };
}
