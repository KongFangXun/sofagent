// ============================================================
// fde-classify.ts · MCP tool：fde_classify（v1.4.3 章八 · 引擎二）
// ============================================================
//
// 三问判定 → 节点方案（nodes.json）：classifyAutomation SSOT 判定 +
// 六步分解最小工作单元 + executor 映射 + 三态 summary + fde-audit。
// 委托 @sofagent/orchestrator fde/fde-workbench.classifyNodes。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface FdeClassifyNode {
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

export interface FdeClassifyArgs {
  enterprise_id: string;
  nodes: FdeClassifyNode[];
}

export interface FdeClassifyToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    nodesPath?: string;
    summary?: { auto: number; enhance: number; manual: number };
    plans?: Array<Record<string, unknown>>;
  };
}

/**
 * fde_classify——引擎二：三问判定 → 节点方案。
 * 判定规则 SSOT 在 compose-interview.classifyAutomation（不重写）。
 */
export async function fdeClassifyTool(args: FdeClassifyArgs): Promise<FdeClassifyToolResult> {
  const { enterprise_id } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return { text: '[sofagent] fde_classify 失败：enterprise_id 必填且非空', data: { isError: true, ok: false } };
  }
  if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
    return { text: '[sofagent] fde_classify 失败：nodes 必填且非空', data: { isError: true, ok: false } };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    const nodes = args.nodes.map((n) => ({
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
    }));

    const file = orch.classifyNodes(dataDir, enterprise_id, nodes);

    return {
      text: [
        `[sofagent] FDE 三问判定完成 ✅（${enterprise_id}）`,
        `  · 判定 ${file.plans.length} 节点：🔄 自动 ${file.summary.auto} / ⚡ 强化 ${file.summary.enhance} / 👤 暂不动 ${file.summary.manual}`,
        `  · 每节点附六步分解最小工作单元（GUIDE §3.2）`,
        `  · 归档：data/fde/${enterprise_id}/nodes.json`,
      ].join('\n'),
      data: {
        isError: false,
        ok: true,
        nodesPath: `data/fde/${enterprise_id}/nodes.json`,
        summary: file.summary,
        plans: file.plans as unknown as Array<Record<string, unknown>>,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[sofagent] fde_classify 异常：${msg}`, data: { isError: true, ok: false } };
  }
}
