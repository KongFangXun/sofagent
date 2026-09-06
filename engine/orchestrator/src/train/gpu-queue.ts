// gpu-queue.ts · v1.4.5 第一章 · GPU 显存预算队列（并发不 OOM）
//
// 定位：多训练任务并发时 GPU 显存怎么分——一张 4090 同时跑两个任务会 OOM。
// 本文件按「显存预算」排队：每任务申报所需 MiB，队列按剩余预算决定立即
// 启动 or 排队等待；任务终态（完成/失败/取消）释放预算后队首依序获释。
//
// 对齐 v1.3.7 AsyncSubAgent 模式（spawn 独立进程 + 事件回调），队列本身
// 不 spawn——只做资源账本 + 放行决策（职责单一：调度决策与进程编排分离，
// spawn 仍由 train-scheduler 的 launch 承担）。
//
// 双模式：
//   - 串行模式（concurrency=1 或预算不可知）：同刻至多一个任务在跑
//   - 按预算并发：Σ(在跑任务显存) + 新任务 ≤ 总预算 → 放行，否则排队
//
// 测试纪律：纯内存账本零真实 GPU——预算判定可全量注入测试。

// ════════════════════════════════════════
// 数据模型
// ════════════════════════════════════════

/** 队列中的任务条目（申报显存 + 入队时间） */
export interface GpuQueueEntry {
  jobId: string;
  /** 申报显存（MiB——估算口径：模型大小 × 量化系数 + 激活余量） */
  requiredMiB: number;
  /** 入队时间戳（ms——FIFO 同刻公平） */
  enqueuedAtMs: number;
}

/** 在跑任务条目（占用账本） */
export interface GpuRunningEntry extends GpuQueueEntry {
  /** 获释时间戳（ms——利用率统计口径） */
  startedAtMs: number;
}

/** 队列快照（监控/审计——train_status 消费同源） */
export interface GpuQueueSnapshot {
  /** 队列模式（serial=串行 / budget=按预算并发） */
  mode: 'serial' | 'budget';
  /** 总预算（MiB——budget 模式生效） */
  totalBudgetMiB: number;
  /** 已占用（在跑任务 Σ requiredMiB） */
  allocatedMiB: number;
  /** 剩余可分配 */
  freeMiB: number;
  /** 在跑任务数 */
  runningCount: number;
  /** 排队任务数 */
  queuedCount: number;
  running: GpuRunningEntry[];
  queued: GpuQueueEntry[];
}

/** 获释回调（预算可用时触发——scheduler 的 launch 接线） */
export type GpuSlotRelease = (jobId: string) => void;

/** 队列选项 */
export interface GpuQueueOptions {
  /** 总显存预算（MiB——0 或缺省表示预算不可知 → 串行模式） */
  totalMiB?: number;
  /** 最大并发数上限（缺省 Infinity——防小任务挤爆进程数） */
  maxConcurrent?: number;
  /** 时钟注入（测试） */
  now?: () => number;
}

// ════════════════════════════════════════
// GPU 队列（显存预算账本 + FIFO 放行）
// ════════════════════════════════════════

/**
 * 创建 GPU 显存预算队列。
 *
 * 放行规则：
 *   - serial 模式：在跑数为 0 才放行（一次一个）
 *   - budget 模式：freeMiB ≥ requiredMiB 且并发数未满 → 立即放行；否则入队
 *   - release 时（任务终态）：队首依序检查——预算够就逐个放行（非只放一个）
 *
 * 回调时序：acquire 立即放行或入队后，release 触发队首获释回调
 * （onRelease 在构造时注册——单订阅模型，scheduler 是唯一接线方）。
 */
export function createGpuQueue(options: GpuQueueOptions = {}) {
  const now = options.now ?? Date.now;
  const totalMiB = options.totalMiB ?? 0;
  const mode: 'serial' | 'budget' = totalMiB > 0 ? 'budget' : 'serial';
  const maxConcurrent = options.maxConcurrent ?? Number.POSITIVE_INFINITY;

  const running = new Map<string, GpuRunningEntry>();
  const queued: GpuQueueEntry[] = []; // FIFO（shift 取队首）
  const releaseCallbacks: GpuSlotRelease[] = [];

  const allocatedMiB = (): number =>
    [...running.values()].reduce((sum, r) => sum + r.requiredMiB, 0);

  /** 判定新任务能否立即放行 */
  const canAdmit = (requiredMiB: number): boolean => {
    if (running.size >= maxConcurrent) return false;
    if (mode === 'serial') return running.size === 0;
    return allocatedMiB() + requiredMiB <= totalMiB;
  };

  /** 队首依序获释（release 后调用——预算够就连放） */
  const pump = (): void => {
    while (queued.length > 0) {
      const head = queued[0]!;
      if (!canAdmit(head.requiredMiB)) break;
      queued.shift();
      running.set(head.jobId, { ...head, startedAtMs: now() });
      for (const cb of releaseCallbacks) cb(head.jobId);
    }
  };

  return {
    /**
     * 申请显存额度（提交训练任务时调用）。
     * @returns true = 立即获准（在跑账本已记）；false = 已入队（等待 release 获释）
     *
     * 幂等：同 jobId 已在跑账本（pump 预放行 / 重复 acquire）→ 直接返回 true
     * 不重复占额——否则任务会排在自己后面死锁。
     */
    acquire(jobId: string, requiredMiB: number): boolean {
      if (running.has(jobId)) return true; // pump 预放行的获释路径——已占额
      if (canAdmit(requiredMiB)) {
        running.set(jobId, {
          jobId,
          requiredMiB,
          enqueuedAtMs: now(),
          startedAtMs: now(),
        });
        return true;
      }
      queued.push({ jobId, requiredMiB, enqueuedAtMs: now() });
      return false;
    },

    /**
     * 释放额度（任务终态：completed/failed/cancelled 均调）。
     * 幂等：未在跑任务 release 是安全 no-op。
     */
    release(jobId: string): void {
      const had = running.delete(jobId);
      // 同名任务若也在队中（异常防御——同 jobId 二次 acquire 排队），一并移除
      const qi = queued.findIndex((q) => q.jobId === jobId);
      if (qi !== -1) queued.splice(qi, 1);
      if (had) pump();
    },

    /**
     * 静默释放（清账不泵队）——僵尸收割专用：调度器在 launch 前收割僵尸
     * 额度后立即自己 acquire，若走带 pump 的 release 会把排队任务提前拉进
     * running，随后当前任务 acquire 判定失败 → 永远排在自己后面（死锁）。
     */
    silentRelease(jobId: string): void {
      running.delete(jobId);
    },

    /** 注册获释回调（scheduler launch 接线——预算可用时回调 jobId） */
    onRelease(cb: GpuSlotRelease): void {
      releaseCallbacks.push(cb);
    },

    /** 查询在跑/排队状态（监控面——train_status / dashboard-sink 消费） */
    snapshot(): GpuQueueSnapshot {
      return {
        mode,
        totalBudgetMiB: totalMiB,
        allocatedMiB: allocatedMiB(),
        freeMiB: mode === 'budget' ? totalMiB - allocatedMiB() : 0,
        runningCount: running.size,
        queuedCount: queued.length,
        running: [...running.values()],
        queued: [...queued],
      };
    },

    /** 队列中移除（取消排队任务——不入跑直接撤） */
    dequeue(jobId: string): boolean {
      const idx = queued.findIndex((q) => q.jobId === jobId);
      if (idx === -1) return false;
      queued.splice(idx, 1);
      return true;
    },
  };
}

/** GPU 队列实例类型（调度器注入——对齐 ProcessGuard 注入模式） */
export type GpuQueue = ReturnType<typeof createGpuQueue>;

// ════════════════════════════════════════
// 显存估算（申报口径辅助——scheduler 消费）
// ════════════════════════════════════════

/**
 * 按任务申报估算所需显存（MiB——粗粒度规则，宁可高估不 OOM）。
 *
 * 估算公式：基座参数量（B）× 每参数字节 × 量化系数 + 训练态系数。
 * QLoRA（4bit + LoRA + paged optimizer）：≈ 模型 × 0.5 + 2 GiB 余量
 * 全参 SFT（bf16 + AdamW）：≈ 模型 × 6（权重+梯度+优化器状态）
 *
 * 参数量从 baseModel 名提取（Qwen3-8B → 8；提取失败按 7B 缺省）。
 */
export function estimateTrainVramMiB(
  baseModel: string,
  algorithm: 'sft' | 'dpo' | 'grpo',
  hyperparams?: Record<string, unknown>,
): number {
  const paramsB = Number(/(\d+(?:\.\d+)?)\s*B/i.exec(baseModel)?.[1] ?? 7);
  const isQlora =
    typeof hyperparams?.qlora === 'object' ||
    hyperparams?.load_in_4bit === true ||
    hyperparams?.peft === 'lora';
  const GiB = 1024;
  if (isQlora) {
    // 4bit 量化 + LoRA 参数 + paged 优化器 + 激活余量
    return Math.round(paramsB * 0.5 * GiB + 2 * GiB);
  }
  if (algorithm === 'grpo') {
    // RL 采样组在跑（group_size 个响应同时在显存）——比 SFT 多一档余量
    const groupSize = typeof hyperparams?.group_size === 'number' ? hyperparams.group_size : 8;
    return Math.round(paramsB * 6 * GiB + groupSize * 0.5 * GiB);
  }
  // 全参 SFT/DPO：权重 + 梯度 + 优化器状态（AdamW 双矩量）
  return Math.round(paramsB * 6 * GiB + 2 * GiB);
}
