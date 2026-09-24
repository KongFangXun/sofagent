// ============================================================
// events/bus.ts · 轻量事件总线（v1.5.2 第一章新建）
// ============================================================
//
// 形态：进程内 pub/sub + 落盘事件队列 + HMAC 投递留痕 + 死信队列（可重放）。
//
// 三个「留痕/可靠性」设计要点：
//   1. **落盘事件队列**：每个事件进总线即 append 到
//      `{dataDir}/events/event-queue.jsonl`（HMAC 链，kindField='type'）——
//      进程崩溃后事件不丢。⚠️ 队列链**当前无验链消费点**：`verifyChain(queue)`
//      是内核具备的能力，但本仓无任何调用方对它验链（`verifyEventTrail()`
//      只验 `delivery-trail.jsonl`；`traceEvent()` 只按 correlationId 读队列）。
//      即「队列可验链」目前是**能力**而非**已装配的校验面**——接线属后续版本落点。
//   2. **投递全程留痕**：每次投递结局（DELIVERED / FAILED / DEAD_LETTER /
//      REPLAYED）写 `{dataDir}/events/delivery-trail.jsonl`（HMAC 链），
//      条目带 correlationId（触发链根）+ causationId（父事件）——每条事件
//      触发链可追溯；`traceEvent()` 还原链条，`verifyEventTrail()` 验链。
//   3. **死信与重试复用 v1.3.1**：失败经 @sofagent/core 的 classifyError
//      六值分类 + isRetryableStopReason 判定可重试性 + backoffDelayMs 取退避
//      延时——不另造错误分类与退避表。死信落 `{dataDir}/events/dead-letter.jsonl`
//      （HMAC 链，kindField='stopReason'，白名单 = stop_reason 六值）。
//
// 🔴 注册点：总线实例由调用方创建并持有。事件源适配器（adapters.ts）与
//    路由（router.ts）通过 bus.subscribe() 挂载；第三章异常总线经
//    bus.sendToDeadLetter() 复用本文件的死信通道（不新建第二套死信机制）。
//
// 🔴 事件类型门：落盘用链内核的 kind 门（kindField='type'，白名单 =
//    REGISTERED_EVENT_TYPES）——未登记类型**拒绝落盘**（拼错/未登记的事件
//    永不触发是静默失效，故 fail-loud；新增事件类型请扩 types.ts 注册表）。
//
// ── v1.5.2 第三章：派发前置 should-run 判定链 ──
//    `publish()` 在 `appendEvent`（落盘）与 `deliver`（投递）之间插入可选判定点
//    （`EventBusOptions.shouldRunGate`，判定链实现见 ./should-run.ts）。判定为
//    挂起时：**不投递、不进死信**（死信是异常的唯一入口，挂起不是异常），挂起
//    原因落 decision-log（ORCHESTRATION/skip/ACT），事件入 pending 队列等条件满足
//    后自动恢复。未注入 gate 时该步整体跳过——行为与 v1.5.1 完全一致。
//    🔴 挂起事件**在判定前已落盘**（appendEvent 先于判定）——挂起只影响「派发
//       调度态」，事件本身不丢；恢复即重新判定并投递。
// ============================================================

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { emitDecision } from '@sofagent/audit';
import { appendChained, verifyChain, type ChainCheckResult } from '@sofagent/audit';
import {
  backoffDelayMs,
  classifyError,
  getDataDir,
  getEnvFingerprint,
  getHmacKey,
  isRetryableStopReason,
  type StopReason,
} from '@sofagent/core';
import {
  REGISTERED_EVENT_TYPES,
  type DeadLetterEntry,
  type DeliveryOutcome,
  type DeliveryRecord,
  type EventPublishInput,
  type EventPublishResult,
  type SofagentEvent,
} from './types';
import type { ShouldRunGate, ShouldRunSuspension } from './should-run';

/** 投递留痕条目的 kind 白名单（链内核 kind 门取值） */
const DELIVERY_OUTCOMES: readonly string[] = ['DELIVERED', 'FAILED', 'DEAD_LETTER', 'REPLAYED'];

/** stop_reason 六值白名单（死信链 kind 门取值——复用 v1.3.1 分类，不新造值） */
const STOP_REASONS: readonly string[] = ['completed', 'aborted', 'timeout', 'malformed', 'failed', 'auth'];

/** 事件处理器——返回 Promise 以支持异步节点执行 */
export type EventHandler = (event: SofagentEvent) => void | Promise<void>;

/** 订阅句柄 */
export interface EventSubscriptionHandle {
  /** 订阅的事件类型（'*' = 通配） */
  type: string;
  /** 处理器 */
  handler: EventHandler;
}

/** 总线构造选项 */
export interface EventBusOptions {
  /** 数据目录覆盖（缺省走 getDataDir()——显式 > SOFAGENT_DATA > 默认） */
  dataDir?: string;
  /**
   * 事件处理失败时的**内联重试**次数（缺省 1）。
   *
   * 语义边界：内联重试只吃「进程内马上能恢复」的抖动（≤1 次，退避取
   * backoffDelayMs(0)）；重试次数耗尽或不可重试（auth/aborted）→ 进死信队列，
   * 后续按 backoffDelayMs 阶梯重放。默认值刻意压小——总线是同步投递，
   * 长时间占线会顶住发布方。
   */
  maxRetries?: number;
  /** 退避等待注入（测试传 no-op 实现零等待；缺省真 setTimeout） */
  sleep?: (ms: number) => Promise<void>;
  /** 时钟注入（测试可固定时刻） */
  now?: () => Date;
  /** 事件 id 生成注入（测试可固定 id） */
  newId?: () => string;
  /**
   * 事件路由决策的留痕上下文（kind=ORCHESTRATION 的 emitDecision）。
   * 缺省 `{ agentId: 'orchestrator:events' }`（sessionId 取事件 correlationId）；
   * 传 `false` 关闭决策留痕（纯流量场景——投递链留痕不受影响）。
   */
  decisionContext?: { agentId: string; sessionId?: string } | false;
  /**
   * v1.5.2 第三章：派发前置「五问」判定链（should-run）。
   *
   * 调用时机：`publish()` 落盘队列之后、投递订阅者之前。判定为挂起时——
   *   · **不投递**给任何订阅者；
   *   · **绝不进死信通道**（死信是异常的唯一入口，挂起不是异常）；
   *   · 挂起原因落 decision-log（kind=ORCHESTRATION / category=skip / moment=ACT）；
   *   · 事件进 pending 队列，由后续 `publish()` 或显式 `resumePending()`
   *     重新判定，条件满足则**自动恢复投递**。
   *
   * **缺省不注入 = 行为与 v1.5.1 完全一致（零行为变化）。**
   */
  shouldRunGate?: ShouldRunGate;
}

/**
 * 挂起等待恢复的派发（v1.5.2 第三章）。
 *
 * 挂起事件**已落盘**到事件队列（`appendEvent` 在判定前执行）——挂起态只是
 * 「派发调度态」，事件本身不丢；恢复即按此记录重新判定并投递。
 */
export interface PendingDispatch {
  /** 被挂起的事件（attempt=1，尚未投递） */
  event: SofagentEvent;
  /** 挂起详情（不通过的那一问 + 原因 + 恢复提示） */
  suspension: ShouldRunSuspension;
  /** 挂起时刻（ISO 8601） */
  suspendedAt: string;
  /** 该挂起对应的决策留痕 ts（decision-log 可查） */
  decisionTs?: string;
}

/** 死信入队入参（第三章异常总线复用本通道时的附加标记） */
export interface DeadLetterInput {
  /** 投递失败的节点 */
  nodeId?: string;
  /** 失败原因（缺省取 event 元数据） */
  error?: string;
  /** 已显式分类的 stop_reason（缺省按 error 现场分类） */
  stopReason?: StopReason;
  /** 已尝试次数 */
  attempts?: number;
  /** 关联的决策条目 ts（异常总线写入的决策） */
  decisionTs?: string;
  /** 异常分类（第三章：retryable / needs-human / needs-rollback） */
  anomalyClass?: string;
}

/**
 * 事件总线——进程内 pub/sub + 落盘队列 + 投递留痕 + 死信。
 */
export class EventBus {
  readonly dataDir: string;
  private readonly eventsDir: string;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly decisionContext: { agentId: string; sessionId?: string } | false;
  private readonly shouldRunGate?: ShouldRunGate;
  private readonly subscriptions: EventSubscriptionHandle[] = [];
  /** 挂起等待恢复的派发（v1.5.2 第三章——挂起非失败，条件满足自动恢复） */
  private pending: PendingDispatch[] = [];

  constructor(options: EventBusOptions = {}) {
    this.dataDir = getDataDir(options.dataDir);
    this.eventsDir = join(this.dataDir, 'events');
    this.maxRetries = options.maxRetries ?? 1;
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
    this.decisionContext = options.decisionContext ?? { agentId: 'orchestrator:events' };
    this.shouldRunGate = options.shouldRunGate;
  }

  // ────────────────────────────────────────────────────────
  // 路径
  // ────────────────────────────────────────────────────────

  /** 落盘事件队列路径 */
  get queuePath(): string {
    return join(this.eventsDir, 'event-queue.jsonl');
  }

  /** 投递留痕（HMAC 链）路径 */
  get trailPath(): string {
    return join(this.eventsDir, 'delivery-trail.jsonl');
  }

  /** 死信队列路径 */
  get deadLetterPath(): string {
    return join(this.eventsDir, 'dead-letter.jsonl');
  }

  // ────────────────────────────────────────────────────────
  // 订阅
  // ────────────────────────────────────────────────────────

  /**
   * 订阅事件。
   *
   * @param type 事件类型（EVENT_TYPES 注册表取值；'*' = 订阅全部）
   * @param handler 处理器（抛错 = 投递失败 → 重试/死信）
   * @returns 取消订阅函数
   */
  subscribe(type: string, handler: EventHandler): () => void {
    const sub: EventSubscriptionHandle = { type, handler };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  /** 当前订阅数（调试/测试用） */
  subscriberCount(type?: string): number {
    if (type === undefined) return this.subscriptions.length;
    return this.subscriptions.filter((s) => s.type === type || s.type === '*').length;
  }

  // ────────────────────────────────────────────────────────
  // 发布 / 投递
  // ────────────────────────────────────────────────────────

  /**
   * 发布事件——落盘队列 → 投递订阅者 → 写投递留痕。
   *
   * 投递失败：classifyError 分类 → 可重试且未超内联重试上限 → 退避后重投；
   * 否则进死信队列（可重放）。**投递失败不抛错**——以结构化结果返回，
   * 保证事件源（webhook 接入方 / 节点执行方）不被下游故障拖垮。
   *
   * ⚠️ 唯一的抛错路径是**落盘 kind 门**：`type` ∉ REGISTERED_EVENT_TYPES 时
   * `appendChained` 抛 `ChainKernelError`（fail-closed——未登记类型永不触发，
   * 静默接受会把「拼错事件名」变成无声事故）。事件类型务必取自 `EVENT_TYPES`。
   *
   * v1.5.2 第三章：落盘之后、投递之前插入**派发前置五问判定链**（注入
   * `shouldRunGate` 时生效）——判定为挂起则不投递、不进死信，入 pending 队列
   * 等条件满足后自动恢复；未注入时该步整体跳过（行为与 v1.5.1 一致）。
   *
   * @param input 发布入参
   * @returns 投递结果（含死信 id / stop_reason / 留痕决策 ts / 挂起态）
   * @throws ChainKernelError 事件类型未登记（落盘 kind 门 fail-closed 拒绝）
   */
  async publish<T>(input: EventPublishInput<T>): Promise<EventPublishResult> {
    const event = this.normalize(input);
    this.appendEvent(event);
    const gate = this.shouldRunGate;
    if (gate) {
      const verdict = await gate(event);
      if (!verdict.run) {
        // 挂起即返回——**本次不尝试恢复**：刚挂起的事件判定没过，此刻恢复无意义；
        // 对既有挂起事件，若条件已变好则下一条通过的 publish（走下面的成功路径）
        // 或显式 resumePending() 会真正投递。这样避免「同一次 publish 内先挂起
        // 后立即投递」的判定不一致（非确定性 gate 下会返回 suspended 却已投递）。
        return this.suspendDispatch(event, verdict.suspended);
      }
    }
    const result = await this.deliver(event, 1, 0);
    // 本次派发通过 → 顺带重新判定挂起队列（「条件满足自动恢复」的自动触发点）
    if (gate) await this.resumePending();
    return result;
  }

  // ────────────────────────────────────────────────────────
  // 派发前置判定（v1.5.2 第三章）——挂起 / 恢复
  // ────────────────────────────────────────────────────────

  /**
   * 挂起一次派发（should-run 未通过）——**不投递、不进死信**。
   *
   * 落一条决策留痕（decision-log 可查挂起原因），事件入 pending 队列等恢复。
   *
   * @param event 被挂起的事件
   * @param suspension 挂起详情（判定链给出的首个不通过问题）
   * @returns 挂起态投递结果（delivered=false + suspended=true）
   */
  private suspendDispatch(
    event: SofagentEvent,
    suspension: ShouldRunSuspension | undefined,
  ): EventPublishResult {
    const attemptEvent: SofagentEvent = { ...event, attempt: 1 };
    const detail: ShouldRunSuspension = suspension ?? {
      question: 'health',
      reason: '派发前置判定未通过（未提供挂起详情）',
      resumeHint: '条件满足后自动恢复',
    };
    const decisionTs = this.writeSuspensionDecision(attemptEvent, detail);
    this.pending.push({
      event: attemptEvent,
      suspension: detail,
      suspendedAt: this.now().toISOString(),
      ...(decisionTs !== undefined ? { decisionTs } : {}),
    });
    return {
      event: attemptEvent,
      delivered: false,
      subscriberCount: 0,
      attempts: 0, // 挂起未投递——尝试次数为 0（区别于失败）
      suspended: true,
      suspension: detail,
      ...(decisionTs !== undefined ? { decisionTs } : {}),
    };
  }

  /**
   * 写派发挂起决策（kind=ORCHESTRATION / category=skip / moment=ACT）。
   *
   * 语义为「跳过本次派发」——**只使用既有 DecisionKind/DecisionCategory/LoopPhase
   * 取值，不扩 schema**。tags 带 `should-run` 与具体问题名（如 health）便于检索。
   * decisionContext=false 时跳过（纯流量场景——对齐 writeDispatchDecision 开关语义）。
   *
   * @returns 决策条目 ts（跳过/失败时 undefined）
   */
  private writeSuspensionDecision(event: SofagentEvent, suspension: ShouldRunSuspension): string | undefined {
    if (this.decisionContext === false) return undefined;
    const sessionId = this.decisionContext.sessionId ?? event.correlationId;
    try {
      const entry = emitDecision(
        {
          agentId: this.decisionContext.agentId,
          sessionId,
          kind: 'ORCHESTRATION',
          category: 'skip',
          moment: 'ACT',
          why: {
            text: `派发挂起（should-run 未通过·${suspension.question}）：${event.type} —— ${suspension.reason}；恢复条件：${suspension.resumeHint}`,
            tags: ['should-run', suspension.question, event.type],
            confidence: 'high',
          },
          ...(event.causationId !== undefined
            ? { causedBy: [event.causationId], causalType: 'caused' as const }
            : {}),
        },
        this.dataDir,
      );
      return entry.ts;
    } catch (err) {
      // 决策留痕失败不阻断挂起（对齐 dual-gate-mw「留痕不阻断业务」），但显式告警
      console.error(
        `[events:bus] 派发挂起决策留痕失败（不阻断挂起）：${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * 重新判定 pending 队列并投递条件已满足的事件（**条件满足自动恢复**）。
   *
   * 对每个挂起事件重跑 `shouldRunGate`：通过 → 真正投递（清出 pending）；
   * 仍不通过 → 保留在 pending（更新挂起详情）。恢复投递走 `deliver()`，
   * 因此照常写投递留痕与路由决策（「恢复了」可查）。
   *
   * 触发点：① 每次 `publish()` 之后自动调用；② 宿主可显式调用本方法（如人审
   * 通过、配额恢复时）。未注入 gate 或 pending 为空时为 no-op。
   *
   * @returns 本次被真正投递的挂起事件结果数组（仍挂起的不计入）
   */
  async resumePending(): Promise<EventPublishResult[]> {
    const gate = this.shouldRunGate;
    if (!gate || this.pending.length === 0) return [];
    const snapshot = this.pending;
    this.pending = [];
    const resumed: EventPublishResult[] = [];
    for (const item of snapshot) {
      const verdict = await gate(item.event);
      if (verdict.run) {
        resumed.push(await this.deliver(item.event, 1, 0));
      } else {
        this.pending.push({
          ...item,
          suspension: verdict.suspended ?? item.suspension,
        });
      }
    }
    return resumed;
  }

  /** 当前挂起等待恢复的派发（调试/断言用；返回快照副本） */
  listPending(): PendingDispatch[] {
    return [...this.pending];
  }

  /** 补齐事件字段（id / ts / correlationId） */
  private normalize<T>(input: EventPublishInput<T>): SofagentEvent<T> {
    const id = input.id ?? this.newId();
    return {
      id,
      type: input.type,
      source: input.source,
      ts: input.ts ?? this.now().toISOString(),
      payload: input.payload,
      correlationId: input.correlationId ?? id,
      ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
      ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      ...(input.targetNodeId !== undefined ? { targetNodeId: input.targetNodeId } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      attempt: 1,
    };
  }

  /**
   * 投递一次（含内联重试）。
   *
   * @param event 事件（attempt 字段表示本次尝试序号）
   * @param attempt 本次尝试序号（1-based）
   * @param priorAttempts 本次之前已失败的尝试次数（用于退避取值）
   */
  private async deliver(
    event: SofagentEvent,
    attempt: number,
    priorAttempts: number,
  ): Promise<EventPublishResult> {
    const targets = this.subscriptions.filter((s) => s.type === event.type || s.type === '*');
    const attemptEvent: SofagentEvent = { ...event, attempt };
    if (targets.length === 0) {
      // 无订阅者：事件已落盘（后续订阅方可从队列消费），视为投递完成
      const decisionTs = this.writeDispatchDecision(attemptEvent, 0);
      this.appendDelivery({ event: attemptEvent, outcome: 'DELIVERED', attempt, decisionTs });
      return { event: attemptEvent, delivered: true, subscriberCount: 0, attempts: attempt, decisionTs };
    }

    const errors: string[] = [];
    let failed = false;
    let firstError: unknown;
    for (const sub of targets) {
      try {
        await sub.handler(attemptEvent);
      } catch (err) {
        failed = true;
        errors.push(err instanceof Error ? err.message : String(err));
        if (firstError === undefined) firstError = err;
      }
    }

    if (!failed) {
      const decisionTs = this.writeDispatchDecision(attemptEvent, targets.length);
      this.appendDelivery({ event: attemptEvent, outcome: 'DELIVERED', attempt, decisionTs });
      return {
        event: attemptEvent,
        delivered: true,
        subscriberCount: targets.length,
        attempts: attempt,
        decisionTs,
      };
    }

    const stopReason = classifyError(firstError);
    const errorText = errors.join(' | ');
    // 可重试且还有内联重试余额 → 退避后重投
    if (isRetryableStopReason(stopReason) && priorAttempts < this.maxRetries) {
      this.appendDelivery({ event: attemptEvent, outcome: 'FAILED', attempt, stopReason, error: errorText });
      await this.sleep(backoffDelayMs(priorAttempts));
      return this.deliver(event, attempt + 1, priorAttempts + 1);
    }

    // 不可重试 / 重试耗尽 → 死信队列
    const deadLetterId = this.sendToDeadLetter(event, { error: errorText, attempts: attempt, stopReason });
    return {
      event: attemptEvent,
      delivered: false,
      subscriberCount: targets.length,
      attempts: attempt,
      stopReason,
      error: errorText,
      deadLetterId,
    };
  }

  // ────────────────────────────────────────────────────────
  // 落盘：事件队列 / 投递留痕
  // ────────────────────────────────────────────────────────

  /** 事件落盘（HMAC 链，kindField='type'——未登记类型拒绝落盘） */
  private appendEvent(event: SofagentEvent): void {
    this.ensureDir();
    appendChained(event as unknown as Record<string, unknown>, {
      filePath: this.queuePath,
      validKinds: REGISTERED_EVENT_TYPES,
      kindField: 'type',
      key: getHmacKey(),
      fingerprint: getEnvFingerprint(this.dataDir),
      logLabel: '[events:queue]',
    });
  }

  /** 投递留痕（HMAC 链，kindField='kind'） */
  private appendDelivery(input: {
    event: SofagentEvent;
    outcome: DeliveryOutcome;
    attempt: number;
    stopReason?: StopReason;
    error?: string;
    decisionTs?: string;
    deadLetterId?: string;
  }): void {
    this.ensureDir();
    const record: DeliveryRecord = {
      kind: input.outcome,
      ts: this.now().toISOString(),
      eventId: input.event.id,
      eventType: input.event.type,
      correlationId: input.event.correlationId,
      ...(input.event.causationId !== undefined ? { causationId: input.event.causationId } : {}),
      ...(input.event.targetNodeId !== undefined ? { nodeId: input.event.targetNodeId } : {}),
      attempt: input.attempt,
      ...(input.stopReason !== undefined ? { stopReason: input.stopReason } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.decisionTs !== undefined ? { decisionTs: input.decisionTs } : {}),
      ...(input.deadLetterId !== undefined ? { deadLetterId: input.deadLetterId } : {}),
    };
    appendChained(record as unknown as Record<string, unknown>, {
      filePath: this.trailPath,
      validKinds: DELIVERY_OUTCOMES,
      key: getHmacKey(),
      fingerprint: getEnvFingerprint(this.dataDir),
      logLabel: '[events:trail]',
    });
  }

  /**
   * 写事件路由决策（kind=ORCHESTRATION——「编排决策（子 Agent 委派/图路由）」）。
   *
   * 作用：给第三章的异常决策提供**真实的因果边锚点**——异常决策以本条目 ts
   * 作 causedBy，形成「事件路由 → 异常处理」的可追溯链。decisionContext=false
   * 时跳过（投递链留痕不受影响）。
   *
   * @returns 决策条目 ts（跳过时 undefined）
   */
  private writeDispatchDecision(event: SofagentEvent, subscriberCount: number): string | undefined {
    if (this.decisionContext === false) return undefined;
    const sessionId = this.decisionContext.sessionId ?? event.correlationId;
    try {
      const entry = emitDecision(
        {
          agentId: this.decisionContext.agentId,
          sessionId,
          kind: 'ORCHESTRATION',
          category: 'route',
          moment: 'ACT',
          why: {
            text: `事件派发：${event.type} → ${subscriberCount} 个订阅者（source=${event.source}）`,
            tags: ['event-dispatch', event.type, `attempt-${event.attempt ?? 1}`],
            confidence: 'high',
          },
          ...(event.causationId !== undefined ? { causedBy: [event.causationId], causalType: 'caused' as const } : {}),
        },
        this.dataDir,
      );
      return entry.ts;
    } catch (err) {
      // 决策留痕失败不阻断投递（对齐 dual-gate-mw：「留痕不阻断业务」），
      // 但显式告警——静默降级是本章要防的失效形态
      console.error(`[events:bus] 事件路由决策留痕失败（不阻断投递）：${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  // ────────────────────────────────────────────────────────
  // 死信队列（第三章复用入口）
  // ────────────────────────────────────────────────────────

  /**
   * 事件处理失败入死信队列（**本通道是异常的唯一入口**——第三章复用，
   * 不新建第二套死信机制）。
   *
   * @param event 失败事件
   * @param input 失败上下文（nodeId / error / stopReason / attempts / decisionTs / anomalyClass）
   * @returns 死信 id
   */
  sendToDeadLetter(event: SofagentEvent, input: DeadLetterInput = {}): string {
    this.ensureDir();
    const stopReason = input.stopReason ?? classifyError(input.error ?? '事件处理失败');
    const attempts = input.attempts ?? event.attempt ?? 1;
    const entry: DeadLetterEntry = {
      id: `dl-${event.id}`,
      ts: this.now().toISOString(),
      event,
      ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
      error: input.error ?? '事件处理失败（未提供错误信息）',
      stopReason,
      retryable: isRetryableStopReason(stopReason),
      attempts,
      nextRetryDelayMs: backoffDelayMs(attempts - 1),
      replayCount: 0,
      ...(input.decisionTs !== undefined ? { decisionTs: input.decisionTs } : {}),
      ...(input.anomalyClass !== undefined ? { anomalyClass: input.anomalyClass } : {}),
    };
    this.appendDeadLetter(entry);
    this.appendDelivery({
      event,
      outcome: 'DEAD_LETTER',
      attempt: attempts,
      stopReason,
      error: entry.error,
      deadLetterId: entry.id,
      ...(input.decisionTs !== undefined ? { decisionTs: input.decisionTs } : {}),
    });
    return entry.id;
  }

  /** 死信落盘（HMAC 链，kindField='stopReason'——白名单 = stop_reason 六值） */
  private appendDeadLetter(entry: DeadLetterEntry): void {
    appendChained(entry as unknown as Record<string, unknown>, {
      filePath: this.deadLetterPath,
      validKinds: STOP_REASONS,
      kindField: 'stopReason',
      key: getHmacKey(),
      fingerprint: getEnvFingerprint(this.dataDir),
      logLabel: '[events:dead-letter]',
    });
  }

  /**
   * 列出死信（append-only 折叠：同一 id 取最后一条——重放会追加更新记录）。
   *
   * @returns 死信条目数组（按入队顺序）
   */
  listDeadLetters(): DeadLetterEntry[] {
    const rows = this.readJsonl<DeadLetterEntry>(this.deadLetterPath);
    const byId = new Map<string, DeadLetterEntry>();
    for (const row of rows) {
      if (typeof row?.id === 'string') byId.set(row.id, row);
    }
    return [...byId.values()];
  }

  /** 取单条死信（不存在返回 null） */
  getDeadLetter(id: string): DeadLetterEntry | null {
    return this.listDeadLetters().find((d) => d.id === id) ?? null;
  }

  /**
   * 重放死信——原始事件重新进总线（attempt 递增），重放结果进投递留痕。
   *
   * 退避：重放前按 backoffDelayMs(replayCount) 等待（sleep 可注入——测试零等待）。
   *
   * @param id 死信 id
   * @returns 重放投递结果（死信不存在时 delivered=false + error）
   */
  async replayDeadLetter(id: string, opts: { force?: boolean } = {}): Promise<EventPublishResult> {
    const entry = this.getDeadLetter(id);
    if (!entry) {
      return {
        event: {
          id,
          type: 'unknown',
          source: 'node-output',
          ts: this.now().toISOString(),
          payload: null,
          correlationId: id,
        },
        delivered: false,
        subscriberCount: 0,
        attempts: 0,
        error: `死信 ${id} 不存在`,
      };
    }
    // 异常总线写下的死信带 `anomalyClass`。只有 retryable 类才该被「通用重放」放行：
    //   needs-human 的正确处置是人工审批（HITL 队列），needs-rollback 是 snapshot_restore；
    //   而这两类死信的 `retryable` 标志为 true（该标志只由 stop_reason 派生，**不看 anomalyClass**），
    //   于是「批量重放所有 retryable 死信」这种将来很自然的写法会把它们静默放回执行链。
    //   故此处把「误放」从默认行为改成需人确认的动作：非 retryable 类必须显式 force。
    if (!opts.force && entry.anomalyClass !== undefined && entry.anomalyClass !== 'retryable') {
      return {
        event: entry.event,
        delivered: false,
        subscriberCount: 0,
        attempts: entry.attempts,
        error:
          `死信 ${id} 的异常类别为 ${entry.anomalyClass}（非 retryable）——通用重放会把「需人工/需回滚」的异常` +
          `静默放回执行链。确需重放请显式传 { force: true }；否则走对应处置：needs-human → HITL 审批，` +
          `needs-rollback → snapshot_restore`,
      };
    }
    const attempt = entry.attempts + 1;
    await this.sleep(backoffDelayMs(entry.replayCount));
    const replayed: SofagentEvent = { ...entry.event, attempt };
    const result = await this.deliver(replayed, attempt, 0);
    const updated: DeadLetterEntry = {
      ...entry,
      replayCount: entry.replayCount + 1,
      replayedAt: this.now().toISOString(),
      attempts: attempt,
      nextRetryDelayMs: backoffDelayMs(entry.replayCount + 1),
    };
    this.appendDeadLetter(updated);
    this.appendDelivery({
      event: replayed,
      outcome: 'REPLAYED',
      attempt,
      ...(result.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
    return result;
  }

  // ────────────────────────────────────────────────────────
  // 追溯 / 验链
  // ────────────────────────────────────────────────────────

  /**
   * 还原一条事件触发链——按 correlationId 取链条内全部事件（按落盘顺序）。
   *
   * @param eventId 链条内任取一个事件 id（缺省用根事件 id）
   * @returns 链条事件数组（事件不存在时为空数组）
   */
  traceEvent(eventId: string): SofagentEvent[] {
    const queue = this.readJsonl<SofagentEvent>(this.queuePath);
    const anchor = queue.find((e) => e?.id === eventId);
    if (!anchor) return [];
    return queue.filter((e) => e?.correlationId === anchor.correlationId);
  }

  /** 读投递留痕（可按事件 id / 触发链过滤） */
  listDeliveries(filter: { eventId?: string; correlationId?: string } = {}): DeliveryRecord[] {
    const rows = this.readJsonl<DeliveryRecord>(this.trailPath);
    return rows.filter((r) => {
      if (!r || typeof r.kind !== 'string') return false;
      if (filter.eventId !== undefined && r.eventId !== filter.eventId) return false;
      if (filter.correlationId !== undefined && r.correlationId !== filter.correlationId) return false;
      return true;
    });
  }

  /** 验投递留痕链（HMAC 链完整性——可向举证方证明留痕未被重写） */
  verifyEventTrail(): ChainCheckResult {
    if (!existsSync(this.trailPath)) {
      return { status: 'insufficient', detail: '投递留痕文件不存在' };
    }
    const rows = this.readJsonl<DeliveryRecord>(this.trailPath);
    if (rows.length < 2) {
      return { status: 'insufficient', detail: '投递留痕不足 2 条' };
    }
    return verifyChain(rows as unknown as Record<string, unknown>[], {
      key: getHmacKey(),
      fingerprint: getEnvFingerprint(this.dataDir),
      subject: '投递留痕',
    });
  }

  // ────────────────────────────────────────────────────────
  // 内部工具
  // ────────────────────────────────────────────────────────

  private ensureDir(): void {
    if (!existsSync(this.eventsDir)) mkdirSync(this.eventsDir, { recursive: true, mode: 0o700 });
  }

  /** 读 JSONL（跳过解析失败行——不因单行损坏丢整链） */
  private readJsonl<T>(filePath: string): T[] {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf-8');
    const out: T[] = [];
    const lines = raw.split('\n');
    // 末行损坏的判定基准：最后一条非空行的下标。链**中段**损坏丢的是中间一环，
    // 后一条的 prevHash 随之对不上 ⇒ verifyChain 会暴露；链**末行**损坏丢的是链尾，
    // 前面 N-1 条仍是一条自洽前缀 ⇒ verifyChain（只走 prevHash 链接，无链头/链尾/
    // 条目计数锚点）**照样通过**，损坏无人知。故末行必须显式告警。
    let lastDataLine = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.trim() !== '') {
        lastDataLine = i;
        break;
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (trimmed === '') continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch (err) {
        /* 为何可静默：链中段损坏跳过——该行缺失会让其后条目的 prevHash 对不上，
           verifyChain 必然暴露；末行损坏无后继可比对、验链发现不了，已在下行显式告警 */
        if (i === lastDataLine) {
          console.error(
            `[events:bus] ${filePath} 末行损坏已跳过——链尾丢失，verifyChain 无法发现（只走 prevHash 链接，无链尾锚点）：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    return out;
  }

  /** 内联重试上限（调试/断言用） */
  get inlineRetryLimit(): number {
    return this.maxRetries;
  }
}
