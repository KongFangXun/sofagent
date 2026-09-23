// ============================================================
// audit-stream-push.test.ts · 审计事件流对外订阅桥（v1.5.2 章一「订阅推送」）
// ============================================================
//
// 覆盖面（任务书验收 + 铁律「每个 fail-closed 分支都要有故障注入测试」）：
//   1. 三态映射：能映射的事件 → 正确 verdict；不能映射的已登记事件 → null
//   2. 订阅投递：向总线 publish 一个事件 → 桥被触发并把消息推给 mock endpoint
//   3. 默认零副作用：无 endpoint 配置时，publish 不订阅、不推送、不落盘、不抛
//   4. 多平台：一个平台失败不影响另一个（真断言两个结果）
//   5. detach 后退订生效（publish 不再触发）
//   6. push() 失败时降级路径生效（fallback 日志 + 通道健康，按既有通道语义断言）
//   7. 订阅者不抛（防污染总线投递语义——注入会 reject 的违约 pusher）
//
// 隔离：注入假 pusher / 假总线 → 零真实外网；降级用例用回环 endpoint（SSRF 前置
// 拦截，不发 HTTP）+ tmp dataDir（通道健康落盘隔离开真实 ~/.sofagent）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EVENT_TYPES, type SofagentEvent } from '@sofagent/orchestrator';
import {
  attachAuditStreamToBus,
  mapEventToAuditPush,
  pushAuditStreamEvent,
  resolveAuditStreamPlatforms,
  type AuditStreamBusPort,
  type AuditStreamPusherOptions,
} from '../webhook/audit-stream-push';
import { createWebhookPusher, readWebhookChannelHealth } from '../webhook/index';
import type { AuditVerdict, WebhookPlatform, WebhookPushResult, WebhookPusher } from '../webhook/index';

// ────────────────────────────────────────────────────────────
// 测试替身
// ────────────────────────────────────────────────────────────

/** 事件构造（缺省字段可覆盖；避免为纯映射测试构造完整总线事件） */
function mkEvent(type: string, payload: unknown, extra: Partial<SofagentEvent> = {}): SofagentEvent {
  return {
    id: 'evt-1',
    type,
    source: 'node-output',
    ts: '2026-09-23T00:00:00.000Z',
    payload,
    correlationId: 'corr-1',
    ...extra,
  };
}

type FakeBus = AuditStreamBusPort & {
  topics: string[];
  emit(event: SofagentEvent): Promise<void>;
};

/** 同形 v1.5.1 EventBus 的假总线（记录订阅 topic；emit 同时投给同类型与通配订阅者） */
function mkFakeBus(): FakeBus {
  const handlers = new Map<string, Array<(e: SofagentEvent) => void | Promise<void>>>();
  return {
    topics: [],
    subscribe(type, handler) {
      this.topics.push(type);
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
      };
    },
    async emit(event) {
      const exact = handlers.get(event.type) ?? [];
      const wildcard = handlers.get('*') ?? [];
      for (const h of [...exact, ...wildcard]) await h(event);
    },
  };
}

interface FakePusher {
  calls: Array<{ platform: WebhookPlatform; verdict: AuditVerdict; message: string }>;
  push(platform: WebhookPlatform, verdict: AuditVerdict, message: string): Promise<WebhookPushResult>;
}

/** 假 pusher——记录每次推送；可按平台定制成败；可配置为违约 reject */
function mkFakePusher(opts: { failPlatforms?: WebhookPlatform[]; rejectPlatforms?: WebhookPlatform[] } = {}): FakePusher {
  const calls: FakePusher['calls'] = [];
  return {
    calls,
    async push(platform, verdict, message) {
      calls.push({ platform, verdict, message });
      if (opts.rejectPlatforms?.includes(platform)) throw new Error(`违约 pusher: ${platform} reject`);
      const failed = opts.failPlatforms?.includes(platform) ?? false;
      return failed
        ? { success: false, platform, attempts: 1, degraded: true, error: `模拟失败: ${platform}` }
        : { success: true, platform, attempts: 1, degraded: false };
    },
  };
}

const tmpDirs: string[] = [];
function mkTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

let savedData: string | undefined;

beforeEach(() => {
  savedData = process.env.SOFAGENT_DATA;
});

afterEach(() => {
  if (savedData === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = savedData;
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════
// 1 · 三态映射（纯函数）
// ════════════════════════════════════════════════════════════

describe('章一 订阅推送 · mapEventToAuditPush 三态映射', () => {
  // 能映射的事件 → 正确 verdict（「哪类事件 → 哪一态」逐条对齐）
  const mapped: Array<{ name: string; event: SofagentEvent; verdict: AuditVerdict }> = [
    { name: 'anomaly.reported → FAIL', event: mkEvent(EVENT_TYPES.ANOMALY_REPORTED, { error: '节点崩溃' }), verdict: 'FAIL' },
    {
      name: 'node.completed(success=false) → FAIL',
      event: mkEvent(EVENT_TYPES.NODE_OUTPUT, { workflowId: 'w', nodeId: 'n', output: 'x', success: false }),
      verdict: 'FAIL',
    },
    { name: 'device.upgrade → WARN', event: mkEvent(EVENT_TYPES.DEVICE_UPGRADE, { targetVersion: '1.5.2' }), verdict: 'WARN' },
    { name: 'device.deploy → WARN', event: mkEvent(EVENT_TYPES.DEVICE_DEPLOY, { bundleId: 'b1' }), verdict: 'WARN' },
  ];
  it.each(mapped)('映射：$name', ({ event, verdict }) => {
    const r = mapEventToAuditPush(event);
    expect(r).not.toBeNull();
    expect(r!.verdict).toBe(verdict);
    expect(r!.message).toContain('审计事件流');
    expect(r!.message).toContain(event.correlationId);
  });

  // 不能映射的已登记事件 → null（不硬塞成 PASS 制造噪声）
  const unmapped: Array<{ name: string; event: SofagentEvent }> = [
    {
      name: 'node.completed(success=true) → null',
      event: mkEvent(EVENT_TYPES.NODE_OUTPUT, { workflowId: 'w', nodeId: 'n', output: 'ok', success: true }),
    },
    { name: 'webhook.form.submitted → null', event: mkEvent(EVENT_TYPES.WEBHOOK_FORM, { kind: 'form', body: {} }) },
    { name: 'webhook.im.message → null', event: mkEvent(EVENT_TYPES.WEBHOOK_IM, { kind: 'im', body: {} }) },
    { name: 'timer.tick → null', event: mkEvent(EVENT_TYPES.TIMER_TICK, { timerId: 't', schedule: '@daily' }) },
    { name: 'device.task.dispatch → null', event: mkEvent(EVENT_TYPES.DEVICE_TASK_DISPATCH, { tasks: [] }) },
    { name: '未知类型 → null', event: mkEvent('unknown.event', {}) },
  ];
  it.each(unmapped)('不映射：$name', ({ event }) => {
    expect(mapEventToAuditPush(event)).toBeNull();
  });

  // 显式裁决声明通道（产生方精确声明三态——WARN vs FAIL 静态表覆盖不到）
  it('显式声明：metadata.auditVerdict 覆盖静态类型缺省（WARN）', () => {
    const e = mkEvent(EVENT_TYPES.ANOMALY_REPORTED, { error: 'e' }, { metadata: { auditVerdict: 'WARN' } });
    expect(mapEventToAuditPush(e)!.verdict).toBe('WARN');
  });
  it('显式声明：metadata.auditVerdict=PASS 被接受（三态闭合域）', () => {
    const e = mkEvent(EVENT_TYPES.NODE_OUTPUT, { success: true }, { metadata: { auditVerdict: 'PASS' } });
    expect(mapEventToAuditPush(e)!.verdict).toBe('PASS');
  });
  it('显式声明：非法值被忽略，回落静态映射', () => {
    const e = mkEvent(EVENT_TYPES.NODE_OUTPUT, { success: true }, { metadata: { auditVerdict: 'BOGUS' } });
    expect(mapEventToAuditPush(e)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
// 2 · resolveAuditStreamPlatforms
// ════════════════════════════════════════════════════════════

describe('章一 订阅推送 · 平台解析', () => {
  it('未配置任何 endpoint → 空数组', () => {
    expect(resolveAuditStreamPlatforms({ env: {} })).toEqual([]);
  });
  it('按已配置 endpoint 决定（未配置者跳过，不是报错）', () => {
    const env = { SOFAGENT_WEBHOOK_FEISHU: 'https://x.example/hook' };
    expect(resolveAuditStreamPlatforms({ env })).toEqual(['feishu']);
  });
  it('显式 platforms 优先（含空数组 = 显式关档）', () => {
    const env = { SOFAGENT_WEBHOOK_FEISHU: 'https://x.example/hook' };
    expect(resolveAuditStreamPlatforms({ env, platforms: ['wecom'] })).toEqual(['wecom']);
    expect(resolveAuditStreamPlatforms({ env, platforms: [] })).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════
// 3 · 订阅投递
// ════════════════════════════════════════════════════════════

describe('章一 订阅推送 · 订阅投递', () => {
  it('向总线 emit 失败事件 → 桥触发并把消息推给注入的 pusher', async () => {
    const bus = mkFakeBus();
    const pusher = mkFakePusher();
    attachAuditStreamToBus(bus, { platforms: ['feishu'], pusher: pusher as unknown as WebhookPusher });

    // 通配订阅（出站面覆盖所有事件）
    expect(bus.topics).toEqual(['*']);

    await bus.emit(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, { error: 'npm 依赖缺失' }));

    expect(pusher.calls).toHaveLength(1);
    expect(pusher.calls[0]!.platform).toBe('feishu');
    expect(pusher.calls[0]!.verdict).toBe('FAIL');
    expect(pusher.calls[0]!.message).toContain('npm 依赖缺失');
  });

  it('不进流的事件（成功节点）→ 零推送', async () => {
    const bus = mkFakeBus();
    const pusher = mkFakePusher();
    attachAuditStreamToBus(bus, { platforms: ['feishu'], pusher: pusher as unknown as WebhookPusher });
    await bus.emit(mkEvent(EVENT_TYPES.NODE_OUTPUT, { success: true, nodeId: 'n' }));
    expect(pusher.calls).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// 4 · 默认零副作用（未配置 endpoint）
// ════════════════════════════════════════════════════════════

describe('章一 订阅推送 · 默认零副作用（L1 关档）', () => {
  it('无 endpoint 配置 → 不订阅、不推送、不落盘、不抛', async () => {
    const bus = mkFakeBus();
    const logPath = path.join(mkTmpDir('sofagent-audit-stream-off-'), 'webhook-fallback.log');
    const detach = attachAuditStreamToBus(bus, { env: {}, logPath });

    // 未订阅（订阅面与今日逐字一致——零订阅）
    expect(bus.topics).toEqual([]);

    // emit 一个本会进流的事件 → 零推送
    await bus.emit(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, { error: 'x' }));

    // 无落盘（降级日志未创建）
    expect(fs.existsSync(logPath)).toBe(false);

    // detach 为 no-op，不抛
    expect(() => detach()).not.toThrow();
  });

  it('pushAuditStreamEvent：无平台 → []，且不触发建 pusher', async () => {
    const pusher = mkFakePusher();
    const r = await pushAuditStreamEvent(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, {}), {
      env: {},
      platforms: [],
      pusher: pusher as unknown as WebhookPusher,
    });
    expect(r).toEqual([]);
    expect(pusher.calls).toHaveLength(0);
  });

  it('pushAuditStreamEvent：不进流的事件 → []', async () => {
    const pusher = mkFakePusher();
    const r = await pushAuditStreamEvent(mkEvent(EVENT_TYPES.TIMER_TICK, {}), {
      platforms: ['feishu'],
      pusher: pusher as unknown as WebhookPusher,
    });
    expect(r).toEqual([]);
    expect(pusher.calls).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// 5 · 多平台（一个平台失败不影响另一个）
// ════════════════════════════════════════════════════════════

describe('章一 订阅推送 · 多平台', () => {
  it('feishu 失败 / wecom 成功 → 两个结果都在，互不影响', async () => {
    const options: AuditStreamPusherOptions = {
      platforms: ['feishu', 'wecom'],
      pusher: mkFakePusher({ failPlatforms: ['feishu'] }) as unknown as WebhookPusher,
    };
    const results = await pushAuditStreamEvent(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, { error: 'e' }), options);

    expect(results).toHaveLength(2);
    const byPlatform = new Map(results.map((r) => [r.platform, r]));
    expect(byPlatform.get('feishu')!.success).toBe(false);
    expect(byPlatform.get('feishu')!.degraded).toBe(true);
    expect(byPlatform.get('wecom')!.success).toBe(true);
    expect(byPlatform.get('wecom')!.degraded).toBe(false);
  });

  it('单平台违约 reject → 不中断其余平台（合成 degraded 结果）', async () => {
    const options: AuditStreamPusherOptions = {
      platforms: ['feishu', 'wecom'],
      pusher: mkFakePusher({ rejectPlatforms: ['feishu'] }) as unknown as WebhookPusher,
    };
    const results = await pushAuditStreamEvent(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, {}), options);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.platform === 'feishu')!.success).toBe(false);
    expect(results.find((r) => r.platform === 'wecom')!.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// 6 · detach 退订生效
// ════════════════════════════════════════════════════════════

describe('章一 订阅推送 · detach 退订', () => {
  it('detach 后 emit 不再触发推送', async () => {
    const bus = mkFakeBus();
    const pusher = mkFakePusher();
    const detach = attachAuditStreamToBus(bus, { platforms: ['feishu'], pusher: pusher as unknown as WebhookPusher });

    await bus.emit(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, {}));
    expect(pusher.calls).toHaveLength(1);

    detach();
    await bus.emit(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, {}));
    expect(pusher.calls).toHaveLength(1); // 未再触发
  });
});

// ════════════════════════════════════════════════════════════
// 7 · 降级路径（push 失败 → fallback 日志 + 通道健康）
// ════════════════════════════════════════════════════════════

describe('章一 订阅推送 · 失败降级（真实 pusher + 回环 endpoint）', () => {
  it('SSRF 拒绝回环 endpoint → 降级本地日志 + 通道健康可见，且不抛', async () => {
    const dataDir = mkTmpDir('sofagent-audit-stream-data-');
    process.env.SOFAGENT_DATA = dataDir;
    const logPath = path.join(dataDir, 'webhook-fallback.log');

    // 真实 pusher（不注入假件）；回环 endpoint 被 SSRF 前置拦截 → 不发 HTTP、直接降级
    const results = await pushAuditStreamEvent(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, { error: 'e' }), {
      platforms: ['feishu'],
      env: { SOFAGENT_WEBHOOK_FEISHU: 'http://127.0.0.1:9/hook' },
      logPath,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.degraded).toBe(true);
    expect(results[0]!.error).toContain('内网');

    // 降级本地日志落盘（既有通道语义——jsonl 含 platform/verdict/message/error）
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]!) as { platform: string; verdict: string };
    expect(record.platform).toBe('feishu');
    expect(record.verdict).toBe('FAIL');

    // 通道健康落盘（告警通道自身故障可观测）
    const health = readWebhookChannelHealth(dataDir);
    expect(health).not.toBeNull();
    expect(health!.lastError).toContain('feishu');
  });
});

// ════════════════════════════════════════════════════════════
// 8 · 订阅者不抛（防污染总线投递语义）
// ════════════════════════════════════════════════════════════

describe('章一 订阅推送 · 订阅者永不抛', () => {
  it('pusher 违约 reject → 逐平台吞错，总线 emit 正常 resolve（两个平台都被尝试）', async () => {
    const bus = mkFakeBus();
    const pusher = mkFakePusher({ rejectPlatforms: ['feishu', 'wecom'] });
    attachAuditStreamToBus(bus, { platforms: ['feishu', 'wecom'], pusher: pusher as unknown as WebhookPusher });

    await expect(bus.emit(mkEvent(EVENT_TYPES.ANOMALY_REPORTED, {}))).resolves.toBeUndefined();
    expect(pusher.calls.map((c) => c.platform).sort()).toEqual(['feishu', 'wecom']);
  });

  it('处理器内未预期异常（metadata 访问抛错）→ 订阅回调吞错并告警，emit 不 reject', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bus = mkFakeBus();
    const pusher = mkFakePusher();
    attachAuditStreamToBus(bus, { platforms: ['feishu'], pusher: pusher as unknown as WebhookPusher });

    // 故障注入：metadata 的 get 抛错 ⇒ mapEventToAuditPush 抛错 ⇒ 命中处理器兜底 catch
    const boom = new Proxy({}, { get() { throw new Error('boom-metadata'); } });
    const event = mkEvent(EVENT_TYPES.ANOMALY_REPORTED, {}, { metadata: boom as Record<string, unknown> });

    await expect(bus.emit(event)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
