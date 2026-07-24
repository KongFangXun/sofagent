// ============================================================
// composer.ts · DeepAgents 任务编排
// v1.2.0 新增：用 createDeepAgent() 做任务拆解，输出 YAML 工作流
// v1.2.0：deepagents 提升为正式依赖，移除 as unknown as 类型转换
// v1.2.0：迁移至 @sofagent/orchestrator
// v1.2.0 新增：ComposeResult 结构化返回（yaml + subagents）+
//   enterpriseWorkflowYaml 企业 workflow 参考 + variant 拆解策略（A/B/C/D）
// ============================================================

import type { SubAgentConfig } from './workflow-parser';

/**
 * 动态加载 deepagents（v1.0.9：正式依赖）
 */
async function loadDeepAgentsCreate(): Promise<Function | null> {
  try {
    const { createDeepAgent } = await import('deepagents');
    return createDeepAgent as Function;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// v1.1.8 新增：compose 输入/输出结构化
// ────────────────────────────────────────────────────────────

/** 拆解策略变体：A 步骤拆解（默认）/ B 领域驱动 / C 风险优先 / D 测试先行 */
export type ComposeVariant = 'A' | 'B' | 'C' | 'D';

/** compose 输入（v1.1.8 新增 enterpriseWorkflowYaml + variant） */
export interface ComposeInput {
  /** 任务描述 */
  taskDesc: string;
  /** FDE 梳理的企业 workflow（可选）——compose 的参考上下文，不凭空生成通用拆解 */
  enterpriseWorkflowYaml?: string;
  /** 拆解策略选择（默认 A） */
  variant?: ComposeVariant;
}

/** compose 结构化结果（v1.1.8 新增） */
export interface ComposeResult {
  /** YAML 文本（保留，给 --dry-run 预览） */
  yaml: string;
  /** 结构化 SubAgent 配置（新增；解析失败时为空数组） */
  subagents: SubAgentConfig[];
}

/** 各变体的拆解策略说明（注入 system prompt） */
const VARIANT_GUIDES: Record<ComposeVariant, string> = {
  A: '按执行步骤顺序拆解：准备 → 核心实现 → 验证 → 收尾（默认策略，步骤驱动）',
  B: '按业务领域拆解：同一领域的子任务归一个节点（领域驱动，适合跨模块任务）',
  C: '按风险优先级拆解：风险最高的子任务排最前，早暴露早处理（风险优先）',
  D: '按测试先行拆解：先写失败测试节点，再实现节点，最后重构节点（TDD）',
};

/**
 * 使用 DeepAgents 编排任务（v1.1.7 新签名 · ComposeInput → ComposeResult）
 *
 * 创建一个编排 Agent，systemPrompt 基于 variant 策略 + 企业 workflow 参考，
 * Agent 输出格式为 YAML 工作流定义；返回结构化 ComposeResult。
 *
 * @param input ComposeInput（taskDesc 必填，其余可选）
 * @param parseSubAgents 可选的 YAML→SubAgent 解析器（依赖注入，测试可 mock；
 *        缺省时 subagents 为空数组——dag-runner 侧会自行再解析）
 * @returns ComposeResult，或 null（deepagents 不可用/生成失败）
 */
export async function compose(
  input: ComposeInput,
  parseSubAgents?: (yaml: string) => SubAgentConfig[],
): Promise<ComposeResult | null> {
  const yamlText = await composeYaml(input);
  if (!yamlText) return null;
  let subagents: SubAgentConfig[] = [];
  if (parseSubAgents) {
    try {
      subagents = parseSubAgents(yamlText);
    } catch {
      // 解析失败不阻塞——yaml 已产出，subagents 留空由 dag-runner 再解析
      subagents = [];
    }
  }
  return { yaml: yamlText, subagents };
}

/**
 * 使用 DeepAgents 编排任务（v1.1.7 兼容签名 · 返回 YAML 字符串）
 *
 * 旧接口保留：composeTask() 等现有调用方不动。内部走 composeYaml()。
 *
 * @param taskDesc    任务描述
 * @param workflowYml 可选——现有 workflow.yml 内容，用于指导编排风格
 * @returns YAML 工作流定义字符串，或 null（不可用/失败）
 */
export async function composeWithDeepAgents(
  taskDesc: string,
  workflowYml?: string
): Promise<string | null> {
  return composeYaml({ taskDesc, enterpriseWorkflowYaml: workflowYml, variant: 'A' });
}

/**
 * compose 核心：调 DeepAgents 生成 YAML 文本
 */
async function composeYaml(input: ComposeInput): Promise<string | null> {
  const createDeepAgent = await loadDeepAgentsCreate();
  if (!createDeepAgent) return null;

  try {
    const systemPrompt = buildComposeSystemPrompt(input.enterpriseWorkflowYaml, input.variant ?? 'A');

    const agent = await (createDeepAgent as any)({
      name: 'sofagent-composer',
      systemPrompt,
      tools: [], // compose 阶段不需要工具——纯文本生成
    });

    // 调用 agent 生成工作流
    const result = await (agent as any).invoke?.({
      messages: [
        {
          role: 'user',
          content: `请将以下任务拆解为工作流 YAML：\n\n${input.taskDesc}`,
        },
      ],
    });

    // 从 agent 输出中提取 YAML
    const output = extractYAML(result);
    if (!output) return null;

    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ sofagent 提示：compose 未完成——${msg}`);
    return null;
  }
}

/**
 * 构建编排 Agent 的 system prompt
 * @param workflowYml 企业 workflow 参考（可选）
 * @param variant 拆解策略（默认 A）
 */
function buildComposeSystemPrompt(workflowYml?: string, variant: ComposeVariant = 'A'): string {
  const basePrompt = `You are a task orchestration composer. Your job is to decompose a task description into a structured YAML workflow definition.

Output format (MUST be valid YAML):
\`\`\`yaml
workflow:
  name: <task-name>
  description: <brief description>
  nodes:
    - id: <node-id>
      agent: <agent-type>
      task: <subtask description>
      depends_on: []
    - id: <node-id-2>
      agent: <agent-type>
      task: <subtask description>
      depends_on: [<node-id>]
\`\`\`

Agent types available:
- developer: for coding and implementation tasks
- qa-engineer: for testing and verification tasks
- technical-writer: for documentation tasks
- researcher: for analysis and research tasks

Decomposition strategy (variant ${variant}):
${VARIANT_GUIDES[variant]}

Rules:
1. Decompose into 2-5 subtask nodes
2. Each node has a clear, single responsibility
3. Dependencies must form a DAG (no cycles)
4. Output ONLY the YAML block, no additional text`;

  if (workflowYml) {
    return `${basePrompt}\n\nReference enterprise workflow (align decomposition with this real business process — decompose WHAT it does, not a generic breakdown):\n\`\`\`yaml\n${workflowYml}\n\`\`\``;
  }

  return basePrompt;
}

/**
 * 从 agent 输出中提取 YAML 块
 */
function extractYAML(agentResult: unknown): string | null {
  const text = extractText(agentResult);

  // 尝试提取 YAML 代码块
  const yamlBlockMatch = text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/);
  if (yamlBlockMatch) {
    return yamlBlockMatch[1]!.trim();
  }

  // 尝试找 workflow: 开头的 YAML
  const workflowMatch = text.match(/(workflow:\s*\n(?:[\s\S]*?))(?:$|(?=\n\n[^-\s]))/);
  if (workflowMatch) {
    return workflowMatch[1]!.trim();
  }

  // 如果整个输出看起来像 YAML
  if (text.includes('workflow:') && text.includes('nodes:')) {
    return text.trim();
  }

  return null;
}

/**
 * 从 agent 结果中提取文本内容
 */
function extractText(result: unknown): string {
  if (typeof result === 'string') return result;

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;

    // LangChain/DeepAgents 风格：result.content 或 result.text
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;

    // messages 数组中的最后一条 assistant 消息
    if (Array.isArray(obj.messages)) {
      for (let i = obj.messages.length - 1; i >= 0; i--) {
        const msg = obj.messages[i] as Record<string, unknown>;
        if ((msg.role === 'assistant' || msg.type === 'ai') && typeof msg.content === 'string') {
          return msg.content;
        }
      }
    }

    // 尝试 JSON 序列化
    try {
      if (Object.keys(obj).length > 0) {
        return JSON.stringify(obj, null, 2);
      }
    } catch { /* fall through */ }
  }

  return String(result ?? '');
}
