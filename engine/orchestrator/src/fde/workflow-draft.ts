// ============================================================
// fde/workflow-draft.ts · 五要素 + 三问 + 依赖 → workflow.yml 草稿生成（v1.3.5 交付 7右半）
// ============================================================
//
// 五要素 + 三问判定 + 依赖引导 → workflow.yml 草稿。
// 草稿 agent 字段留空 → 批量生成时由节点类型动态解析链自动推导。
//
// 纯规则驱动（LLM 不参与生成）。
// ============================================================
import type { ComposeSession, NodeInterview } from './compose-interview';

/** 生成的 workflow.yml 草稿 */
export interface WorkflowDraft {
  /** YAML 文本 */
  yaml: string;
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description: string;
  /** 节点列表 */
  nodes: Array<{
    id: string;
    /** agent 字段留空——批量生成时推导 */
    agent: string;
    task: string;
    depends_on: string[];
    /** 自动化标签（注释保留） */
    automation_tag: string;
  }>;
}

/**
 * 从梳理会话生成 workflow.yml 草稿。
 *
 * @param session FDE 梳理会话
 * @returns WorkflowDraft
 */
export function generateWorkflowDraft(session: ComposeSession): WorkflowDraft {
  const nodes = session.nodes.map((node) => ({
    id: node.nodeId,
    agent: '', // 留空——由节点类型动态解析链在批量生成时自动推导
    task: buildNodeTask(node),
    depends_on: node.dependsOn,
    automation_tag: tagToLabel(node.tag),
  }));

  const yaml = buildWorkflowYaml(session, nodes);

  return {
    yaml,
    name: session.workflowName,
    description: session.workflowDescription,
    nodes,
  };
}

/** 构建节点 task 描述（从五要素 + 标签） */
function buildNodeTask(node: NodeInterview): string {
  const lines = [
    `节点：${node.description}`,
    `输入：${node.elements.input}`,
    `输出：${node.elements.output}`,
    `负责人：${node.elements.owner}`,
    `耗时：${node.elements.duration}`,
    `痛点：${node.elements.bottleneck}`,
    `自动化标签：${tagToLabel(node.tag)}`,
  ];
  return lines.join('\n');
}

/** 生成 workflow.yml 文本 */
function buildWorkflowYaml(
  session: ComposeSession,
  nodes: WorkflowDraft['nodes'],
): string {
  const lines: string[] = [
    `name: ${session.workflowName}`,
    `description: ${session.workflowDescription}`,
    'workflow:',
    `  name: ${session.workflowName}`,
    `  description: ${session.workflowDescription}`,
    '  nodes:',
  ];

  for (const node of nodes) {
    lines.push(`    - id: ${node.id}`);
    lines.push(`      agent: "${node.agent}"  # 留空——批量生成时由 agent-creation 推导`);
    lines.push('      task: |');
    for (const line of node.task.split('\n')) {
      lines.push(`        ${line}`);
    }
    if (node.depends_on.length > 0) {
      lines.push(`      depends_on: [${node.depends_on.map((d) => `"${d}"`).join(', ')}]`);
    } else {
      lines.push('      depends_on: []');
    }
    lines.push(`      # 自动化标签：${node.automation_tag}`);
  }

  return lines.join('\n');
}

/** 标签转中文标签 */
function tagToLabel(tag: string): string {
  switch (tag) {
    case 'auto': return '🔄 自动执行';
    case 'enhance': return '⚡ 强化岗位';
    case 'manual': return '👤 暂不动';
    default: return tag;
  }
}

/**
 * 校验 workflow 草稿 DAG 无环。
 * 复用 workflow-parser 的 DAG 校验逻辑。
 *
 * @param nodes 节点列表
 * @returns 是否无环
 */
export function validateDraftDag(nodes: WorkflowDraft['nodes']): { valid: boolean; cycle?: string[] } {
  const color = new Map<string, 'white' | 'gray' | 'black'>(
    nodes.map((n) => [n.id, 'white']),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));

  function visit(id: string, stack: string[]): string[] | null {
    color.set(id, 'gray');
    const node = byId.get(id);
    if (node) {
      for (const dep of node.depends_on) {
        if (color.get(dep) === 'gray') {
          return [...stack, id, dep];
        }
        if (color.get(dep) === 'white') {
          const cycle = visit(dep, [...stack, id]);
          if (cycle) return cycle;
        }
      }
    }
    color.set(id, 'black');
    return null;
  }

  for (const node of nodes) {
    if (color.get(node.id) === 'white') {
      const cycle = visit(node.id, []);
      if (cycle) return { valid: false, cycle };
    }
  }
  return { valid: true };
}
