// ============================================================
// train-dryrun.ts · MCP tool：train_dryrun（v1.4.3 章五）
// ============================================================
//
// 训练 dry-run——失败前预防的 MCP 面：管线连通 + 数据抽样 + 显存
// 估算 + 算力外推四项预检（结构化报告，不真训练）。
// 委托 @sofagent/orchestrator 的 train-dryrun.runDryrun
// （复用章一 data-ingest/dataset-builder/dataset-validator +
// 本版章五 scale-curve）。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


export interface TrainDryrunArgs {
  /** 数据文件路径（CSV/Excel/JSON/文本——相对 data 目录或绝对路径） */
  data_path: string;
  /** 训练算法 */
  algorithm: 'sft' | 'dpo' | 'grpo';
  /** 列映射（可选——缺省按常见命名约定推断） */
  column_mapping?: Record<string, string>;
  /** 显存预检（可选） */
  vram?: {
    params_billions: number;
    batch_size: number;
    sequence_length: number;
    bytes_per_param?: number;
    gradient_checkpointing?: boolean;
    /** GPU 可用显存（MiB——超限 fail） */
    gpu_vram_mib?: number;
  };
  /** 算力外推（可选——pilot 数据点 + 目标规模） */
  extrapolate?: {
    points: Array<{ compute: number; performance: number }>;
    target_compute: number;
    cost_per_unit?: number;
    budget_cap?: number;
  };
}

export interface TrainDryrunToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    passed: boolean;
    checks: Array<{ name: string; status: string; detail: string }>;
    vramEstimate?: Record<string, unknown>;
    extrapolation?: Record<string, unknown>;
    nextPilotCompute?: number | null;
  };
}

/**
 * train_dryrun——训练前预检（四项：管线连通/数据抽样/显存/算力外推）。
 * 预检失败不抛出（体检语义 = 如实报告哪项挂了怎么修）。
 */
export async function trainDryrunTool(args: TrainDryrunArgs): Promise<TrainDryrunToolResult> {
  const { data_path, algorithm } = args;

  if (typeof data_path !== 'string' || data_path.trim() === '') {
    return {
      text: '[sofagent] train_dryrun 失败：data_path 必填且非空',
      data: { isError: true, ok: false, passed: false, checks: [] },
    };
  }
  if (!['sft', 'dpo', 'grpo'].includes(algorithm)) {
    return {
      text: '[sofagent] train_dryrun 失败：algorithm 必须是 sft/dpo/grpo',
      data: { isError: true, ok: false, passed: false, checks: [] },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    // 相对路径按 data 目录解析（对齐 train_submit 的 data_path 口径）
    const resolvedPath = data_path.startsWith('/')
      ? data_path
      : join(getDataDir(), data_path);

    const result = orch.runDryrun({
      dataPath: resolvedPath,
      algorithm,
      ...(args.column_mapping !== undefined ? { columnMapping: args.column_mapping } : {}),
      ...(args.vram !== undefined
        ? {
            vram: {
              paramsBillions: args.vram.params_billions,
              batchSize: args.vram.batch_size,
              sequenceLength: args.vram.sequence_length,
              ...(args.vram.bytes_per_param !== undefined ? { bytesPerParam: args.vram.bytes_per_param } : {}),
              ...(args.vram.gradient_checkpointing !== undefined
                ? { gradientCheckpointing: args.vram.gradient_checkpointing }
                : {}),
              ...(args.vram.gpu_vram_mib !== undefined ? { gpuVramMiB: args.vram.gpu_vram_mib } : {}),
            },
          }
        : {}),
      ...(args.extrapolate !== undefined
        ? {
            extrapolate: {
              points: args.extrapolate.points,
              targetCompute: args.extrapolate.target_compute,
              ...(args.extrapolate.cost_per_unit !== undefined
                ? { costPerUnit: args.extrapolate.cost_per_unit }
                : {}),
              ...(args.extrapolate.budget_cap !== undefined ? { budgetCap: args.extrapolate.budget_cap } : {}),
            },
          }
        : {}),
    });

    const icon = (s: string): string => (s === 'ok' ? '✓' : s === 'fail' ? '✗' : s === 'warn' ? '⚠' : '·');
    const lines = result.checks.map((c) => `  ${icon(c.status)} ${c.name}: ${c.detail}`);
    const header = result.passed
      ? `[sofagent] 训练 dry-run ✅ 通过（可提交 train_submit）——${result.checks.filter((c) => c.status === 'ok').length} 项通过：`
      : `[sofagent] 训练 dry-run ❌ 未通过（先修 fail 项再提交）——待处理：`;
    const body = result.passed ? lines : [...lines.filter((l) => l.includes('✗') || l.includes('⚠')), ...lines.filter((l) => !l.includes('✗') && !l.includes('⚠'))].filter((l, i, a) => a.indexOf(l) === i);

    return {
      text: `${header}\n${body.join('\n')}`,
      data: {
        isError: false,
        ok: true,
        passed: result.passed,
        checks: result.checks,
        ...(result.vramEstimate !== undefined
          ? { vramEstimate: result.vramEstimate as unknown as Record<string, unknown> }
          : {}),
        ...(result.extrapolation !== undefined
          ? { extrapolation: result.extrapolation as unknown as Record<string, unknown> }
          : {}),
        ...(result.nextPilotCompute !== undefined ? { nextPilotCompute: result.nextPilotCompute } : {}),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_dryrun 异常：${msg}`,
      data: { isError: true, ok: false, passed: false, checks: [{ name: 'dryrun', status: 'fail', detail: msg }] },
    };
  }
}
