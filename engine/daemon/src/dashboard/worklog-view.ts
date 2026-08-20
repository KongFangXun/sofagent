// ============================================================
// worklog-view.ts · worklog 终端 ASCII 列表视图（v1.3.9 三 · 可选交付）
// ============================================================
//
// 复用 v1.2.3「纯文本 + emoji 前缀」渲染惯例（零外部依赖），
// 把 WorklogAggregator 聚合结果渲染成终端可读列表。
// 消费 data/dashboard/worklog.json（落盘产物）——不重复聚合。
//
// 用法：node -e "console.log(renderWorklogView('data/dashboard/worklog.json'))"
// ============================================================

import { readFileSync, existsSync } from 'fs';

/** worklog.json 落盘产物的形状（aggregator.writeWorklogJson 的契约面） */
interface WorklogPayload {
  generatedAt: string;
  agents: Array<{
    agentId: string;
    totals: {
      tasks: number; llmCalls: number;
      tokens: { input: number; output: number };
      modelCallMs: number;
      durationBasis: 'node-total' | 'model-call-only';
      costUsd: number | null;
      humanInterventions: number;
    };
    tasks: Array<{ taskId: string; modelCallMs: number; nodeTotalMs: number | null; humanInterventions: number }>;
  }>;
  workflows: Array<{ workflowId: string; humanInterventions: number; nodes: Array<{ taskId: string; status: string }> }>;
  weeklyTrend: Array<{ week: string; activity: number; auditPassRate: number | null; costUsd: number }>;
  evolution: {
    auditPassRate: { overall: number | null };
    failureRecurrence: { rate: number | null };
    firstPassRate: { rate: number | null };
  };
}

/**
 * 渲染终端 ASCII 列表视图。
 *
 * @param worklogJsonPath worklog.json 路径（缺省 data/dashboard/worklog.json）
 * @returns 多行文本（文件不存在返回提示行）
 */
export function renderWorklogView(worklogJsonPath = 'data/dashboard/worklog.json'): string {
  if (!existsSync(worklogJsonPath)) {
    return `[sofagent] 未找到 ${worklogJsonPath}——先运行聚合落盘（WorklogAggregator.writeWorklogJson）`;
  }
  let payload: WorklogPayload;
  try {
    payload = JSON.parse(readFileSync(worklogJsonPath, 'utf-8')) as WorklogPayload;
  } catch (err) {
    return `[sofagent] worklog.json 解析失败: ${err instanceof Error ? err.message : String(err)}`;
  }

  const lines: string[] = [];
  lines.push(`[sofagent] AI 工作明细（生成于 ${payload.generatedAt}）`);
  lines.push('');

  // Agent 段
  lines.push('── Agent 工作明细 ──');
  if (payload.agents.length === 0) {
    lines.push('（暂无数据）');
  }
  for (const a of payload.agents) {
    const t = a.totals;
    lines.push(
      `🔹 ${a.agentId}  ${t.tasks} 任务 · ${t.llmCalls} 调用 · ` +
      `${(t.tokens.input + t.tokens.output).toLocaleString()} tokens · ` +
      `${(t.modelCallMs / 1000).toFixed(1)}s 模型耗时` +
      `${t.costUsd !== null ? ` · ~$${t.costUsd}` : ''}`
    );
    for (const task of a.tasks.slice(0, 5)) {
      lines.push(
        `   · ${task.taskId}  ${task.modelCallMs}ms` +
        `${task.nodeTotalMs !== null ? `（节点总 ${task.nodeTotalMs}ms）` : ''}` +
        `${task.humanInterventions > 0 ? ` · 👤 介入 ${task.humanInterventions}` : ''}`
      );
    }
    if (a.tasks.length > 5) lines.push(`   … 共 ${a.tasks.length} 条`);
  }
  lines.push('');

  // Workflow 段
  lines.push('── Workflow 节点状态 ──');
  if (payload.workflows.length === 0) {
    lines.push('（暂无数据）');
  }
  for (const wf of payload.workflows) {
    const active = wf.nodes.filter((n) => n.status === 'active').length;
    lines.push(`🔸 ${wf.workflowId}  ${wf.nodes.length} 节点（${active} 活跃）${wf.humanInterventions > 0 ? ` · 👤 介入 ${wf.humanInterventions}` : ''}`);
  }
  lines.push('');

  // 周趋势段（迷你 ASCII 柱状）
  lines.push('── 周趋势 ──');
  if (payload.weeklyTrend.length === 0) {
    lines.push('（暂无数据）');
  }
  const maxActivity = Math.max(1, ...payload.weeklyTrend.map((w) => w.activity));
  for (const w of payload.weeklyTrend) {
    const bar = '█'.repeat(Math.max(1, Math.round((w.activity / maxActivity) * 20)));
    lines.push(`${w.week} ${bar} ${w.activity}（审计通过率 ${w.auditPassRate ?? '—'} · ~$${w.costUsd}）`);
  }
  lines.push('');

  // 进化趋势段
  lines.push('── 进化趋势 ──');
  lines.push(`   审计 PASS 率   ${payload.evolution.auditPassRate.overall ?? '—'}`);
  lines.push(`   错题复发率     ${payload.evolution.failureRecurrence.rate ?? '—'}`);
  lines.push(`   首次通过率     ${payload.evolution.firstPassRate.rate ?? '—'}`);

  return lines.join('\n');
}
