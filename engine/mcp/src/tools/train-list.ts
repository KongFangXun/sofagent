// ============================================================
// train-list.ts · MCP tool：train_list（v1.4.5 第一章）
// ============================================================
//
// 历史任务列表——按时间 / 状态 / 模型 / 企业过滤。FDE 交付复盘、
// 多任务管理入口。委托 @sofagent/orchestrator 的 listJobsGuarded
// （企业隔离——只扫本企业分区，其他企业 jobId 连存在性都不泄露）。
// ============================================================

import { getDataDir } from '@sofagent/core';

export interface TrainListArgs {
  /** 🔴 企业标识（隔离分区——只列本企业任务） */
  enterprise_id: string;
  /** 状态过滤（queued/running/checkpointing/completed/failed/cancelled/interrupted） */
  status?: string;
  /** 基座模型过滤（子串匹配——如 Qwen3） */
  base_model?: string;
  /** 时间过滤：最近 N 天（缺省全量） */
  last_days?: number;
  /** 返回条数上限（缺省 50） */
  limit?: number;
}

export interface TrainListToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    enterpriseId?: string;
    total?: number;
    /** 过滤后总数（分页前） */
    matched?: number;
    jobs?: Array<{
      trainJobId: string;
      status: string;
      baseModel: string;
      algorithm: string;
      createdAt: string;
      updatedAt: string;
      reason?: string;
    }>;
  };
}

/** 合法状态枚举（校验用——TRAIN_JOB_STATUSES 同源镜像，MCP 层不 import 内部模块） */
const VALID_STATUSES = [
  'queued',
  'running',
  'checkpointing',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

/**
 * train_list——历史任务列表（时间/状态/模型/企业过滤）。
 * 状态非法返回结构化错误；空列表是合法结果（提示语引导提交）。
 */
export async function trainListTool(args: TrainListArgs): Promise<TrainListToolResult> {
  const { enterprise_id, status, base_model, last_days, limit } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return {
      text: '[sofagent] train_list 失败：enterprise_id 必填（企业隔离分区依赖）',
      data: { isError: true, ok: false, issues: ['enterprise_id 必填且非空'] },
    };
  }
  if (status !== undefined && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return {
      text: `[sofagent] train_list 失败：status 非法（可选：${VALID_STATUSES.join(' | ')}）`,
      data: { isError: true, ok: false, issues: [`status 非法：${status}`] },
    };
  }
  if (last_days !== undefined && (!Number.isFinite(last_days) || last_days <= 0)) {
    return {
      text: '[sofagent] train_list 失败：last_days 需为正数（天）',
      data: { isError: true, ok: false, issues: ['last_days 需为正数'] },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    // 受守卫列 job（只扫本企业分区——零跨企业泄露）
    const guarded = orch.listJobsGuarded(dataDir, enterprise_id);
    if (!guarded.ok) {
      return {
        text: `[sofagent] train_list 拒绝：${guarded.error.message}`,
        data: { isError: true, ok: false, issues: [guarded.error.message] },
      };
    }
    const all = guarded.data;

    // 过滤链：状态 → 模型子串 → 时间窗
    let matched = all;
    if (status !== undefined) {
      matched = matched.filter((r) => r.status === status);
    }
    if (typeof base_model === 'string' && base_model.trim() !== '') {
      const needle = base_model.toLowerCase();
      matched = matched.filter((r) => r.job.baseModel.toLowerCase().includes(needle));
    }
    if (typeof last_days === 'number') {
      const cutoff = Date.now() - last_days * 24 * 60 * 60 * 1000;
      matched = matched.filter((r) => Date.parse(r.createdAt) >= cutoff);
    }

    // 排序（updatedAt 降序——最近活动在前）+ 截断
    const sorted = [...matched].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const capped = typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted.slice(0, 50);

    if (capped.length === 0) {
      return {
        text:
          `[sofagent] 训练任务列表：0 条（enterprise=${enterprise_id}` +
          `${status ? `，status=${status}` : ''}）——尚无匹配任务，提交走 train_submit`,
        data: {
          isError: false,
          ok: true,
          issues: [],
          enterpriseId: enterprise_id,
          total: all.length,
          matched: 0,
          jobs: [],
        },
      };
    }

    const lines = capped.map(
      (r) =>
        `· ${r.jobId} [${r.status}] ${r.job.baseModel}·${r.job.algorithm}（${r.updatedAt}）` +
        (r.reason ? ` —— ${r.reason.slice(0, 80)}` : ''),
    );
    return {
      text:
        `[sofagent] 训练任务列表：${capped.length}/${matched.length} 条（共 ${all.length}，enterprise=${enterprise_id}）\n  ` +
        lines.join('\n  '),
      data: {
        isError: false,
        ok: true,
        issues: [],
        enterpriseId: enterprise_id,
        total: all.length,
        matched: matched.length,
        jobs: capped.map((r) => ({
          trainJobId: r.jobId,
          status: r.status,
          baseModel: r.job.baseModel,
          algorithm: r.job.algorithm,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          ...(r.reason !== undefined ? { reason: r.reason } : {}),
        })),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_list 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
