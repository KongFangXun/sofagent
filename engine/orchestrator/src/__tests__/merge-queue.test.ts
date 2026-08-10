// ============================================================
// merge-queue.test.ts · MergeQueue 并发合并测试（v1.3.1 交付 13）
// ============================================================
//
// 覆盖：
// - 并发合并：多生产者按到达序 yield（与原始调用序不同）
// - 顺序重排：进模型上下文前重排回原始 taskId 调用序
// - 配对保证：每个 taskId 恰一个结果——重复 push 拒绝（默认策略）
// - register 幂等 + 自动登记 + isComplete 波次完成判定
// ============================================================

import { describe, it, expect } from 'vitest';
import { MergeQueue } from '../loop/merge-queue';

describe('MergeQueue · 并发合并（v1.3.1 交付 13）', () => {
  it('多生产者按到达序 yield（到达序 ≠ 原始调用序）', () => {
    const queue = new MergeQueue<string>();
    // Planner 原始调用序：task-1 → task-2 → task-3
    queue.register('task-1');
    queue.register('task-2');
    queue.register('task-3');

    // 并发完成序与调用序不同：task-2 先到达，task-1 其次，task-3 最后
    queue.push('task-2', 'engineer-2', '产出B');
    queue.push('task-1', 'engineer-1', '产出A');
    queue.push('task-3', 'engineer-3', '产出C');

    // 到达序 = push 顺序（审计节点看实时进度）
    const arrival = queue.arrivalOrder().map((i) => i.result);
    expect(arrival).toEqual(['产出B', '产出A', '产出C']);
    expect(queue.size).toBe(3);
  });

  it('进模型上下文前重排回原始调用序', () => {
    const queue = new MergeQueue<string>();
    queue.register('task-1');
    queue.register('task-2');
    queue.register('task-3');

    queue.push('task-3', 'engineer-3', '产出C');
    queue.push('task-1', 'engineer-1', '产出A');
    queue.push('task-2', 'engineer-2', '产出B');

    const reordered = queue.reordered().map((i) => i.result);
    expect(reordered).toEqual(['产出A', '产出B', '产出C']);
  });

  it('配对保证：重复 push 同一 taskId 被拒绝（默认 reject 策略）', () => {
    const queue = new MergeQueue<string>();
    queue.register('task-1');

    const first = queue.push('task-1', 'engineer-1', '首个结果');
    const dup = queue.push('task-1', 'engineer-1', '重复结果');

    expect(first).toBe(true);
    expect(dup).toBe(false);
    expect(queue.size).toBe(1); // 不丢不乱
    expect(queue.rejectedCount).toBe(1);
    // 首个结果保留
    expect(queue.arrivalOrder()[0]?.result).toBe('首个结果');
  });

  it('配对保证：replace 策略覆盖结果但保持到达位置', () => {
    const queue = new MergeQueue<string>({ duplicatePolicy: 'replace' });
    queue.register('task-1');
    queue.push('task-1', 'engineer-1', '旧结果');
    queue.push('task-1', 'engineer-1', '新结果');

    expect(queue.size).toBe(1);
    expect(queue.arrivalOrder()[0]?.result).toBe('新结果');
  });

  it('register 幂等：重复登记保留首次序号', () => {
    const queue = new MergeQueue<string>();
    const seq1 = queue.register('task-1');
    const seq2 = queue.register('task-1');
    expect(seq1).toBe(seq2);
    expect(queue.registeredCount).toBe(1);
  });

  it('未 register 的 taskId 首次 push 自动登记（宽容）', () => {
    const queue = new MergeQueue<string>();
    queue.push('orphan-task', 'engineer-9', '产出X');
    expect(queue.has('orphan-task')).toBe(true);
    expect(queue.registeredCount).toBe(1);
    expect(queue.arrivalOrder()[0]?.producer).toBe('engineer-9');
  });

  it('isComplete：全部 taskId 有结果 = 波次完成', () => {
    const queue = new MergeQueue<string>();
    const taskIds = ['task-1', 'task-2', 'task-3'];
    queue.register('task-1');
    queue.register('task-2');
    queue.register('task-3');

    expect(queue.isComplete(taskIds)).toBe(false);
    queue.push('task-1', 'e1', 'A');
    queue.push('task-2', 'e2', 'B');
    expect(queue.isComplete(taskIds)).toBe(false);
    queue.push('task-3', 'e3', 'C');
    expect(queue.isComplete(taskIds)).toBe(true);
  });

  it('drain 消费后队列清空；reset 连原始调用序一起清', () => {
    const queue = new MergeQueue<string>();
    queue.register('task-1');
    queue.push('task-1', 'e1', 'A');

    const drained = queue.drain();
    expect(drained).toHaveLength(1);
    expect(queue.size).toBe(0);
    // registeredCount 保留（drain 只清结果）
    expect(queue.registeredCount).toBe(1);

    queue.reset();
    expect(queue.registeredCount).toBe(0);
    expect(queue.rejectedCount).toBe(0);
  });
});
