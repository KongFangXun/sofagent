// ============================================================
// events-bus.test.ts · 第一章「事件驱动执行触发」验收测试（v1.5.1）
// ============================================================
//
// 覆盖任务书第一章四条验收 + 三类触发源：
//   1. 上游节点产出自动触发下游节点（workflow 内部事件链）
//   2. webhook 入站事件 ≥2 类（表单提交 / IM 消息）可触发节点
//   3. 事件投递全程审计留痕（每条事件触发链可追溯 + 留痕链可验）
//   4. 失败事件进死信队列，可重放
//   5. 定时器源（timer.tick）登记与触发（三类源齐备）
//
// 隔离纪律：dataDir 走 mkdtemp（不碰真实数据目录）；sleep 注入 no-op
// （退避等待零耗时——测的是语义不是等待）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { EventBus } from '../events/bus';
import {
  createNodeOutputSource,
  createTimerAdapter,
  createWebhookAdapter,
  WebhookPayloadError,
} from '../events/adapters';
import { EventRouter, parseEventSubscriptions, validateEventSubscriptions } from '../events/router';
import { EVENT_TYPES, type SofagentEvent } from '../events/types';

// ════════════════════════════════════════
// 夹具
// ════════════════════════════════════════

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-events-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 总线：tmp dataDir + 零等待退避 + 固定时钟 */
function makeBus(): EventBus {
  return new EventBus({
    dataDir: tmpDir,
    sleep: async () => {},
    now: () => new Date('2026-09-20T00:00:00.000Z'),
  });
}

/**
 * 事件链 workflow：intake 由表单提交触发，followup 由 intake 产出触发。
 * （`on:` 声明的两种写法各用一次：字符串简写 + 完整形态）
 */
const CHAIN_WORKFLOW = `
workflow:
  name: order-flow
  nodes:
    - id: intake
      agent: developer
      task: 接收表单并入库
      on: webhook.form.submitted
    - id: followup
      agent: qa-engineer
      task: 跟进处理
      on:
        event: workflow.node.completed
        from: intake
`;

// ════════════════════════════════════════
// 一、上游节点产出自动触发下游节点
// ════════════════════════════════════════

describe('第一章 · 上游节点产出自动触发下游节点', () => {
  it('节点产出事件驱动下游节点执行（内部事件链，按声明顺序）', async () => {
    const bus = makeBus();
    const executed: string[] = [];
    const router = new EventRouter({
      bus,
      nodeRunner: async ({ nodeId }) => {
        executed.push(nodeId);
        return { output: `${nodeId} 产出`, success: true };
      },
    });
    const subscriptions = router.attach(CHAIN_WORKFLOW);
    expect(subscriptions.map((s) => `${s.nodeId}<-${s.event}`)).toEqual([
      `intake<-${EVENT_TYPES.WEBHOOK_FORM}`,
      `followup<-${EVENT_TYPES.NODE_OUTPUT}`,
    ]);

    const webhook = createWebhookAdapter(bus);
    const result = await webhook.handleWebhook({
      kind: 'form',
      body: { formId: 'contact-us', email: 'a@b.c' },
    });
    expect(result.delivered).toBe(true);

    // intake 被表单事件触发 → 其产出事件触发 followup
    expect(executed).toEqual(['intake', 'followup']);

    // 三条事件同属一条触发链（correlationId 相同，causationId 指向父事件）：
    // 表单事件 → intake 产出事件 → followup 产出事件
    const chain = bus.traceEvent(result.event.id);
    expect(chain.length).toBe(3);
    expect(new Set(chain.map((e) => e.correlationId)).size).toBe(1);
    const intakeOutput = chain.find((e) => (e.payload as { nodeId?: string }).nodeId === 'intake');
    expect(intakeOutput?.causationId).toBe(result.event.id);
  });

  it('from 约束不匹配时不触发（不会误派发到非上游节点）', async () => {
    const bus = makeBus();
    const executed: string[] = [];
    const router = new EventRouter({
      bus,
      nodeRunner: async ({ nodeId }) => {
        executed.push(nodeId);
        return { output: 'ok', success: true };
      },
    });
    router.attach(`
workflow:
  name: from-constraint
  nodes:
    - id: a
      agent: developer
      task: A
    - id: b
      agent: developer
      task: B
      on:
        event: ${EVENT_TYPES.NODE_OUTPUT}
        from: a
`);
    // 伪造来自节点 c 的产出事件 → 不命中 b 的 from: a 约束
    const other = createNodeOutputSource(bus);
    await other.emitCompletion({ workflowId: 'from-constraint', nodeId: 'c', output: 'x', success: true });
    expect(executed).toEqual([]);

    // 来自 a 的产出 → 命中
    await other.emitCompletion({ workflowId: 'from-constraint', nodeId: 'a', output: 'x', success: true });
    expect(executed).toEqual(['b']);
  });
});

// ════════════════════════════════════════
// 二、webhook 入站 ≥2 类
// ════════════════════════════════════════

describe('第一章 · webhook 入站（≥2 类）', () => {
  const TWO_SOURCE_WORKFLOW = `
workflow:
  name: two-sources
  nodes:
    - id: form-node
      agent: developer
      task: 处理表单
      on:
        event: ${EVENT_TYPES.WEBHOOK_FORM}
        filter: { formId: contact-us }
    - id: im-node
      agent: researcher
      task: 处理 IM
      on: ${EVENT_TYPES.WEBHOOK_IM}
`;

  it('表单提交与 IM 消息两类入站各自触发对应节点（filter 生效）', async () => {
    const bus = makeBus();
    const executed: Array<{ nodeId: string; type: string }> = [];
    const router = new EventRouter({
      bus,
      nodeRunner: async ({ nodeId, event }) => {
        executed.push({ nodeId, type: event.type });
        return { output: 'ok', success: true };
      },
    });
    router.attach(TWO_SOURCE_WORKFLOW);
    const webhook = createWebhookAdapter(bus);

    const form = await webhook.handleWebhook({ kind: 'form', body: { formId: 'contact-us' } });
    expect(form.event.type).toBe(EVENT_TYPES.WEBHOOK_FORM);
    const im = await webhook.handleWebhook({ kind: 'im', body: { text: '在吗' } });
    expect(im.event.type).toBe(EVENT_TYPES.WEBHOOK_IM);

    expect(executed).toEqual([
      { nodeId: 'form-node', type: EVENT_TYPES.WEBHOOK_FORM },
      { nodeId: 'im-node', type: EVENT_TYPES.WEBHOOK_IM },
    ]);
  });

  it('filter 不命中则不触发（等值过滤语义）', async () => {
    const bus = makeBus();
    const executed: string[] = [];
    const router = new EventRouter({
      bus,
      nodeRunner: async ({ nodeId }) => {
        executed.push(nodeId);
        return { output: 'ok', success: true };
      },
    });
    router.attach(TWO_SOURCE_WORKFLOW);
    await createWebhookAdapter(bus).handleWebhook({ kind: 'form', body: { formId: 'other-form' } });
    expect(executed).toEqual([]);
  });

  it('JSON 字符串入站体可解析；畸形入站 fail-loud', async () => {
    const bus = makeBus();
    const webhook = createWebhookAdapter(bus);
    const ok = await webhook.handleWebhook({ kind: 'form', body: '{"formId":"contact-us"}' });
    expect((ok.event.payload as { body: { formId: string } }).body.formId).toBe('contact-us');

    await expect(webhook.handleWebhook({ kind: 'form', body: 'not-json' })).rejects.toBeInstanceOf(
      WebhookPayloadError,
    );
    await expect(
      webhook.handleWebhook({ kind: 'form', body: [1, 2] as unknown }),
    ).rejects.toBeInstanceOf(WebhookPayloadError);
  });
});

// ════════════════════════════════════════
// 三、事件投递全程审计留痕
// ════════════════════════════════════════

describe('第一章 · 事件投递全程审计留痕', () => {
  it('每次投递有留痕条目（事件/类型/链条键/尝试序号），且留痕链可验', async () => {
    const bus = makeBus();
    const router = new EventRouter({
      bus,
      nodeRunner: async () => ({ output: 'ok', success: true }),
    });
    router.attach(CHAIN_WORKFLOW);
    const result = await createWebhookAdapter(bus).handleWebhook({ kind: 'form', body: { formId: 'contact-us' } });

    const deliveries = bus.listDeliveries({ correlationId: result.event.correlationId });
    // 表单事件 + intake 产出事件 + followup 产出事件 = 3 条投递留痕（均 DELIVERED）
    expect(deliveries.length).toBe(3);
    for (const d of deliveries) {
      expect(d.kind).toBe('DELIVERED');
      expect(d.correlationId).toBe(result.event.correlationId);
      expect(typeof d.eventId).toBe('string');
      expect(typeof d.eventType).toBe('string');
      expect(d.attempt).toBeGreaterThanOrEqual(1);
      expect(typeof d.decisionTs).toBe('string');
    }
    // 留痕带 causationId（第二跳能指回父事件）——触发链可追溯
    expect(deliveries.some((d) => d.causationId === result.event.id)).toBe(true);

    expect(bus.verifyEventTrail().status).toBe('ok');
  });

  it('事件队列落盘且类型门生效（未登记类型拒绝落盘）', async () => {
    const bus = makeBus();
    await bus.publish({ type: EVENT_TYPES.WEBHOOK_IM, source: 'webhook', payload: { kind: 'im', body: {} } });
    const lines = fs.readFileSync(bus.queuePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    const stored = JSON.parse(lines[0]!) as SofagentEvent & { prevHash: string };
    expect(stored.type).toBe(EVENT_TYPES.WEBHOOK_IM);
    expect(stored.prevHash).toBe('genesis');

    // 未登记类型 → 链内核 kind 门拒绝（fail-loud，不静默丢事件）
    await expect(
      bus.publish({ type: 'not.registered.event', source: 'webhook', payload: {} }),
    ).rejects.toThrow();
  });
});

// ════════════════════════════════════════
// 四、失败事件进死信队列，可重放
// ════════════════════════════════════════

describe('第一章 · 死信与重放', () => {
  it('节点执行失败 → 死信队列（stop_reason 分类 + 退避延时）', async () => {
    const bus = makeBus();
    let shouldFail = true;
    const router = new EventRouter({
      bus,
      nodeRunner: async () => {
        if (shouldFail) throw new Error('LLM timeout: 请求超时');
        return { output: 'ok', success: true };
      },
    });
    router.attach(`
workflow:
  name: dead-letter
  nodes:
    - id: worker
      agent: developer
      task: 干活
      on: ${EVENT_TYPES.WEBHOOK_FORM}
`);
    await createWebhookAdapter(bus).handleWebhook({ kind: 'form', body: {} });

    const dead = bus.listDeadLetters();
    expect(dead.length).toBe(1);
    // 复用 v1.3.1 分类：timeout 属可重试类（isRetryableStopReason）
    expect(dead[0]!.stopReason).toBe('timeout');
    expect(dead[0]!.retryable).toBe(true);
    expect(dead[0]!.nextRetryDelayMs).toBe(2000);

    // 重放：修复故障后重投 → 成功 + REPLAYED 留痕
    shouldFail = false;
    const replayed = await bus.replayDeadLetter(dead[0]!.id);
    expect(replayed.delivered).toBe(true);
    expect(bus.getDeadLetter(dead[0]!.id)!.replayCount).toBe(1);
    expect(bus.listDeliveries({ eventId: replayed.event.id }).some((d) => d.kind === 'REPLAYED')).toBe(true);
  });

  it('非 retryable 异常类别的死信：通用重放必须被拒，显式 force 才放行', async () => {
    const bus = makeBus();
    // 异常总线写入的死信带 anomalyClass——needs-human / needs-rollback 的正确处置分别是
    // HITL 审批与 snapshot_restore，而不是「再跑一次执行链」。
    const id = bus.sendToDeadLetter(
      {
        id: 'evt-human-1',
        type: EVENT_TYPES.WEBHOOK_IM,
        source: 'webhook',
        ts: new Date().toISOString(),
        payload: {},
        correlationId: 'evt-human-1',
      },
      { error: '凭证失效', stopReason: 'failed', attempts: 1, anomalyClass: 'needs-human' },
    );
    // 关键前提：该类的 retryable 为 true（此标志只由 stop_reason 派生、不看 anomalyClass）
    // ⇒「批量重放所有 retryable 死信」这种将来很自然的写法会把它静默放回执行链。
    expect(bus.getDeadLetter(id)!.retryable).toBe(true);

    const refused = await bus.replayDeadLetter(id);
    expect(refused.delivered).toBe(false);
    expect(refused.error).toContain('needs-human');
    expect(bus.getDeadLetter(id)!.replayCount).toBe(0); // 被拒时不得留重放痕

    bus.subscribe(EVENT_TYPES.WEBHOOK_IM, async () => {});
    const forced = await bus.replayDeadLetter(id, { force: true });
    expect(forced.delivered).toBe(true);
    expect(bus.getDeadLetter(id)!.replayCount).toBe(1);
  });

  it('不可重试错误（auth）直接进死信且标记不可重试', async () => {
    const bus = makeBus();
    const router = new EventRouter({
      bus,
      nodeRunner: async () => {
        throw new Error('凭证被拒 返回错误 401');
      },
    });
    router.attach(`
workflow:
  name: auth-fail
  nodes:
    - id: worker
      agent: developer
      task: 干活
      on: ${EVENT_TYPES.WEBHOOK_IM}
`);
    await createWebhookAdapter(bus).handleWebhook({ kind: 'im', body: {} });
    const dead = bus.listDeadLetters();
    expect(dead[0]!.stopReason).toBe('auth');
    expect(dead[0]!.retryable).toBe(false);
  });

  it('未注入节点执行器 → 显式失败入死信（不静默丢弃事件）', async () => {
    const bus = makeBus();
    const router = new EventRouter({ bus });
    router.attach(`
workflow:
  name: no-runner
  nodes:
    - id: worker
      agent: developer
      task: 干活
      on: ${EVENT_TYPES.WEBHOOK_FORM}
`);
    await createWebhookAdapter(bus).handleWebhook({ kind: 'form', body: {} });
    const dead = bus.listDeadLetters();
    expect(dead.length).toBe(1);
    expect(dead[0]!.error).toContain('未注入节点执行器');
  });
});

// ════════════════════════════════════════
// 五、定时器源 + `on:` 声明校验
// ════════════════════════════════════════

describe('第一章 · 定时器源与 on: 声明校验', () => {
  it('定时器登记（cron 语法复用校验）+ 触发 timer.tick 事件驱动节点', async () => {
    const bus = makeBus();
    const executed: string[] = [];
    const router = new EventRouter({
      bus,
      nodeRunner: async ({ nodeId }) => {
        executed.push(nodeId);
        return { output: 'ok', success: true };
      },
    });
    router.attach(`
workflow:
  name: timer-flow
  nodes:
    - id: nightly
      agent: developer
      task: 夜间巡检
      on: ${EVENT_TYPES.TIMER_TICK}
`);
    const timers = createTimerAdapter(bus);
    expect(timers.register({ id: 'nightly', schedule: '@daily' })).toBeNull();
    expect(timers.register({ id: 'bad', schedule: '99 99 99 99 99' })).toContain('非法');

    const fired = await timers.fire('nightly');
    expect(fired.delivered).toBe(true);
    expect(executed).toEqual(['nightly']);
  });

  it('on: 声明校验——未登记事件类型 / 悬空 from / 非法形态均拒绝', () => {
    const unknownEvent = `
workflow:
  name: bad-event
  nodes:
    - id: a
      agent: developer
      task: A
      on: webhook.typo.event
`;
    expect(validateEventSubscriptions(unknownEvent)[0]).toContain('未登记的事件类型');

    const dangling = `
workflow:
  name: bad-from
  nodes:
    - id: a
      agent: developer
      task: A
      on:
        event: ${EVENT_TYPES.NODE_OUTPUT}
        from: ghost
`;
    expect(validateEventSubscriptions(dangling)[0]).toContain('不存在的节点');

    const wrongForm = `
workflow:
  name: bad-form
  nodes:
    - id: a
      agent: developer
      task: A
      on: [a, b]
`;
    expect(validateEventSubscriptions(wrongForm)[0]).toContain('形态非法');

    // 合法声明 → 无错误
    expect(validateEventSubscriptions(CHAIN_WORKFLOW)).toEqual([]);
    // 无 on: 声明的 workflow 恒通过（行为零变化）
    expect(
      validateEventSubscriptions('workflow:\n  name: plain\n  nodes:\n    - id: a\n      agent: developer\n      task: A\n'),
    ).toEqual([]);
  });

  it('parseEventSubscriptions 解析两种写法', () => {
    const parsed = parseEventSubscriptions(CHAIN_WORKFLOW);
    expect(parsed.workflowName).toBe('order-flow');
    expect(parsed.subscriptions).toHaveLength(2);
    expect(parsed.subscriptions[0]).toEqual({ nodeId: 'intake', event: EVENT_TYPES.WEBHOOK_FORM });
    expect(parsed.subscriptions[1]).toEqual({
      nodeId: 'followup',
      event: EVENT_TYPES.NODE_OUTPUT,
      from: 'intake',
    });
  });
});
