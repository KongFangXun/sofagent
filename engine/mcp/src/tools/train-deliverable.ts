// ============================================================
// train-deliverable.ts · MCP tool：train_deliverable（v1.4.5 第四章）
//
// FDE 训练交付包的 MCP 面：generate（五件聚合 → zip + manifest + HMAC）
// / verify（manifest 逐项核对 + 环境兼容性）双动作。
// 委托 @sofagent/orchestrator 的 train-deliverable 实现（generate /
// verify 纯函数），本 tool 只做参数适配与结果包装——对齐 train-doctor
// 模式（MCP 面薄、编排层真身）。
//
// 五件内容（devlog 第四章交付表）：训练配置模板 / 数据管道配置 /
// eval 基线冻结 / 运维手册 / 权重清单（含第五章保留策略标记的回滚点）。
// ============================================================

import { getDataDir } from '@sofagent/core';

/** train_deliverable tool 入参 */
export interface TrainDeliverableArgs {
  /** 动作：generate 生成交付包 / verify 校验既有包 */
  action: 'generate' | 'verify';
  /** 🔴 企业标识（企业隔离分区依赖） */
  enterprise_id: string;
  /** 血缘任务（generate 可选——缺省取最新 completed job） */
  train_job_id?: string;
  /** 数据集标识（generate 可选——缺省取版本台账最新） */
  dataset_id?: string;
  /** FDE 联系方式（generate 可选——④ 运维手册联系方式段） */
  contact?: string;
  /** 待校验包路径（verify 🔴 必填——zip 绝对/相对路径） */
  zip_path?: string;
}

/** train_deliverable tool 结果 */
export interface TrainDeliverableToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    /** generate：交付包 zip 路径 */
    zipPath?: string;
    /** generate：五件内容覆盖情况 */
    sections?: Record<string, number>;
    /** generate：manifest（已签名） */
    manifestHmac?: string;
    /** verify：完整性结论 */
    integrityOk?: boolean;
    /** verify：逐条目核对明细 */
    files?: Array<{ path: string; section: string; status: string }>;
    /** verify：环境兼容性结论 */
    envOk?: boolean;
    /** verify：环境体检明细（人读） */
    envDetail?: string;
  };
}

/** 参数校验（generate/verify 共用前置） */
function validateCommon(action: unknown, enterpriseId: unknown): string[] | null {
  const issues: string[] = [];
  if (action !== 'generate' && action !== 'verify') {
    issues.push('action 必须是 generate / verify');
  }
  if (typeof enterpriseId !== 'string' || enterpriseId.trim() === '') {
    issues.push('enterprise_id 必填且非空（企业隔离分区依赖）');
  }
  return issues.length > 0 ? issues : null;
}

/**
 * train_deliverable——FDE 交付包生成/校验。
 * 校验失败/前置不满足返回结构化错误（不抛出——对齐 train_submit 模式）。
 */
export async function trainDeliverableTool(
  args: TrainDeliverableArgs,
): Promise<TrainDeliverableToolResult> {
  const { action, enterprise_id, train_job_id, dataset_id, contact, zip_path } = args;

  // ── 前置校验（快速失败）──
  const commonIssues = validateCommon(action, enterprise_id);
  if (commonIssues !== null) {
    return {
      text: `[sofagent] train_deliverable 失败：${commonIssues.join('；')}`,
      data: { isError: true, ok: false, issues: commonIssues },
    };
  }
  if (action === 'verify' && (typeof zip_path !== 'string' || zip_path.trim() === '')) {
    const issues = ['verify 动作必须提供 zip_path（待校验交付包路径）'];
    return {
      text: `[sofagent] train_deliverable 失败：${issues[0]}`,
      data: { isError: true, ok: false, issues },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    if (action === 'generate') {
      // ── generate：五件聚合 + zip + manifest + HMAC ──
      const result = orch.generateTrainDeliverable(dataDir, enterprise_id, {
        ...(typeof train_job_id === 'string' && train_job_id.trim() !== ''
          ? { trainJobId: train_job_id }
          : {}),
        ...(typeof dataset_id === 'string' && dataset_id.trim() !== ''
          ? { datasetId: dataset_id }
          : {}),
        ...(typeof contact === 'string' && contact.trim() !== '' ? { contact } : {}),
      });
      const sections = result.sections as Record<string, number>;
      const sectionLines = Object.entries(sections)
        .map(([k, v]) => `  · ${k}: ${v} 件`)
        .join('\n');
      return {
        text: [
          `[sofagent] 训练交付包已生成 ✅（${enterprise_id}）`,
          `zip：${result.zipPath}（${(result.zipBytes / 1024).toFixed(1)} KB）`,
          '五件内容：',
          sectionLines,
          `manifest HMAC：${result.manifest.manifestHmac.slice(0, 12)}…（企业收包侧 train_deliverable verify 校验）`,
        ].join('\n'),
        data: {
          isError: false,
          ok: true,
          issues: [],
          zipPath: result.zipPath,
          sections,
          manifestHmac: result.manifest.manifestHmac,
        },
      };
    }

    // ── verify：manifest 逐项核对 + 环境兼容性（train doctor 子集）──
    const report = orch.verifyTrainDeliverable(zip_path as string, { dataDir });
    const fileLines = report.files
      .map((f) => `  · ${f.path}（${f.section}）：${f.status}`)
      .join('\n');
    const unregisteredNote =
      report.unregistered.length > 0
        ? `\n  ⚠ 未登记条目：${report.unregistered.join('、')}`
        : '';
    return {
      text: report.ok
        ? [
            `[sofagent] 交付包校验通过 ✅（${zip_path}）`,
            '完整性：manifest 逐项核对全过',
            `环境兼容：${report.env.detail}`,
            '明细：',
            fileLines,
          ].join('\n')
        : [
            `[sofagent] 交付包校验未通过 ❌（${zip_path}）`,
            `原因：${report.rejectionReason ?? '未知'}`,
            `环境兼容：${report.env.detail}`,
            '明细：',
            fileLines,
            unregisteredNote,
          ].join('\n'),
      data: {
        isError: !report.ok,
        ok: report.ok,
        issues: report.ok ? [] : [report.rejectionReason ?? '校验未通过'],
        integrityOk: report.integrityOk,
        files: report.files.map((f) => ({ path: f.path, section: f.section, status: f.status })),
        envOk: report.env.ok,
        envDetail: report.env.detail,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_deliverable ${action} 失败：${message}`,
      data: { isError: true, ok: false, issues: [message] },
    };
  }
}
