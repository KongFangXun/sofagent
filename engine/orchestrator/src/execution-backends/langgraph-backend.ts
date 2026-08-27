// langgraph-backend.ts · v1.4.1 增量 · LangGraph createReactAgent fallback 后端
//
// 职责：封装 createReactAgent 的创建/调用/结果提取，对 ExecutionBackend 接口
// 暴露的只是 execute(task)→result。
//
// 迁移策略（关键）：
// FORGE driver 的 stateModifier / stream 处理逻辑极其精细（沉淀 run-01~run-12
// 教训），不在本文件内重写——改为接收 ExecutionTask.stateModifierFactory +
// ExecutionTask.streamHandler 回调。FORGE driver 把现有逻辑作为回调传入，
// 本文件只负责 createReactAgent 创建 + stream 执行 + 硬熔断控制。
//
// 这意味着：FORGE driver 的 stateModifier / trimMessagesSafe / estimateTokens /
// isReportText / 写报告窗口逻辑全部保留在 driver 侧，零改动、零回归风险。

import type { ExecutionBackend, ExecutionTask, ExecutionResult } from '../execution-backend.js';

/**
 * 创建 LangGraph createReactAgent 执行后端。
 *
 * 行为对齐现有 FORGE driver 的 createReactAgent 调用：
 * - stateModifier：如果 task.stateModifierFactory 提供，用它产出的 stateModifier；
 *   否则用默认的 SystemMessage 注入（适用于 launcher.ts 主入口的简单场景）。
 * - stream：用 streamMode:'updates' 流式执行，chunk 喂给 task.streamHandler。
 * - 硬熔断：streamHandler 返回 hardBreak=true 时中断 stream。
 * - 工具预算：stateModifierFactory 内部实现（FORGE driver 的软熔断逻辑）。
 */
export async function createLangGraphBackend(): Promise<ExecutionBackend> {
  // 动态加载 LangGraph（运行时 try-catch，失败由工厂层 fallback）
  // @ts-ignore — prebuilt 子路径导出在 moduleResolution: node 下无法解析类型
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const { SystemMessage } = await import('@langchain/core/messages');

  const backend: ExecutionBackend = {
    name: 'langgraph',

    async execute(task: ExecutionTask): Promise<ExecutionResult> {
      // 1. 构造 stateModifier
      let stateModifier: ((state: { messages: unknown[] }) => unknown[]) | undefined;
      if (task.stateModifierFactory) {
        // FORGE driver 提供的自定义 stateModifier（含软熔断 + 消息裁剪）
        stateModifier = task.stateModifierFactory({
          systemPrompt: task.systemPrompt,
          toolBudget: task.toolBudget,
        }) as ((state: { messages: unknown[] }) => unknown[]);
      } else {
        // 默认 stateModifier：SystemMessage 注入（launcher.ts 主入口用）
        const systemMsg = new SystemMessage(task.systemPrompt);
        stateModifier = (state) => {
          const messages = state.messages ?? [];
          return [systemMsg, ...messages];
        };
      }

      // 2. 模型解析
      //    FORGE driver 在调用 backend 前已经解析好模型（modelConfig.model），
      //    这里只处理 modelConfig.model 不提供的场景（launcher.ts 主入口）。
      let llm: unknown = task.modelConfig?.model;
      if (!llm) {
        const { resolveLLMModel } = await import('../loop/nodes.js');
        const resolved = await resolveLLMModel(null as unknown as 'engineer' | 'reviewer' | null);
        if (!resolved || !resolved.model) {
          throw new Error('[langgraph-backend] 模型解析失败');
        }
        llm = resolved.model;
      }

      // 3. 创建 agent（行为对齐现有 createReactAgent 调用）
      // TS7：prebuilt 子路径导出的参数类型收严，unknown 需经 as any 桥接
      // （llm/tools/stateModifier 的真实类型由 FORGE driver 与 resolveLLMModel 保证）
      const agent = createReactAgent({
        llm: llm as any,
        tools: task.tools as any,
        stateModifier: stateModifier as any,
        // preModelHook：task.modelConfig?.preModelHook（FORGE 的 token 硬阈值裁剪）
        // 如果提供就传入，否则不传
        ...(task.modelConfig?.preModelHook
          ? { preModelHook: task.modelConfig.preModelHook }
          : {}),
      });

      // 4. stream 执行（行为对齐现有 FORGE invokeAgent）
      const recursionLimit = task.recursionLimit ?? 50;
      const stream = await agent.stream(
        { messages: [{ role: 'user', content: task.task }] },
        { recursionLimit, streamMode: 'updates' }
      );

      const allMessages: unknown[] = [];
      let hardBreak = false;

      for await (const chunk of stream) {
        // chunk 是 { nodeName: stateDelta }——解包每个节点的 delta
        const entries = Object.entries(chunk as Record<string, unknown>);
        for (const [, delta] of entries) {
          const msgs = (delta as { messages?: unknown[] })?.messages;
          if (!Array.isArray(msgs)) continue;
          for (const msg of msgs) {
            allMessages.push(msg);
          }
        }

        // 喂给 streamHandler（FORGE driver 的写报告窗口 / 硬熔断逻辑）
        if (task.streamHandler) {
          const control = task.streamHandler(chunk);
          if (control.hardBreak) {
            hardBreak = true;
            break;
          }
        }
      }

      if (hardBreak) {
        // 显式通知 generator 终止——避免 break 后的「幽灵」API 请求继续消耗 Token
        try {
          await (stream as AsyncGenerator).return(undefined);
        } catch {
          // generator 已关闭——忽略
        }
      }

      // 5. 提取结果
      //    不在本文件做报告提取（extractAgentText / synthesizeReportFromMessages
      //    是 FORGE 编排层的事）——只返回原始消息 + 简单的 output 兜底。
      const output = extractLastAiContent(allMessages);
      const rounds = countAiMessages(allMessages);

      return {
        output,
        rounds,
        hitRecursionLimit: hardBreak,
        hardBreak,
        rawMessages: allMessages,
      };
    },

    async close() {
      // LangGraph createReactAgent 无需显式关闭
    },
  };

  return backend;
}

/**
 * 从消息数组里提取最后一条 AI message 的 content（兜底用）。
 *
 * ⚠️ 这只是兜底——FORGE driver 的 extractAgentText 逻辑更复杂
 * （从后往前找 + isReportText 质量门控），driver 侧应该用 result.rawMessages
 * 自己跑 extractAgentText，而不是依赖 result.output。
 */
function extractLastAiContent(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { _getType?: () => string; content?: unknown };
    if (msg?._getType?.() === 'ai') {
      const c = msg?.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) {
        return c.map((x) => (typeof x === 'string' ? x : (x as { text?: string })?.text ?? '')).join('');
      }
    }
  }
  return '';
}

/** 统计 AI message 数量（用于 rounds 字段） */
function countAiMessages(messages: unknown[]): number {
  let count = 0;
  for (const msg of messages) {
    if ((msg as { _getType?: () => string })?._getType?.() === 'ai') count++;
  }
  return count;
}
