// ============================================================
// train-submit.ts · MCP tool：train_submit（v1.4.3 块二）
// ============================================================
//
// 训练任务提交——dataPath + baseModel + algorithm（sft/dpo/grpo）+
// hyperparams + budget（可选）→ 生成 train job 实例（trainJobId）。
// 委托 @sofagent/orchestrator 的 train-scheduler（spawn Python 子进程
// 由 daemon 侧调度器接管——本 tool 只做提交与落盘，不阻塞等待训练完成）。
//
// 协议三约定同源（v1.3.6 SSOT）：单 JSON config 文件传 job（①）、
// stdout JSON 事件流回流 events.jsonl（②）、SIGINT checkpoint 暂停（③）。
// enterpriseId 必填——企业隔离分区 data/train/<enterpriseId>/<jobId>/。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface TrainSubmitArgs {
  /** 数据路径（训练集） */
  data_path: string;
  /** 基座模型（企业专属模型 / 开源基座） */
  base_model: string;
  /** 训练算法（sft 监督微调 / dpo 偏好优化 / grpo 组相对策略优化） */
  algorithm: 'sft' | 'dpo' | 'grpo';
  /** 超参（透传训练框架——Node 不解释具体键） */
  hyperparams?: Record<string, unknown>;
  /** 预算（可选——超限 SIGINT 暂停等人审，train_budget tool 衔接） */
  budget?: { max_minutes?: number; max_steps?: number; max_cost?: number };
  /** 企业标识（🔴 必填——隔离分区依赖，缺失拒绝创建） */
  enterprise_id: string;
  /** 训练任务标识（可选——同 train_job_id 重复提交幂等返回既有任务） */
  train_job_id?: string;
}

export interface TrainSubmitToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    /** 生成的训练任务标识（train_job_id） */
    trainJobId?: string;
    /** 幂等命中：返回既有任务而非新建 */
    created?: boolean;
    /** 任务初始状态（queued） */
    status?: string;
    /** 企业分区（隔离审计可读） */
    enterpriseId?: string;
    /** job 目录（状态/events.jsonl 落点——进度查询入口） */
    jobDir?: string;
  };
}

/**
 * train_submit——提交训练任务（生成 trainJobId，spawn 由调度器接管）。
 * 校验失败/enterpriseId 缺失返回结构化错误（不抛出——对齐 train_budget 模式）。
 */
export async function trainSubmit(args: TrainSubmitArgs): Promise<TrainSubmitToolResult> {
  const { data_path, base_model, algorithm, hyperparams, budget, enterprise_id, train_job_id } = args;

  // 前置校验（快速失败——缺失必填直接结构化错误）
  if (typeof data_path !== 'string' || data_path.trim() === '') {
    return {
      text: '[sofagent] train_submit 失败：data_path 必填且非空',
      data: { isError: true, ok: false, issues: ['data_path 必填且非空'] },
    };
  }
  if (typeof base_model !== 'string' || base_model.trim() === '') {
    return {
      text: '[sofagent] train_submit 失败：base_model 必填且非空',
      data: { isError: true, ok: false, issues: ['base_model 必填且非空'] },
    };
  }
  if (algorithm !== 'sft' && algorithm !== 'dpo' && algorithm !== 'grpo') {
    return {
      text: '[sofagent] train_submit 失败：algorithm 必须是 sft / dpo / grpo',
      data: { isError: true, ok: false, issues: ['algorithm 必须是 sft / dpo / grpo'] },
    };
  }
  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return {
      text: '[sofagent] train_submit 失败：enterprise_id 必填（企业隔离分区依赖）',
      data: { isError: true, ok: false, issues: ['enterprise_id 必填且非空'] },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    // 委托编排层：createTrainJob（协议校验 + enterpriseId 必填 + 幂等）
    // spawn 由 daemon 侧调度器（createTrainScheduler）接管——MCP tool 只提交
    // 不阻塞，训练进度走 events.jsonl / train_budget status 查询。
    const result = orch.createTrainJob({
      dataDir,
      enterpriseId: enterprise_id,
      ...(typeof train_job_id === 'string' && train_job_id.trim() !== ''
        ? { jobId: train_job_id }
        : {}),
      dataPath: data_path,
      baseModel: base_model,
      algorithm,
      ...(hyperparams !== undefined ? { hyperparams } : {}),
      ...(budget !== undefined
        ? {
            budget: {
              ...(typeof budget.max_minutes === 'number' ? { maxMinutes: budget.max_minutes } : {}),
              ...(typeof budget.max_steps === 'number' ? { maxSteps: budget.max_steps } : {}),
              ...(typeof budget.max_cost === 'number' ? { maxCost: budget.max_cost } : {}),
            },
          }
        : {}),
    });

    const jobDir = orch.trainJobDir(dataDir, enterprise_id, result.record.jobId);
    return {
      text: result.created
        ? `[sofagent] 训练任务已提交 ✅（trainJobId=${result.record.jobId}，算法 ${result.record.job.algorithm}，基座 ${result.record.job.baseModel}）——进度见 ${join('data', 'train', enterprise_id, result.record.jobId, 'events.jsonl')}`
        : `[sofagent] 训练任务已存在（幂等命中）→ trainJobId=${result.record.jobId}（状态 ${result.record.status}，未重复创建）`,
      data: {
        isError: false,
        ok: true,
        issues: [],
        trainJobId: result.record.jobId,
        created: result.created,
        status: result.record.status,
        enterpriseId: enterprise_id,
        jobDir,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_submit 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
