// ============================================================
// train-report.ts · MCP tool：train_report（v1.4.5 章六）
// ============================================================
//
// 训练报告生成——客户可读交付物的 MCP 面：数据概况 + 训练配置 +
// eval 对比 + 产物清单 + 量化四字段（GUIDE §4.3），归档
// data/dashboard/train-reports/。
// 委托 @sofagent/orchestrator 的 train-report.generateTrainReport
// （复用章三 TrainEvalReport / 章二 dataset_version / v1.4.5 train job）。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface TrainReportArgs {
  /** 训练任务标识 */
  train_job_id: string;
  /** 企业标识 */
  enterprise_id: string;
  /** 基线 eval（训练前——章三 runTrainEval 产出的报告 JSON） */
  baseline_eval?: Record<string, unknown>;
  /** 训后 eval */
  after_eval?: Record<string, unknown>;
  /** 训练集版本记录（章二 dataset_version） */
  dataset_version?: Record<string, unknown>;
  /** 量化四字段输入（GUIDE §4.3 岗位口径） */
  quantification?: {
    annual_salary: number;
    takeover_ratio: number;
    ai_annual_cost: number;
    one_time_investment?: number;
  };
  /** 产物清单（可选——缺省从 job record 推导） */
  artifacts?: string[];
}

export interface TrainReportToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    /** 报告归档路径 */
    markdownPath?: string;
    jsonPath?: string;
    /** 结构化报告（绩效量化引擎直接消费） */
    report?: Record<string, unknown>;
  };
}

/**
 * train_report——训练报告生成（markdown + JSON 双形态归档）。
 * eval/数据版本输入为可选（缺失段降级注明不拒绝——报告尽力生成）。
 */
export async function trainReportTool(args: TrainReportArgs): Promise<TrainReportToolResult> {
  const { train_job_id, enterprise_id } = args;

  if (typeof train_job_id !== 'string' || train_job_id.trim() === '') {
    return { text: '[sofagent] train_report 失败：train_job_id 必填且非空', data: { isError: true, ok: false } };
  }
  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return { text: '[sofagent] train_report 失败：enterprise_id 必填且非空', data: { isError: true, ok: false } };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    const result = orch.generateTrainReport({
      dataDir,
      enterpriseId: enterprise_id,
      trainJobId: train_job_id,
      baselineEval: (args.baseline_eval ?? null) as never,
      afterEval: (args.after_eval ?? null) as never,
      datasetVersion: (args.dataset_version ?? null) as never,
      ...(args.quantification !== undefined
        ? {
            quantification: orch.computeQuantification({
              annualSalary: args.quantification.annual_salary,
              takeoverRatio: args.quantification.takeover_ratio,
              aiAnnualCost: args.quantification.ai_annual_cost,
              ...(args.quantification.one_time_investment !== undefined
                ? { oneTimeInvestment: args.quantification.one_time_investment }
                : {}),
            }),
          }
        : {}),
      ...(args.artifacts !== undefined ? { artifacts: args.artifacts } : {}),
    });

    const e = result.json.evaluation;
    const summaryLines = [
      `[sofagent] 训练报告已生成 ✅（${train_job_id}）`,
      `  · 归档：${result.archivePaths.markdownPath}（+ .json）`,
      `  · eval：${e.baselineAverage !== null ? e.baselineAverage.toFixed(1) : '—'} → ${e.afterAverage !== null ? e.afterAverage.toFixed(1) : '—'}${e.scoreDelta !== null ? `（${e.scoreDelta >= 0 ? '+' : ''}${e.scoreDelta.toFixed(1)}）` : ''}`,
      `  · 数据集：${result.json.dataset ? `${result.json.dataset.datasetId}@${result.json.dataset.version}（${result.json.dataset.sampleCount} 条）` : '未关联'}`,
      `  · 产物：${result.json.artifacts.length} 项`,
    ];
    if (result.json.quantification !== null) {
      summaryLines.push(
        `  · 量化：当前 ${result.json.quantification.currentCost.display} → AI 后 ${result.json.quantification.aiCost.display}，年节省 ${result.json.quantification.annualSaving.display}，回本 ${result.json.quantification.paybackPeriod.display}`,
      );
    }

    return {
      text: summaryLines.join('\n'),
      data: {
        isError: false,
        ok: true,
        markdownPath: result.archivePaths.markdownPath,
        jsonPath: result.archivePaths.jsonPath,
        report: result.json as unknown as Record<string, unknown>,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[sofagent] train_report 异常：${msg}`, data: { isError: true, ok: false } };
  }
}
