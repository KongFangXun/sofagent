// ============================================================
// fde-deploy.ts · MCP tool：fde_deploy（v1.5.3 章八 · 引擎六）
// ============================================================
//
// 三层交付物 → workflow.yml 组装部署（deployments/<name>.yml）——
// 复用 workflow-draft.generateWorkflowDraft（与 fde_compose 产物同
// 格式）。本引擎只产出工件不代激活——激活走 workflow_submit +
// activate_workflow 现有链路（人审闸门保留）。
// 委托 @sofagent/orchestrator fde/fde-quantify.deployWorkflow。
//
// v1.5.0 章五：部署成功后写陪跑期登记（{dataDir}/fde/companion.json
// 的 deployedAt——companion.getCompanionState 读同源状态，部署→陪跑
// 显式衔接，无需手工配置）。best-effort：登记失败不阻断部署返回。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * 部署成功后写陪跑期登记（best-effort）。
 * companion.json 已含 deployedAt（重复部署）时保留最早值——陪跑期
 * 从首次部署起算，不因重复部署重置；已有 reportGeneratedAt 标记
 * （前次部署已期满出报告）时重置为新部署周期。
 */
function registerCompanionDeployment(dataDir: string, deployedAt: string, workflowName: string): void {
  const companionPath = join(dataDir, 'fde', 'companion.json');
  let marker: Record<string, unknown> = {};
  if (existsSync(companionPath)) {
    try {
      marker = JSON.parse(readFileSync(companionPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // 坏标记按空重建
    }
  }
  // 期满报告已生成 → 新部署开启新陪跑周期（清 reportGeneratedAt，重写 deployedAt）
  const priorReported = typeof marker.reportGeneratedAt === 'string';
  if (priorReported) delete marker.reportGeneratedAt;
  if (priorReported || typeof marker.deployedAt !== 'string') {
    marker.deployedAt = deployedAt;
  }
  marker.lastDeployedAt = deployedAt;
  marker.lastWorkflow = workflowName;
  mkdirSync(join(dataDir, 'fde'), { recursive: true });
  writeFileSync(companionPath, JSON.stringify(marker, null, 2) + '\n', 'utf-8');
}


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
    /** 陪跑期登记是否写入成功（v1.5.0 章五——best-effort） */
    companionRegistered?: boolean;
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

    // v1.5.0 章五：部署成功 → 写陪跑期登记（best-effort，失败不阻断部署返回）
    let companionRegistered = false;
    try {
      registerCompanionDeployment(dataDir, new Date().toISOString(), args.workflow_name);
      companionRegistered = true;
    } catch (err) {
      console.warn(`[sofagent] fde_deploy 陪跑期登记失败（不阻断部署）: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      text: [
        `[sofagent] FDE workflow 已组装 ✅（${enterprise_id}）`,
        `  · ${result.nodeCount} 节点 → ${result.workflowPath}`,
        ...(companionRegistered
          ? ['  · 陪跑期登记已写入（fde/companion.json）——部署后 14 天每日 Refine 巡检自动生效']
          : []),
        `  · 下一步：`,
        ...result.nextSteps.map((s) => `    - ${s}`),
      ].join('\n'),
      data: {
        isError: false,
        ok: true,
        workflowPath: result.workflowPath,
        nodeCount: result.nodeCount,
        nextSteps: result.nextSteps,
        companionRegistered,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[sofagent] fde_deploy 异常：${msg}`, data: { isError: true, ok: false } };
  }
}
