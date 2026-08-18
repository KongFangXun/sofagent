// ============================================================
// train-budget.ts · MCP tool：train_budget（v1.3.7 交付⑦）
// ============================================================
//
// 训练预算控制——查预算 / 超预算人审续跑或终止。
// 委托 @sofagent/orchestrator 的 train-budget 持久化层（train/jobs.json）。
//
// 与协议三约定同源（交付⑥）：预算字段写入 job.json（协议①），
// 超预算通过 SIGINT 暂停（协议③），预算事件进 stdout 流（协议②）。
//
// 操作：
//   - status：查任务预算状态（实际消耗 / 是否暂停 / 暂停详情）
//   - resolve：人审决策落地（resume 续跑 / terminate 终止）——挂起态才可操作
// ============================================================

import { join } from 'path';

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

export interface TrainBudgetArgs {
  /** 操作：status 查预算 / resolve 人审续跑或终止 */
  action: 'status' | 'resolve';
  /** 训练任务标识（job.json 的 jobId） */
  job_id: string;
  /** resolve 时的人审决策：resume 续跑（从 checkpoint 恢复）/ terminate 终止 */
  decision?: 'resume' | 'terminate';
}

export interface TrainBudgetToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    job_id?: string;
    status?: string;
    /** 预算挂起等待人审（resolve 前置态——对齐 model_switch 的 awaitingHuman 语义） */
    awaitingHuman?: boolean;
    usage?: { elapsed_minutes: number; steps: number; cost: number };
    budget?: { max_minutes?: number; max_steps?: number; max_cost?: number } | null;
    violation?: { dimension: string; actual: number; limit: number };
  };
}

export async function trainBudget(args: TrainBudgetArgs): Promise<TrainBudgetToolResult> {
  const { action, job_id, decision } = args;

  if (action !== 'status' && action !== 'resolve') {
    return {
      text: '[sofagent] train_budget 失败：action 必须是 status 或 resolve',
      data: { isError: true, ok: false, issues: ['action 必须是 status 或 resolve'] },
    };
  }
  if (typeof job_id !== 'string' || job_id.trim() === '') {
    return {
      text: '[sofagent] train_budget 失败：job_id 必填且非空',
      data: { isError: true, ok: false, issues: ['job_id 必填且非空'] },
    };
  }

  try {
    const budgetMod = await import('@sofagent/orchestrator');
    const dataDir = getSofagentDataDir();
    const job = budgetMod.findTrainJob(dataDir, job_id);

    if (!job) {
      return {
        text: `[sofagent] train_budget 失败：未找到训练任务 ${job_id}`,
        data: { isError: true, ok: false, issues: [`未找到训练任务 ${job_id}`], job_id },
      };
    }

    // ── status：查预算 ──
    if (action === 'status') {
      const awaiting = job.status === 'paused';
      return {
        text: awaiting
          ? `[sofagent] 训练任务 ${job_id} 已超预算暂停 ⚠️（${job.pause?.violation.dimension}：实际 ${job.pause?.violation.actual} / 上限 ${job.pause?.violation.limit}）——等待人审续跑/终止（action=resolve）`
          : `[sofagent] 训练任务 ${job_id} 状态：${job.status}（耗时 ${job.usage.elapsedMinutes} 分钟 / ${job.usage.steps} 步 / 成本 ${job.usage.cost}）`,
        data: {
          isError: false,
          ok: true,
          issues: [],
          job_id,
          status: job.status,
          awaitingHuman: awaiting,
          usage: { elapsed_minutes: job.usage.elapsedMinutes, steps: job.usage.steps, cost: job.usage.cost },
          budget: job.budget
            ? {
                ...(job.budget.maxMinutes != null ? { max_minutes: job.budget.maxMinutes } : {}),
                ...(job.budget.maxSteps != null ? { max_steps: job.budget.maxSteps } : {}),
                ...(job.budget.maxCost != null ? { max_cost: job.budget.maxCost } : {}),
              }
            : null,
          ...(job.pause
            ? {
                violation: {
                  dimension: job.pause.violation.dimension,
                  actual: job.pause.violation.actual,
                  limit: job.pause.violation.limit,
                },
              }
            : {}),
        },
      };
    }

    // ── resolve：人审决策落地（仅 paused 态可操作）──
    if (job.status !== 'paused') {
      return {
        text: `[sofagent] train_budget 失败：任务 ${job_id} 当前状态 ${job.status}，仅 paused（超预算挂起）可 resolve`,
        data: { isError: true, ok: false, issues: ['仅 paused 态可 resolve'], job_id, status: job.status },
      };
    }
    if (decision !== 'resume' && decision !== 'terminate') {
      return {
        text: '[sofagent] train_budget 失败：resolve 需 decision=resume 或 terminate',
        data: { isError: true, ok: false, issues: ['decision 必须是 resume 或 terminate'], job_id },
      };
    }

    const resolvedStatus = decision === 'resume' ? 'running' : 'terminated';
    budgetMod.upsertTrainJob(dataDir, {
      ...job,
      status: resolvedStatus,
      pause: undefined,
      updatedAt: new Date().toISOString(),
    });

    // decision-log 留痕（对齐 model_register 审计模式）
    try {
      const audit = (await import('@sofagent/audit')) as unknown as {
        emitDecision: (input: Record<string, unknown>) => unknown;
      };
      audit.emitDecision({
        agentId: 'sofagent-mcp-train-budget',
        sessionId: `train-budget-${job_id}`,
        kind: 'CONFIG_CHANGE',
        moment: 'ACT',
        // v1.3.6 交付⑮：人审续跑/终止 = 方案选择（判断时刻分类 select）
        category: 'select',
        why: `训练预算人审：任务 ${job_id} 超预算暂停后人工决策 ${decision}（${decision === 'resume' ? '从 checkpoint 续跑' : '终止训练'}）`,
        evidence: [`job=${job_id} decision=${decision}`],
      });
    } catch {
      // 留痕降级不阻塞
    }

    return {
      text:
        decision === 'resume'
          ? `[sofagent] 训练任务 ${job_id} 已批准续跑 ✅（从 checkpoint 恢复，协议③）`
          : `[sofagent] 训练任务 ${job_id} 已终止 ⛔（人审决策落地）`,
      data: { isError: false, ok: true, issues: [], job_id, status: resolvedStatus },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_budget 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg], job_id },
    };
  }
}
