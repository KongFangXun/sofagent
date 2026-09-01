// ============================================================
// fde-derive.ts · MCP tool：fde_derive（v1.4.3 章八 · 引擎四）
// ============================================================
//
// 五要素 + 访谈 → ontology YAML 草稿（ontology-draft.yaml）——复用
// compose-interview.deriveOntologyDraft 完整推导链路；产物可导入
// ontology_import。委托 @sofagent/orchestrator fde/fde-quantify.deriveOntology。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface FdeDeriveNode {
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

export interface FdeDeriveArgs {
  enterprise_id: string;
  workflow_name: string;
  workflow_description?: string;
  nodes: FdeDeriveNode[];
}

export interface FdeDeriveToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    draftPath?: string;
    counts?: { entities: number; concepts: number; relations: number };
    needsFullOntology?: boolean;
  };
}

/**
 * fde_derive——引擎四：本体推导（YAML 草稿落盘）。
 * 机器初稿——人工确认后经 ontology_import 导入。
 */
export async function fdeDeriveTool(args: FdeDeriveArgs): Promise<FdeDeriveToolResult> {
  const { enterprise_id } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return { text: '[sofagent] fde_derive 失败：enterprise_id 必填且非空', data: { isError: true, ok: false } };
  }
  if (typeof args.workflow_name !== 'string' || args.workflow_name.trim() === '') {
    return { text: '[sofagent] fde_derive 失败：workflow_name 必填且非空', data: { isError: true, ok: false } };
  }
  if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
    return { text: '[sofagent] fde_derive 失败：nodes 必填且非空', data: { isError: true, ok: false } };
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

    const result = orch.deriveOntology(dataDir, enterprise_id, session);

    return {
      text: [
        `[sofagent] FDE 本体草稿已落盘 ✅（${enterprise_id}）`,
        `  · 实体 ${result.counts.entities} / 概念 ${result.counts.concepts} / 关系 ${result.counts.relations}`,
        `  · 需要全量本体：${result.needsFullOntology ? '是（超 10 实体或 5 节点）' : '否'}`,
        `  · 归档：data/fde/${enterprise_id}/ontology-draft.yaml`,
        `  · 下一步：人工确认后经 ontology_import 导入`,
      ].join('\n'),
      data: {
        isError: false,
        ok: true,
        draftPath: `data/fde/${enterprise_id}/ontology-draft.yaml`,
        counts: result.counts,
        needsFullOntology: result.needsFullOntology,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[sofagent] fde_derive 异常：${msg}`, data: { isError: true, ok: false } };
  }
}
