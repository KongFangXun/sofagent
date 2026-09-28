// ============================================================
// ai-node-registry.ts · 治理面注册——外部 Agent 节点登记为被治理对象
// ============================================================
//
// 分工三句（马鞍边界，不得越界）：
//   DeepSeek harness 造节点（生成侧）· LangChain/LangGraph 编排（工作流侧）·
//   本仓治理节点（判定与审计侧）——本仓不做节点本体、不做运行时合体。
//
// 设计约束（对齐 G9 设备注册先例 device-registry.ts）：
//   - 身份 = Ed25519 验签（复用 @sofagent/core 的 generateEd25519KeyPair /
//     signIdentityPayload / verifyAgentIdentity——不另造第二套密码学）；
//   - fail-closed（铁律 4）：伪造签名 / 身份字段缺失 / 公钥被篡改 ⇒ 拒绝登记
//     并留审计记录（拒绝原因结构化，非静默丢弃）；
//   - 注册面**轻于**设备面：无心跳 / 无派单——节点是「软件公民」，只登记
//     身份 + 编排栈声明 + 事件端点 + 能力面声明；
//   - 引用契约不绑定具体编排栈（LangChain/LangGraph 是声明值不是类型分支）。
//
// 与 workflow 引用契约的衔接：workflow-store 的 workflowNodeAdd 引用外部节点
// 类型时经 `lookupAiNode` 做治理状态前置检查——未注册节点可被引用但不入治理面
// （引用时告警留痕），见 crud/workflow-store.ts。
// ============================================================

import {
  verifyAgentIdentity,
  type AgentIdentity,
} from '@sofagent/core';

/** 编排栈声明——开放枚举（引用契约不绑编排栈：新栈只需登记名字，不写类型分支） */
export type OrchestrationStack = 'langchain' | 'langgraph' | 'custom' | (string & {});

/** 节点能力面声明（治理面只登记不裁决——能力是否兑现由事件流对账暴露） */
export interface AiNodeCapabilities {
  /** 节点声明可执行的工具类动作（如 ['web-search', 'code-exec']） */
  tools?: string[];
  /** 节点声明会产生的出站请求 host 域（出站白名单的节点侧声明输入） */
  egressHosts?: string[];
  /** 任务类型声明（供路由/编排侧参考，治理面不强制） */
  taskKinds?: string[];
}

/** 事件端点声明——节点运行事件从哪里进治理面（本仓拉取或节点推送的接入位） */
export interface AiNodeEventEndpoint {
  /** 端点类型：'inline' = 宿主进程内（事件总线直连）；'webhook' = HTTP 回投 */
  kind: 'inline' | 'webhook';
  /** webhook 形态的目标 URL（inline 形态缺省） */
  url?: string;
}

/** 治理面登记记录（注册面轻于设备面：无心跳 / 无派单字段） */
export interface AiNodeRegistration {
  /** 节点唯一标识（与身份码 agentId 同源） */
  nodeId: string;
  /** 身份码（Ed25519 验签对象——publicKey + signature 绑定委托人/约束/责任声明） */
  identity: AgentIdentity;
  /** 编排栈声明（LangChain/LangGraph 等——登记不裁决） */
  stack: OrchestrationStack;
  /** 事件端点声明 */
  eventEndpoint: AiNodeEventEndpoint;
  /** 能力面声明 */
  capabilities: AiNodeCapabilities;
  /** 登记时刻（ISO 8601） */
  registeredAt: string;
}

/** 注册入参（节点侧自带的身份码 + 声明面） */
export interface RegisterAiNodeInput {
  identity: AgentIdentity;
  stack: OrchestrationStack;
  eventEndpoint: AiNodeEventEndpoint;
  capabilities?: AiNodeCapabilities;
}

/** 注册结果——拒绝时带结构化原因（fail-closed 可审计） */
export interface RegisterAiNodeResult {
  ok: boolean;
  node?: AiNodeRegistration;
  /** 拒绝理由码：invalid-identity=验签不过 / malformed=声明字段非法 / duplicate-key=身份键撞车 */
  reason?: 'invalid-identity' | 'malformed' | 'duplicate-key';
  /** 人类可读拒绝说明（进审计留痕） */
  message?: string;
}

/**
 * 治理面注册表（进程内登记面——持久化由调用方决定落点；本面只做登记与查询）。
 *
 * 与 device-registry 的差别（有意为之，非遗漏）：设备面有心跳/派单/OTA 下发；
 * 节点面没有——节点是软件公民，治理面只看「身份可信 + 事件可进 + 出站可控」。
 */
export class AiNodeRegistry {
  private readonly nodes = new Map<string, AiNodeRegistration>();

  /**
   * 登记一个外部节点（fail-closed）。
   *
   * 判定序：
   *   1. identity 非空 + nodeId 可解析 → 否则 malformed
   *   2. verifyAgentIdentity（Ed25519 验签）→ 不过即 invalid-identity
   *      （公钥/签名缺失、格式非法、绑定信息被篡改——verify 内部 catch 一律 false）
   *   3. 同 nodeId 再注册：身份码完全一致 = 幂等重放（返回既有登记）；
   *      身份码不一致 = duplicate-key 拒绝（同 id 换身份 = 冒名，fail-closed）
   *   4. stack / eventEndpoint 声明字段合法性 → 否则 malformed
   */
  register(input: RegisterAiNodeInput): RegisterAiNodeResult {
    const identity = input?.identity;
    if (!identity || typeof identity.agentId !== 'string' || identity.agentId === '') {
      return {
        ok: false,
        reason: 'malformed',
        message: '身份码缺失或 agentId 为空',
      };
    }
    // Ed25519 验签（fail-closed）——任一绑定信息被篡改即 false，伪造签名拒绝
    if (!verifyAgentIdentity(identity)) {
      return {
        ok: false,
        reason: 'invalid-identity',
        message: `节点 ${identity.agentId} 身份验签失败（Ed25519 fail-closed）：公钥/签名缺失、格式非法或绑定信息被篡改`,
      };
    }
    const stack = input?.stack;
    if (typeof stack !== 'string' || stack === '') {
      return { ok: false, reason: 'malformed', message: '编排栈声明缺失（stack 为空）' };
    }
    const ep = input?.eventEndpoint;
    if (!ep || (ep.kind !== 'inline' && ep.kind !== 'webhook')) {
      return { ok: false, reason: 'malformed', message: '事件端点声明非法（kind 须为 inline|webhook）' };
    }
    if (ep.kind === 'webhook' && (typeof ep.url !== 'string' || ep.url === '')) {
      return { ok: false, reason: 'malformed', message: 'webhook 事件端点缺 url' };
    }

    const nodeId = identity.agentId;
    const existing = this.nodes.get(nodeId);
    if (existing) {
      if (existing.identity.publicKey === identity.publicKey && existing.identity.signature === identity.signature) {
        // 幂等重放：同身份码重复登记 = 返回既有（注册面无副作用幂等）
        return { ok: true, node: existing };
      }
      return {
        ok: false,
        reason: 'duplicate-key',
        message: `节点 ${nodeId} 已登记且身份码不一致（同 id 换身份 = 冒名，fail-closed 拒绝）`,
      };
    }

    const registration: AiNodeRegistration = {
      nodeId,
      identity,
      stack,
      eventEndpoint: ep,
      capabilities: input.capabilities ?? {},
      registeredAt: new Date().toISOString(),
    };
    this.nodes.set(nodeId, registration);
    return { ok: true, node: registration };
  }

  /** 治理状态前置检查（workflow 引用契约消费）——未注册返回 undefined（调用方告警留痕） */
  lookup(nodeId: string): AiNodeRegistration | undefined {
    return this.nodes.get(nodeId);
  }

  /** 是否已注册（布尔形态，供引用时告警判定） */
  isRegistered(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /** 全量登记清单（治理面对账 / 测试用） */
  list(): AiNodeRegistration[] {
    return [...this.nodes.values()];
  }

  /** 登记数 */
  get size(): number {
    return this.nodes.size;
  }
}

/**
 * 默认全局注册表（宿主装配点——与 getDefaultAnomalyBus 同款「显式单例」模式）。
 * 生产代码经此共享同一登记面；测试可 new AiNodeRegistry() 独立造册。
 */
let defaultRegistry: AiNodeRegistry | undefined;

export function getDefaultAiNodeRegistry(): AiNodeRegistry {
  if (!defaultRegistry) defaultRegistry = new AiNodeRegistry();
  return defaultRegistry;
}

/** 测试缝：重置默认注册表（仅测试用——生产面禁调） */
export function resetDefaultAiNodeRegistry(): void {
  defaultRegistry = undefined;
}
