// ============================================================
// fde-deploy.ts · MCP tool：fde_deploy（v1.4.2 章八 · 引擎六）
// ============================================================
//
// 三层交付物 → workflow.yml 组装部署（deployments/<name>.yml）——
// 复用 workflow-draft.generateWorkflowDraft（与 fde_compose 产物同
// 格式）。本引擎只产出工件不代激活——激活走 workflow_submit +
// activate_workflow 现有链路（人审闸门保留）。
// 委托 @sofagent/orchestrator fde/fde-quantify.deployWorkflow。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface FdeDeployNode {
  node_id: string;
  description: string;
  elements: {
    input: string;
    output: string;
    owner: string;
    duration: string;
    bottleneck: string;
  };
  questions: {
    input_automatable: boolean;
    rules_codifiable: boolean;
    output_predictable: boolean;
  };
  depends_on?: string[];
}

export interface FdeDeployArgs {
  enterprise_id: string;
  workflow_name: string;
  workflow_description?: string;
  nodes: FdeDeployNode[];
}

export interface FdeDeployToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    workflowPath?: string;
    nodeCount?: number;
    nextSteps?: string[];
  };
}

/**
 * fde_deploy——引擎六：workflow.yml 组装部署。
 * 产物与 fde_compose 同格式——直接走 workflow_submit + activate_workflow。
 */
export async function fdeDeployTool(args: FdeDeployArgs): Promise<FdeDeployToolResult> {
  const { enterprise_id } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return { text: '[sofagent] fde_deploy 失败：enterprise_id 必填且非空', data: { isError: true, ok: false } };
  }
  if (typeof args.workflow_name !== 'string' || args.workflow_name.trim() === '') {
    return { text: '[sofagent] fde_deploy 失败：workflow_name 必填且非空', data: { isError: true, ok: false } };
  }
  if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
    return { text: '[sofagent] fde_deploy 失败：nodes 必填且非空', data: { isError: true, ok: false } };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    const session = {
      enterpriseId: enterprise_id,
      workflowName: args.workflow_name,
      workflowDescription: args.workflow_description ?? '',
      nodes: args.nodes.map((n) => ({
        nodeId: n.node_id,
        description: n.description,
        elements: n.elements,
        questions: {
          inputAutomatable: n.questions.input_automatable,
          rulesCodifiable: n.questions.rules_codifiable,
          outputPredictable: n.questions.output_predictable,
        },
        tag: orch.classifyAutomation({
          inputAutomatable: n.questions.input_automatable,
          rulesCodifiable: n.questions.rules_codifiable,
          outputPredictable: n.questions.output_predictable,
        }),
        dependsOn: n.depends_on ?? [],
      })),
    };

    const result = orch.deployWorkflow(dataDir, enterprise_id, session);

    return {
      text: [
        `[sofagent] FDE workflow 已组装 ✅（${enterprise_id}）`,
        `  · ${result.nodeCount} 节点 → ${result.workflowPath}`,
        `  · 下一步：`,
        ...result.nextSteps.map((s) => `    - ${s}`),
      ].join('\n'),
      data: {
        isError: false,
        ok: true,
        workflowPath: result.workflowPath,
        nodeCount: result.nodeCount,
        nextSteps: result.nextSteps,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[sofagent] fde_deploy 异常：${msg}`, data: { isError: true, ok: false } };
  }
}
