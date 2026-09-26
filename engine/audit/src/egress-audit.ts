// ============================================================
// egress-audit.ts · v1.5.3 章五 · 出站裁决 HMAC 挂链（与 G10 读取审计对称）
// ============================================================
//
// 数据主权「管出」翼的留痕面：一次出站裁决（host × Allow/Deny）落**审计链**。
//
// 与「管进」翼 G10（engine/mcp/src/tools/device-data-query.ts）的对称关系：
//   - G10 读取授权判定通过后，调 `emitDecision(...)` 落 decision-log.jsonl；
//   - 本章出站裁决通过/拒绝后，同样调 `emitDecision(...)` 落**同一条链**。
//   同一挂链机制（chain-kernel HMAC-SHA256 + 环境指纹 + 原子追加），不另立一套——
//   这是「管进」+「管出」两翼齐备的判据（验收 ②）。
//
// 为何不用 appendHistory（history.jsonl）：
//   audit-history 的 AuditHistoryEntry 是**审计运行**(git diff 粒度)条目——
//   必填 diffRange/exitCode/ruleResults/diffFileCount，语义上装不下一次出站裁决；
//   硬塞会让裁决事件伪装成一次代码审计运行，污染审计运行统计（stats/contribution）。
//   G10 读取审计走的正是 decision-log（决策日志）而非 history——本章与它对齐。
//
// 裁决事件契约可导出（验收 ④）：EGRESS_DECISION_CONTRACT_SCHEMA_VERSION + 结构化
//   JSON schema（exportEgressDecisionContract）+ 稳定事件构造器
//   （buildEgressDecisionEvent）——schema 稳定、可导出，判定底座（v1.6.0+）与
//   AI 节点消费方（v1.5.4 第五章）就位后可直接消费，无需再改本文件。
//
// ⚠️ 马鞍边界：本文件只做**审计挂链**——不含任何拦截/代理实现（实现在外，
//   见 engine/orchestrator/src/egress-interceptor-api.ts 通道）。
// ⚠️ emitDecision 会写真实数据目录——测试必须传临时 dataDir。
// ============================================================

import { emitDecision, type DecisionLogEntry } from './decision-log';
import type { EgressDecision, EgressRequest } from '@sofagent/rules';

/**
 * 裁决事件**数据结构 schema 版本**（稳定性锚点——消费方据此判兼容）。
 * ⚠️ 命名约定：后缀 `SCHEMA_VERSION` 表明它是「数据结构 schema 版本」而非产品
 * 版本（与 `check-version.sh` [1/14] 段的既有豁免语义一致，同 checkpoint
 * `SCHEMA_VERSION` 先例）——产品版本由 package.json SSOT 持有，本常量不随其变化。
 */
export const EGRESS_DECISION_CONTRACT_SCHEMA_VERSION = 'v1';

/** 契约标题（导出物标识） */
export const EGRESS_DECISION_CONTRACT_TITLE = 'sofagent egress decision event';

/**
 * 出站裁决事件（稳定契约面·v1）。
 *
 * 这是审计链落盘内容的结构投影 + 判定底座消费面——字段稳定，只增不改。
 * 判定底座（v1.6.0+）就位后按 `host × verdict` 作 `Noul` 判定输入源；
 * 判定只出建议，Allow/Deny 执行决策仍由策略契约（egress-policy.ts）持有。
 */
export interface EgressDecisionEvent {
  /** 契约版本 */
  schemaVersion: string;
  /** ISO 8601 裁决时刻 */
  ts: string;
  /** 裁决主体（workflow / 节点 / agent 标识） */
  subject: string;
  /** 目标 host（归一化） */
  host: string;
  /** 目标端口（请求带则记） */
  port?: number;
  /** 协议类别（请求带则记） */
  protocol?: string;
  /** 裁决结果 */
  verdict: 'Allow' | 'Deny';
  /** 裁决理由码（egress-policy 的 EgressReason） */
  reason: string;
  /** 人类可读理由文本 */
  message: string;
  /** 命中的声明（Allow 时有值——可追溯「依据哪条声明放行」） */
  matchedRule?: string;
  /** 裁决归属 Agent（审计主体） */
  agentId: string;
  /** 裁决会话标识 */
  sessionId: string;
}

/** 裁决事件构造入参（策略裁决 + 主体上下文的收纳） */
export interface EgressDecisionEventInput {
  /** 裁决主体（workflow / 节点 / agent） */
  subject: string;
  /** 原始出站请求 */
  request: EgressRequest;
  /** 策略裁决结果（egress-policy.decideEgress 产出） */
  decision: Pick<EgressDecision, 'verdict' | 'reason' | 'message'> & Partial<Pick<EgressDecision, 'host' | 'matchedRule'>>;
  /** 归属 Agent（缺省 'egress-guard'） */
  agentId?: string;
  /** 会话标识（缺省按主体 + 时刻构造） */
  sessionId?: string;
}

/** 导出契约的结构类型（JSON schema 子集——零依赖，可直接 JSON 序列化给外部消费方） */
export interface EgressDecisionContract {
  schemaVersion: string;
  title: string;
  type: 'object';
  required: string[];
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  /** 附加说明（判定底座衔接语义） */
  description: string;
}

/**
 * 构造一条稳定的裁决事件（不做任何写盘——纯函数，契约面）。
 *
 * @param input 裁决 + 上下文
 * @param now 时刻覆盖（测试用；缺省当前时间）
 */
export function buildEgressDecisionEvent(
  input: EgressDecisionEventInput,
  now: Date = new Date(),
): EgressDecisionEvent {
  const host = input.decision.host ?? input.request.host;
  const agentId = input.agentId && input.agentId !== '' ? input.agentId : 'egress-guard';
  const sessionId =
    input.sessionId && input.sessionId !== ''
      ? input.sessionId
      : `egress-${input.subject}-${now.getTime()}`;

  const event: EgressDecisionEvent = {
    schemaVersion: EGRESS_DECISION_CONTRACT_SCHEMA_VERSION,
    ts: now.toISOString(),
    subject: input.subject,
    host,
    verdict: input.decision.verdict,
    reason: input.decision.reason,
    message: input.decision.message,
    agentId,
    sessionId,
  };
  if (typeof input.request.port === 'number') event.port = input.request.port;
  if (typeof input.request.protocol === 'string' && input.request.protocol !== '') {
    event.protocol = input.request.protocol;
  }
  if (typeof input.decision.matchedRule === 'string' && input.decision.matchedRule !== '') {
    event.matchedRule = input.decision.matchedRule;
  }
  return event;
}

/**
 * 导出裁决事件契约（JSON schema 子集——验收 ④）。
 *
 * 稳定、可序列化、零依赖：外部消费方（判定底座 v1.6.0+ / AI 节点 v1.5.4）
 * 拿到本对象即可校验 buildEgressDecisionEvent 的产出，无需读源码。
 */
export function exportEgressDecisionContract(): EgressDecisionContract {
  return {
    schemaVersion: EGRESS_DECISION_CONTRACT_SCHEMA_VERSION,
    title: EGRESS_DECISION_CONTRACT_TITLE,
    type: 'object',
    required: ['schemaVersion', 'ts', 'subject', 'host', 'verdict', 'reason', 'message', 'agentId', 'sessionId'],
    properties: {
      schemaVersion: { type: 'string', description: '契约版本（v1）' },
      ts: { type: 'string', description: 'ISO 8601 裁决时刻' },
      subject: { type: 'string', description: '裁决主体（workflow / 节点 / agent）' },
      host: { type: 'string', description: '目标 host（归一化）' },
      port: { type: 'number', description: '目标端口（可选）' },
      protocol: { type: 'string', description: '协议类别（可选）' },
      verdict: { type: 'string', enum: ['Allow', 'Deny'], description: '裁决结果' },
      reason: { type: 'string', description: '裁决理由码' },
      message: { type: 'string', description: '人类可读理由文本' },
      matchedRule: { type: 'string', description: '命中的声明（Allow 时）' },
      agentId: { type: 'string', description: '裁决归属 Agent' },
      sessionId: { type: 'string', description: '裁决会话标识' },
    },
    description:
      'sofagent 出站裁决事件契约（管出翼）。判定底座（v1.6.0+）就位后按 host×verdict 作 Noul 判定输入源；判定只出建议，执行决策仍由 egress-policy 策略契约持有。',
  };
}

/**
 * 记录一次出站裁决到审计链（decision-log.jsonl——与 G10 读取审计同链）。
 *
 * 落盘内容 = buildEgressDecisionEvent 的稳定契约投影进 decision-log：
 *   - kind='TOOL_GATE'（出站闸门裁决语义）、moment='ACT'（执行期）
 *   - category：Allow → 'select'，Deny → 'skip'
 *   - why.text = 裁决摘要，tags = ['egress', verdict, reason]
 *   - evidence = 结构化证据（host/port/protocol/verdict/reason/matchedRule/subject）
 *   - artifactRef = egress/<subject>/<host>
 *
 * HMAC 挂链由 emitDecision → chain-kernel.appendChained 承载（同密钥、同签名
 * 算法、同环境指纹）——本函数只**追加**，不改写既有链（留痕不破坏链）。
 *
 * @throws DecisionSchemaError 入参非法（不写文件）
 * @throws DecisionWriteError 写盘失败（绝不静默丢弃）
 */
export function recordEgressDecision(
  input: EgressDecisionEventInput,
  dataDir?: string,
): DecisionLogEntry {
  const event = buildEgressDecisionEvent(input);
  const evidence: string[] = [
    `subject=${event.subject}`,
    `host=${event.host}`,
    `verdict=${event.verdict}`,
    `reason=${event.reason}`,
  ];
  if (event.port !== undefined) evidence.push(`port=${event.port}`);
  if (event.protocol !== undefined) evidence.push(`protocol=${event.protocol}`);
  if (event.matchedRule !== undefined) evidence.push(`matchedRule=${event.matchedRule}`);

  return emitDecision(
    {
      agentId: event.agentId,
      sessionId: event.sessionId,
      kind: 'TOOL_GATE',
      moment: 'ACT',
      category: event.verdict === 'Allow' ? 'select' : 'skip',
      why: {
        text: `出站裁决 ${event.verdict}：${event.host}（${event.reason}）——${event.message}`,
        tags: ['egress', event.verdict, event.reason],
        confidence: 'high',
      },
      artifactRef: `egress/${event.subject}/${event.host}`,
      evidence,
    },
    dataDir,
  );
}
