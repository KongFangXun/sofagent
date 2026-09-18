// ============================================================
// loop/agent-runner.ts · 角色 Agent 执行器工厂（v1.4.9 深模块条目 4）
// ============================================================
// 背景：nodes.ts 两个角色 runner（defaultRunEngineer / defaultRunReviewer）
// 归一化后 50 行重复（占 62%）：LLM provider 四级回退解析、gate 三段接线、
// 心跳、主权包裹、文本提取、降级路径——全部是同一执行骨架。
// 本模块把骨架收编为 makeAgentRunner(spec, deps)：角色差异全部进 spec
// （工具集/prompt 拼装/endpoint 标注），新增角色只需一个 spec。
//
// 依赖注入（ForTest 三件套替代）：router / sovereigntyMw / progressMw
// 经 deps 传入——测试不再需要全局 setter（可并行、无跨测试污染）。
// ============================================================

import type { ExecutableTool } from '../tools';
import { wrapToolsWithGate, createToolGate, convertToLangGraphTools } from '../tools';
import { buildConstrainedSystemPrompt } from '@sofagent/inject';
import { spawnSubAgent } from '../launcher';
import type { SubAgentDefinition } from '../registry';
import type { DataSovereigntyMiddleware } from '../middleware/data-sovereignty-mw';
import type { ProgressMiddleware } from '../middleware/progress-mw';
import type { LoopArtifacts } from './state';
import { resolveLLMModelFor } from './llm-env';
import { resolveMaxTurns } from './nodes';

/** 角色执行规格——角色差异的唯一声明面 */
export interface AgentRunnerSpec {
  readonly role: 'engineer' | 'reviewer';
  /** 该角色的工具集（gated 前原始形态） */
  readonly tools: ExecutableTool[];
  /** 角色 SubAgent 定义（prompt 头 + 降级 spawnSubAgent 消费） */
  readonly agentDef: SubAgentDefinition;
  /** 任务文本拼装（角色各自的 prompt 构造） */
  readonly buildTask: (a: LoopArtifacts) => string;
  /** 主权包裹的 endpoint/purpose 标注 */
  readonly endpoints: { endpoint: string; purpose: string };
  /** 进度节点标题（progressMw.nodeStart 第二参） */
  readonly progressTitle: string;
  /** gate 的任务描述 */
  readonly gateTaskDesc: string;
  /** 额外上下文拼进 systemPrompt（decide 摘要等——角色可选） */
  readonly extraContext?: (task: string) => Promise<string>;
}

/** 依赖注入面（测试替换全局 setter 的正路） */
export interface AgentRunnerDeps {
  readonly sovereigntyMw: DataSovereigntyMiddleware;
  readonly progressMw: ProgressMiddleware;
}

/**
 * 构造角色执行器——统一骨架：
 * routeAndLog → （角色 extraContext）→ LLM 解析 → agentFactory → gate 三段 →
 * 心跳 → 主权包裹 invoke → 文本提取 → 降级路径（spawnSubAgent 前缀标注）。
 */
export function makeAgentRunner(
  spec: AgentRunnerSpec,
  deps: AgentRunnerDeps,
): (task: string) => Promise<string> {
  return async function runAgentTask(task: string): Promise<string> {
    // 角色 extraContext（engineer 的 decide/execute 摘要等）
    let extraSummary = '';
    if (spec.extraContext) {
      try {
        extraSummary = await spec.extraContext(task);
      } catch (err) {
        console.warn(`[sofagent] ${spec.role} extraContext 失败，跳过:`, err instanceof Error ? err.message : String(err));
      }
    }

    const sovereigntyMw = deps.sovereigntyMw;
    const progressMw = deps.progressMw;
    const nodeStartedAt = Date.now();
    progressMw.nodeStart(spec.role, spec.progressTitle.slice(0, 120));

    try {
      const resolved = await resolveLLMModelFor(spec.role);
      if (!resolved || !resolved.model) throw new Error('SOFAGENT_LLM 未设置，无法确定模型 provider');

      // v1.3.6 交付⑤：ExecutionBackend——resolveAgentFactory（LangGraph 直连优先）
      const { resolveAgentFactory } = await import('../agent-factory.js');
      const agentFactory = await resolveAgentFactory();
      if (!agentFactory.factory) throw new Error('agent 工厂不可用（LangGraph 与 DSH 均未就绪）');
      const constrainedPrompt = buildConstrainedSystemPrompt(process.cwd());
      const systemPrompt = `${constrainedPrompt}\n\n${spec.agentDef.systemPrompt}${extraSummary ? `\n\n${extraSummary}` : ''}`;
      // ToolGate 事前拦截（三段接线：create → wrap → convert）
      const gate = createToolGate({ agentName: spec.role, taskDesc: spec.gateTaskDesc.slice(0, 500) });
      const gatedTools = wrapToolsWithGate(spec.tools, gate);
      const langGraphTools = convertToLangGraphTools(gatedTools);
      const agent = (agentFactory.factory as unknown as (params: {
        llm: unknown;
        tools: unknown[];
        prompt: string;
      }) => { invoke: (input: unknown, config?: { recursionLimit?: number }) => Promise<unknown> })({
        llm: resolved.model,
        tools: langGraphTools,
        prompt: systemPrompt,
      });
      // 心跳（3s 节流）
      progressMw.heartbeat(spec.role);
      // 主权包裹（routeSummary 由角色 extraContext 或空串占位——路由评估在角色侧已做）
      const sensitivity = 'internal'; // 骨架缺省（角色侧 routeAndLog 有更细评估时经 extraContext 携带）
      const result = await sovereigntyMw.wrapModelCall(
        {
          provider: process.env.SOFAGENT_LLM?.split(':')[0] ?? 'unknown',
          model: process.env.SOFAGENT_LLM?.split(':')[1] ?? 'unknown',
          endpoint: spec.endpoints.endpoint,
          purpose: spec.endpoints.purpose,
        },
        () => agent.invoke(
          { messages: [{ role: 'user', content: task }] },
          { recursionLimit: resolveMaxTurns(spec.role) * 2 },
        ),
        { agentRole: spec.role, userIntent: task.slice(0, 200), sensitivity },
      );
      const output = extractAgentText(result);
      progressMw.nodeEnd(spec.role, { durationMs: Date.now() - nodeStartedAt, success: true });
      return output || '[降级运行] createReactAgent 未返回内容，已回退';
    } catch (err) {
      console.warn(`[sofagent] ${spec.role} createReactAgent 失败，降级到 spawnSubAgent:`, err instanceof Error ? err.message : String(err));
      progressMw.nodeEnd(spec.role, { durationMs: Date.now() - nodeStartedAt, success: false });
      const fallback = await spawnSubAgent(spec.agentDef, task);
      return `[降级运行] ${fallback}`;
    }
  };
}

/** 从 agent 调用结果提取文本（骨架内件） */
function extractAgentText(result: unknown): string {
  const r = result as { messages?: Array<{ content?: unknown }> };
  const last = r?.messages?.[r.messages.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return last.content
      .map((c) => (typeof c === 'string' ? c : ((c as { text?: string }).text ?? '')))
      .join('');
  }
  return '';
}
