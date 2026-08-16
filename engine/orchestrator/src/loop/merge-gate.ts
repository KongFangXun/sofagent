// ============================================================
// loop/merge-gate.ts · 并行波次审计卡关 + 合并/丢弃决策（v1.3.5 交付 3）
// ============================================================
//
// 审计节点 = guard edge：每波次并行 SubAgent 完成后统一经审计节点跑
// `git diff` 硬证据卡关（复用 worktree-merge-gate.ts 的 runMergeGate）——
//   全 PASS → merge 回主工作树；
//   任一 FAIL → 丢弃对应 worktree（runMergeGate 内部 cleanup）。
//
// 与 worktree-merge-gate.ts 的关系：
//   worktree-merge-gate = 单 worktree 的审计+合并原语（v1.2.3 交付，不动）
//   本文件 = 波次级聚合：并发跑多个单 worktree 卡关 + 汇总决策
//   （全 merged → 波次通过；任一 rejected → 波次失败）
//
// 零新依赖——纯聚合逻辑，复用既有 runMergeGate。
// ============================================================

import type { WorktreeHandle } from '../worktree-isolation';
import {
  runMergeGate,
  type MergeGateOptions,
  type MergeGateResult,
} from '../worktree-merge-gate';

/** 波次内一个待卡关的 worktree（绑定 taskId 便于结果回填） */
export interface WaveWorktree {
  /** 原始任务标识（与 MergeQueue taskId 对应） */
  taskId: string;
  /** worktree 句柄（SubAgent 独立工作区） */
  handle: WorktreeHandle;
}

/** 波次卡关决策 */
export interface WaveGateDecision {
  /** 波次标识（如 wave-1 / checkpointId） */
  waveId: string;
  /** 是否全 PASS——所有 worktree 都 merged（或 noop/冲突已裁决） */
  allMerged: boolean;
  /** 通过的卡关结果（merged / conflict-resolved / noop） */
  merged: MergeGateResult[];
  /** 被拒绝的卡关结果（rejected / error——审计 FAIL 或卡关自身错误） */
  rejected: MergeGateResult[];
  /** 人类可读汇总 */
  summary: string;
}

/** runWaveMergeGate 入参 */
export interface WaveGateOptions {
  /** 主仓库根目录（默认 process.cwd()） */
  repoRoot?: string;
  /** 任务描述（审计上下文） */
  task?: string;
  /** 主分支 ref（默认自动探测） */
  mainRef?: string;
  /** 单 worktree 卡关函数（可注入 mock——测试不跑真实 git） */
  mergeFn?: (handle: WorktreeHandle, opts?: MergeGateOptions) => Promise<MergeGateResult>;
  /** 日志输出 */
  log?: (msg: string) => void;
}

/** 判定单个卡关结果是否算「通过」 */
export function isMergeGatePass(result: MergeGateResult): boolean {
  return (
    result.status === 'merged' ||
    result.status === 'conflict-resolved' ||
    result.status === 'noop'
  );
}

/**
 * 跑一个并行波次的审计卡关——并发对每个 worktree 执行 runMergeGate，
 * 汇总全 PASS 合并 / 任一 FAIL 丢弃的波次决策。
 *
 * @param waveId 波次标识
 * @param handles 波次内全部待卡关 worktree
 * @param opts 选项（mergeFn 可注入 mock）
 * @returns WaveGateDecision
 */
export async function runWaveMergeGate(
  waveId: string,
  handles: WaveWorktree[],
  opts: WaveGateOptions = {},
): Promise<WaveGateDecision> {
  const log = opts.log ?? (() => {});
  const mergeFn = opts.mergeFn ?? runMergeGate;

  // 并发对每个 worktree 跑审计卡关（guard edge——并行波次统一过审计节点）
  const results = await Promise.all(
    handles.map(async ({ taskId, handle }) => {
      try {
        const result = await mergeFn(handle, {
          repoRoot: opts.repoRoot,
          task: opts.task,
          mainRef: opts.mainRef,
        });
        return { taskId, result };
      } catch (err) {
        // 卡关自身抛异常 → 按 rejected 处理（不静默吞掉）
        const msg = err instanceof Error ? err.message : String(err);
        log(`⛔ wave-gate: ${taskId} 卡关异常：${msg}`);
        return {
          taskId,
          result: {
            status: 'error' as const,
            rejectionReason: `merge-gate 内部错误：${msg}`,
          },
        };
      }
    }),
  );

  const merged = results.filter((r) => isMergeGatePass(r.result)).map((r) => r.result);
  const rejected = results.filter((r) => !isMergeGatePass(r.result)).map((r) => r.result);
  const allMerged = merged.length === handles.length;

  const summary = allMerged
    ? `波次 ${waveId} 卡关全 PASS：${merged.length}/${handles.length} 个 worktree 已合并`
    : `波次 ${waveId} 卡关有 FAIL：${rejected.length}/${handles.length} 个 worktree 被拒绝（已丢弃）`;

  return { waveId, allMerged, merged, rejected, summary };
}
