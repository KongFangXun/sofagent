// ============================================================
// cordis-plugin-inject · 插件单测（v1.4.0 交付五 · v1.5.0 章十补接线面）
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pluginDefault, { pluginMeta, capability, invoke } from './index';
import { buildConstrainedSystemPrompt } from '@sofagent/inject';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

// 章十：接线面断言需要可控的判定源与消息工厂——两条桥接面都打桩成确定性替身
// （真依赖是否装在当前环境与接线正确性无关；打桩后能对**透传参数**做逐字断言）。
vi.mock('@sofagent/inject', () => ({
  buildConstrainedSystemPrompt: vi.fn(() => 'CONSTRAINT-PROMPT'),
}));
vi.mock('@deepseek-ai/dsh-llm', () => ({
  createUserMessage: vi.fn((input: Record<string, unknown>) => ({ __fakeUserMessage: true, ...input })),
}));

describe('cordis-plugin-sofagent-inject', () => {
  it('插件元数据完整（id/version/description/seam）', () => {
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-inject');
    expect(pluginMeta.version).toBe(require('../package.json').version); // SSOT 对齐：版本跟随主版本（读 package.json）
    expect(pluginMeta.description.length).toBeGreaterThan(10);
    expect(pluginMeta.seam.length).toBeGreaterThan(0);
  });

  it('能力说明非空', () => {
    expect(capability.length).toBeGreaterThan(0);
  });

  it('invoke 可调用（成功或降级，不挂死）', async () => {
    const r = await invoke().catch((e) => e);
    expect(r).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// v1.5.0 章十 · seam 事件接线（seam 从声明到实现）
// 断言面：① 订阅真实存在（ctx.on 的调用形态与事件名）② disposer 收进复合卸载契约
//        ③ Turn 首步**真注入**（判定源 = @sofagent/inject.buildConstrainedSystemPrompt）
//        ④ 非首步 / reject / 判定源缺席 / 空文本 → 原样返回（fail-open，绝不误改本步输入）
// ─────────────────────────────────────────────────────────────────────────────
describe('章十 · seam 事件接线', () => {
  const MANIFEST = require('../../plugins.json') as {
    plugins: Array<{ id: string; seamHandlers?: string[] }>;
  };
  const declared: string[] =
    MANIFEST.plugins.find((p) => p.id === 'cordis-plugin-sofagent-inject')?.seamHandlers ?? [];
  const ONE = ['agent/pre-step'];

  const errSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildConstrainedSystemPrompt).mockImplementation(() => 'CONSTRAINT-PROMPT');
    vi.mocked(createUserMessage).mockImplementation((input: Record<string, unknown>) => ({
      __fakeUserMessage: true,
      ...input,
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 宿主 ctx 替身：记录订阅名 + 保留 disposer（对齐 cordis `ctx.on(event, h) → disposer`） */
  function hostCtx() {
    const subscribed = new Map<string, (...a: unknown[]) => unknown>();
    const disposed: string[] = [];
    const on = vi.fn((event: string, handler: (...a: unknown[]) => unknown) => {
      subscribed.set(event, handler);
      return () => {
        disposed.push(event);
      };
    });
    return { ctx: { provide: vi.fn(() => () => undefined), on }, subscribed, disposed };
  }

  /** 宿主 pre-step 载荷替身：`{ messages, turn, step, signal }`（waterfall listener 收 `(payload, next)`） */
  function preStepPayload(step: number, cwd?: string) {
    return {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      turn: 1,
      step,
      signal: undefined,
      agent: cwd === undefined ? undefined : { session: { header: { cwd } } },
    };
  }

  it('seamHandlers 与 plugins.json 声明同集合（三处对账的插件侧）', () => {
    expect(declared.slice().sort()).toEqual([...ONE].sort());
  });

  it('apply 经 ctx.on 订阅 agent/pre-step；复合 disposer 逐个反注册', async () => {
    const spy = errSpy();
    const { ctx, subscribed, disposed } = hostCtx();
    const disposer = (pluginDefault.apply as (c: unknown) => unknown)(ctx) as
      | (() => Promise<void>)
      | undefined;
    expect([...subscribed.keys()].sort()).toEqual([...ONE].sort());
    expect(typeof disposer).toBe('function');
    await disposer!();
    expect(disposed.slice().sort()).toEqual([...ONE].sort());
    spy.mockRestore();
  });

  it('step === 1：注入一条约束消息（判定源 + 宿主消息工厂，宿主参数原样在前）', async () => {
    const spy = errSpy();
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const hostDecision = { kind: 'enter', messages: [{ host: true }] };
    const next = vi.fn(async () => hostDecision);

    const verdict = (await subscribed.get('agent/pre-step')!(
      preStepPayload(1, '/proj/root'),
      next,
    )) as { kind: string; messages: unknown[] };

    expect(next).toHaveBeenCalledTimes(1); // 先取宿主默认决策，再在其上追加
    expect(buildConstrainedSystemPrompt).toHaveBeenCalledWith('/proj/root'); // cwd 优先透传
    expect(createUserMessage).toHaveBeenCalledWith({
      content: [{ type: 'text', text: 'CONSTRAINT-PROMPT' }],
      source: { kind: 'plugin', plugin: 'sofagent-inject' },
    });
    expect(verdict.kind).toBe('enter'); // 宿主的 kind 保留
    expect(verdict.messages).toHaveLength(2);
    expect(verdict.messages[0]).toEqual({ host: true }); // 宿主消息在前，注入消息追加在后
    expect(verdict.messages[1]).toMatchObject({ __fakeUserMessage: true });
    spy.mockRestore();
  });

  it('step !== 1：原样返回宿主决策（约束是常驻上下位，不逐步重复注入）', async () => {
    const spy = errSpy();
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const hostDecision = { kind: 'enter', messages: [{ host: true }] };
    const next = vi.fn(async () => hostDecision);

    const verdict = await subscribed.get('agent/pre-step')!(preStepPayload(2), next);

    expect(verdict).toBe(hostDecision); // 同一对象原样返回
    expect(buildConstrainedSystemPrompt).not.toHaveBeenCalled();
    expect(createUserMessage).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("kind === 'reject'：原样返回，不做任何注入", async () => {
    const spy = errSpy();
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const hostDecision = { kind: 'reject', messages: [] };
    const next = vi.fn(async () => hostDecision);

    const verdict = await subscribed.get('agent/pre-step')!(preStepPayload(1), next);

    expect(verdict).toBe(hostDecision);
    expect(createUserMessage).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('判定源缺席（buildConstrainedSystemPrompt 抛错）：原样返回宿主决策（fail-open）', async () => {
    const spy = errSpy();
    vi.mocked(buildConstrainedSystemPrompt).mockImplementation(() => {
      throw new Error('约束源不可达');
    });
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const hostDecision = { kind: 'enter', messages: [{ host: true }] };
    const next = vi.fn(async () => hostDecision);

    await expect(
      subscribed.get('agent/pre-step')!(preStepPayload(1), next),
    ).resolves.toBe(hostDecision);
    expect(createUserMessage).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('约束文本为空：不注入空消息（不污染本步输入）', async () => {
    const spy = errSpy();
    vi.mocked(buildConstrainedSystemPrompt).mockImplementation(() => '   ');
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const hostDecision = { kind: 'enter', messages: [{ host: true }] };
    const next = vi.fn(async () => hostDecision);

    await expect(
      subscribed.get('agent/pre-step')!(preStepPayload(1), next),
    ).resolves.toBe(hostDecision);
    expect(createUserMessage).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('项目根缺 session 面：回落到 SOFAGENT_PROJECT_ROOT（与 CLI/MCP 同口径）', async () => {
    const spy = errSpy();
    process.env.SOFAGENT_PROJECT_ROOT = '/env/root';
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const next = vi.fn(async () => ({ kind: 'enter', messages: [] }));

    await subscribed.get('agent/pre-step')!(preStepPayload(1), next);

    expect(buildConstrainedSystemPrompt).toHaveBeenCalledWith('/env/root');
    delete process.env.SOFAGENT_PROJECT_ROOT;
    spy.mockRestore();
  });
});
