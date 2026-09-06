// ============================================================
// fde-distill.ts · MCP tool：fde_distill（v1.4.5 章八 · 引擎五）
// ============================================================
//
// 跑通过程 → 三层交付物自动生成（GUIDE 第五章——单节点三实体）：
//   文档层 <nodeId>-manual.md（人读手册：现状/步骤/验收/回滚）
//   Skill 层 <nodeId>-skill.md（Agent 可执行作业指导）
//   运行层 <nodeId>-node.yaml（workflow 节点片段——引擎六组装用）
// 委托 @sofagent/orchestrator fde/fde-quantify.distillDeliverables。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface FdeDistillNode {
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

export interface FdeDistillArgs {
  enterprise_id: string;
  nodes: FdeDistillNode[];
}

export interface FdeDistillToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    deliverablesDir?: string;
    layers?: Array<{ nodeId: string; doc: string; skill: string; run: string }>;
  };
}

/**
 * fde_distill——引擎五：三层交付物生成（文档/Skill/运行）。
 * 五要素注入 GUIDE 第五章模板位；plans 关联判定标签（可选）。
 */
export async function fdeDistillTool(args: FdeDistillArgs): Promise<FdeDistillToolResult> {
  const { enterprise_id } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return { text: '[sofagent] fde_distill 失败：enterprise_id 必填且非空', data: { isError: true, ok: false } };
  }
  if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
    return { text: '[sofagent] fde_distill 失败：nodes 必填且非空', data: { isError: true, ok: false } };
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

    // plans 关联（若引擎二已跑——判定标签注入模板）
    let plans: Array<{ nodeId: string; tag: 'auto' | 'enhance' | 'manual' }> | null = null;
    const { existsSync, readFileSync } = await import('fs');
    const nodesPath = join(dataDir, 'fde', enterprise_id, 'nodes.json');
    if (existsSync(nodesPath)) {
      try {
        const parsed = JSON.parse(readFileSync(nodesPath, 'utf8')) as { plans?: Array<{ nodeId: string; tag: 'auto' | 'enhance' | 'manual' }> };
        if (Array.isArray(parsed.plans)) plans = parsed.plans;
      } catch {
        plans = null;
      }
    }

    const result = orch.distillDeliverables(dataDir, enterprise_id, nodes, plans as never); // 同 fde-quantify——局部最小读集桥接

    return {
      text: [
        `[sofagent] FDE 三层交付物已生成 ✅（${enterprise_id}）`,
        `  · ${result.layers.length} 节点 × 3 层（文档/Skill/运行）`,
        `  · 归档：data/fde/${enterprise_id}/deliverables/（README.md 索引）`,
        `  · 文档层给人看 / Skill 层给 Agent 执行 / 运行层组装 workflow`,
      ].join('\n'),
      data: {
        isError: false,
        ok: true,
        deliverablesDir: `data/fde/${enterprise_id}/deliverables`,
        layers: result.layers.map((l) => ({
          nodeId: l.nodeId,
          doc: `${l.nodeId}-manual.md`,
          skill: `${l.nodeId}-skill.md`,
          run: `${l.nodeId}-node.yaml`,
        })),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[sofagent] fde_distill 异常：${msg}`, data: { isError: true, ok: false } };
  }
}
