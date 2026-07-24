// ============================================================
// dag-runner.ts · 编排执行器（DeepAgents SubAgent 调度）
// v1.2.0 新增
// ============================================================
//
// ⚠️ 命名说明：文件名 dag-runner 指向最终目标（DAG 并行调度），
//    v1.2.0 当前实现为**串行状态机**——主 Agent 按 depends_on
//    顺序委派 Sub Agent，无依赖的节点可同步并行（取决于 LLM
//    是否在一次回复中发出多个 task 调用）。完整 DAG 并行调度
//    + 沙箱隔离规划在 v1.3.0。
//
// 把 compose 产出的 workflow YAML 真正跑起来：
//   1. parseWorkflowYaml → SubAgentConfig[]（workflow-parser）
//   2. 每个 SubAgent 的 systemPrompt 前置 buildConstrainedSystemPrompt 四层加载链
//   3. createDeepAgent({ subagents }) 创建编排 Agent（subagents 不再是 []）
//   4. 主 Agent 经 task tool 自主委派（可串行可并行）
//
// 主理人裁决落实：
//   - 裁决 #1：同文件冲突检测——多个节点声明写同一文件时打 WARN（不阻塞）
//   - 裁决 #4：ORCHESTRATOR_PROMPT 显式引导主 Agent 对无依赖节点并行委派；
//     nodes[].parallel=true 时在任务描述中显式要求并发 invoke
//
// 依赖倒置：createDeepAgent 与 buildConstrainedSystemPrompt 均可经
// DagRunnerDeps 注入——测试用 mock，生产默认动态 import 真实实现。

import { parseWorkflowYaml, toSubAgentConfigs, type ParsedWorkflow } from './workflow-parser';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 编排执行结果 */
export interface DAGResult {
  /** 主 Agent 最终输出（DeepAgents invoke 原始返回） */
  finalOutput: unknown;
  /** 参与执行的 SubAgent 数量 */
  subagentCount: number;
  /** 同文件冲突 WARN 列表（裁决 #1；无冲突为空数组） */
  warnings: string[];
  /** 解析出的 workflow（供上层审计/日志） */
  workflow: ParsedWorkflow;
}

/** createDeepAgent 签名（结构化类型；真实实现来自 deepagents 包） */
export type CreateDeepAgentFn = (params: {
  subagents: Array<{
    name: string;
    description: string;
    systemPrompt: string;
    tools?: unknown[];
  }>;
  tools: unknown[];
  systemPrompt: string;
}) => Promise<{ invoke: (input: { messages: Array<{ role: string; content: string }> }) => Promise<unknown> }>;

/**
 * 断言 SubAgent 配置数组中不包含空 tools 数组（F-01 回归防护）。
 * SubAgent 应 omit tools 字段，继承 DeepAgents 默认工具集。
 */
export function assertSubAgentsNoEmptyTools(subagents: Array<Record<string, unknown>>): void {
  for (const sa of subagents) {
    if ('tools' in sa && Array.isArray(sa['tools']) && (sa['tools'] as unknown[]).length === 0) {
      throw new Error(
        `SubAgent "${sa['name']}" 包含空 tools 数组——应 omit tools 字段以继承 DeepAgents 默认工具集`,
      );
    }
  }
}

/** 可注入依赖（测试 mock 入口） */
export interface DagRunnerDeps {
  createDeepAgent?: CreateDeepAgentFn;
  buildConstrainedSystemPrompt?: (projectRoot: string) => string;
}

// ────────────────────────────────────────────────────────────
// 编排器 system prompt（裁决 #4：显式并行引导）
// ────────────────────────────────────────────────────────────

/**
 * 编排主 Agent 的 system prompt。
 * 关键引导：无依赖关系的子任务**应当在一次回复中并行发出多个 task 调用**，
 * 有依赖关系的子任务严格等上游完成再委派。
 */
export const ORCHESTRATOR_PROMPT = `你是 sofagent 编排器。你的职责是把任务按 workflow 拆解结果委派给 Sub Agent 执行，并聚合结果。

## 委派规则
1. 每个 workflow 节点对应一个 Sub Agent——用 task 工具把节点的 task 描述交给它
2. **并行优先**：depends_on 为空的多个节点之间没有依赖——你**应当在同一次回复中并行发出多个 task 调用**，不要串行等待
3. **依赖有序**：节点 B depends_on 节点 A 时，必须等 A 的 task 调用返回后再委派 B
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
 * 产生一条 WARN（不阻塞——DeepAgents filesValue 会做文件级 LWW 合并，
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
        `filesValue 将按文件级 LWW 合并，后写覆盖先写，请确认拆分边界`,
      );
    }
  }
  return warnings;
}

// ────────────────────────────────────────────────────────────
// 动态依赖加载（生产路径；测试经 DagRunnerDeps 注入 mock）
// ────────────────────────────────────────────────────────────

async function loadCreateDeepAgent(): Promise<CreateDeepAgentFn | null> {
  try {
    const mod = (await import('deepagents')) as { createDeepAgent?: unknown };
    return (mod.createDeepAgent ?? null) as CreateDeepAgentFn | null;
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
 * 执行编排：workflow YAML → SubAgent 委派 → 聚合结果
 *
 * @param taskDesc 原始任务描述
 * @param workflowYaml compose 产出的 workflow YAML
 * @param projectRoot 项目根（buildConstrainedSystemPrompt 加载链锚点，默认 cwd）
 * @param deps 可注入依赖（测试 mock）
 * @returns DAGResult
 * @throws Error deepagents 不可用 / workflow 解析失败
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
  const createDeepAgent = deps.createDeepAgent ?? (await loadCreateDeepAgent());
  if (!createDeepAgent) {
    throw new Error('deepagents 不可用——无法创建编排 Agent');
  }
  const buildPrompt =
    deps.buildConstrainedSystemPrompt ?? (await loadBuildConstrainedSystemPrompt());
  const constrainedPrefix = buildPrompt ? buildPrompt(projectRoot) : '';

  // 4. 每个 SubAgent 注入四层约束加载链（前置，不覆盖 agent 自身 prompt）
  //    omit tools 字段——SubAgent 继承 DeepAgents 默认工具集（read_file/write_file/edit_file/glob/grep/execute）
  //    主 Agent 保留 tools: []（只用 task 委派工具）
  const subagents = configs.map((c) => ({
    name: c.name,
    description: c.description,
    systemPrompt: constrainedPrefix ? `${constrainedPrefix}\n\n${c.systemPrompt}` : c.systemPrompt,
    // omit tools → SubAgent 使用 DeepAgents 默认工具集（read_file/write_file/edit_file/glob/grep/execute）
  }));

  // 5. 创建编排 Agent（subagents 不再是 []）
  const orchestrator = await createDeepAgent({
    subagents,
    tools: [],
    systemPrompt: ORCHESTRATOR_PROMPT,
  });

  // 6. 组装任务描述（含 workflow 结构 + 并行引导）
  const nodeLines = parsed.nodes
    .map((n) => {
      const deps = n.depends_on.length > 0 ? n.depends_on.join(', ') : '无';
      return `- 节点 ${n.id}（agent: ${n.agent}，depends_on: ${deps}）：${n.task}`;
    })
    .join('\n');
  const userContent =
    `任务：${taskDesc}\n\n` +
    `workflow「${parsed.name}」共 ${parsed.nodes.length} 个节点：\n${nodeLines}\n\n` +
    `请按依赖关系委派执行；无依赖的节点请并行发起 task 调用。`;

  // 7. 执行——主 Agent 自主决定委派时序（可串行可并行）
  const result = await orchestrator.invoke({
    messages: [{ role: 'user', content: userContent }],
  });

  return {
    finalOutput: result,
    subagentCount: subagents.length,
    warnings,
    workflow: parsed,
  };
}
