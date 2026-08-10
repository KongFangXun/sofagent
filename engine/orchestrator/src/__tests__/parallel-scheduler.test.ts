// ============================================================
// parallel-scheduler.test.ts · 并行 SubAgent 调度器测试（v1.3.1 交付 3）
// ============================================================
//
// 覆盖：
// - 波次分发：多任务并发执行（worktree 隔离工厂注入 fake 句柄）
// - 到达序入队：MergeQueue 按完成序 yield + 原始序重排
// - 卡关联动：全 PASS → decision.allMerged=true；任一 FAIL → allMerged=false
// - worktree 创建失败 → 任务标记 error 不崩溃
//
// 测试全部注入 mock（fake worktree + fake SubAgent + fake mergeFn），
// 不跑真实 git / LLM。
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { ParallelScheduler, type ParallelTask } from '../loop/parallel-scheduler';
import type { MergeGateResult } from '../worktree-merge-gate';
import type { WorktreeHandle } from '../worktree-isolation';

/** fake worktree 句柄——记录 create/cleanup 调用，不碰真实 git */
function makeFakeHandle(agentId: string, id = agentId): WorktreeHandle & { created: boolean; cleaned: boolean } {
  return {
    path: `/tmp/fake-worktree/${id}`,
    branch: `sofagent/wt-${id}`,
    agentId,
    created: false,
    cleaned: false,
    async create() {
      this.created = true;
    },
    async cleanup() {
      this.cleaned = true;
    },
    async diff() {
      return `diff of ${id}`;
    },
  };
}

/** 构造 merged 卡关结果 */
function mergedResult(agentId: string, sha = 'abc123'): MergeGateResult {
  return { status: 'merged', mergeCommitSha: sha, auditVerdict: 'PASS', auditReport: 'ok' };
}

/** 构造 rejected 卡关结果 */
function rejectedResult(agentId: string): MergeGateResult {
  return {
    status: 'rejected',
    auditVerdict: 'FAIL',
    auditReport: 'A1 拦截',
    rejectionReason: '审计未通过：A1 拦截',
  };
}

describe('ParallelScheduler · 波次分发（v1.3.1 交付 3）', () => {
  it('分发波次：每个任务独立 worktree + SubAgent 执行 + 结果入队', async () => {
    const handles = new Map<string, WorktreeHandle & { created: boolean; cleaned: boolean }>();
    const executed: string[] = [];

    const scheduler = new ParallelScheduler({
      repoRoot: '/tmp/repo',
      task: '测试波次',
      createWorktreeFn: ((opts: { agentId: string }) => {
        const h = makeFakeHandle(opts.agentId);
        handles.set(opts.agentId, h);
        return h;
      }) as never,
      runSubAgent: async (task, handle) => {
        executed.push(task.taskId);
        expect(handle.path).toContain('fake-worktree'); // worktree 隔离底座生效
        return { status: 'success', output: `产出:${task.taskId}` };
      },
      gateOptions: {
        mergeFn: async (handle) => mergedResult(handle.agentId),
      },
    });

    const tasks: ParallelTask[] = [
      { taskId: 't1', agentId: 'engineer-1', task: '任务1' },
      { taskId: 't2', agentId: 'engineer-2', task: '任务2' },
      { taskId: 't3', agentId: 'engineer-3', task: '任务3' },
    ];

    const wave = await scheduler.dispatchWave(tasks);

    // 全部任务执行
    expect(executed.sort()).toEqual(['t1', 't2', 't3']);
    expect(handles.size).toBe(3);
    // 每个 worktree 都 create 过
    for (const h of handles.values()) {
      expect(h.created).toBe(true);
    }
    // 结果入队（到达序）
    expect(wave.queue.size).toBe(3);
    expect(wave.results).toHaveLength(3);
    // 全 PASS → allMerged
    expect(wave.decision.allMerged).toBe(true);
    expect(wave.decision.merged).toHaveLength(3);
    expect(wave.decision.rejected).toHaveLength(0);
  });

  it('到达序入队 + 原始序重排（MergeQueue 联动）', async () => {
    // 故意让 t2 先完成（模拟并发完成序 ≠ 调用序）
    const scheduler = new ParallelScheduler({
      repoRoot: '/tmp/repo',
      createWorktreeFn: ((opts: { agentId: string }) => makeFakeHandle(opts.agentId)) as never,
      runSubAgent: async (task) => {
        if (task.taskId === 't2') {
          await new Promise((r) => setTimeout(r, 10)); // t2 慢——后到达
        }
        return { status: 'success', output: `产出:${task.taskId}` };
      },
      gateOptions: {
        mergeFn: async (handle) => mergedResult(handle.agentId),
      },
    });

    const tasks: ParallelTask[] = [
      { taskId: 't1', agentId: 'engineer-1', task: '任务1' },
      { taskId: 't2', agentId: 'engineer-2', task: '任务2' },
    ];
    const wave = await scheduler.dispatchWave(tasks);

    // 到达序 = 完成序（t1 先到达）
    const arrival = wave.queue.arrivalOrder().map((i) => i.result.taskId);
    expect(arrival).toEqual(['t1', 't2']);
    // 原始序重排 = 调用序
    const reordered = wave.queue.reordered().map((i) => i.result.taskId);
    expect(reordered).toEqual(['t1', 't2']);
  });

  it('任一 SubAgent FAIL → 该 worktree 不进卡关（不 merge 失败产出）', async () => {
    const gateCalls: string[] = [];
    const scheduler = new ParallelScheduler({
      repoRoot: '/tmp/repo',
      createWorktreeFn: ((opts: { agentId: string }) => makeFakeHandle(opts.agentId)) as never,
      runSubAgent: async (task) => {
        if (task.taskId === 't2') {
          return { status: 'error', output: '', error: 'SubAgent 崩溃' };
        }
        return { status: 'success', output: 'ok' };
      },
      gateOptions: {
        mergeFn: async (handle) => {
          gateCalls.push(handle.agentId);
          return mergedResult(handle.agentId);
        },
      },
    });

    const wave = await scheduler.dispatchWave([
      { taskId: 't1', agentId: 'engineer-1', task: '任务1' },
      { taskId: 't2', agentId: 'engineer-2', task: '任务2' },
    ]);

    // 失败的 t2 不进卡关（guard edge 只审成功产出）
    expect(gateCalls).toEqual(['engineer-1']);
    const t2 = wave.results.find((r) => r.taskId === 't2');
    expect(t2?.status).toBe('error');
    // 队列仍含 t2 结果（供审计可见失败）
    expect(wave.queue.has('t2')).toBe(true);
  });

  it('波次卡关任一 FAIL → allMerged=false（审计 FAIL 丢弃对应 worktree）', async () => {
    const scheduler = new ParallelScheduler({
      repoRoot: '/tmp/repo',
      createWorktreeFn: ((opts: { agentId: string }) => makeFakeHandle(opts.agentId)) as never,
      runSubAgent: async (task) => ({ status: 'success', output: 'ok' }),
      gateOptions: {
        mergeFn: async (handle) => {
          if (handle.agentId === 'engineer-2') {
            return rejectedResult(handle.agentId);
          }
          return mergedResult(handle.agentId);
        },
      },
    });

    const wave = await scheduler.dispatchWave([
      { taskId: 't1', agentId: 'engineer-1', task: '任务1' },
      { taskId: 't2', agentId: 'engineer-2', task: '任务2' },
      { taskId: 't3', agentId: 'engineer-3', task: '任务3' },
    ]);

    expect(wave.decision.allMerged).toBe(false);
    expect(wave.decision.merged).toHaveLength(2);
    expect(wave.decision.rejected).toHaveLength(1);
    expect(wave.decision.rejected[0]?.status).toBe('rejected');
  });

  it('worktree 创建失败 → 任务标记 error，不崩溃', async () => {
    const scheduler = new ParallelScheduler({
      repoRoot: '/tmp/repo',
      createWorktreeFn: (() => {
        throw new Error('git worktree 不可用');
      }) as never,
      runSubAgent: async () => ({ status: 'success', output: 'should-not-run' }),
    });

    const wave = await scheduler.dispatchWave([
      { taskId: 't1', agentId: 'engineer-1', task: '任务1' },
    ]);

    const t1 = wave.results.find((r) => r.taskId === 't1');
    expect(t1?.status).toBe('error');
    expect(t1?.error).toContain('worktree 创建失败');
    // 队列含失败结果
    expect(wave.queue.size).toBe(1);
  });

  it('未注入 runSubAgent → 调度器抛错（不静默内置 LLM 调用）', async () => {
    const scheduler = new ParallelScheduler({
      repoRoot: '/tmp/repo',
      createWorktreeFn: ((opts: { agentId: string }) => makeFakeHandle(opts.agentId)) as never,
    });
    // dispatchWave 内部 Promise.all 会捕获？不——runSubAgent 在任务内执行，异常被 catch 成 error 结果
    const wave = await scheduler.dispatchWave([
      { taskId: 't1', agentId: 'engineer-1', task: '任务1' },
    ]);
    // 默认 runSubAgent 抛错 → 任务标记 error（调度器不崩溃）
    expect(wave.results[0]?.status).toBe('error');
    expect(wave.results[0]?.error).toContain('runSubAgent 未注入');
  });
});

describe('ParallelScheduler · 并发上限（maxConcurrency）', () => {
  it('并发窗口限制在 maxConcurrency 内', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const scheduler = new ParallelScheduler({
      repoRoot: '/tmp/repo',
      maxConcurrency: 2,
      createWorktreeFn: ((opts: { agentId: string }) => makeFakeHandle(opts.agentId)) as never,
      runSubAgent: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { status: 'success', output: 'ok' };
      },
      gateOptions: { mergeFn: async (h) => mergedResult(h.agentId) },
    });

    const wave = await scheduler.dispatchWave([
      { taskId: 't1', agentId: 'engineer-1', task: '任务1' },
      { taskId: 't2', agentId: 'engineer-2', task: '任务2' },
      { taskId: 't3', agentId: 'engineer-3', task: '任务3' },
      { taskId: 't4', agentId: 'engineer-4', task: '任务4' },
    ]);

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(wave.results).toHaveLength(4);
  });
});

describe('ParallelScheduler · graph 集成节点依赖', () => {
  it('导出类型可被 graph.ts 消费（ParallelTask 形状）', () => {
    const task: ParallelTask = { taskId: 'x', agentId: 'engineer-1', task: 'y' };
    expect(task.taskId).toBe('x');
    expect(task.agentId).toBe('engineer-1');
    expect(task.task).toBe('y');
  });
});
