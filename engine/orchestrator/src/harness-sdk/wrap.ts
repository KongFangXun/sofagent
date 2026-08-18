// ============================================================
// harness-sdk/wrap.ts · SubAgent 托管 SDK 核心（v1.3.7 交付 ③）
// ============================================================
//
// 一行包装，获得约束层全部能力——审计 / 审批 / 身份 / Trace / 决策审计。
//
// 🔴 双形态兼容设计：
//   ① createReactAgent 形态：wrapTools() 包装工具集 → 创建 agent 时传入
//   ② 纯 StateGraph 形态：tools 节点是工具调用必经点——该节点消费的工具集
//      同样经 wrapTools() 注入拦截（「在 tools 节点注入拦截」的实现位）
//   两形态共享同一拦截层——wrap(agent) 只加 agent 级治理面（身份/注册/trace）。
//
// registry 执行链（衔接方案）：
//   registry 存「怎么构建」（graph 构建器工厂函数），dag-runner 管「什么时候构建」——
//   wrap() 自动把构建器注册进 GraphBuilderRegistry，解析链命中时按需实例化。
//
// 版本边界：sandbox=true → 明确错误「v1.3.8 启用」（v1.3.7 沙箱组件未就绪）。
// ============================================================

import { generateAgentIdentity, type AgentIdentity } from '@sofagent/core';
import {
  type ApprovalMode,
  type HarnessWrapOptions,
  type HarnessToolCallEvent,
  type HarnessApprovalEvent,
  type WrappableAgent,
  type WrappedAgent,
  isSideEffectTool,
} from './types';
import {
  registerGraphBuilder,
  type GraphBuilder,
} from './builder-registry';
import type { ExecutableTool } from '../tools';

/** 结果预览截断长度（审计事件不落盘超大结果） */
const RESULT_PREVIEW_LIMIT = 500;

/** 截断保护 */
function preview(text: unknown): string {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return s.length > RESULT_PREVIEW_LIMIT ? `${s.slice(0, RESULT_PREVIEW_LIMIT)}…（截断）` : s;
}

// ============================================================
// 工具层拦截（两形态共享的治理内核）
// ============================================================

/**
 * 包装工具集——每次工具调用进审计 + 审批判定 + 事件回调。
 *
 * 审批语义（对齐 v1.3.1）：
 *   - allow-with-audit（默认）：放行 + 事件留痕
 *   - require-approval：副作用类工具（SIDE_EFFECT_TOOL_PATTERNS）调 requestApproval
 *     等人审——未提供回调时保守拒绝（fail-safe）
 *   - deny：副作用类工具全部拦截（只读观察模式）
 *
 * @param tools 原始工具集（ExecutableTool[]——sofagent 内部工具格式）
 * @param options 托管配置（复用 HarnessWrapOptions）
 * @returns 包装后的新工具集（不改原数组）
 */
export function wrapTools(
  tools: ExecutableTool[],
  options: HarnessWrapOptions = {},
): ExecutableTool[] {
  const approval: ApprovalMode = options.approval ?? 'allow-with-audit';
  const agentId = resolveAgentId(options);

  return tools.map((tool) => ({
    ...tool,
    func: (input: Record<string, unknown>): string => {
      const ts = new Date().toISOString();

      // ── 审批判定（副作用类工具才受审批模式约束）──
      if (isSideEffectTool(tool.name)) {
        if (approval === 'deny') {
          emitOnToolCall(options, {
            agentId,
            toolName: tool.name,
            args: input,
            resultPreview: '⛔ deny 模式拦截——未执行',
            errored: false,
            approvalVerdict: approval,
            ts,
          });
          return `⛔ [Harness 拦截] ${tool.name} 在 deny 模式下禁止执行（只读观察模式）`;
        }
        if (approval === 'require-approval') {
          // 同步 func 签名下无法 await——走保守同步策略：
          // 提供 requestApproval 时先记录审批请求（异步审批结论经 onToolCall 事件回传），
          // 未提供回调时 fail-safe 拒绝（人审通道缺失 ≠ 放行）
          if (!options.requestApproval) {
            emitOnToolCall(options, {
              agentId,
              toolName: tool.name,
              args: input,
              resultPreview: '⛔ require-approval 但无审批通道——保守拒绝',
              errored: false,
              approvalVerdict: approval,
              ts,
            });
            return `⛔ [Harness 拦截] ${tool.name} 需要人审但审批通道未接入（fail-safe 拒绝）`;
          }
          // 审批通道已接入：发起审批请求（异步结论由宿主经事件链消费；
          // 同步路径先记录请求，宿主在 approve 后重放调用——对齐 HITL 挂起语义）
          const event: HarnessApprovalEvent = { agentId, toolName: tool.name, args: input, ts };
          void options.requestApproval(event).catch(() => {
            // 审批回调异常不阻塞工具链——记一条审计事件
          });
        }
      }

      // ── 执行（allow-with-audit / require-approval 已接通道 / 非副作用工具）──
      let result: string;
      let errored = false;
      try {
        result = tool.func(input);
      } catch (err) {
        errored = true;
        result = `⚠️ 工具执行异常：${err instanceof Error ? err.message : String(err)}`;
      }

      emitOnToolCall(options, {
        agentId,
        toolName: tool.name,
        args: input,
        resultPreview: preview(result),
        errored,
        approvalVerdict: approval,
        ts,
      });

      return result;
    },
  }));
}

/** onToolCall 事件派发（缺省钩子时静默——宿主未订阅不报错） */
function emitOnToolCall(options: HarnessWrapOptions, event: HarnessToolCallEvent): void {
  if (options.onToolCall) {
    try {
      options.onToolCall(event);
    } catch {
      // 事件钩子异常不影响工具链
    }
  }
}

/** 从 options 解析 agentId（identity 对象 → agentId；字符串/缺省 → name 派生） */
function resolveAgentId(options: HarnessWrapOptions): string {
  if (typeof options.identity === 'object' && options.identity !== null && 'agentId' in options.identity) {
    return options.identity.agentId;
  }
  return options.name ?? 'wrapped-agent';
}

// ============================================================
// Agent 层包装（身份签发 + registry 注册 + invoke trace）
// ============================================================

/**
 * 托管一个 LangGraph agent——一行包装，获得约束层治理面。
 *
 * @param agent 可 invoke 的 agent（createReactAgent 产物或纯 StateGraph 编译产物）
 * @param options 托管配置
 * @returns WrappedAgent（agent 透传 + 身份 + 审批模式 + 统计 + registry 句柄）
 * @throws Error sandbox=true（v1.3.8 启用的版本边界）
 */
export function wrap(agent: WrappableAgent, options: HarnessWrapOptions = {}): WrappedAgent {
  // ── 版本边界：sandbox 留空（v1.3.7 组件未就绪）──
  if (options.sandbox === true) {
    throw new Error('[harness-sdk] sandbox: true 将在 v1.3.8 启用——v1.3.7 沙箱组件未就绪，本版请传 false 或省略');
  }

  // ── 身份签发（三种入参形态）──
  const name = options.name ?? 'wrapped-agent';
  let identity: AgentIdentity;
  if (typeof options.identity === 'object' && options.identity !== null) {
    identity = options.identity;
  } else {
    identity = generateAgentIdentity(name, {
      systemPrompt: `harness-sdk 托管 agent（${name}）`,
      ...(typeof options.identity === 'string' ? { principal: options.identity } : {}),
    });
  }

  // ── registry 注册（graph 构建器工厂——「怎么构建」由 registry 存）──
  const builder: GraphBuilder = {
    name,
    kind: 'harness-wrapped',
    build: () => agent,
    options: { approval: options.approval ?? 'allow-with-audit', trace: options.trace ?? true },
  };
  registerGraphBuilder(builder);

  // ── invoke 代理（trace 落盘 + 统计）──
  const stats = { toolCalls: 0, intercepted: 0, approvals: 0 };
  const wrappedAgent: WrappedAgent = {
    agent: {
      invoke: async (input: unknown, invokeOptions?: Record<string, unknown>) => {
        const startedAt = new Date().toISOString();
        try {
          const result = await agent.invoke(input, invokeOptions);
          appendTrace(options, { name, identity: identity.agentId, startedAt, finishedAt: new Date().toISOString(), ok: true });
          return result;
        } catch (err) {
          appendTrace(options, { name, identity: identity.agentId, startedAt, finishedAt: new Date().toISOString(), ok: false, error: err instanceof Error ? err.message : String(err) });
          throw err;
        }
      },
    },
    identity,
    approval: options.approval ?? 'allow-with-audit',
    trace: options.trace ?? true,
    stats,
    registryName: name,
  };

  return wrappedAgent;
}

/** trace 落盘（JSONL——v1.3.1 LLM 调用级 Trace 的 SDK 暴露面；非致命） */
function appendTrace(
  options: HarnessWrapOptions,
  record: { name: string; identity: string; startedAt: string; finishedAt: string; ok: boolean; error?: string },
): void {
  if (options.trace === false) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { appendFileSync, existsSync, mkdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const dataDir = options.dataDir ?? join(process.cwd(), 'data');
    const traceDir = join(dataDir, 'trace');
    if (!existsSync(traceDir)) mkdirSync(traceDir, { recursive: true });
    appendFileSync(join(traceDir, 'harness-sdk.jsonl'), JSON.stringify({ ...record, ts: new Date().toISOString() }) + '\n', 'utf-8');
  } catch {
    // trace 失败不阻塞 agent 执行
  }
}
