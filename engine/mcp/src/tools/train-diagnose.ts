// ============================================================
// train-diagnose.ts · MCP tool：train_diagnose（v1.4.5 第二章）
// ============================================================
//
// 训练失败诊断——七类分类（OOM/数据格式/超参发散/框架/环境/重复坍塌/
// 精度异常）+ 上下文收集（日志尾部+环境+checkpoint+超参）+ 修复处方。
// 委托 @sofagent/orchestrator 的 train-diagnose（纯规则——LLM 不参与）。
// ============================================================

import { getDataDir } from '@sofagent/core';

export interface TrainDiagnoseArgs {
  /** 🔴 训练任务标识（failed/cancelled 等有失败上下文的任务） */
  train_job_id: string;
  /** 🔴 企业标识（隔离分区） */
  enterprise_id: string;
  /** 是否落盘报告（缺省 true——data/train/<企业>/<jobId>/diagnose.json） */
  save?: boolean;
}

export interface TrainDiagnoseToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    trainJobId?: string;
    enterpriseId?: string;
    status?: string;
    /** 七类分类（null=未识别转人审） */
    category?: string | null;
    categoryName?: string;
    matchedKeywords?: string[];
    /** 修复处方步骤 */
    prescriptionSteps?: string[];
    prescriptionSource?: string;
    /** 上下文四源摘要 */
    context?: {
      logTail: string;
      lastCheckpoint: { checkpointPath: string; step: number } | null;
      hyperparams: Record<string, unknown>;
      envFramework: string | null;
      envCuda: string | null;
    };
    reportFile?: string;
    diagnosedAt?: string;
  };
}

/**
 * train_diagnose——训练失败诊断（七类分类+上下文+处方）。
 * 任务不存在返回结构化错误（不抛出——对齐 train_status 模式）。
 */
export async function trainDiagnoseTool(args: TrainDiagnoseArgs): Promise<TrainDiagnoseToolResult> {
  const { train_job_id, enterprise_id, save } = args;

  if (typeof train_job_id !== 'string' || train_job_id.trim() === '') {
    return {
      text: '[sofagent] train_diagnose 失败：train_job_id 必填且非空',
      data: { isError: true, ok: false, issues: ['train_job_id 必填且非空'] },
    };
  }
  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return {
      text: '[sofagent] train_diagnose 失败：enterprise_id 必填（企业隔离分区依赖）',
      data: { isError: true, ok: false, issues: ['enterprise_id 必填且非空'] },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();
    const report = orch.diagnoseTrainFailure(dataDir, enterprise_id, train_job_id);

    let reportFile: string | undefined;
    if (save !== false) {
      reportFile = orch.saveTrainDiagnoseReport(dataDir, report);
    }

    const lines = [
      `任务：${report.trainJobId}（状态 ${report.status}）`,
      `一、失败分类：${report.classification.category ?? '未识别（转人审）'}——${report.classification.name}`,
      report.classification.matchedKeywords.length > 0
        ? `   日志证据：${report.classification.matchedKeywords.join('、')}`
        : '   日志证据：无关键词命中（零命中兜底路径）',
    ];
    if (report.prescription) {
      lines.push(`二、修复处方（${report.prescription.source}）：`);
      report.prescription.steps.forEach((step, i) => lines.push(`   ${i + 1}. ${step}`));
    }
    lines.push('三、诊断上下文（四源已打包）：');
    lines.push(`   日志尾部：${report.context.logTail.slice(-200) || '（空）'}`);
    lines.push(
      `   最近断点：${report.context.lastCheckpoint ? `${report.context.lastCheckpoint.checkpointPath}（step ${report.context.lastCheckpoint.step}）` : '无'}`,
    );
    if (reportFile) lines.push(`四、报告落盘：${reportFile}`);

    return {
      text: `[sofagent] 训练失败诊断 ✅\n  ${lines.join('\n  ')}`,
      data: {
        isError: false,
        ok: true,
        issues: [],
        trainJobId: report.trainJobId,
        enterpriseId: report.enterpriseId,
        status: report.status,
        category: report.classification.category,
        categoryName: report.classification.name,
        matchedKeywords: report.classification.matchedKeywords,
        prescriptionSteps: report.prescription?.steps ?? [],
        prescriptionSource: report.prescription?.source,
        context: {
          logTail: report.context.logTail,
          lastCheckpoint: report.context.lastCheckpoint,
          hyperparams: report.context.hyperparams,
          envFramework: report.context.envManifest?.framework
            ? `${report.context.envManifest.framework.name}@${report.context.envManifest.framework.version}`
            : null,
          envCuda: report.context.envManifest?.cudaVersion ?? null,
        },
        ...(reportFile !== undefined ? { reportFile } : {}),
        diagnosedAt: report.diagnosedAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_diagnose 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
