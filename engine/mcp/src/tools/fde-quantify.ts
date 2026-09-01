// ============================================================
// fde-quantify.ts · MCP tool：fde_quantify（v1.4.3 章八 · 引擎三）
// ============================================================
//
// 量化四字段计算 + ROI 排序（quantification.json）——公式复用
// train-report.computeQuantification（同公式同源）。
// manual 节点不参与（👤 暂不动——量化给 🔄/⚡）。
// 委托 @sofagent/orchestrator fde/fde-quantify.quantifyNodes。
// ============================================================
import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface FdeQuantifyNodeInput {
  node_id: string;
  annual_salary: number;
  takeover_ratio: number;
  ai_annual_cost: number;
  one_time_investment?: number;
}

export interface FdeQuantifyArgs {
  enterprise_id: string;
  nodes: FdeQuantifyNodeInput[];
}

export interface FdeQuantifyToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    quantificationPath?: string;
    totals?: { totalAnnualSaving: number; totalOneTimeInvestment: number; nodeCount: number };
    ranked?: Array<Record<string, unknown>>;
  };
}

/**
 * fde_quantify——引擎三：量化四字段 + ROI 排序落盘。
 * ROI = 年节省 ÷（一次性投入 + 1）——高在前（决策面从上往下投）。
 */
export async function fdeQuantifyTool(args: FdeQuantifyArgs): Promise<FdeQuantifyToolResult> {
  const { enterprise_id } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return { text: '[sofagent] fde_quantify 失败：enterprise_id 必填且非空', data: { isError: true, ok: false } };
  }
  if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
    return { text: '[sofagent] fde_quantify 失败：nodes 必填且非空', data: { isError: true, ok: false } };
  }
  for (const n of args.nodes) {
    if (typeof n.node_id !== 'string' || n.node_id.trim() === '') {
      return { text: '[sofagent] fde_quantify 失败：node_id 必填且非空', data: { isError: true, ok: false } };
    }
    if (typeof n.annual_salary !== 'number' || typeof n.takeover_ratio !== 'number' || typeof n.ai_annual_cost !== 'number') {
      return { text: '[sofagent] fde_quantify 失败：annual_salary/takeover_ratio/ai_annual_cost 必须为数字', data: { isError: true, ok: false } };
    }
    if (n.takeover_ratio < 0 || n.takeover_ratio > 1) {
      return { text: '[sofagent] fde_quantify 失败：takeover_ratio 需在 0..1（工时占比）', data: { isError: true, ok: false } };
    }
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    // plans 关联（若引擎二已跑——nodes.json 回读判定标签）
    let plans: Array<{ nodeId: string; tag: 'auto' | 'enhance' | 'manual' }> | null = null;
    const { existsSync, readFileSync } = await import('fs');
    const nodesPath = join(dataDir, 'fde', enterprise_id, 'nodes.json');
    if (existsSync(nodesPath)) {
      try {
        const parsed = JSON.parse(readFileSync(nodesPath, 'utf8')) as { plans?: Array<{ nodeId: string; tag: 'auto' | 'enhance' | 'manual' }> };
        if (Array.isArray(parsed.plans)) plans = parsed.plans;
      } catch {
        plans = null; // 坏文件降级——不阻断量化
      }
    }

    const file = orch.quantifyNodes(
      dataDir,
      enterprise_id,
      args.nodes.map((n) => ({
        nodeId: n.node_id,
        annualSalary: n.annual_salary,
        takeoverRatio: n.takeover_ratio,
        aiAnnualCost: n.ai_annual_cost,
        ...(n.one_time_investment !== undefined ? { oneTimeInvestment: n.one_time_investment } : {}),
      })),
      plans as never, // 局部最小读集（nodeId/tag）——完整 NodePlan 由引擎侧消费方忽略其余字段
    );

    const top = file.ranked[0];
    return {
      text: [
        `[sofagent] FDE 量化完成 ✅（${enterprise_id}）`,
        `  · 量化 ${file.totals.nodeCount} 节点，总年节省 ${file.totals.totalAnnualSaving.toLocaleString('zh-CN')} 元`,
        `  · ROI 首位：${top ? top.nodeId : '—'}${top ? `（年节省 ${top.metrics.annualSaving.display}）` : ''}`,
        `  · 归档：data/fde/${enterprise_id}/quantification.json`,
      ].join('\n'),
      data: {
        isError: false,
        ok: true,
        quantificationPath: `data/fde/${enterprise_id}/quantification.json`,
        totals: file.totals,
        ranked: file.ranked as unknown as Array<Record<string, unknown>>,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[sofagent] fde_quantify 异常：${msg}`, data: { isError: true, ok: false } };
  }
}
