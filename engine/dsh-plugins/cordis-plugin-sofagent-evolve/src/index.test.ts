// ============================================================
// cordis-plugin-evolve · 插件单测（v1.4.0 交付五 · v1.5.0 章十补接线面）
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pluginDefault, { pluginMeta, capability, invoke } from './index';
import { parseDiff, getDataDir } from '@sofagent/core';
import { runRules } from '@sofagent/audit';
import { generateThinkEntry } from '@sofagent/think';

// 章十：沉淀链三源（parseDiff → runRules → generateThinkEntry）打桩成确定性替身——
// 接线正确性 = 三源被调用的**顺序与参数**，与引擎内部实现无关（引擎自有其单测）。
vi.mock('@sofagent/core', () => ({
  parseDiff: vi.fn(() => ['src/a.ts']),
  getDataDir: vi.fn(() => '/data/dir'),
}));
vi.mock('@sofagent/audit', () => ({
  runRules: vi.fn(async () => [{ rule: 'no-archaeology', pass: true }]),
}));
vi.mock('@sofagent/think', () => ({
  // 返回值须有定义：既有元数据用例用 `invoke()` 走同一桥接面（返回 undefined 会被判失败）
  generateThinkEntry: vi.fn(async () => ({ ok: true, entry: 'think-entry' })),
}));

describe('cordis-plugin-sofagent-evolve', () => {
  it('插件元数据完整（id/version/description/seam）', () => {
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-evolve');
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
// 断言面：① 订阅真实存在 ② disposer 收进复合卸载契约 ③ turn/end **真沉淀**
//        ④ 其余会话事件 / 空 diff / 判定源缺席 → 零副作用（fail-open）
// 🔴 关键形状：订阅点是 `session/event`（`turn/end` 是会话事件类型，由过滤条件承载），
//    宿主/仓内都没有 ctx 级 `turn/end` 派发点——`ctx.on('turn/end')` 会永不触发。
// ─────────────────────────────────────────────────────────────────────────────
describe('章十 · seam 事件接线', () => {
  const MANIFEST = require('../../plugins.json') as {
    plugins: Array<{
      id: string;
      seamHandlers?: string[];
      bridges?: Array<{ pkg: string; api: string }>;
    }>;
  };
  const entry = MANIFEST.plugins.find((p) => p.id === 'cordis-plugin-sofagent-evolve');
  const declared: string[] = entry?.seamHandlers ?? [];
  const ONE = ['session/event'];

  const errSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SOFAGENT_TASK;
    delete process.env.SOFAGENT_PROJECT_ROOT;
    vi.mocked(parseDiff).mockImplementation(() => ['src/a.ts']);
    vi.mocked(getDataDir).mockImplementation(() => '/data/dir');
    vi.mocked(runRules).mockImplementation(async () => [{ rule: 'no-archaeology', pass: true }]);
    vi.mocked(generateThinkEntry).mockImplementation(async () => ({ ok: true, entry: 'think-entry' }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SOFAGENT_TASK;
    delete process.env.SOFAGENT_PROJECT_ROOT;
  });

  /** 宿主 ctx 替身：记录订阅名 + 保留 disposer */
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

  const sessionOf = (cwd?: string) => ({ header: cwd === undefined ? {} : { cwd } });

  it('seamHandlers 与 plugins.json 声明同集合（三处对账的插件侧）', () => {
    expect(declared.slice().sort()).toEqual([...ONE].sort());
  });

  it('订阅名是 session/event 而非 turn/end（后者不是 ctx 派发点）', () => {
    expect(declared).toContain('session/event');
    expect(declared).not.toContain('turn/end');
  });

  it('bridges 声明覆盖沉淀链三源（parseDiff / runRules / generateThinkEntry）', () => {
    const keys = (entry?.bridges ?? []).map((b) => `${b.pkg}.${b.api}`).sort();
    expect(keys).toEqual(
      [
        '@sofagent/audit.runRules',
        '@sofagent/core.getDataDir',
        '@sofagent/core.parseDiff',
        '@sofagent/think.generateThinkEntry',
      ].sort(),
    );
  });

  it('apply 经 ctx.on 订阅 session/event；复合 disposer 逐个反注册', async () => {
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

  it('turn/end + 有变更：parseDiff → runRules → generateThinkEntry 逐参透传', async () => {
    const spy = errSpy();
    process.env.SOFAGENT_TASK = 'T-SEAM';
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await subscribed.get('session/event')!(sessionOf('/proj'), {
      type: 'turn/end',
      turn: 3,
      reason: 'stop',
    });

    expect(parseDiff).toHaveBeenCalledWith('HEAD', '/proj'); // session.header.cwd 优先
    expect(runRules).toHaveBeenCalledWith({ diffFiles: ['src/a.ts'], silent: true });
    expect(generateThinkEntry).toHaveBeenCalledWith(
      ['src/a.ts'],
      [{ rule: 'no-archaeology', pass: true }],
      'T-SEAM',
      { dataDir: '/data/dir' },
    );
    spy.mockRestore();
  });

  it('其余会话事件：零副作用（不进沉淀链）', async () => {
    const spy = errSpy();
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const handler = subscribed.get('session/event')!;

    await handler(sessionOf('/proj'), { type: 'turn/start', turn: 1 });
    await handler(sessionOf('/proj'), { type: 'message/added' });
    await handler(sessionOf('/proj'), undefined);

    expect(parseDiff).not.toHaveBeenCalled();
    expect(runRules).not.toHaveBeenCalled();
    expect(generateThinkEntry).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('turn/end 但工作区无变更：不跑规则、不写沉淀（零副作用）', async () => {
    const spy = errSpy();
    vi.mocked(parseDiff).mockImplementation(() => []);
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await subscribed.get('session/event')!(sessionOf('/proj'), { type: 'turn/end', turn: 2 });

    expect(parseDiff).toHaveBeenCalledTimes(1);
    expect(runRules).not.toHaveBeenCalled();
    expect(generateThinkEntry).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('diff 取数失败：不抛、不进入后续链路（fail-open，不影响 Turn 收尾）', async () => {
    const spy = errSpy();
    vi.mocked(parseDiff).mockImplementation(() => {
      throw new Error('git 不可用');
    });
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await expect(
      subscribed.get('session/event')!(sessionOf('/proj'), { type: 'turn/end', turn: 1 }),
    ).resolves.toBeUndefined();
    expect(runRules).not.toHaveBeenCalled();
    expect(generateThinkEntry).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('数据目录解析失败：沉淀照跑（dataDir 交引擎兜底），不中断链', async () => {
    const spy = errSpy();
    vi.mocked(getDataDir).mockImplementation(() => {
      throw new Error('数据目录不可达');
    });
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await subscribed.get('session/event')!(sessionOf('/proj'), { type: 'turn/end', turn: 1 });

    expect(generateThinkEntry).toHaveBeenCalledWith(['src/a.ts'], expect.anything(), undefined, {
      dataDir: undefined,
    });
    spy.mockRestore();
  });
});
