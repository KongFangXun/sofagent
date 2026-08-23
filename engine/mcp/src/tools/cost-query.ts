// ============================================================
// cost-query.ts · MCP tool：成本审计查询（v1.4.0 交付三 新增）
// ============================================================
//
// 数据口：查预算 / 实际消耗 / 超限记录——成本审计维度的查询面。
// 复用 cost-audit 判定逻辑（worklog + budget → 超支发现）。
// 安全约束：本 tool 只读。
// 商业平台 预留：本 tool 即商业层计量数据暴露接口（商业平台 §9.1 G3）。
// ============================================================

import { runCostAudit, loadWorklogSlice, type CostBudget } from '@sofagent/audit';
import { join } from 'path';
import { homedir } from 'os';

/** 成本显示统一人民币：引擎 costUsd 按美元计费，展示 ×7.2 估算汇率换算（与 dashboard fmtCost 同口径） */
const USD_CNY = 7.2;
const fmtCny = (usd: number | null | undefined, digits = 2): string =>
  usd === null || usd === undefined ? '' : `¥${(usd * USD_CNY).toFixed(digits)}`;

export interface CostQueryResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据（预算/实际/超限） */
  data: Record<string, unknown>;
}

/** 解析 dataDir（与 getHistoryFilePath 同链：SOFAGENT_DATA > 默认 ~/.sofagent/data） */
function resolveDataDir(): string {
  return process.env.SOFAGENT_DATA || join(homedir(), '.sofagent', 'data');
}

/**
 * 查询成本审计状态
 *
 * @param params 查询参数
 * @param params.budget 预算配置（可选；不传则读 config 侧预算，仍无则仅报实际消耗）
 */
export async function costQuery(params: { budget?: CostBudget } = {}): Promise<CostQueryResult> {
  try {
    const dataDir = resolveDataDir();
    const worklog = loadWorklogSlice(dataDir);
    const budget: CostBudget | null = params.budget ?? null;
    const findings = runCostAudit({ worklog, budget });

    const lines: string[] = [];
    lines.push('[sofagent] 成本审计（cost_query）');
    lines.push(`预算: ${budget ? `token ${budget.maxTokensPerRun ?? '未配'} / 日成本 ${fmtCny(budget.maxCostPerDay) || '未配'}` : '未配置（opt-in——workflow.yml 配 budget 后启用）'}`);
    if (!worklog) {
      lines.push('（无 worklog 数据——运行编排/审计任务后产生 data/dashboard/worklog.json）');
    } else {
      for (const a of worklog.agents || []) {
        const t = a.totals?.tokens;
        const total = (t?.input || 0) + (t?.output || 0);
        const c = a.totals?.costUsd;
        lines.push(
          `· ${a.agentId}: ${total} tokens${c !== null && c !== undefined ? ` / ~${fmtCny(c, 4)}` : ''}` +
          (a.totals?.tasks ? ` / ${a.totals.tasks} 任务` : '') +
          (a.totals?.llmCalls ? ` / ${a.totals.llmCalls} 调用` : '')
        );
      }
      if (findings.length === 0) {
        lines.push('超限记录: 无（预算内）');
      } else {
        lines.push('超限记录:');
        for (const f of findings) {
          lines.push(`  ⚠️ ${f.message}`);
        }
      }
    }

    return {
      text: lines.join('\n'),
      data: {
        budget: budget ?? undefined,
        worklog: worklog ?? undefined,
        findings,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] cost 查询失败：${err instanceof Error ? err.message : String(err)}`,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
