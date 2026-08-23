// ============================================================
// worklog-query.ts · MCP tool：AI 工作明细查询（v1.3.9 三 新增）
// ============================================================
//
// worklog 数据层的查询口——按 Agent / 按 Workflow / 按周趋势 /
// 人工介入记录（HITL 审批纠正事件）/ 进化四维趋势。
// 数据零新增：聚合既有审计日志 + decision-log + LLM Trace 三源。
//
// 安全约束：本 tool 只读。
// ============================================================

import { WorklogAggregator } from '@sofagent/orchestrator';

/** 成本显示统一人民币：引擎 costUsd 按美元计费，展示 ×7.2 估算汇率换算（与 dashboard fmtCost 同口径） */
const USD_CNY = 7.2;
const fmtCny = (usd: number | null | undefined): string =>
  usd === null || usd === undefined ? '' : `¥${(usd * USD_CNY).toFixed(2)}`;

export interface WorklogQueryResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据（worklog 聚合结果） */
  data: Record<string, unknown>;
}

/**
 * 查询 AI 工作明细
 *
 * @param params 查询参数
 * @param params.agentId 按 Agent 过滤（缺省全量）
 * @param params.workflowId 按 Workflow 过滤（缺省全量）
 * @param params.weeklyTrend 附带周趋势（活跃度/成功率/成本）
 * @param params.evolution 附带进化四维趋势（审计 PASS 率/错题复发率/AB 曲线/首次通过率）
 */
export async function worklogQuery(params: {
  agentId?: string;
  workflowId?: string;
  weeklyTrend?: boolean;
  evolution?: boolean;
} = {}): Promise<WorklogQueryResult> {
  try {
    const agg = new WorklogAggregator();
    const result = agg.query({
      agentId: params.agentId,
      workflowId: params.workflowId,
      weeklyTrend: params.weeklyTrend,
      evolution: params.evolution,
    });

    // 文本视图（终端/对话可读；结构化细节走 data）
    const lines: string[] = [];
    lines.push('[sofagent] AI 工作明细（worklog）');
    for (const a of result.agents) {
      const t = a.totals;
      const duration = t.durationBasis === 'node-total'
        ? `${t.modelCallMs}ms 模型调用（另有节点总耗时口径）`
        : `${t.modelCallMs}ms 模型调用`;
      lines.push(
        `· ${a.agentId}: ${t.tasks} 任务 / ${t.llmCalls} 次调用 / ` +
        `${t.tokens.input + t.tokens.output} tokens / ${duration}` +
        `${t.costUsd !== null ? ` / ~${fmtCny(t.costUsd)}` : ''}` +
        `${t.humanInterventions > 0 ? ` / 人工介入 ${t.humanInterventions} 次` : ''}`
      );
      for (const task of a.tasks.slice(0, 10)) { // 文本视图截前 10 条，全量走 data
        lines.push(
          `  - ${task.taskId}: ${task.decisions} 决策 / ${task.llmCalls} 调用 / ` +
          `${task.modelCallMs}ms 模型耗时` +
          `${task.nodeTotalMs !== null ? ` / ${task.nodeTotalMs}ms 节点总耗时` : ''}` +
          `${task.humanInterventions > 0 ? ` / 人工介入 ${task.humanInterventions} 次` : ''}`
        );
      }
      if (a.tasks.length > 10) lines.push(`  …（共 ${a.tasks.length} 条，全量见结构化输出）`);
    }
    for (const wf of result.workflows) {
      lines.push(
        `· workflow ${wf.workflowId}: ${wf.nodes.length} 节点` +
        `${wf.humanInterventions > 0 ? ` / 人工介入 ${wf.humanInterventions} 次` : ''}`
      );
    }
    if (result.weeklyTrend) {
      lines.push('周趋势:');
      for (const w of result.weeklyTrend) {
        lines.push(`  ${w.week}: 活跃 ${w.activity} / 审计通过率 ${w.auditPassRate ?? '—'} / 成本 ~${fmtCny(w.costUsd)}`);
      }
    }
    if (result.evolution) {
      const e = result.evolution;
      lines.push('进化趋势:');
      lines.push(`  审计 PASS 率: ${e.auditPassRate.overall ?? '—'}`);
      lines.push(`  错题复发率: ${e.failureRecurrence.rate ?? '—'}（${e.failureRecurrence.repeatedPatterns}/${e.failureRecurrence.totalPatterns}）`);
      lines.push(`  AB 胜负: ${e.abCurve ? `${e.abCurve.winner} 连胜 ${e.abCurve.consecutiveWins}` : '—'}`);
      lines.push(`  首次通过率: ${e.firstPassRate.rate ?? '—'}（${e.firstPassRate.totalTasks} 任务中 ${e.firstPassRate.retriedTasks} 重试）`);
    }
    if (result.agents.length === 0 && result.workflows.length === 0) {
      lines.push('（暂无工作明细数据——运行审计/决策/LLM 调用后产生）');
    }

    return { text: lines.join('\n'), data: result as unknown as Record<string, unknown> };
  } catch (err) {
    return {
      text: `[sofagent] worklog 查询失败：${err instanceof Error ? err.message : String(err)}`,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
