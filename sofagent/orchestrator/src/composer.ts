// ============================================================
// composer.ts · DeepAgents 任务编排
// v1.1.6 新增：用 createDeepAgent() 做任务拆解，输出 YAML 工作流
// v1.1.6：deepagents 提升为正式依赖，移除 as unknown as 类型转换
// v1.1.6：迁移至 @sofagent/orchestrator
// ============================================================

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

/**
 * 使用 DeepAgents 编排任务
 *
 * 创建一个编排 Agent，systemPrompt 基于 workflow.yml 节点定义，
 * Agent 输出格式为 YAML 工作流定义。
 *
 * @param taskDesc    任务描述
 * @param workflowYml 可选——现有 workflow.yml 内容，用于指导编排风格
 * @returns YAML 工作流定义字符串，或 null（不可用/失败）
 */
export async function composeWithDeepAgents(
  taskDesc: string,
  workflowYml?: string
): Promise<string | null> {
  const createDeepAgent = await loadDeepAgentsCreate();
  if (!createDeepAgent) return null;

  try {
    const systemPrompt = buildComposeSystemPrompt(workflowYml);

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
          content: `请将以下任务拆解为工作流 YAML：\n\n${taskDesc}`,
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
 */
function buildComposeSystemPrompt(workflowYml?: string): string {
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

Rules:
1. Decompose into 2-5 subtask nodes
2. Each node has a clear, single responsibility
3. Dependencies must form a DAG (no cycles)
4. Output ONLY the YAML block, no additional text`;

  if (workflowYml) {
    return `${basePrompt}\n\nReference workflow style (follow this pattern):\n\`\`\`yaml\n${workflowYml}\n\`\`\``;
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
