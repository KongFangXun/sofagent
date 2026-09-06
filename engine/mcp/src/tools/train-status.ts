// ============================================================
// train-status.ts · MCP tool：train_status（v1.4.5 第一章）
// ============================================================
//
// 训练任务进度查询——status / step / loss / reward 曲线 / 日志尾部。
// 委托 @sofagent/orchestrator 的 train-job 读取面（readTrainEvents +
// loadTrainJobRecord——只读零副作用）。MCP 客户端（WorkBuddy/商业平台）
// 长任务轮询入口。
//
// enterpriseId 必填（企业隔离）；guard 走 getJobGuarded（跨企业拒绝）。
// ============================================================

import { getDataDir } from '@sofagent/core';

export interface TrainStatusArgs {
  /** 🔴 训练任务标识 */
  train_job_id: string;
  /** 🔴 企业标识（隔离分区） */
  enterprise_id: string;
  /** 曲线窗口（缺省全量；N=尾部 N 条 progress 事件） */
  last_n?: number;
}

export interface TrainStatusToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    trainJobId?: string;
    enterpriseId?: string;
    status?: string;
    /** 当前步数 / 总步数（超参里有 max_steps 时） */
    step?: number | null;
    maxSteps?: number | null;
    /** 最近 loss / reward */
    lastLoss?: number | null;
    lastReward?: number | null;
    /** loss/reward 曲线（尾部 N 点——图表消费） */
    lossCurve?: Array<{ step: number; loss?: number; reward?: number }>;
    /** 事件统计 */
    eventCount?: number;
    protocolErrors?: number;
    /** 最近 checkpoint（续跑起点） */
    lastCheckpoint?: { checkpointPath: string; step: number } | null;
    /** 失败原因（failed 态） */
    reason?: string;
    /** 用量快照（预算口径） */
    usage?: Record<string, unknown>;
  };
}

/**
 * train_status——查训练进度（status/step/loss/reward 曲线）。
 * 任务不存在/跨企业返回结构化错误（不抛出——对齐 train_submit 模式）。
 */
export async function trainStatusTool(args: TrainStatusArgs): Promise<TrainStatusToolResult> {
  const { train_job_id, enterprise_id, last_n } = args;

  if (typeof train_job_id !== 'string' || train_job_id.trim() === '') {
    return {
      text: '[sofagent] train_status 失败：train_job_id 必填且非空',
      data: { isError: true, ok: false, issues: ['train_job_id 必填且非空'] },
    };
  }
  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return {
      text: '[sofagent] train_status 失败：enterprise_id 必填（企业隔离分区依赖）',
      data: { isError: true, ok: false, issues: ['enterprise_id 必填且非空'] },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    // 受守卫读取（跨企业拒绝——train-job 的隔离面）
    const record = orch.getTrainJobRecord(dataDir, enterprise_id, train_job_id);
    if (!record) {
      return {
        text: `[sofagent] train_status 失败：任务 ${train_job_id} 不存在（enterprise=${enterprise_id}）`,
        data: { isError: true, ok: false, issues: [`任务不存在：${train_job_id}`] },
      };
    }

    const progressResult = orch.getTrainProgress(dataDir, enterprise_id, train_job_id);
    const progressEvents = progressResult.events.filter(
      (e): e is { type: 'progress'; step: number; loss?: number; reward?: number } => e.type === 'progress',
    );
    const window = typeof last_n === 'number' && last_n > 0 ? progressEvents.slice(-last_n) : progressEvents;
    const last = progressEvents[progressEvents.length - 1];
    const maxSteps =
      typeof record.job.hyperparams.max_steps === 'number'
        ? (record.job.hyperparams.max_steps as number)
        : typeof record.job.budget?.maxSteps === 'number'
          ? record.job.budget.maxSteps
          : null;

    const lines = [
      `任务：${record.jobId}（${record.status}）`,
      `模型：${record.job.baseModel} · 算法 ${record.job.algorithm}`,
      last
        ? `进度：step ${last.step}${maxSteps !== null ? ` / ${maxSteps}` : ''}` +
          (typeof last.loss === 'number' ? ` · loss ${last.loss}` : '') +
          (typeof last.reward === 'number' ? ` · reward ${last.reward}` : '')
        : '进度：暂无 progress 事件（任务未到训练循环或已终态）',
      `事件：${progressResult.events.length} 条（解析坏行 ${progressResult.errors}）`,
    ];
    if (record.lastCheckpoint) {
      lines.push(`断点：${record.lastCheckpoint.checkpointPath}（step ${record.lastCheckpoint.step}）`);
    }
    if (record.reason) {
      lines.push(`原因：${record.reason.slice(0, 200)}`);
    }

    return {
      text: `[sofagent] 训练进度 ✅\n  ${lines.join('\n  ')}`,
      data: {
        isError: false,
        ok: true,
        issues: [],
        trainJobId: record.jobId,
        enterpriseId: record.enterpriseId,
        status: record.status,
        step: last ? last.step : null,
        maxSteps,
        lastLoss: last && typeof last.loss === 'number' ? last.loss : null,
        lastReward: last && typeof last.reward === 'number' ? last.reward : null,
        lossCurve: window.map((e) => ({
          step: e.step,
          ...(typeof e.loss === 'number' ? { loss: e.loss } : {}),
          ...(typeof e.reward === 'number' ? { reward: e.reward } : {}),
        })),
        eventCount: progressResult.events.length,
        protocolErrors: progressResult.errors,
        lastCheckpoint: record.lastCheckpoint ?? null,
        ...(record.reason !== undefined ? { reason: record.reason } : {}),
        usage: record.usage as unknown as Record<string, unknown>,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_status 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
