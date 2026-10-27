// ============================================================
// loop/merge-gate.ts · 并行波次审计卡关 + 合并/丢弃决策（v1.3.7 交付 3）
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
  /** v1.8.0：该波次原始任务总数（含执行失败未进卡关者）——allMerged 分母。
   *  未传时回退 handles.length（兼容直接调用方；波次路径必须传 results.length） */
  totalTasks?: number;
}

/** 判定单个卡关结果是否算「通过」
 *  v1.8.0：conflict-resolved 区分 resolution——incumbent-wins 的语义是
 *  「incoming 让步丢弃、通知重试」，对 incoming 而言是未合并（产出被丢弃
 *  却计入已合并 = 假成功）；incoming-wins/merged/noop 维持通过语义 */
export function isMergeGatePass(result: MergeGateResult): boolean {
  if (result.status === 'conflict-resolved') {
    return result.conflict?.resolution !== 'incumbent-wins';
  }
  return (
    result.status === 'merged' ||
    result.status === 'noop'
  );
}

/**
 * 跑一个并行波次的审计卡关——并发对每个 worktree 执行 runMergeGate，
 * 汇总全 PASS 合并 / 任一 FAIL 丢弃的波次决策。
 *
 * v1.8.0 修复（波次假 PASS）：新增 totalTasks 形参——分母改用原始任务数而非
 * 「进入卡关的任务数」。旧实现 allMerged = merged.length === handles.length，
 * 而 handles 是调度侧已排除失败任务后的子集（parallel-scheduler 只收成功任务），
 * 于是「一败一成」报「全 PASS：1/1」、「全败」报「全 PASS：0/0」（空数组 0===0
 * 也满足）——失败被汇总层包装成成功。空波次（totalTasks===0）不再进卡关语义，
 * 短路返回显式 NO-OP。
 *
 * @param waveId 波次标识
 * @param handles 波次内全部待卡关 worktree
 * @param opts 选项（mergeFn 可注入 mock）；totalTasks = 该波次原始任务总数
 * @returns WaveGateDecision
 */
export async function runWaveMergeGate(
  waveId: string,
  handles: WaveWorktree[],
  opts: WaveGateOptions = {},
): Promise<WaveGateDecision> {
  const log = opts.log ?? (() => {});
  const mergeFn = opts.mergeFn ?? runMergeGate;
  // v1.8.0：分母取原始任务数——未显式传入时回退 handles.length（兼容既有
  // 直接调用方；波次路径必须传 results.length，见 parallel-scheduler 调用点）
  const totalTasks = opts.totalTasks ?? handles.length;

  // 空波次显式 NO-OP：无任务即无卡关对象，不进入「0===0 全 PASS」语义
  if (totalTasks === 0) {
    return {
      waveId,
      allMerged: false,
      merged: [],
      rejected: [],
      summary: `波次 ${waveId} 空任务——无卡关对象（NO-OP）`,
    };
  }

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
  // v1.8.0：分母 = 原始任务数（totalTasks）且必须 > 0——handles 只含进入卡关的
  // 任务（调度侧已排除失败者），拿 handles.length 当分母会把「失败被排除」洗成全过
  const allMerged = merged.length === totalTasks && totalTasks > 0;

  const summary = allMerged
    ? `波次 ${waveId} 卡关全 PASS：${merged.length}/${totalTasks} 个 worktree 已合并`
    : `波次 ${waveId} 卡关有 FAIL：${rejected.length}/${totalTasks} 个被拒绝（已丢弃）${handles.length < totalTasks ? `，另有 ${totalTasks - handles.length} 个任务未进卡关（执行失败/无 worktree——计入分母）` : ''}`;

  return { waveId, allMerged, merged, rejected, summary };
}
