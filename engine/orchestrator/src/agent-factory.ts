// agent-factory.ts · v1.3.7 交付⑤ · 调用点统一 agent 工厂（ExecutionBackend 迁移缝）
//
// 使命：dag-runner / composer / loop/nodes / node-executor 四个调用点的
// createReactAgent 调用迁移到 ExecutionBackend 接口——但不是直接改调用方式
// （那会动 extractAgentText/extractYAML/extractText 等下游消费逻辑，回归风险大），
// 而是提供一个「工厂解析」缝：
//
//   const createAgent = await resolveAgentFactory();
//   const agent = await createAgent({ llm, tools, prompt });   // ← 调用姿势不变
//   const result = await agent.invoke({ messages: [...] });    // ← 消费姿势不变
//
// - LangGraph 可用（现状）→ 原样返回 createReactAgent（零行为变化）。
// - LangGraph 不可用 → 尝试 DSH 后端，产出 invoke 兼容代理（内部走
//   backend.execute()，invoke 返回 { messages: [...] } 形状供下游提取函数消费）。
// - 两者都不可用 → null（调用点各自走既有降级路径，与今天行为一致）。
//
// 设计依据：ExecutionBackend 接口注释明确「execute 是唯一必须实现的方法」。
// invoke 兼容代理是执行层的适配器，不改变编排层的显式图结构（24 条 git diff
// 规则 + HMAC 链 + DAG 波次审计全部依赖的东西一点不动）。

import type { ExecutionBackend, ExecutionTask, ExecutionResult } from './execution-backend.js';

/** createReactAgent 调用参数（四调用点的公共形状） */
export interface AgentFactoryParams {
  llm: unknown;
  tools: unknown[];
  prompt: string;
}

/** invoke 兼容 agent 形状（与 createReactAgent 返回一致的最小面） */
export interface InvocableAgent {
  invoke(
    input: { messages: Array<{ role: string; content: string }> },
    config?: { recursionLimit?: number },
  ): Promise<{ messages: unknown[] }>;
}

/** agent 工厂（与 createReactAgent 同签名） */
export type AgentFactory = (params: AgentFactoryParams) => Promise<InvocableAgent>;

/** 解析结果——backend 为 null 表示 LangGraph 直连（零适配） */
export interface ResolvedAgentFactory {
  /** invoke 兼容工厂（null = LangGraph 与 DSH 均不可用） */
  factory: AgentFactory | null;
  /** 执行后端（LangGraph 直连时为 null——不走 ExecutionBackend 适配层） */
  backend: ExecutionBackend | null;
  /** 来源标识（日志/审计用） */
  source: 'langgraph' | 'dsh' | 'none';
}

/** 进程级缓存（避免每次调用重复动态 import 探测） */
let cached: ResolvedAgentFactory | null = null;

/**
 * 解析 agent 工厂——四调用点统一的迁移缝。
 *
 * 优先级：LangGraph 直连（零行为变化）→ DSH 后端适配 → null。
 *
 * 为什么 LangGraph 直连而不是走 langgraph-backend：四个调用点的调用方式
 * （invoke 非流式 / 提取函数消费 {messages}）与 langgraph-backend 的
 * stream 模式（FORGE driver 场景）不同。直连保持既有行为 100% 不变；
 * DSH 侧因没有「直连 createReactAgent」等价物，走 backend.execute() 适配。
 */
export async function resolveAgentFactory(): Promise<ResolvedAgentFactory> {
  if (cached) return cached;

  // 1. LangGraph 直连（现状路径——零行为变化）
  try {
    // @ts-ignore — prebuilt 子路径导出在 moduleResolution: node 下无法解析类型
    const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
    if (typeof createReactAgent === 'function') {
      cached = {
        factory: createReactAgent as unknown as AgentFactory,
        backend: null,
        source: 'langgraph',
      };
      return cached;
    }
  } catch {
    /* LangGraph 不可用——试 DSH */
  }

  // 2. DSH 后端（invoke 兼容代理）
  try {
    const { createExecutionBackend } = await import('./execution-backend.js');
    const backend = await createExecutionBackend();
    if (backend.name === 'dsh') {
      cached = {
        factory: (params) => Promise.resolve(createDshInvocableAgent(backend, params)),
        backend,
        source: 'dsh',
      };
      return cached;
    }
    // backend 是 langgraph（DSH 守卫拦截后 fallback）——但 LangGraph import
    // 已在上面失败才走到这里，说明 langgraph-backend 也不可用，返回 none
    await backend.close?.();
  } catch {
    /* DSH 也不可用——none */
  }

  cached = { factory: null, backend: null, source: 'none' };
  return cached;
}

/**
 * 创建 DSH 后端的 invoke 兼容代理。
 *
 * 把 backend.execute(task) 包装成 createReactAgent 形状：
 * - 工厂参数 { llm, tools, prompt } → ExecutionTask（systemPrompt/task/tools/modelConfig.model）
 * - agent.invoke({messages}) → 从 messages 末尾取 user 消息作 task，
 *   执行后返回 { messages: [AIMessageLike] } 供下游提取函数消费
 */
function createDshInvocableAgent(
  backend: ExecutionBackend,
  params: AgentFactoryParams,
): InvocableAgent {
  return {
    async invoke(input, config) {
      // 从输入 messages 取最后一条 user 消息作任务文本（对齐四调用点用法：
      // 它们都只投递单条 user 消息）
      const userMsg = [...input.messages].reverse().find((m) => m.role === 'user');
      const task: ExecutionTask = {
        systemPrompt: params.prompt,
        task: userMsg?.content ?? '',
        tools: params.tools,
        modelConfig: params.llm ? { model: params.llm } : undefined,
        recursionLimit: config?.recursionLimit,
      };
      const result: ExecutionResult = await backend.execute(task);
      // invoke 兼容返回：AI 消息形状（extractAgentText/extractText 的消费格式）
      return {
        messages: [
          {
            role: 'assistant',
            content: result.output,
            _getType: () => 'ai',
          },
        ],
      };
    },
  };
}

/** 测试辅助：清空进程级缓存（测试间隔离用） */
export function resetAgentFactoryCache(): void {
  cached = null;
}
