// ============================================================
// billing.ts · 账单周期聚合（G8 · v1.4.7）
//
// 商业平台冷启动的数据源：每次 cron 执行进 worklog + cost——
// 本模块把 data/dashboard/worklog.json（WorklogAggregator 落盘
// 产物）按「agent × 自然月」聚合成月结账单数据。
//
// 口径：
//   - costUsd 来自 WorklogAggregator 的成本估算（模型单价未收录
//     时为 null——账单里如实记 null 并在 estimated=false 标注，
//     不臆造 0 成本）；
//   - 月归属取任务 lastSeen 所在自然月（对账口径：任务结束月）；
//   - 纯读侧聚合——不写盘不重算 worklog（单一落盘源是 aggregator）。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** worklog.json 单 agent 聚合形状（aggregator.AgentWorklog 的落盘契约子集） */
interface AgentSlice {
  agentId: string;
  tasks: Array<{
    taskId: string;
    costUsd: number | null;
    llmCalls: number;
    tokens: { input: number; output: number };
    lastSeen: string;
  }>;
}

/** 月结账单条目（单 agent 单月） */
export interface MonthlyBillEntry {
  /** 自然月（YYYY-MM，UTC） */
  month: string;
  /** agent ID */
  agentId: string;
  /** 该月任务数 */
  tasks: number;
  /** 该月 LLM 调用次数 */
  llmCalls: number;
  /** 该月 token 用量合计 */
  tokens: { input: number; output: number };
  /** 该月成本合计（USD）——全部任务均有估算时为数值 */
  costUsd: number | null;
  /** 是否完整估算（false = 至少一个任务单价未收录，costUsd 为已知的下界） */
  estimated: boolean;
}

/** 账单聚合结果 */
export interface BillingReport {
  /** 聚合时点（ISO 8601） */
  generatedAt: string;
  /** 数据源路径 */
  source: string;
  /** agent × 月 账单条目（按 month 升序、agentId 字典序） */
  entries: MonthlyBillEntry[];
  /** 全部月份合计（USD；含未完整估算标注） */
  totalUsd: number | null;
}

/** ISO 8601 → 自然月键（YYYY-MM）；非法时间返回 null（该任务不计入） */
function monthKey(tsIso: string): string | null {
  const d = new Date(tsIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 7);
}

/**
 * 读 worklog.json 聚合月结账单。
 *
 * @param dataDir 数据目录（缺省 data/ 惯例由调用方解析后传入）
 * @returns 账单报告；worklog.json 不存在或损坏时返回 null（调用方决定降级提示）
 */
export function buildBillingReport(dataDir: string): BillingReport | null {
  const source = join(dataDir, 'dashboard', 'worklog.json');
  if (!existsSync(source)) return null;

  let payload: { agents?: AgentSlice[] };
  try {
    payload = JSON.parse(readFileSync(source, 'utf-8')) as { agents?: AgentSlice[] };
  } catch {
    return null;
  }

  // month → agent → 累计
  const byMonthAgent = new Map<string, Map<string, MonthlyBillEntry>>();
  for (const agent of payload.agents ?? []) {
    for (const t of agent.tasks ?? []) {
      const month = monthKey(t.lastSeen);
      if (!month) continue; // 非法时间戳任务不臆造归属
      let agents = byMonthAgent.get(month);
      if (!agents) {
        agents = new Map();
        byMonthAgent.set(month, agents);
      }
      let entry = agents.get(agent.agentId);
      if (!entry) {
        entry = {
          month,
          agentId: agent.agentId,
          tasks: 0,
          llmCalls: 0,
          tokens: { input: 0, output: 0 },
          costUsd: 0,
          estimated: true,
        };
        agents.set(agent.agentId, entry);
      }
      entry.tasks += 1;
      entry.llmCalls += t.llmCalls ?? 0;
      entry.tokens.input += t.tokens?.input ?? 0;
      entry.tokens.output += t.tokens?.output ?? 0;
      if (typeof t.costUsd === 'number') {
        entry.costUsd = (entry.costUsd ?? 0) + t.costUsd;
      } else {
        // 单价未收录：costUsd 退化为已知下界，标注不完整估算
        entry.estimated = false;
      }
    }
  }

  const entries = [...byMonthAgent.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([, agents]) =>
      [...agents.values()].sort((a, b) => (a.agentId < b.agentId ? -1 : 1)),
    );

  const totalUsd = entries.reduce<number | null>((acc, e) => {
    if (acc === null || e.costUsd === null) return acc ?? e.costUsd;
    return acc + e.costUsd;
  }, entries.length > 0 ? 0 : null);

  return {
    generatedAt: new Date().toISOString(),
    source,
    entries,
    totalUsd,
  };
}

/** 账单文本渲染（CLI/报表用） */
export function renderBilling(report: BillingReport): string {
  const lines: string[] = [`账单周期聚合（${report.generatedAt}）`, ''];
  if (report.entries.length === 0) {
    lines.push('（无任务记录——账单为空）');
    return lines.join('\n');
  }
  lines.push('月份       Agent                              任务  LLM调用   Token(in/out)        成本(USD)');
  for (const e of report.entries) {
    const cost = e.costUsd === null ? '—' : `$${e.costUsd.toFixed(4)}${e.estimated ? '' : '+'}`;
    lines.push(
      `${e.month}  ${e.agentId.padEnd(33)}${String(e.tasks).padStart(4)}  ${String(e.llmCalls).padStart(7)}  ` +
        `${String(e.tokens.input).padStart(8)}/${String(e.tokens.output).padEnd(8)}  ${cost}`,
    );
  }
  const total = report.totalUsd === null ? '—（存在未估算任务）' : `$${report.totalUsd.toFixed(4)}`;
  lines.push('', `合计: ${total}${report.entries.some((e) => !e.estimated) ? '（含未完整估算月份，实际为下界）' : ''}`);
  return lines.join('\n');
}
