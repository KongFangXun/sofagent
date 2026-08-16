// ============================================================
// intent-bus.ts · 意图总线（Intent Bus）—— v1.3.5 交付 T02
//
// 意图广播事件总线：Agent 广播「我要做什么」→ 匹配的订阅者触发反应。
// 独立于协议核心（protocol.ts），因为事件总线逻辑（订阅匹配、事件分发、
// 最终一致性窗口）复杂度高，独立便于单测和演进。
//
// 协议设计 §2：事件格式 + glob 订阅匹配 + 收敛窗口
// ============================================================
// ────────────────────────────────────────────────────────────
// Intent 事件格式（协议设计 §2.2）
// ────────────────────────────────────────────────────────────

/** 意图事件——Agent 广播「我要做什么」 */
export interface IntentEvent {
  /** 事件 ID（UUID，幂等去重用） */
  id: string;
  /** 发送者 agentId（v1.3.1 身份码） */
  source: string;
  /** 意图类型（glob 可匹配：intent.create.report / intent.modify.*） */
  intent: string;
  /** 意图目标（操作的文件/实体/key） */
  target: string;
  /** 意图载荷（自由结构——如要创建的报告内容摘要） */
  payload?: unknown;
  /** 发送时间戳（ISO 8601 UTC） */
  ts: string;
  /** 关联团队 ID */
  teamId: string;
}

/** 订阅规则（协议设计 §2.3） */
export interface Subscription {
  /** 订阅者 agentId */
  subscriber: string;
  /** 匹配的意图模式（glob：intent.create.* 匹配所有 create 类意图） */
  pattern: string;
  /** 触发反应的回调（收到匹配意图时调用） */
  onMatch: (event: IntentEvent) => void | Promise<void>;
}

// ────────────────────────────────────────────────────────────
// glob 匹配（复用 minimatch 语义——零新依赖）
// ────────────────────────────────────────────────────────────

/**
 * glob 模式转正则——支持 * 通配符。
 *
 * pattern: "intent.create.*" → 匹配 intent.create.report / intent.create.config 等
 * pattern: "intent.*"        → 匹配所有 intent 类
 * pattern: "intent.create.report" → 精确匹配
 *
 * @param pattern glob 模式
 * @returns 正则表达式
 */
function globToRegex(pattern: string): RegExp {
  // 转义正则特殊字符，仅保留 * 作为通配符
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // 转义正则元字符
    .replace(/\*/g, '.*');                    // * → .*（匹配任意字符序列）
  return new RegExp(`^${escaped}$`);
}

/**
 * 判断意图是否匹配订阅模式。
 *
 * @param pattern 订阅模式（glob）
 * @param intent 意图类型
 * @returns 是否匹配
 */
export function matchIntent(pattern: string, intent: string): boolean {
  return globToRegex(pattern).test(intent);
}

// ────────────────────────────────────────────────────────────
// IntentBus 事件总线（协议设计 §2.4）
// ────────────────────────────────────────────────────────────

/** 收敛回调参数 */
export interface ConvergenceResult {
  /** 收敛窗口内的事件列表 */
  events: IntentEvent[];
  /** 团队 ID */
  teamId: string;
}

/**
 * 意图总线——异步事件广播 + 订阅匹配 + 收敛窗口。
 *
 * 最终一致性窗口：默认 5 秒无新意图即收敛（可配置）。
 * 收敛时触发 onConverged 回调（批量处理窗口内事件）。
 */
export class IntentBus {
  /** 订阅列表 */
  private subscriptions: Subscription[] = [];
  /** 已广播的事件流（按时间顺序） */
  private events: IntentEvent[] = [];
  /** 收敛窗口（ms，默认 5000） */
  private readonly windowMs: number;
  /** 收敛检测定时器 */
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 收敛回调 */
  private convergedCallback: ((result: ConvergenceResult) => void) | undefined;
  /** 当前团队 ID（收敛回调需要） */
  private readonly teamId: string;
  /** 去重集合（已处理的事件 ID） */
  private seenEventIds: Set<string> = new Set();

  constructor(teamId: string, windowMs = 5000) {
    this.teamId = teamId;
    this.windowMs = windowMs;
  }

  /**
   * 订阅意图模式。
   * @param subscription 订阅规则
   */
  subscribe(subscription: Subscription): void {
    this.subscriptions.push(subscription);
  }

  /**
   * 取消订阅。
   * @param subscriber 订阅者 agentId
   * @param pattern 匹配模式（可选——不传则取消该订阅者的全部订阅）
   */
  unsubscribe(subscriber: string, pattern?: string): void {
    this.subscriptions = this.subscriptions.filter(
      (s) => !(s.subscriber === subscriber && (pattern === undefined || s.pattern === pattern)),
    );
  }

  /**
   * 广播意图事件——写入事件流 + 通知匹配的订阅者 + 重置收敛定时器。
   *
   * @param event 意图事件
   */
  broadcast(event: IntentEvent): void {
    // 幂等去重——同一事件 ID 不重复处理
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);

    this.events.push(event);
    this.notifySubscribers(event);
    this.resetConvergenceTimer();
  }

  /**
   * 设置收敛回调。
   * @param cb 收敛时触发的回调
   */
  onConverged(cb: (result: ConvergenceResult) => void): void {
    this.convergedCallback = cb;
  }

  /**
   * 获取所有已广播的事件（只读副本）。
   */
  getEvents(): IntentEvent[] {
    return [...this.events];
  }

  /**
   * 获取当前订阅列表（只读副本）。
   */
  getSubscriptions(): Subscription[] {
    return [...this.subscriptions];
  }

  /**
   * 手动触发收敛检测（测试用——不等待窗口超时）。
   */
  flush(): void {
    this.triggerConvergence();
  }

  /**
   * 关闭总线——清理定时器。
   */
  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // ── 内部方法 ──

  /** 通知匹配该事件的订阅者 */
  private notifySubscribers(event: IntentEvent): void {
    for (const sub of this.subscriptions) {
      if (matchIntent(sub.pattern, event.intent)) {
        // 异步调用——不阻塞广播方
        Promise.resolve(sub.onMatch(event)).catch((err) => {
          console.error(`[intent-bus] 订阅者 ${sub.subscriber} 回调出错: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
  }

  /** 重置收敛定时器——windowMs 内无新事件则触发收敛 */
  private resetConvergenceTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.triggerConvergence();
    }, this.windowMs);
  }

  /** 触发收敛——调用回调并传递窗口内事件 */
  private triggerConvergence(): void {
    if (this.convergedCallback) {
      this.convergedCallback({
        events: [...this.events],
        teamId: this.teamId,
      });
    }
    this.timer = undefined;
  }
}
