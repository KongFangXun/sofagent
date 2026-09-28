// ============================================================
// cordis-bridge.test.ts · v1.5.4 第五章 · cordis 兼容层 + 挂载预检单测
// ============================================================
//
// 覆盖面（对齐验收标准 ⑤⑥）：
//   ⑤ cordis 兼容层：事件桥有读数、services 桥可调用
//       （接口集口径——事件名对 SEAMS 词汇表、服务对 @public 面）
//   ⑥ 插件可用性预检：四段探针可执行，产出「可用 / 只挂载不生效 + 缺口明细」两态
//
// 隔离：SOFAGENT_DATA / SOFAGENT_KEY_PATH 指向临时目录。
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as coreMod from '@sofagent/core';
import * as evolveMod from '@sofagent/evolve';
import * as injectMod from '@sofagent/inject';
import * as auditMod from '@sofagent/audit';
import { EventBus } from '../events/bus';
import { EVENT_TYPES } from '../events/types';
import { createCordisEventBridge, CORDIS_EVENT_MAPPING } from '../compat/cordis-event-bridge';
import { createCordisServiceBridge, DEFAULT_SERVICE_DECLARATIONS } from '../compat/cordis-service-bridge';
import {
  probePluginMount,
  DSH_HOST_CTX_EVENTS,
  PROBE_SEGMENTS,
  SEGMENT_LABELS,
  type PluginProbeDeclaration,
} from '../compat/plugin-mount-probe';
import { publishAiNodeToolCall, publishAiNodeTaskCompleted } from '../ai-node-events';

// ── 隔离数据面 ──
const ISO_DIR = join(tmpdir(), `sofagent-cordis-bridge-${process.pid}`);
const KEY_PATH = join(ISO_DIR, 'test-hmac-key');
mkdirSync(ISO_DIR, { recursive: true });
writeFileSync(KEY_PATH, '0123456789abcdef0123456789abcdef', 'utf-8');

const ORIG_DATA = process.env.SOFAGENT_DATA;
const ORIG_KEY = process.env.SOFAGENT_KEY_PATH;
process.env.SOFAGENT_DATA = ISO_DIR;
process.env.SOFAGENT_KEY_PATH = KEY_PATH;

afterAll(() => {
  if (ORIG_DATA === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = ORIG_DATA;
  if (ORIG_KEY === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = ORIG_KEY;
  rmSync(ISO_DIR, { recursive: true, force: true });
});

function newBus(): EventBus {
  return new EventBus({ dataDir: ISO_DIR, decisionContext: false, sleep: async () => {} });
}

/** 建一个装了全部默认声明的 services 桥 */
function bridgeWithDefaults() {
  const sb = createCordisServiceBridge();
  for (const d of DEFAULT_SERVICE_DECLARATIONS) sb.register(d.pkg, d.namespace, d.apis);
  return sb;
}

// ════════════════════════════════════════════════════════════
// ⑤-A 事件桥（主干事件 → cordis ctx 事件形态·有读数）
// ════════════════════════════════════════════════════════════

describe('cordis 事件桥', () => {
  it('映射表目标事件名全在 SEAMS 词汇表（不凭空造事件名）', () => {
    const mapped = new Set(Object.values(CORDIS_EVENT_MAPPING).flat());
    expect(mapped.size).toBeGreaterThan(0);
    for (const name of mapped) expect(DSH_HOST_CTX_EVENTS).toContain(name);
    expect(mapped.has('tools/pre-execute')).toBe(true);
    expect(mapped.has('tools/result')).toBe(true);
    expect(mapped.has('session/event')).toBe(true);
    expect(mapped.has('agent/error')).toBe(true);
  });

  it('转发主干三类节点事件到对应 ctx 事件位（有读数 + 转形正确）', async () => {
    const bus = newBus();
    const bridge = createCordisEventBridge(bus);
    const pre: unknown[][] = [];
    const res: unknown[][] = [];
    const sess: unknown[][] = [];
    bridge.attachCordisConsumer('tools/pre-execute', (...a) => pre.push(a));
    bridge.attachCordisConsumer('tools/result', (...a) => res.push(a));
    bridge.attachCordisConsumer('session/event', (...a) => sess.push(a));

    await publishAiNodeToolCall(bus, { nodeId: 'n1', tool: 'web-search', argsDigest: 'd', outcome: 'ok' });

    expect(bridge.stats.forwarded).toBe(1);
    expect(bridge.stats.byType[EVENT_TYPES.AI_NODE_TOOL_CALL]).toBe(1);
    expect(bridge.stats.byCordisEvent['tools/pre-execute']).toBe(1);
    expect(bridge.stats.byCordisEvent['tools/result']).toBe(1);
    // tools/* 转形 { name, arguments }
    expect(pre).toHaveLength(1);
    expect(pre[0]![0]).toMatchObject({ name: 'web-search' });
    expect(res).toHaveLength(1);
    expect(res[0]![0]).toMatchObject({ name: 'web-search' });

    // 任务完成 → session/event 转形 { type, session, event }
    await publishAiNodeTaskCompleted(bus, { nodeId: 'n1', taskId: 'run-1', outcome: 'done' });
    expect(bridge.stats.byType[EVENT_TYPES.AI_NODE_TASK_COMPLETED]).toBe(1);
    expect(sess).toHaveLength(1);
    expect(sess[0]![0]).toMatchObject({
      type: 'node-event',
      session: { id: 'n1' },
      event: { type: EVENT_TYPES.AI_NODE_TASK_COMPLETED },
    });

    bridge.dispose();
  });

  it('异常流 → agent/error（载荷原样）', async () => {
    const bus = newBus();
    const bridge = createCordisEventBridge(bus);
    const errs: unknown[][] = [];
    bridge.attachCordisConsumer('agent/error', (...a) => errs.push(a));

    await bus.publish({
      type: EVENT_TYPES.ANOMALY_REPORTED,
      source: 'ai-node',
      payload: { nodeId: 'x', message: 'boom' },
    });
    expect(bridge.stats.byCordisEvent['agent/error']).toBe(1);
    expect(errs).toHaveLength(1);
    expect(errs[0]![0]).toMatchObject({ nodeId: 'x', message: 'boom' });
    bridge.dispose();
  });

  it('单 handler 抛错不拖垮转发（适配层降级）', async () => {
    const bus = newBus();
    const bridge = createCordisEventBridge(bus);
    const okCalls: unknown[][] = [];
    bridge.attachCordisConsumer('tools/result', () => {
      throw new Error('handler 内部错');
    });
    bridge.attachCordisConsumer('tools/result', (...a) => okCalls.push(a));

    await publishAiNodeToolCall(bus, { nodeId: 'n', tool: 't', argsDigest: 'd', outcome: 'ok' });
    expect(bridge.stats.forwarded).toBe(1);
    expect(okCalls).toHaveLength(1);
    bridge.dispose();
  });

  it('dispose 卸载订阅并清空消费者', async () => {
    const bus = newBus();
    const bridge = createCordisEventBridge(bus);
    const calls: unknown[][] = [];
    bridge.attachCordisConsumer('tools/result', (...a) => calls.push(a));
    bridge.dispose();
    await publishAiNodeToolCall(bus, { nodeId: 'n', tool: 't', argsDigest: 'd', outcome: 'ok' });
    expect(calls).toHaveLength(0);
    expect(bridge.stats.forwarded).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// ⑤-B services 桥（@public 面按 ctx.provider 暴露·可调用）
// ════════════════════════════════════════════════════════════

describe('cordis services 桥', () => {
  it('register/get/namespaces + invoke 真实取包函数', async () => {
    const sb = createCordisServiceBridge();
    const provider = sb.register('@sofagent/core', 'core', ['getDataDir']);
    expect(sb.stats.registered).toBe(1);
    expect(sb.namespaces()).toContain('core');
    expect(sb.get('core')).toBe(provider);
    expect(sb.get('nope')).toBeUndefined();
    expect(provider.meta).toMatchObject({ pkg: '@sofagent/core', namespace: 'core' });

    const out = await provider.invoke('getDataDir');
    expect(sb.stats.invocations).toBe(1);
    expect(sb.stats.failures).toBe(0);
    expect(typeof out).toBe('string');
  });

  it('调用不存在的 API → 抛可读错误 + failures++（fail-loud 不静默成功）', async () => {
    const sb = createCordisServiceBridge();
    const provider = sb.register('@sofagent/core', 'core', ['getDataDir']);
    await expect(provider.invoke('noSuchApi')).rejects.toThrow(/不是可调用函数/);
    expect(sb.stats.failures).toBe(1);
  });

  it('DEFAULT_SERVICE_DECLARATIONS 每符号都是目标包真实导出（防假缺口）', () => {
    const mods: Record<string, Record<string, unknown>> = {
      '@sofagent/core': coreMod as unknown as Record<string, unknown>,
      '@sofagent/evolve': evolveMod as unknown as Record<string, unknown>,
      '@sofagent/inject': injectMod as unknown as Record<string, unknown>,
      '@sofagent/audit': auditMod as unknown as Record<string, unknown>,
    };
    for (const decl of DEFAULT_SERVICE_DECLARATIONS) {
      const mod = mods[decl.pkg];
      expect(mod, `未纳入模块表：${decl.pkg}`).toBeDefined();
      for (const api of decl.apis) {
        expect(typeof mod![api], `${decl.pkg}.${api} 应为函数`).toBe('function');
      }
    }
  });

  it('dispose 后命名空间清空', () => {
    const sb = createCordisServiceBridge();
    sb.register('@sofagent/core', 'core', ['getDataDir']);
    expect(sb.namespaces()).toHaveLength(1);
    sb.dispose();
    expect(sb.namespaces()).toHaveLength(0);
    expect(sb.stats.registered).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// ⑥ 插件可用性预检（四段两态）
// ════════════════════════════════════════════════════════════

describe('插件挂载预检（四段两态）', () => {
  it('四段全过 → 可用（usable）', async () => {
    const bus = newBus();
    const eventBridge = createCordisEventBridge(bus);
    const serviceBridge = bridgeWithDefaults();

    const decl: PluginProbeDeclaration = {
      pluginId: 'ok-plugin',
      declaredEvents: ['tools/pre-execute', 'tools/result'],
      declaredServices: [{ pkg: '@sofagent/core', api: 'getDataDir' }],
      apply: async () => ({ ok: true }),
      fireProbe: async () => {
        await publishAiNodeTaskCompleted(bus, { nodeId: 'n', taskId: 'probe', outcome: 'done' });
        return { fired: true, produced: eventBridge.stats.forwarded };
      },
    };

    const verdict = await probePluginMount(decl, { serviceBridge, eventBridge });
    expect(verdict.verdict).toBe('usable');
    expect(verdict.gaps).toEqual([]);
    expect(verdict.segments).toHaveLength(PROBE_SEGMENTS.length);
    expect(verdict.segments.every((s) => s.ok)).toBe(true);
    expect(verdict.summary).toContain('可用');
    eventBridge.dispose();
  });

  it('任一不过 → 只挂载不生效 + 全量缺口明细', async () => {
    const bus = newBus();
    const eventBridge = createCordisEventBridge(bus);
    const serviceBridge = bridgeWithDefaults();

    const decl: PluginProbeDeclaration = {
      pluginId: 'bad-plugin',
      declaredEvents: ['turn/end'], // hook-protocol 载荷类型——非 ctx 订阅点（假接线）
      declaredServices: [{ pkg: '@sofagent/nope', api: 'x' }],
      apply: async () => ({ ok: false, error: '依赖缺失' }),
      fireProbe: async () => ({ fired: false, produced: 0 }),
    };

    const verdict = await probePluginMount(decl, { serviceBridge, eventBridge });
    expect(verdict.verdict).toBe('mounted-inert');
    expect(verdict.segments.filter((s) => !s.ok)).toHaveLength(4);
    expect(verdict.gaps.length).toBeGreaterThanOrEqual(4);
    expect(verdict.summary).toContain('只挂载不生效');
    // 段①明确报「宿主未派发」（把载荷类型与 ctx 订阅点区分开）
    expect(verdict.segments[0]!.gaps.join()).toContain('宿主未派发');
    // 段②报服务包未注册
    expect(verdict.segments[1]!.gaps.join()).toContain('未注册进 services 桥');
    eventBridge.dispose();
  });

  it('缺 apply 槽 / 缺探针槽 → 对应段判缺口（不静默为通过）', async () => {
    const bus = newBus();
    const eventBridge = createCordisEventBridge(bus);
    const serviceBridge = bridgeWithDefaults();

    const verdict = await probePluginMount(
      { pluginId: 'partial', declaredEvents: ['tools/result'], declaredServices: [] },
      { serviceBridge, eventBridge },
    );
    expect(verdict.verdict).toBe('mounted-inert');
    expect(verdict.segments[0]!.ok).toBe(true); // 段①事件命中
    expect(verdict.segments[1]!.ok).toBe(true); // 段②无服务声明
    expect(verdict.segments[2]!.ok).toBe(false); // 段③缺 apply
    expect(verdict.segments[3]!.ok).toBe(false); // 段④缺探针
    eventBridge.dispose();
  });

  it('段②：服务在注册面但 API 不在声明面内 → 判缺口', async () => {
    const bus = newBus();
    const eventBridge = createCordisEventBridge(bus);
    const serviceBridge = createCordisServiceBridge();
    serviceBridge.register('@sofagent/core', 'core', ['getDataDir']); // 只声明 getDataDir

    const verdict = await probePluginMount(
      {
        pluginId: 'api-mismatch',
        declaredEvents: ['tools/result'],
        declaredServices: [{ pkg: '@sofagent/core', api: 'getHmacKey' }], // 未注册的 API
        apply: async () => ({ ok: true }),
        fireProbe: async () => ({ fired: true, produced: 1 }),
      },
      { serviceBridge, eventBridge },
    );
    expect(verdict.segments[1]!.ok).toBe(false);
    expect(verdict.segments[1]!.gaps.join()).toContain('不在已注册 API 面内');
    eventBridge.dispose();
  });

  it('对照源快照随结论返回（复检对账：接口集漂移可检出）', async () => {
    const bus = newBus();
    const eventBridge = createCordisEventBridge(bus);
    const serviceBridge = bridgeWithDefaults();
    const verdict = await probePluginMount(
      { pluginId: 'snap', declaredEvents: ['tools/result'], declaredServices: [] },
      { serviceBridge, eventBridge },
    );
    expect(verdict.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(verdict.hostInterface.eventCount).toBe(DSH_HOST_CTX_EVENTS.length);
    expect(verdict.hostInterface.serviceNamespaces).toHaveLength(DEFAULT_SERVICE_DECLARATIONS.length);
    eventBridge.dispose();
  });

  it('PROBE_SEGMENTS / SEGMENT_LABELS 覆盖全部四段', () => {
    expect(PROBE_SEGMENTS).toHaveLength(4);
    for (const seg of PROBE_SEGMENTS) expect(SEGMENT_LABELS[seg]).toBeTruthy();
  });

  it('DSH_HOST_CTX_EVENTS 排除 hook-protocol 载荷类型（turn/end 非订阅点）', () => {
    expect(DSH_HOST_CTX_EVENTS).not.toContain('turn/end');
    expect(DSH_HOST_CTX_EVENTS).not.toContain('turn/start');
    expect(DSH_HOST_CTX_EVENTS).not.toContain('hook/invoked');
    expect(DSH_HOST_CTX_EVENTS).toContain('session/event');
    expect(DSH_HOST_CTX_EVENTS).toHaveLength(19);
  });
});
