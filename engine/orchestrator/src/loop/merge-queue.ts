// ============================================================
// merge-queue.ts · 并行编排 MergeQueue 并发合并（v1.3.1 交付 13）
// ============================================================
//
// 并行编排的并发一致性底座：多个并行 SubAgent（worktree-1/2/3）的产出
// 按**到达序**进入队列（审计节点看实时进度），进模型上下文前按 taskId
// **原始调用序**重排（上下文不被打乱）。
//
// 核心保证（Message Flow & Ordering 适配）：
//   1. 多生产者 → 单消费者：push 即到达序追加，单消费者依次消费
//   2. 流序 = 到达序（给 Human 渲染 / 审计节点看实时进度）
//   3. 上下文序 = 原始调用序（register 登记 taskId 顺序，reordered 重排）
//   4. 配对保证：每个 taskId 恰一个结果——重复 push 拒绝（不丢不乱）
//
// 零新依赖——纯内存数据结构，不引入队列库。
// ============================================================

/** MergeQueue 队列项——一个 SubAgent 任务的一个结果 */
export interface MergeQueueItem<T = unknown> {
  /** 原始任务标识（与 Planner 输出的 taskId 一一对应） */
  taskId: string;
  /** 原始调用序号（register 时分配；重排键） */
  seq: number;
  /** 生产者标识（如 engineer-1 / worktree-1） */
  producer: string;
  /** 任务结果 */
  result: T;
  /** 到达时间（ISO 8601） */
  arrivedAt: string;
}

/** 重复 push 同一 taskId 时的处理策略 */
export type DuplicatePushPolicy = 'reject' | 'replace';

/**
 * MergeQueue——多生产者并发产出合并队列。
 *
 * 用法：
 *   const queue = new MergeQueue<string>();
 *   queue.register('task-1'); queue.register('task-2'); queue.register('task-3'); // 原始调用序
 *   queue.push('task-2', 'engineer-2', '产出B');  // 到达序可能与调用序不同
 *   queue.push('task-1', 'engineer-1', '产出A');
 *   queue.push('task-3', 'engineer-3', '产出C');
 *   queue.arrivalOrder()  // [B, A, C] —— 审计节点看实时进度
 *   queue.reordered()     // [A, B, C] —— 进模型上下文前重排回原始序
 */
export class MergeQueue<T = unknown> {
  /** 到达序队列（push 顺序） */
  private readonly arrival: MergeQueueItem<T>[] = [];
  /** taskId → 原始调用序号 */
  private readonly seqByTaskId = new Map<string, number>();
  /** 下一个可用原始调用序号 */
  private nextSeq = 0;
  /** 重复 push 策略（默认 reject——配对保证：每 taskId 恰一结果） */
  private readonly duplicatePolicy: DuplicatePushPolicy;
  /** 重复 push 被拒绝的次数（可观测） */
  private duplicateRejected = 0;

  constructor(options: { duplicatePolicy?: DuplicatePushPolicy } = {}) {
    this.duplicatePolicy = options.duplicatePolicy ?? 'reject';
  }

  /**
   * 登记 taskId 的原始调用顺序（Planner 决定委派顺序时调用）。
   *
   * 幂等：同一 taskId 重复 register 保留首次序号（原始调用序不因并发到达改变）。
   * 未 register 的 taskId 在首次 push 时自动登记（宽容——生产者先到先得）。
   *
   * @param taskId 原始任务标识
   * @returns 分配到的原始调用序号
   */
  register(taskId: string): number {
    const existing = this.seqByTaskId.get(taskId);
    if (existing !== undefined) return existing;
    const seq = this.nextSeq++;
    this.seqByTaskId.set(taskId, seq);
    return seq;
  }

  /**
   * 生产者推送一个任务结果（到达序入队）。
   *
   * 配对保证：同一 taskId 第二次 push 按策略处理——
   *   reject（默认）→ 拒绝并返回 false（首个结果保留，不丢不乱）；
   *   replace → 覆盖结果但保持原到达位置。
   *
   * @param taskId 原始任务标识
   * @param producer 生产者标识（engineer-1 / worktree-1 等）
   * @param result 任务结果
   * @returns 是否成功入队（false = 重复 push 被拒绝）
   */
  push(taskId: string, producer: string, result: T): boolean {
    const seq = this.register(taskId); // 自动登记（幂等）

    const existingIndex = this.arrival.findIndex((item) => item.taskId === taskId);
    if (existingIndex !== -1) {
      if (this.duplicatePolicy === 'replace') {
        const existing = this.arrival[existingIndex]!;
        this.arrival[existingIndex] = {
          ...existing,
          producer,
          result,
          arrivedAt: new Date().toISOString(),
        };
        return true;
      }
      // reject：配对保证——一个 taskId 恰一个结果
      this.duplicateRejected += 1;
      return false;
    }

    this.arrival.push({
      taskId,
      seq,
      producer,
      result,
      arrivedAt: new Date().toISOString(),
    });
    return true;
  }

  /**
   * 到达序消费——审计节点看实时进度（多生产者产出按完成序 yield）。
   * @returns 按 push 顺序的队列项（不改内部状态）
   */
  arrivalOrder(): MergeQueueItem<T>[] {
    return [...this.arrival];
  }

  /**
   * 原始调用序重排——进模型上下文前调用（上下文序不被打乱）。
   * 未登记/未到达的 taskId 排在最后（宽容：缺失项不阻塞已到达项）。
   * @returns 按原始调用序（seq 升序）的队列项
   */
  reordered(): MergeQueueItem<T>[] {
    return [...this.arrival].sort((a, b) => a.seq - b.seq);
  }

  /**
   * 检查指定 taskId 集合是否全部到达（波次是否完成）。
   * @param taskIds 原始任务标识集合
   * @returns 全部有结果 = true
   */
  isComplete(taskIds: string[]): boolean {
    return taskIds.every((id) => this.arrival.some((item) => item.taskId === id));
  }

  /** 某 taskId 是否已有结果 */
  has(taskId: string): boolean {
    return this.arrival.some((item) => item.taskId === taskId);
  }

  /** 当前队列中的结果数 */
  get size(): number {
    return this.arrival.length;
  }

  /** 已登记的 taskId 数（含未到达的） */
  get registeredCount(): number {
    return this.seqByTaskId.size;
  }

  /** 重复 push 被拒绝的次数（配对保证的观测指标） */
  get rejectedCount(): number {
    return this.duplicateRejected;
  }

  /** 取出并清空全部结果（按到达序；消费后队列为空） */
  drain(): MergeQueueItem<T>[] {
    const items = this.arrival.splice(0, this.arrival.length);
    return items;
  }

  /** 清空队列（保留已登记的原始调用序） */
  clear(): void {
    this.arrival.length = 0;
  }

  /** 完全重置（队列 + 原始调用序全部清空） */
  reset(): void {
    this.arrival.length = 0;
    this.seqByTaskId.clear();
    this.nextSeq = 0;
    this.duplicateRejected = 0;
  }
}
