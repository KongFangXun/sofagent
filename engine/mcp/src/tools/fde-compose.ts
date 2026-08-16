// ============================================================
// fde-compose.ts · MCP tool：FDE 梳理辅助（v1.3.5 交付 7右半）
// ============================================================
//
// fde_compose({ action, ... })
//   action=workflow → 从五要素生成 workflow.yml 草稿
//   action=ontology → 从五要素推导 ontology 草稿并落盘
// ============================================================

import type { ComposeSession, NodeInterview } from '@sofagent/orchestrator';

export interface FdeComposeArgs {
  action: 'workflow' | 'ontology';
  /** 梳理会话 JSON（含 enterpriseId / nodes / workflowName 等） */
  session: {
    enterpriseId: string;
    workflowName: string;
    workflowDescription?: string;
    nodes: Array<{
      nodeId: string;
      description: string;
      elements: {
        input: string;
        output: string;
        owner: string;
        duration: string;
        bottleneck: string;
      };
      questions: {
        inputAutomatable: boolean;
        rulesCodifiable: boolean;
        outputPredictable: boolean;
      };
      dependsOn: string[];
    }>;
  };
}

export interface FdeComposeResult {
  text: string;
  data: {
    action: string;
    yaml?: string;
    ontologyPath?: string;
    entityCount?: number;
    isError: boolean;
  };
}

/**
 * FDE 梳理辅助 MCP tool（无 CLI 环境的 MCP 客户端可用）。
 */
export async function fdeCompose(args: FdeComposeArgs): Promise<FdeComposeResult> {
  if (!args.session || !args.session.nodes || args.session.nodes.length === 0) {
    return {
      text: '[sofagent] fde_compose 错误: session.nodes 必填且非空',
      data: { action: args.action, isError: true },
    };
  }

  try {
    const orchestrator = await import('@sofagent/orchestrator');
    const { classifyAutomation } = orchestrator;

    // 构造 ComposeSession（补充自动化标签）
    const session: ComposeSession = {
      enterpriseId: args.session.enterpriseId,
      workflowName: args.session.workflowName,
      workflowDescription: args.session.workflowDescription ?? '',
      nodes: args.session.nodes.map((n): NodeInterview => ({
        nodeId: n.nodeId,
        description: n.description,
        elements: n.elements,
        questions: n.questions,
        tag: classifyAutomation(n.questions),
        dependsOn: n.dependsOn,
      })),
    };

    if (args.action === 'workflow') {
      const { generateWorkflowDraft, validateDraftDag } = orchestrator;
      const draft = generateWorkflowDraft(session);
      const dagCheck = validateDraftDag(draft.nodes);
      if (!dagCheck.valid) {
        return {
          text: `[sofagent] fde_compose: DAG 有环 ${dagCheck.cycle?.join(' → ')}`,
          data: { action: 'workflow', isError: true },
        };
      }
      return {
        text: [
          `[sofagent] fde_compose: workflow.yml 草稿已生成`,
          `  节点数：${draft.nodes.length}`,
          `  agent 字段留空——批量生成时由 agent-creation 推导`,
        ].join('\n'),
        data: {
          action: 'workflow',
          yaml: draft.yaml,
          isError: false,
        },
      };
    }

    if (args.action === 'ontology') {
      const { generateOntologyDraft } = orchestrator;
      const { draft, savedPath } = generateOntologyDraft(session);
      return {
        text: [
          `[sofagent] fde_compose: Ontology 草稿已生成并落盘`,
          `  实体数：${draft.entities.length}`,
          `  概念数：${draft.concepts.length}`,
          `  关系数：${draft.relations.length}`,
          `  落盘路径：${savedPath}`,
          `  需要全量本体：${draft.needsFullOntology ? '是' : '否'}`,
        ].join('\n'),
        data: {
          action: 'ontology',
          ontologyPath: savedPath,
          entityCount: draft.entities.length,
          isError: false,
        },
      };
    }

    return {
      text: `[sofagent] fde_compose 错误: 未知 action '${args.action}'`,
      data: { action: args.action, isError: true },
    };
  } catch (err) {
    return {
      text: `[sofagent] fde_compose 失败：${err instanceof Error ? err.message : String(err)}`,
      data: { action: args.action, isError: true },
    };
  }
}
