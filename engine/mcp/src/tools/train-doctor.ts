// ============================================================
// train-doctor.ts · MCP tool：train_doctor（v1.4.3 章四）
// ============================================================
//
// 训练环境体检——sofagent train doctor 的 MCP 面：CUDA 可用 / 显存 /
// 框架版本 / 基座模型缓存四项结构化体检报告（对齐 v1.3.x doctor 模式）。
// 委托 @sofagent/orchestrator 的 env-manager.trainDoctor（v1.4.3 扩展，
// 复用 v1.4.3 train-env 检测地基——扩展非重建）。
//
// 只查不装：本 tool 是体检（环境怎么装走 train env init /
// tools/train-env-init.sh；基座模型怎么下走 model-downloader）。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface TrainDoctorArgs {
  /** 企业标识（体检报告与 train-env.json 清单的企业分区） */
  enterprise_id: string;
  /** 数据集挂载点（v1.4.3 第八章反作弊体检——.git 可见性探测；缺省 null 报 fail 给指引） */
  dataset_mount_path?: string;
}

export interface TrainDoctorToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    /** 四项体检整体结论 */
    ready?: boolean;
    enterpriseId?: string;
    cuda?: { status: string; version: string | null; gpuName: string | null; detail: string };
    vram?: { status: string; freeMiB: number | null; detail: string };
    framework?: { status: string; name: string | null; version: string | null; detail: string };
    modelCache?: {
      status: string;
      cached: Array<{ name: string; cached: boolean; path: string }>;
      detail: string;
    };
    /** 环境版本清单（train-env.json——可复现口径） */
    manifest?: Record<string, unknown> | null;
    /** 体检步骤明细（审计留痕） */
    steps?: Array<{ name: string; status: string; detail?: string }>;
    checkedAt?: string;
  };
}

/**
 * train_doctor——训练环境体检（CUDA/显存/框架/基座缓存四项，只查不装）。
 * 环境探测失败不抛出（体检语义 = 如实报告）——对齐 train_submit 结构化
 * 错误模式。
 */
export async function trainDoctorTool(args: TrainDoctorArgs): Promise<TrainDoctorToolResult> {
  const { enterprise_id, dataset_mount_path } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return {
      text: '[sofagent] train_doctor 失败：enterprise_id 必填且非空',
      data: { isError: true, ok: false, issues: ['enterprise_id 必填且非空'] },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();
    // deps 缺省 → env-manager 内部走 makeDefaultExecFn（execFile 封装）——
    // MCP 调用方无需构造；测试经 orchestrator 单测的注入路径覆盖。
    const report = await orch.trainDoctor(dataDir, enterprise_id);

    // v1.4.3 第八章：反作弊基线三项体检（git 禁用 / .git 可见性 / 网络白名单）
    // ——数据集挂载点未登记时传 null（.git 可见性项报 fail 并给指引）。
    const anticheat = orch.checkAnticheatBaseline(dataDir, enterprise_id, dataset_mount_path ?? null);

    const okLines: string[] = [];
    const badLines: string[] = [];
    for (const s of [...report.steps, ...[
      { name: 'anticheat-git-disabled', status: anticheat.gitDisabled.status, detail: anticheat.gitDisabled.detail },
      { name: 'anticheat-git-visibility', status: anticheat.datasetGitVisibility.status, detail: anticheat.datasetGitVisibility.detail },
      { name: 'anticheat-network-allowlist', status: anticheat.networkAllowlist.status, detail: anticheat.networkAllowlist.detail },
    ] as Array<{ name: string; status: string; detail?: string }>]) {
      const line = `${s.name}: ${s.status}${s.detail ? `（${s.detail}）` : ''}`;
      if (s.status === 'ok') okLines.push(line);
      else badLines.push(line);
    }
    const summary = report.ready
      ? `[sofagent] 训练环境体检 ✅ READY（${enterprise_id}）——四项全过：\n  · ${okLines.join('\n  · ')}`
      : `[sofagent] 训练环境体检 ⚠️ 未就绪（${enterprise_id}）——待处理项：\n  · ${badLines.join('\n  · ')}\n（装环境走 train env init / bash tools/train-env-init.sh；基座模型下载支持断点续传）`;

    return {
      text: summary,
      data: {
        isError: false,
        ok: true,
        issues: [],
        ready: report.ready,
        enterpriseId: enterprise_id,
        cuda: report.cuda,
        vram: report.vram,
        framework: report.framework,
        modelCache: {
          status: report.modelCache.status,
          cached: report.modelCache.entries,
          detail: report.modelCache.detail,
        },
        manifest: report.manifest as unknown as Record<string, unknown> | null,
        steps: report.steps,
        checkedAt: report.checkedAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_doctor 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
