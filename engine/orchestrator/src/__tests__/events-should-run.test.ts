// ============================================================
// events-should-run.test.ts · 第三章「运行时 should-run 判定链」验收测试（v1.5.2）
// ============================================================
//
// 覆盖任务书第三章四条验收：
//   1. 五问判定链集成事件总线派发前置
//   2. 挂起原因可查（decision-log 记录）
//   3. 条件满足自动恢复执行（真断言：第二次判定后被真正投递）
//   4. 挂起 ≠ 失败（死信通道为空）
//
// 附：fail-fast 顺序、未注入 gate 的零行为回归。
//
// 隔离纪律：dataDir 走 mkdtemp（不碰真实数据目录）；sleep 注入 no-op。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { EventBus } from '../events/bus';
import {
  SHOULD_RUN_ORDER,
  createShouldRunGate,
  shouldRun,
  type ShouldRunCheck,
  type ShouldRunQuestion,
  type ShouldRunState,
} from '../events/should-run';
import { EVENT_TYPES, type SofagentEvent } from '../events/types';
import { loadDecisionLog } from '@sofagent/audit';

// ════════════════════════════════════════
// 夹具
// ════════════════════════════════════════

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-should-run-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 造一份五问 state（缺省全部通过） */
function stateOf(overrides: Partial<Record<ShouldRunQuestion, ShouldRunCheck>> = {}): ShouldRunState {
  return {
    health: overrides.health ?? { ok: true },
    humanGate: overrides['human-gate'] ?? { ok: true },
    evidence: overrides.evidence ?? { ok: true },
    focus: overrides.focus ?? { ok: true },
    quota: overrides.quota ?? { ok: true },
  };
}

/** 总线：tmp dataDir + 零等待退避 + 固定时钟（可注入 gate） */
function makeBus(shouldRunGate?: ReturnType<typeof createShouldRunGate>): EventBus {
  return new EventBus({
    dataDir: tmpDir,
    sleep: async () => {},
    now: () => new Date('2026-09-20T00:00:00.000Z'),
    ...(shouldRunGate !== undefined ? { shouldRunGate } : {}),
  });
}

/** 发布一条 webhook 表单事件（固定 id 便于断言） */
function formInput(id: string) {
  return {
    id,
    type: EVENT_TYPES.WEBHOOK_FORM,
    source: 'webhook' as const,
    payload: { kind: 'form' as const, body: { formId: 'contact-us' } },
  };
}

// ════════════════════════════════════════
// 一、五问判定链（纯函数）——顺序固定 + fail-fast
// ════════════════════════════════════════

describe('第三章 · 五问判定链（纯函数）', () => {
  it('判定顺序固定为 健康 → 人审 gate → 证据等待 → 专注等待 → 配额', () => {
    expect(SHOULD_RUN_ORDER).toEqual(['health', 'human-gate', 'evidence', 'focus', 'quota']);
  });

  it('五问各自单独不通过 → 挂起且 suspended.question 正确（探针 detail 如实透传）', () => {
    const cases: Array<[ShouldRunQuestion, Partial<Record<ShouldRunQuestion, ShouldRunCheck>>, string]> = [
      ['health', { health: { ok: false, detail: '断路器断开' } }, '断路器断开'],
      ['human-gate', { 'human-gate': { ok: false, detail: '待人工批准' } }, '待人工批准'],
      ['evidence', { evidence: { ok: false, detail: '上游证据缺失' } }, '上游证据缺失'],
      ['focus', { focus: { ok: false, detail: '专注窗口被占' } }, '专注窗口被占'],
      ['quota', { quota: { ok: false, detail: '预算耗尽' } }, '预算耗尽'],
    ];
    for (const [question, override, expectedDetail] of cases) {
      const result = shouldRun(stateOf(override));
      expect(result.run).toBe(false);
      expect(result.suspended?.question).toBe(question);
      // 探针给的 detail / resumeHint 被如实透传
      expect(result.suspended?.reason).toBe(expectedDetail);
      expect(result.suspended?.resumeHint.length).toBeGreaterThan(0);
    }
  });

  it('fail-fast：多问同时不通过 → 只报顺序最靠前的那一问', () => {
    // 健康 + 人审 + 配额同时不通过 → 报 health（顺序最靠前）
    const r1 = shouldRun(stateOf({ health: { ok: false }, 'human-gate': { ok: false }, quota: { ok: false } }));
    expect(r1.suspended?.question).toBe('health');

    // 人审 + 证据同时不通过（健康通过）→ 报 human-gate
    const r2 = shouldRun(stateOf({ 'human-gate': { ok: false }, evidence: { ok: false } }));
    expect(r2.suspended?.question).toBe('human-gate');

    // 证据 + 专注同时不通过 → 报 evidence
    const r3 = shouldRun(stateOf({ evidence: { ok: false }, focus: { ok: false } }));
    expect(r3.suspended?.question).toBe('evidence');

    // 专注 + 配额 → 报 focus
    const r4 = shouldRun(stateOf({ focus: { ok: false }, quota: { ok: false } }));
    expect(r4.suspended?.question).toBe('focus');
  });

  it('五问全通过 → run=true 且无挂起详情', () => {
    const result = shouldRun(stateOf());
    expect(result.run).toBe(true);
    expect(result.suspended).toBeUndefined();
  });

  it('探针未给 detail/resumeHint → 用内置文案（非空）', () => {
    const result = shouldRun(stateOf({ quota: { ok: false } }));
    expect(result.suspended?.question).toBe('quota');
    expect(result.suspended?.reason.length).toBeGreaterThan(0);
    expect(result.suspended?.resumeHint.length).toBeGreaterThan(0);
  });

  it('createShouldRunGate：未接线的问题视为通过；接线的问题生效', async () => {
    const evt = { id: 'e', type: EVENT_TYPES.WEBHOOK_FORM, source: 'webhook', ts: '', payload: {}, correlationId: 'e' } as SofagentEvent;

    // 不注入任何探针 → 全通过
    expect((await createShouldRunGate()(evt)).run).toBe(true);

    // 只接线 quota → 其它问不阻断，quota 不通过则挂起
    const gate = createShouldRunGate({ quota: () => ({ ok: false, detail: '预算耗尽' }) });
    const verdict = await gate(evt);
    expect(verdict.run).toBe(false);
    expect(verdict.suspended?.question).toBe('quota');
  });
});

// ════════════════════════════════════════
// 二、集成事件总线派发前置
// ════════════════════════════════════════

describe('第三章 · 集成事件总线派发前置', () => {
  it('判定不通过 → 不投递给订阅者；EventPublishResult 如实表达「已挂起」', async () => {
    const bus = makeBus(
      createShouldRunGate({ health: () => ({ ok: false, detail: '断路器断开', resumeHint: '恢复后自动重试' }) }),
    );
    const received: SofagentEvent[] = [];
    bus.subscribe(EVENT_TYPES.WEBHOOK_FORM, (e) => {
      received.push(e);
    });

    const result = await bus.publish(formInput('evt-suspended-1'));

    // 未投递给任何订阅者
    expect(received).toEqual([]);
    // 挂起态：delivered=false 且 suspended=true（区别于失败的「两者皆非」）
    expect(result.delivered).toBe(false);
    expect(result.suspended).toBe(true);
    expect(result.suspension?.question).toBe('health');
    expect(result.suspension?.reason).toContain('断路器断开');
    // 挂起不是失败——无死信、无 stopReason
    expect(result.deadLetterId).toBeUndefined();
    expect(result.stopReason).toBeUndefined();
    // 事件入 pending 队列（可查）
    expect(bus.listPending()).toHaveLength(1);
    expect(bus.listPending()[0]!.event.id).toBe('evt-suspended-1');
  });

  it('五问全通过 → 正常投递（delivered=true 且无挂起字段）', async () => {
    const bus = makeBus(createShouldRunGate());
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.WEBHOOK_FORM, (e) => {
      received.push(e.id);
    });

    const result = await bus.publish(formInput('evt-run-1'));
    expect(result.delivered).toBe(true);
    expect(result.suspended).toBeUndefined();
    expect(received).toEqual(['evt-run-1']);
    expect(bus.listPending()).toEqual([]);
  });

  it('挂起的事件已落盘（挂起只影响派发调度态，事件不丢）', async () => {
    const bus = makeBus(createShouldRunGate({ focus: () => ({ ok: false, detail: '专注窗口被占' }) }));
    await bus.publish(formInput('evt-persisted-1'));

    const queue = fs.readFileSync(bus.queuePath, 'utf-8').trim().split('\n');
    const ids = queue.map((l) => (JSON.parse(l) as SofagentEvent).id);
    expect(ids).toContain('evt-persisted-1');
  });
});

// ════════════════════════════════════════
// 三、挂起 ≠ 失败（死信通道为空）
// ════════════════════════════════════════

describe('第三章 · 挂起非失败', () => {
  it('挂起后死信通道为空，且投递留痕无任何 DEAD_LETTER 条目', async () => {
    const bus = makeBus(createShouldRunGate({ 'human-gate': () => ({ ok: false, detail: '待人工批准' }) }));
    bus.subscribe(EVENT_TYPES.WEBHOOK_FORM, () => {
      throw new Error('订阅者不应被调用');
    });

    const result = await bus.publish(formInput('evt-not-fail-1'));

    expect(result.suspended).toBe(true);
    // 死信队列为空（真断言）
    expect(bus.listDeadLetters()).toEqual([]);
    // 投递留痕为空——挂起不写 FAILED / DEAD_LETTER
    expect(bus.listDeliveries({ eventId: 'evt-not-fail-1' })).toEqual([]);
    // 死信文件不存在或为空
    expect(fs.existsSync(bus.deadLetterPath)).toBe(false);
  });
});

// ════════════════════════════════════════
// 四、挂起原因可查（decision-log）
// ════════════════════════════════════════

describe('第三章 · 挂起原因落 decision-log', () => {
  it('挂起写一条 ORCHESTRATION/skip/ACT 决策，tags 带 should-run 与问题名', async () => {
    const bus = makeBus(
      createShouldRunGate({ evidence: () => ({ ok: false, detail: '上游证据缺失', resumeHint: '证据落定后自动恢复' }) }),
    );
    await bus.publish(formInput('evt-decision-1'));

    const entries = loadDecisionLog(tmpDir);
    const suspension = entries.filter((e) => e.kind === 'ORCHESTRATION' && e.category === 'skip');
    expect(suspension).toHaveLength(1);

    const entry = suspension[0]!;
    expect(entry.moment).toBe('ACT');
    expect(entry.why.tags).toContain('should-run');
    expect(entry.why.tags).toContain('evidence');
    expect(entry.why.text).toContain('上游证据缺失');

    // 决策条目 ts 回填到 EventPublishResult（因果可追）
    const result = await bus.publish(formInput('evt-decision-2'));
    expect(typeof result.decisionTs).toBe('string');

    // 挂起事件可经 pending 查回（含 decisionTs）
    const pending = bus.listPending();
    expect(pending).toHaveLength(2);
    for (const item of pending) {
      expect(typeof item.decisionTs).toBe('string');
    }
  });
});

// ════════════════════════════════════════
// 五、条件满足自动恢复执行（真实投递）
// ════════════════════════════════════════

describe('第三章 · 条件满足自动恢复执行', () => {
  it('「先不满足 → 后满足」：下一次 publish 触发自动恢复，挂起事件被真正投递', async () => {
    const healthState = { ok: false };
    const gate = createShouldRunGate({
      health: () =>
        healthState.ok ? { ok: true } : { ok: false, detail: '断路器断开', resumeHint: '恢复后自动重试' },
    });
    const bus = makeBus(gate);
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.WEBHOOK_FORM, (e) => {
      received.push(e.id);
    });

    // ① 第一次：健康不通过 → 挂起，订阅者收不到
    const first = await bus.publish(formInput('evt-resume-1'));
    expect(first.suspended).toBe(true);
    expect(received).toEqual([]);

    // ② 状态恢复
    healthState.ok = true;

    // ③ 下一次 publish 触发自动恢复：新事件投递 + 挂起事件被真正投递
    const second = await bus.publish(formInput('evt-resume-2'));
    expect(second.delivered).toBe(true);

    // 断言：挂起事件 evt-resume-1 被真正投递（这是本章验收第 3 条的核心）
    expect(received).toContain('evt-resume-1');
    expect(received).toContain('evt-resume-2');
    // 恢复后 pending 清空
    expect(bus.listPending()).toEqual([]);
    // 恢复投递写正常 DELIVERED 留痕
    const deliveries = bus.listDeliveries({ eventId: 'evt-resume-1' });
    expect(deliveries.some((d) => d.kind === 'DELIVERED')).toBe(true);
  });

  it('显式 resumePending() 恢复（人审通过 / 配额恢复时宿主主动调用）', async () => {
    const quotaState = { ok: false };
    const bus = makeBus(
      createShouldRunGate({
        quota: () => (quotaState.ok ? { ok: true } : { ok: false, detail: '预算耗尽' }),
      }),
    );
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.WEBHOOK_FORM, (e) => {
      received.push(e.id);
    });

    await bus.publish(formInput('evt-manual-resume-1'));
    expect(received).toEqual([]);
    expect(bus.listPending()).toHaveLength(1);

    // 仍不满足 → resumePending 返回空，pending 保留
    expect(await bus.resumePending()).toEqual([]);
    expect(bus.listPending()).toHaveLength(1);

    // 条件满足 → resumePending 真正投递
    quotaState.ok = true;
    const resumed = await bus.resumePending();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.delivered).toBe(true);
    expect(received).toEqual(['evt-manual-resume-1']);
    expect(bus.listPending()).toEqual([]);
  });

  it('恢复后再次不满足 → 挂起事件仍留在 pending（不误投）', async () => {
    const healthState = { ok: true };
    const bus = makeBus(
      createShouldRunGate({
        health: () => (healthState.ok ? { ok: true } : { ok: false, detail: '断路器断开' }),
      }),
    );
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.WEBHOOK_FORM, (e) => {
      received.push(e.id);
    });

    // 先挂起
    healthState.ok = false;
    await bus.publish(formInput('evt-stay-1'));
    expect(bus.listPending()).toHaveLength(1);

    // 恢复判定后仍为不满足（探针依旧 false）→ resumePending 不投递
    const resumed = await bus.resumePending();
    expect(resumed).toEqual([]);
    expect(received).toEqual([]);
    expect(bus.listPending()).toHaveLength(1);
  });
});

// ════════════════════════════════════════
// 六、回归：未注入 gate 行为与 v1.5.1 一致
// ════════════════════════════════════════

describe('第三章 · 未注入 gate 零行为回归', () => {
  it('不注入 shouldRunGate → 正常投递、无挂起字段、pending 恒空', async () => {
    const bus = makeBus();
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.WEBHOOK_FORM, (e) => {
      received.push(e.id);
    });

    const result = await bus.publish(formInput('evt-regression-1'));
    expect(result.delivered).toBe(true);
    expect(result.suspended).toBeUndefined();
    expect(received).toEqual(['evt-regression-1']);
    expect(bus.listPending()).toEqual([]);
    // decision-log 里只有正常路由决策（category=route），无 should-run 挂起条目
    const skips = loadDecisionLog(tmpDir).filter((e) => e.category === 'skip');
    expect(skips).toEqual([]);
  });
});
