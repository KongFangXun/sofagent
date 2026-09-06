// ============================================================
// dag-runner.ts · 编排执行器（createReactAgent SubAgent 调度）
// v1.3.7 新增 · v1.2.0 迁移至 LangGraph createReactAgent（方案 B）
// ============================================================
//
// ⚠️ 命名说明：文件名 dag-runner 指向最终目标（DAG 并行调度），
//    v1.4.5 当前实现为**串行状态机**——主 Agent 按 depends_on
//    顺序委派 Sub Agent，无依赖的节点可同步并行（取决于 LLM
//    是否在一次回复中发出多个 task 调用）。完整 DAG 并行调度
//    + 沙箱隔离规划在 v1.4.5。
//
// 把 compose 产出的 workflow YAML 真正跑起来：
//   1. parseWorkflowYaml → SubAgentConfig[]（workflow-parser）
//   2. 每个 SubAgent 的 systemPrompt 前置 buildConstrainedSystemPrompt 四层加载链
//   3. 每个 SubAgent 封装为一个 task_<name> tool（内部创建子 createReactAgent）
//   4. 所有 task tools 注入给主 createReactAgent，主 Agent 经 tool call 委派
//
// 方案 B（subagents → tools）：
//   createReactAgent 不支持 subagents 参数。每个 SubAgent 被封装为一个
//   task_<name> tool（@langchain/core/tools 的 tool() 创建），tool 的 func
//   内部创建子 createReactAgent 并 invoke。所有 task tools 注入给主 agent。
//
// 主理人裁决落实：
//   - 裁决 #1：同文件冲突检测——多个节点声明写同一文件时打 WARN（不阻塞）
//   - 裁决 #4：ORCHESTRATOR_PROMPT 显式引导主 Agent 对无依赖节点并行委派；
//     nodes[].parallel=true 时在任务描述中显式要求并发 invoke
//
// 依赖倒置：createReactAgent 与 buildConstrainedSystemPrompt 均可经
// DagRunnerDeps 注入——测试用 mock，生产默认动态 import 真实实现。

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { parseWorkflowYaml, toSubAgentConfigs, type ParsedWorkflow } from './workflow-parser';
import { convertToLangGraphTools, ENGINEER_TOOLS } from './tools';
import { resolveLLMModel } from './loop/nodes';
import { getGraphBuilder } from './harness-sdk/builder-registry';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 编排执行结果 */
export interface DAGResult {
  /** 主 Agent 最终输出（createReactAgent invoke 原始返回） */
  finalOutput: unknown;
  /** 参与执行的 SubAgent 数量 */
  subagentCount: number;
  /** 同文件冲突 WARN 列表（裁决 #1；无冲突为空数组） */
  warnings: string[];
  /** 解析出的 workflow（供上层审计/日志） */
  workflow: ParsedWorkflow;
}

/**
 * createReactAgent 签名（方案 B：纯 { llm, tools, prompt }）。
 *
 * 方案 B 后不再有 subagents 参数——每个 SubAgent 被封装为 task tool 注入给主 Agent。
 * 真实实现来自 @langchain/langgraph/prebuilt 的 createReactAgent。
 */
export type CreateReactAgentFn = (params: {
  llm: unknown;
  tools: unknown[];
  prompt: string;
}) => Promise<{ invoke: (input: { messages: Array<{ role: string; content: string }> }, config?: { recursionLimit?: number }) => Promise<unknown> }>;

/**
 * 断言 SubAgent tools 数组不为空(回归防护）。
 * 迁移后语义变化：不再有 subagents 配置数组，改为检查注入的 subagent tools 数组。
 * 每个封装的 task tool 必须包含实际工具（不能为空数组）。
 */
export function assertSubAgentsNoEmptyTools(subagentTools: unknown[]): void {
  if (subagentTools.length === 0) {
    throw new Error(
      'SubAgent tools 数组为空——每个 SubAgent 至少应继承 ENGINEER_TOOLS 默认工具集',
    );
  }
}

/** 可注入依赖（测试 mock 入口） */
export interface DagRunnerDeps {
  createReactAgent?: CreateReactAgentFn;
  buildConstrainedSystemPrompt?: (projectRoot: string) => string;
  resolveModel?: () => Promise<unknown | null>;
}

// ────────────────────────────────────────────────────────────
// 编排器 system prompt（裁决 #4：显式并行引导）
// ────────────────────────────────────────────────────────────

/**
 * 编排主 Agent 的 system prompt。
 * 关键引导：无依赖关系的子任务**应当在一次回复中并行发出多个 task_<name> 调用**，
 * 有依赖关系的子任务严格等上游完成再委派。
 */
export const ORCHESTRATOR_PROMPT = `你是 sofagent 编排器。你的职责是把任务按 workflow 拆解结果委派给 Sub Agent 执行，并聚合结果。

## 委派规则
1. 每个 workflow 节点对应一个 Sub Agent——用对应的 task_<name> 工具把节点的 task 描述交给它
2. **并行优先**：depends_on 为空的多个节点之间没有依赖——你**应当在同一次回复中并行发出多个 task_<name> 调用**，不要串行等待
3. **依赖有序**：节点 B depends_on 节点 A 时，必须等 A 的 task_<name> 调用返回后再委派 B
4. 节点标记 parallel=true 时，**必须**与同级节点并发执行
5. 全部节点完成后，汇总各 Sub Agent 的输出，给出结构化的最终结果

## 输出格式
- 每个节点一节：节点 id / 负责 Agent / 执行结果摘要
- 最后一节：整体结论（成功/失败 + 关键产出清单）`;

// ────────────────────────────────────────────────────────────
// 同文件冲突检测（裁决 #1）
// ────────────────────────────────────────────────────────────

/**
 * 检测多个节点声明写同一文件的冲突。
 *
 * 识别节点 task 文本中的文件路径声明（"修改/创建/写入 <path>" 或
 * `files: [a.ts, b.ts]` 显式字段）。同一相对路径被 ≥2 个节点引用时
 * 产生一条 WARN（不阻塞——subagent tool 内部各自写文件，
 * WARN 只提醒可能的后写覆盖）。
 *
 * @param parsed 已解析的 workflow
 * @returns WARN 文本数组（无冲突为空数组）
 */
export function detectFileConflicts(parsed: ParsedWorkflow): string[] {
  // 节点 task 中形如 `路径` 的引用（反引号包裹 或 files: 列表项）
  const pathRe = /`([^`\s]+\.[a-zA-Z0-9]+)`/g;
  const claims = new Map<string, string[]>(); // path → nodeIds
  for (const node of parsed.nodes) {
    const found = new Set<string>();
    for (const m of node.task.matchAll(pathRe)) {
      found.add(m[1]!);
    }
    for (const p of found) {
      const list = claims.get(p) ?? [];
      list.push(node.id);
      claims.set(p, list);
    }
  }
  const warnings: string[] = [];
  for (const [p, nodeIds] of claims) {
    if (nodeIds.length > 1) {
      warnings.push(
        `同文件冲突：${p} 被节点 ${nodeIds.join(', ')} 同时声明修改——` +
        `各 SubAgent 各自写文件，后写覆盖先写，请确认拆分边界`,
      );
    }
  }
  return warnings;
}

// ────────────────────────────────────────────────────────────
// 动态依赖加载（生产路径；测试经 DagRunnerDeps 注入 mock）
// ────────────────────────────────────────────────────────────

async function loadCreateReactAgent(): Promise<CreateReactAgentFn | null> {
  // v1.3.6 交付⑤：调用点迁移到 ExecutionBackend——统一经 resolveAgentFactory
  // 解析工厂（LangGraph 直连优先零行为变化；LangGraph 不可用时 DSH 后端
  // 产出 invoke 兼容代理）。dag-runner 的调用/消费姿势完全不变。
  try {
    const { resolveAgentFactory } = await import('./agent-factory.js');
    const resolved = await resolveAgentFactory();
    return (resolved.factory as unknown as CreateReactAgentFn) ?? null;
  } catch {
    return null;
  }
}

async function loadBuildConstrainedSystemPrompt(): Promise<((projectRoot: string) => string) | null> {
  try {
    const mod = (await import('@sofagent/harness')) as { buildConstrainedSystemPrompt?: unknown };
    return (mod.buildConstrainedSystemPrompt ?? null) as ((projectRoot: string) => string) | null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// 主入口
// ────────────────────────────────────────────────────────────

/**
 * 从 Agent 结果中提取文本（兼容多种返回格式）。
 */
function extractAgentText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.messages)) {
      for (let i = obj.messages.length - 1; i >= 0; i--) {
        const msg = obj.messages[i] as Record<string, unknown>;
        if ((msg.role === 'assistant' || msg.type === 'ai') && typeof msg.content === 'string') {
          return msg.content;
        }
      }
    }
  }
  return String(result ?? '');
}

/**
 * 执行编排：workflow YAML → SubAgent 委派 → 聚合结果
 *
 * 方案 B：每个 SubAgent 被封装为 task_<name> tool，注入给主 createReactAgent。
 *
 * @param taskDesc 原始任务描述
 * @param workflowYaml compose 产出的 workflow YAML
 * @param projectRoot 项目根（buildConstrainedSystemPrompt 加载链锚点，默认 cwd）
 * @param deps 可注入依赖（测试 mock）
 * @returns DAGResult
 * @throws Error createReactAgent 不可用 / workflow 解析失败
 */
export async function runDAG(
  taskDesc: string,
  workflowYaml: string,
  projectRoot: string = process.cwd(),
  deps: DagRunnerDeps = {},
): Promise<DAGResult> {
  // 1. 解析 YAML → SubAgent 配置
  const parsed = parseWorkflowYaml(workflowYaml);
  const configs = toSubAgentConfigs(parsed);

  // 2. 同文件冲突检测（裁决 #1：WARN 不阻塞）
  const warnings = detectFileConflicts(parsed);
  for (const w of warnings) {
    console.warn(`⚠️ [dag-runner] ${w}`);
  }

  // 3. 加载依赖
  const createReactAgent = deps.createReactAgent ?? (await loadCreateReactAgent());
  if (!createReactAgent) {
    throw new Error('createReactAgent 不可用——无法创建编排 Agent');
  }
  const buildPrompt =
    deps.buildConstrainedSystemPrompt ?? (await loadBuildConstrainedSystemPrompt());
  const constrainedPrefix = buildPrompt ? buildPrompt(projectRoot) : '';

  // 4. 解析 LLM 模型实例（createReactAgent 需要显式传 llm）
  const resolveModel = deps.resolveModel ?? (async () => {
    const resolved = await resolveLLMModel(null);
    return resolved?.model ?? null;
  });
  const model = await resolveModel();
  if (!model) {
    throw new Error('LLM 模型未配置——SOFAGENT_LLM 环境变量未设置或解析失败');
  }

  // 5. 每个 SubAgent 封装为一个 task_<name> tool（方案 B）
  //    tool 内部创建子 createReactAgent，注入 ENGINEER_TOOLS（全量 6 个工具）
  //    主 Agent 通过 tool call 委派（非 subagents 参数）
  const subagentTools = configs.map((c) => {
    const subSystemPrompt = constrainedPrefix
      ? `${constrainedPrefix}\n\n${c.systemPrompt}`
      : c.systemPrompt;

    return tool(
      async (input: { task_description: string }) => {
        // v1.3.6 交付 ③：graph 构建器命中 → 按需实例化托管 agent
        //（registry 存「怎么构建」，dag-runner 管「什么时候构建」）
        if (c.graphBuilderName) {
          const builder = getGraphBuilder(c.graphBuilderName);
          if (!builder) {
            return `⛔ graph 构建器「${c.graphBuilderName}」未注册——请确认 harness.wrap 已执行`;
          }
          const hostedAgent = builder.build();
          const result = await hostedAgent.invoke(
            { messages: [{ role: 'user', content: input.task_description }] },
            { recursionLimit: 50 },
          );
          return extractAgentText(result);
        }

        // 内置路径：内部创建子 createReactAgent
        const subAgent = await createReactAgent({
          llm: model,
          tools: convertToLangGraphTools(ENGINEER_TOOLS),
          prompt: subSystemPrompt,
        });
        const result = await subAgent.invoke(
          { messages: [{ role: 'user', content: input.task_description }] },
          { recursionLimit: 50 },
        );
        return extractAgentText(result);
      },
      {
        name: `task_${c.name}`,
        description: c.description,
        schema: z.object({
          task_description: z.string().describe('委派给此 Agent 的子任务描述'),
        }),
      },
    );
  });

  // 6. 回归防护：确认 subagent tools 不为空
  assertSubAgentsNoEmptyTools(subagentTools);

  // 7. 创建编排 Agent（主 Agent 用 subagent tools 委派）
  const orchestrator = await createReactAgent({
    llm: model,
    tools: subagentTools,
    prompt: ORCHESTRATOR_PROMPT,
  });

  // 8. 组装任务描述（含 workflow 结构 + 并行引导）
  const nodeLines = parsed.nodes
    .map((n) => {
      const depStr = n.depends_on.length > 0 ? n.depends_on.join(', ') : '无';
      return `- 节点 ${n.id}（agent: ${n.agent}，depends_on: ${depStr}）：${n.task}`;
    })
    .join('\n');
  const userContent =
    `任务：${taskDesc}\n\n` +
    `workflow「${parsed.name}」共 ${parsed.nodes.length} 个节点：\n${nodeLines}\n\n` +
    `请按依赖关系委派执行；无依赖的节点请并行发起 task_<name> 调用。`;

  // 9. 执行——主 Agent 自主决定委派时序（可串行可并行）
  const result = await orchestrator.invoke(
    { messages: [{ role: 'user', content: userContent }] },
    { recursionLimit: 50 },
  );

  return {
    finalOutput: result,
    subagentCount: subagentTools.length,
    warnings,
    workflow: parsed,
  };
}
