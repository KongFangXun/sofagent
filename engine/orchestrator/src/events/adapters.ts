// ============================================================
// events/adapters.ts · 三类事件源适配器（v1.5.1 第一章新建）
// ============================================================
//
// 三类触发源统一「归一化 → 发布进总线」：
//   ① 上游节点产出（node-output）——workflow 内部事件链
//   ② 外部 webhook 入站（form / im）——IO 接入算子（形态归属 [通道] 成分）
//   ③ 定时器（timer）——v1.3.8 cron 既有调度面到期后驱动
//
// 设计约束：
//   - 适配器只做「接入面归一化 + 校验」，不含路由与执行（路由在 router.ts）。
//   - 入站是系统边界：畸形入站 fail-loud 抛错（WebhookPayloadError），
//     不静默丢弃——静默丢弃 = 事件永不触发且无人知晓。
//   - 定时器**不重实现 cron 到期计算**：到期判定属 v1.3.8 既有调度面
//     （engine/daemon/src/scheduler.ts 的 matchField + 到期扫描），本适配器
//     只负责「登记声明 + 语法校验（复用 validateCronSchedule）+ 被驱动时发布
//     timer.tick 事件」。硬要在编排侧重写一份 cron 匹配 = 第二套事实源。
//
// 🔴 注册点：适配器实例由调用方创建（`createWebhookAdapter(bus)` 等）——
//    事件源侧的接线方是接入面宿主（HTTP 入口 / daemon 调度循环 / dag-runner
//    节点执行处），见交付报告的「跨组接线点」。
// ============================================================

import { validateCronSchedule } from '../crud/schema-gate';
import { EventBus } from './bus';
import {
  EVENT_TYPES,
  type EventPublishResult,
  type TimerPayload,
  type WebhookKind,
  type WebhookPayload,
} from './types';

/** webhook 入站校验失败（畸形入站 fail-loud，不静默丢弃） */
export class WebhookPayloadError extends Error {
  constructor(message: string) {
    super(`[events:webhook] 入站校验失败：${message}`);
    this.name = 'WebhookPayloadError';
  }
}

// ────────────────────────────────────────────────────────────
// ① 上游节点产出源
// ────────────────────────────────────────────────────────────

/** 节点产出事件发布入参 */
export interface NodeCompletionInput {
  /** 所属 workflow id */
  workflowId: string;
  /** 完成/失败的节点 id */
  nodeId: string;
  /** 节点输出文本 */
  output: string;
  /** 节点是否成功 */
  success: boolean;
  /** 触发链根（缺省 = 新链条根） */
  correlationId?: string;
  /** 直接触发本次节点执行的上游事件 id */
  causationId?: string;
  /** 附加元数据（agentId / sessionId 等） */
  metadata?: Record<string, unknown>;
}

/** 上游节点产出源 */
export interface NodeOutputSource {
  /** 节点执行完成 → 发布 workflow.node.completed（下游 `on:` 据此触发） */
  emitCompletion(input: NodeCompletionInput): Promise<EventPublishResult>;
}

/**
 * 创建上游节点产出源。
 *
 * 注册点：节点执行处（dag-runner 逐节点执行完成处 / node-executor 出口）
 * 调用 `emitCompletion`；下游节点在 workflow 里声明
 * `on: { event: workflow.node.completed, from: <上游节点 id> }` 即被触发。
 */
export function createNodeOutputSource(bus: EventBus): NodeOutputSource {
  return {
    async emitCompletion(input: NodeCompletionInput): Promise<EventPublishResult> {
      if (!input.workflowId || !input.nodeId) {
        throw new Error('[events:node-output] workflowId 与 nodeId 必填（产出事件无归属节点 = 无法路由）');
      }
      return bus.publish({
        type: EVENT_TYPES.NODE_OUTPUT,
        source: 'node-output',
        payload: {
          workflowId: input.workflowId,
          nodeId: input.nodeId,
          output: input.output,
          success: input.success,
        },
        ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
        ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
        workflowId: input.workflowId,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });
    },
  };
}

// ────────────────────────────────────────────────────────────
// ② webhook 入站源
// ────────────────────────────────────────────────────────────

/** webhook 入站原始输入 */
export interface WebhookInbound {
  /** 入站类别：form=表单提交 / im=IM 消息（≥2 类接入面） */
  kind: WebhookKind;
  /** 入站体（对象，或 JSON 字符串——字符串在适配器内解析） */
  body: unknown;
  /** 来源标识（表单 id / IM 群标识，接入方按自身语义填入） */
  origin?: string;
  /** 入站时刻（缺省 = 入站校验时刻；接入方应传 HTTP 侧收到时刻） */
  receivedAt?: string;
}

/** webhook 入站适配器 */
export interface WebhookAdapter {
  /** 归一化入站体 → 发布事件（form/im 两类；畸形入站抛 WebhookPayloadError） */
  handleWebhook(inbound: WebhookInbound): Promise<EventPublishResult>;
}

/** 入站类别 → 事件类型 */
const WEBHOOK_EVENT: Record<WebhookKind, string> = {
  form: EVENT_TYPES.WEBHOOK_FORM,
  im: EVENT_TYPES.WEBHOOK_IM,
};

/**
 * 创建 webhook 入站适配器。
 *
 * 注册点：HTTP 接入面（表单提交端点 / IM 回调端点）收到请求后调用
 * `handleWebhook({ kind: 'form' | 'im', body, origin })`——节点以
 * `on: webhook.form.submitted` / `on: webhook.im.message` 订阅。
 */
export function createWebhookAdapter(bus: EventBus): WebhookAdapter {
  return {
    async handleWebhook(inbound: WebhookInbound): Promise<EventPublishResult> {
      const eventType = WEBHOOK_EVENT[inbound.kind];
      if (eventType === undefined) {
        throw new WebhookPayloadError(`未知入站类别 "${String(inbound.kind)}"（合法：form / im）`);
      }
      const body = normalizeBody(inbound.body);
      return bus.publish({
        type: eventType,
        source: 'webhook',
        payload: {
          kind: inbound.kind,
          body,
          ...(inbound.origin !== undefined ? { origin: inbound.origin } : {}),
        } satisfies WebhookPayload,
        ...(inbound.receivedAt !== undefined ? { ts: inbound.receivedAt } : {}),
      });
    },
  };
}

/** 归一化入站体：JSON 字符串解析 / 拒绝非对象 */
function normalizeBody(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      return assertPlainObject(parsed);
    } catch (err) {
      if (err instanceof WebhookPayloadError) throw err;
      throw new WebhookPayloadError(`入站体不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return assertPlainObject(body);
}

/** 入站体必须是普通对象（数组/标量 = 无法做 filter 匹配） */
function assertPlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebhookPayloadError('入站体必须是 JSON 对象（表单字段 / IM 消息字段）');
  }
  return value as Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────
// ③ 定时器源
// ────────────────────────────────────────────────────────────

/** 定时器登记项 */
export interface TimerRegistration {
  /** 定时器 id */
  id: string;
  /** 调度声明（三档糖宏 @daily/@weekly/@monthly 或五段 cron；亦可自然语言周期） */
  schedule: string;
  /** 触发时发布的事件类型（缺省 timer.tick） */
  event: string;
  /** 附加载荷 */
  payload?: Record<string, unknown>;
}

/** 定时器源 */
export interface TimerAdapter {
  /** 登记定时器声明（语法非法返回错误文案，不抛错——供接入面回传校验结论） */
  register(timer: { id: string; schedule: string; event?: string; payload?: Record<string, unknown> }): string | null;
  /** 已登记定时器清单 */
  list(): TimerRegistration[];
  /** 触发一次（由 v1.3.8 既有调度面到期驱动，或人工/测试显式触发） */
  fire(id: string): Promise<EventPublishResult>;
}

/**
 * 创建定时器源适配器。
 *
 * 注册点：daemon 侧 v1.3.8 调度面（`engine/daemon/src/scheduler.ts` 到期扫描 +
 * `cron.ts` 消费）到期后调用 `fire(timerId)`；节点以 `on: timer.tick` 订阅。
 * 本适配器不做到期计算（避免第二套 cron 事实源），只在**登记时**复用
 * `validateCronSchedule` 做语法校验。
 */
export function createTimerAdapter(bus: EventBus): TimerAdapter {
  const timers = new Map<string, TimerRegistration>();
  return {
    register(timer): string | null {
      if (typeof timer.id !== 'string' || timer.id.trim() === '') return '定时器 id 必填且非空';
      if (typeof timer.schedule !== 'string' || timer.schedule.trim() === '') {
        return `定时器 ${timer.id} 的 schedule 必填且非空`;
      }
      const err = validateCronSchedule(timer.schedule);
      if (err !== null) return `定时器 ${timer.id} 的 schedule 非法：${err}`;
      const event = timer.event ?? EVENT_TYPES.TIMER_TICK;
      timers.set(timer.id, {
        id: timer.id,
        schedule: timer.schedule.trim(),
        event,
        ...(timer.payload !== undefined ? { payload: timer.payload } : {}),
      });
      return null;
    },

    list(): TimerRegistration[] {
      return [...timers.values()];
    },

    async fire(id: string): Promise<EventPublishResult> {
      const timer = timers.get(id);
      if (!timer) {
        throw new Error(`[events:timer] 定时器 ${id} 未登记（先 register 再 fire）`);
      }
      return bus.publish({
        type: timer.event,
        source: 'timer',
        payload: { timerId: timer.id, schedule: timer.schedule, ...(timer.payload ?? {}) } satisfies TimerPayload &
          Record<string, unknown>,
      });
    },
  };
}
