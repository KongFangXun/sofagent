// ============================================================
// slot-manager.ts · 本地并发槽位信号量 + 排队 + 优先级 + 超时升级（v1.5.4 · 第二章）
// ============================================================
//
// 定位：一体机在线服务面的**本地 GPU 槽位治理**（真实客户诉求：模型全跑在客户
// 自有硬件上，本地推理槽位是稀缺资源）。
//
// 为什么引擎管而非 router / vLLM 管（三层队列边界，不重叠分工）：
//   - router 层管 per-key 限速与云侧 cooldown（防单 key 打爆配额）
//   - **引擎层管本地 GPU 槽位**（本文件——vLLM 双实例无全局视图，router 无 GPU
//     槽位概念，引擎是唯一看得到全局的层）
//   - vLLM 实例层管实例内 continuous batching 微调度
// 排队是**治理策略不是模型能力**——FIFO + 优先级（前台可见排队位置与预估等待）。
//
// 超时升级：排队等待达阈值 → 按合规路由决策**自动提议转云端**（合规允许出门时）
// 或继续等待（信创全封场景）；升级动作留痕 routeReason，可查可举证。
//
// 🔴 判定链不占本地主模型槽位（行为锁，可测）：`kind='decision'` 的取用不计入
// 主模型槽池、不排队、不阻塞——判定链（L1 embedding / DecisionChannel）全程
// 零本地主模型推理请求。
// ============================================================

/** 本地槽位档位（执行档 / 管道档——与 model-registry 的档位同名同语义） */
export type SlotLane = 'executor' | 'pipeline';

/** 排队优先级（高优先在前；同优先级 FIFO） */
export type QueuePriority = 'high' | 'normal' | 'low';

/**
 * 取用类型：
 *   - main-model：本地主模型推理请求（计入槽池、超限排队）
 *   - decision：判定链（embedding / 决策模型）——**不占本地主模型槽**、不排队
 */
export type AcquireKind = 'main-model' | 'decision';

/** 槽位管理器配置 */
export interface SlotManagerConfig {
  /** 本地推理槽位上限（一体机默认 3–5） */
  maxSlots: number;
  /** 排队超时阈值（ms——达阈值触发升级判定） */
  queueTimeoutMs: number;
  /** 平均单次服务时长（ms——用于预估等待） */
  avgServiceMs: number;
  /** 时钟注入（测试确定性用；缺省 Date.now） */
  now?: () => number;
}

/** 缺省配置（一体机默认 5 槽——可配 3–5） */
export const DEFAULT_SLOT_CONFIG: SlotManagerConfig = {
  maxSlots: 5,
  queueTimeoutMs: 30_000,
  avgServiceMs: 5_000,
};

const PRIORITY_RANK: Record<QueuePriority, number> = { high: 0, normal: 1, low: 2 };

/** 取用请求 */
export interface SlotAcquireRequest {
  /** 请求标识（幂等键——同 id 重复取用不重复计数） */
  requestId: string;
  /** 优先级（缺省 normal） */
  priority?: QueuePriority;
  /** 取用类型（缺省 main-model） */
  kind?: AcquireKind;
  /** 档位归属（审计可读） */
  lane?: SlotLane;
}

/** 槽位租约（granted=true） */
export interface SlotLease {
  granted: true;
  requestId: string;
  acquiredAt: number;
  kind: AcquireKind;
  lane?: SlotLane;
}

/** 排队票据（未获槽——前台可见排队位置与预估等待） */
export interface QueueTicket {
  requestId: string;
  priority: QueuePriority;
  kind: AcquireKind;
  lane?: SlotLane;
  enqueuedAt: number;
  /** 排队位置（1-based） */
  position: number;
  /** 预估等待（ms） */
  estimatedWaitMs: number;
}

/** 取用结果（granted 或 queued） */
export type AcquireOutcome = { granted: SlotLease } | { queued: QueueTicket };

/** 等待判定（超时升级决策） */
export interface WaitDecision {
  /** wait 继续等待 / escalate-cloud 提议转云端 */
  action: 'wait' | 'escalate-cloud';
  /** 已等待时长（ms） */
  waitedMs: number;
  /** 判定依据（routeReason 留痕——可查可举证） */
  reason: string;
}

/** 槽位快照（可观测——MCP tool 查询面消费） */
export interface SlotSnapshot {
  maxSlots: number;
  /** 主模型槽在用量 */
  inUse: number;
  /** 空闲主模型槽数 */
  available: number;
  /** 排队深度 */
  queueDepth: number;
  /** 判定链在飞数（不占主模型槽——独立计数） */
  decisionInFlight: number;
  /** 排队明细（前台可见——位置 / 已等待 / 预估等待） */
  queued: Array<{
    requestId: string;
    priority: QueuePriority;
    position: number;
    waitedMs: number;
    estimatedWaitMs: number;
  }>;
  /** 累计计数（行为锁断言面：判定期间主模型授予数应恒为 0） */
  counters: { mainModelGrants: number; decisionGrants: number };
}

/** 槽位配置错误（fail-closed——拒绝在非法配置下运行） */
export class SlotManagerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlotManagerConfigError';
  }
}

/**
 * 槽位管理器可序列化状态（持久化 / 跨进程观测——daemon 持有态，MCP tool 只读快照）。
 */
export interface SlotManagerState {
  maxSlots: number;
  queueTimeoutMs: number;
  avgServiceMs: number;
  /** 主模型槽在用量（租约） */
  leases: Array<{ requestId: string; since: number; lane?: SlotLane }>;
  /** 排队队列 */
  queued: Array<{ requestId: string; priority: QueuePriority; kind: AcquireKind; lane?: SlotLane; enqueuedAt: number }>;
  /** 判定链在飞数 */
  decisionInFlight: number;
  /** 累计计数 */
  counters: { mainModelGrants: number; decisionGrants: number };
}

interface QueueEntry {
  requestId: string;
  priority: QueuePriority;
  kind: AcquireKind;
  lane?: SlotLane;
  enqueuedAt: number;
}

/**
 * 本地槽位信号量（FIFO + 优先级 + 预估等待 + 超时升级判定）。
 *
 * 线程模型：单进程内存态（引擎是唯一全局视图层）；persist/load 供跨进程
 * 观测（daemon 持有态，MCP tool 只读快照）。
 */
export class SlotManager {
  private readonly maxSlots: number;
  private readonly queueTimeoutMs: number;
  private readonly avgServiceMs: number;
  private readonly now: () => number;

  /** 主模型槽在用量（requestId → 租约信息） */
  private readonly inUse = new Map<string, { since: number; lane?: SlotLane }>();
  /** 排队队列（优先级 + FIFO 排序） */
  private readonly queue: QueueEntry[] = [];
  /** 判定链在飞数（不占主模型槽） */
  private decisionInFlight = 0;
  /** 累计计数 */
  private readonly counters = { mainModelGrants: 0, decisionGrants: 0 };

  constructor(config: Partial<SlotManagerConfig> = {}) {
    const merged: SlotManagerConfig = { ...DEFAULT_SLOT_CONFIG, ...config };
    // fail-closed：非法配置拒绝运行（不静默取默认值）
    if (!Number.isInteger(merged.maxSlots) || merged.maxSlots < 1) {
      throw new SlotManagerConfigError(`maxSlots 非法（须为正整数）：${String(merged.maxSlots)}`);
    }
    if (!(merged.queueTimeoutMs > 0)) {
      throw new SlotManagerConfigError(`queueTimeoutMs 非法（须 > 0）：${String(merged.queueTimeoutMs)}`);
    }
    if (!(merged.avgServiceMs > 0)) {
      throw new SlotManagerConfigError(`avgServiceMs 非法（须 > 0）：${String(merged.avgServiceMs)}`);
    }
    this.maxSlots = merged.maxSlots;
    this.queueTimeoutMs = merged.queueTimeoutMs;
    this.avgServiceMs = merged.avgServiceMs;
    this.now = merged.now ?? (() => Date.now());
  }

  /** 预估等待（位置 → ms：`ceil(position/maxSlots) × avgServiceMs`） */
  estimateWaitMs(position: number): number {
    return Math.ceil(position / this.maxSlots) * this.avgServiceMs;
  }

  /**
   * 取用槽位。
   *   - kind='decision'：直接授予（不占主模型槽、不排队——判定链行为锁）
   *   - kind='main-model'：有空槽直接授予，否则入队（优先级 + FIFO）
   */
  acquire(req: SlotAcquireRequest): AcquireOutcome {
    const kind: AcquireKind = req.kind ?? 'main-model';
    const at = this.now();
    if (kind === 'decision') {
      this.decisionInFlight += 1;
      this.counters.decisionGrants += 1;
      return { granted: { granted: true, requestId: req.requestId, acquiredAt: at, kind, ...(req.lane ? { lane: req.lane } : {}) } };
    }
    // 幂等：同 requestId 已在用 → 视为已授予（不重复计数）
    if (this.inUse.has(req.requestId)) {
      return { granted: { granted: true, requestId: req.requestId, acquiredAt: this.inUse.get(req.requestId)!.since, kind } };
    }
    if (this.inUse.size < this.maxSlots) {
      this.inUse.set(req.requestId, { since: at, ...(req.lane ? { lane: req.lane } : {}) });
      this.counters.mainModelGrants += 1;
      return { granted: { granted: true, requestId: req.requestId, acquiredAt: at, kind, ...(req.lane ? { lane: req.lane } : {}) } };
    }
    // 超限 → 入队
    const entry: QueueEntry = {
      requestId: req.requestId,
      priority: req.priority ?? 'normal',
      kind,
      ...(req.lane ? { lane: req.lane } : {}),
      enqueuedAt: at,
    };
    this.insertSorted(entry);
    const position = this.queue.indexOf(entry) + 1;
    return {
      queued: {
        requestId: entry.requestId,
        priority: entry.priority,
        kind: entry.kind,
        ...(entry.lane ? { lane: entry.lane } : {}),
        enqueuedAt: entry.enqueuedAt,
        position,
        estimatedWaitMs: this.estimateWaitMs(position),
      },
    };
  }

  /**
   * 释放槽位（主模型槽或判定链在飞计数）。
   * 释放主模型槽时按优先级 + FIFO 提升队首（提升动作经 justPromoted 暴露）。
   * @returns 释放是否命中（false = 该 requestId 未在任何池中）
   */
  release(requestId: string): boolean {
    if (this.inUse.delete(requestId)) {
      const next = this.queue.shift();
      if (next) {
        const at = this.now();
        this.inUse.set(next.requestId, { since: at, ...(next.lane ? { lane: next.lane } : {}) });
        this.counters.mainModelGrants += 1;
        this.justPromoted = { granted: true, requestId: next.requestId, acquiredAt: at, kind: next.kind, ...(next.lane ? { lane: next.lane } : {}) };
      }
      return true;
    }
    if (this.decisionInFlight > 0) {
      // 判定链释放（无法定位具体 id——仅递减计数）
      this.decisionInFlight -= 1;
      return true;
    }
    return false;
  }

  /** 最近一次因释放而提升的租约（promote 事件读取面；无则 null） */
  justPromoted: SlotLease | null = null;

  /** 排队位置查询（不在队列返回 0） */
  positionOf(requestId: string): number {
    return this.queue.findIndex((e) => e.requestId === requestId) + 1;
  }

  /**
   * 等待判定（超时升级）。
   *
   * - 已获槽 / 未入队 → wait（无需升级）
   * - 等待 ≥ 阈值：合规允许出门 → escalate-cloud（自动提议转云端）；否则继续等待（信创全封）
   * - 等待 < 阈值 → wait
   */
  evaluateWait(requestId: string, opts: { complianceAllowsCloud: boolean }): WaitDecision {
    const entry = this.queue.find((e) => e.requestId === requestId);
    if (!entry) {
      return { action: 'wait', waitedMs: 0, reason: '未在排队（已获槽或未取用）——无需升级' };
    }
    const waitedMs = this.now() - entry.enqueuedAt;
    if (waitedMs >= this.queueTimeoutMs) {
      if (opts.complianceAllowsCloud) {
        return {
          action: 'escalate-cloud',
          waitedMs,
          reason: `排队等待 ${waitedMs}ms ≥ 阈值 ${this.queueTimeoutMs}ms 且合规允许出门——提议转云端`,
        };
      }
      return {
        action: 'wait',
        waitedMs,
        reason: `排队等待 ${waitedMs}ms ≥ 阈值 ${this.queueTimeoutMs}ms 但信创全封（合规不允许出门）——继续等待`,
      };
    }
    return { action: 'wait', waitedMs, reason: `排队等待 ${waitedMs}ms 未达阈值 ${this.queueTimeoutMs}ms——继续等待` };
  }

  /** 槽位快照（可观测） */
  snapshot(): SlotSnapshot {
    const at = this.now();
    return {
      maxSlots: this.maxSlots,
      inUse: this.inUse.size,
      available: Math.max(0, this.maxSlots - this.inUse.size),
      queueDepth: this.queue.length,
      decisionInFlight: this.decisionInFlight,
      queued: this.queue.map((e, i) => ({
        requestId: e.requestId,
        priority: e.priority,
        position: i + 1,
        waitedMs: at - e.enqueuedAt,
        estimatedWaitMs: this.estimateWaitMs(i + 1),
      })),
      counters: { ...this.counters },
    };
  }

  /** 插入排序（优先级升序；同优先级保持 FIFO 稳定序） */
  private insertSorted(entry: QueueEntry): void {
    let i = 0;
    while (
      i < this.queue.length &&
      PRIORITY_RANK[this.queue[i]!.priority] <= PRIORITY_RANK[entry.priority]
    ) {
      i += 1;
    }
    this.queue.splice(i, 0, entry);
  }

  /** 导出可序列化状态（持久化——跨进程观测） */
  toState(): SlotManagerState {
    return {
      maxSlots: this.maxSlots,
      queueTimeoutMs: this.queueTimeoutMs,
      avgServiceMs: this.avgServiceMs,
      leases: [...this.inUse.entries()].map(([requestId, v]) => ({ requestId, since: v.since, ...(v.lane ? { lane: v.lane } : {}) })),
      queued: this.queue.map((e) => ({ requestId: e.requestId, priority: e.priority, kind: e.kind, ...(e.lane ? { lane: e.lane } : {}), enqueuedAt: e.enqueuedAt })),
      decisionInFlight: this.decisionInFlight,
      counters: { ...this.counters },
    };
  }

  /** 从可序列化状态复原（持久化读取——配置面取自 state，时钟可注入） */
  static fromState(state: SlotManagerState, opts: { now?: () => number } = {}): SlotManager {
    const manager = new SlotManager({
      maxSlots: state.maxSlots,
      queueTimeoutMs: state.queueTimeoutMs,
      avgServiceMs: state.avgServiceMs,
      ...(opts.now ? { now: opts.now } : {}),
    });
    for (const lease of state.leases) {
      manager.inUse.set(lease.requestId, { since: lease.since, ...(lease.lane ? { lane: lease.lane } : {}) });
    }
    for (const q of state.queued) {
      manager.queue.push({ requestId: q.requestId, priority: q.priority, kind: q.kind, ...(q.lane ? { lane: q.lane } : {}), enqueuedAt: q.enqueuedAt });
    }
    manager.decisionInFlight = state.decisionInFlight;
    manager.counters.mainModelGrants = state.counters.mainModelGrants;
    manager.counters.decisionGrants = state.counters.decisionGrants;
    return manager;
  }
}
