// ============================================================
// loop/parallel-scheduler.ts · 并行 SubAgent 调度器（v1.3.6 交付 3）
// ============================================================
//
// 并行编排波次调度：多 Engineer（worktree-1/2/3）并发分发——
//   Planner 产出波次任务 → 本调度器为每个任务创建独立 git worktree
//   → 并发执行 SubAgent（受 maxConcurrency 限制）→ 产出按**到达序**
//   推入 MergeQueue（审计节点看实时进度）→ 全部完成后统一送
//   波次审计卡关（merge-gate）→ 全 PASS 合并 / 任一 FAIL 丢弃。
//
// 与设计文档 Send API 的关系：
//   LangGraph Send API 的波次扇出语义（Planner → Send → Engineer-A/B/C）
//   在本调度器内以 Promise.all + worktree 隔离实现同等并发分发——
//   图节点（parallel_wave）只负责调用 dispatchWave，波次本身与
//   模型调用解耦，可在无 LLM 环境单测。
//
// 隔离底座复用 v1.2.3：createWorktree（git worktree 三原语）。
// 零新依赖。
// ============================================================

import { createWorktree, type WorktreeHandle } from '../worktree-isolation';
import { MergeQueue, type MergeQueueItem } from './merge-queue';
import {
  runWaveMergeGate,
  type WaveGateDecision,
  type WaveWorktree,
  type WaveGateOptions,
} from './merge-gate';

/** 波次内一个并行任务（Planner 产出 → 一个 Engineer worktree） */
export interface ParallelTask {
  /** 原始任务标识（与 MergeQueue taskId 对应，决定上下文重排序） */
  taskId: string;
  /** SubAgent 标识（如 engineer-1 / engineer-2） */
  agentId: string;
  /** 任务描述 */
  task: string;
  /** 职责域（conflict-resolver 仲裁输入，可选） */
  responsibilityScope?: string[];
}

/** 单任务执行结果 */
export interface ParallelTaskResult {
  /** 原始任务标识 */
  taskId: string;
  /** SubAgent 标识 */
  agentId: string;
  /** 执行状态 */
  status: 'success' | 'error';
  /** 产出摘要（成功时） */
  output: string;
  /** worktree 路径（成功时；失败可能未创建） */
  worktreePath?: string;
  /** 错误信息（失败时） */
  error?: string;
}

/** 波次调度结果 */
export interface ParallelWaveResult {
  /** 波次内全部任务结果（到达序 = MergeQueue 消费序） */
  results: ParallelTaskResult[];
  /** 波次审计卡关决策（全 PASS 合并 / 任一 FAIL 丢弃） */
  decision: WaveGateDecision;
  /** 本波次的 MergeQueue（可继续消费重排） */
  queue: MergeQueue<ParallelTaskResult>;
}

/** ParallelScheduler 选项 */
export interface ParallelSchedulerOptions {
  /** 主仓库根目录（默认 process.cwd()） */
  repoRoot?: string;
  /** 任务描述（审计上下文，merge-gate 透传） */
  task?: string;
  /** 并发上限（默认 3——Engineer-A/B/C 三波次） */
  maxConcurrency?: number;
  /** MergeQueue 注入（测试可传入共享队列；默认新建） */
  queue?: MergeQueue<ParallelTaskResult>;
  /** worktree 工厂（可注入 mock 句柄——测试不跑真实 git） */
  createWorktreeFn?: typeof createWorktree;
  /** SubAgent 执行函数（可注入 mock——测试不调 LLM） */
  runSubAgent?: (task: ParallelTask, handle: WorktreeHandle) => Promise<{ status: 'success' | 'error'; output: string; error?: string }>;
  /** 波次卡关选项（mergeFn 可注入 mock——测试不跑真实 git merge） */
  gateOptions?: WaveGateOptions;
  /** 日志输出 */
  log?: (msg: string) => void;
}

/**
 * 并行 SubAgent 调度器——一个波次的并发分发 + 审计卡关。
 */
export class ParallelScheduler {
  private readonly repoRoot: string;
  private readonly task: string;
  private readonly maxConcurrency: number;
  private readonly queue: MergeQueue<ParallelTaskResult>;
  private readonly createWorktreeFn: typeof createWorktree;
  private readonly runSubAgent: NonNullable<ParallelSchedulerOptions['runSubAgent']>;
  private readonly gateOptions: WaveGateOptions;
  private readonly log: (msg: string) => void;

  constructor(opts: ParallelSchedulerOptions = {}) {
    this.repoRoot = opts.repoRoot ?? process.cwd();
    this.task = opts.task ?? '';
    this.maxConcurrency = opts.maxConcurrency ?? 3;
    this.queue = opts.queue ?? new MergeQueue<ParallelTaskResult>();
    this.createWorktreeFn = opts.createWorktreeFn ?? createWorktree;
    this.gateOptions = opts.gateOptions ?? {};
    this.log = opts.log ?? (() => {});
    // 默认 SubAgent 执行：调用方注入；未注入时抛错（调度器不内置 LLM 调用）
    this.runSubAgent =
      opts.runSubAgent ??
      (() => {
        throw new Error(
          'ParallelScheduler.runSubAgent 未注入——并行波次需要调用方提供 SubAgent 执行函数（避免调度器内置 LLM 调用）',
        );
      });
  }

  /** 当前 MergeQueue（波次消费/重排入口） */
  getMergeQueue(): MergeQueue<ParallelTaskResult> {
    return this.queue;
  }

  /**
   * 分发一个并行波次。
   *
   * 流程：
   *   1. 按 Planner 输出顺序登记全部 taskId（原始调用序）
   *   2. 为每个任务创建独立 worktree（隔离底座）
   *   3. 受限并发执行 SubAgent（到达序推入 MergeQueue）
   *   4. 全部完成后统一送波次审计卡关（guard edge）
   *
   * @param tasks 波次任务列表（数组序 = 原始调用序）
   * @returns ParallelWaveResult
   */
  async dispatchWave(tasks: ParallelTask[]): Promise<ParallelWaveResult> {
    // 1. 登记原始调用序（Planner 输出顺序）
    for (const t of tasks) {
      this.queue.register(t.taskId);
    }

    // 2. 并发创建 worktree（隔离底座）
    const handles = new Map<string, WorktreeHandle>();
    await Promise.all(
      tasks.map(async (t) => {
        try {
          const handle = this.createWorktreeFn({
            agentId: t.agentId,
            repoRoot: this.repoRoot,
            ...(t.responsibilityScope ? { responsibilityScope: t.responsibilityScope } : {}),
          });
          await handle.create();
          handles.set(t.taskId, handle);
        } catch (err) {
          this.log(`⚠️ parallel-scheduler: ${t.taskId} worktree 创建失败：${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );

    // 3. 受限并发执行 SubAgent（到达序入队）
    const results: ParallelTaskResult[] = await this.runConcurrent(tasks, async (t) => {
      const handle = handles.get(t.taskId);
      const base: ParallelTaskResult = {
        taskId: t.taskId,
        agentId: t.agentId,
        status: 'error',
        output: '',
        ...(handle ? { worktreePath: handle.path } : {}),
      };
      if (!handle) {
        base.error = 'worktree 创建失败，任务未执行';
        this.queue.push(t.taskId, t.agentId, base);
        return base;
      }
      try {
        const r = await this.runSubAgent(t, handle);
        const result: ParallelTaskResult = {
          ...base,
          status: r.status,
          output: r.output,
          ...(r.error ? { error: r.error } : {}),
        };
        // 到达序入队——审计节点消费实时进度
        this.queue.push(t.taskId, t.agentId, result);
        return result;
      } catch (err) {
        const result: ParallelTaskResult = {
          ...base,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        };
        this.queue.push(t.taskId, t.agentId, result);
        return result;
      }
    });

    // 4. 统一送波次审计卡关（仅对成功且有 worktree 的任务）
    const waveWorktrees: WaveWorktree[] = [];
    for (const r of results) {
      const handle = handles.get(r.taskId);
      if (r.status === 'success' && handle) {
        waveWorktrees.push({ taskId: r.taskId, handle });
      }
    }
    const waveId = `wave-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const decision = await runWaveMergeGate(waveId, waveWorktrees, {
      ...this.gateOptions,
      repoRoot: this.repoRoot,
      task: this.task || undefined,
      log: this.log,
    });
    this.log(`🏁 parallel-scheduler: ${decision.summary}`);

    return { results, decision, queue: this.queue };
  }

  /** 受限并发执行器（maxConcurrency 滑动窗口） */
  private async runConcurrent<T>(
    items: T[],
    fn: (item: T) => Promise<ParallelTaskResult>,
  ): Promise<ParallelTaskResult[]> {
    const results = new Array<ParallelTaskResult>(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.maxConcurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]!);
      }
    });
    await Promise.all(workers);
    return results;
  }
}
