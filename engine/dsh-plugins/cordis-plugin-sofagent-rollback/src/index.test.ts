// ============================================================
// cordis-plugin-rollback · 插件单测（v1.4.0 交付五 · v1.5.0 章十补接线面）
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pluginDefault, { pluginMeta, capability, invoke } from './index';
import { listSnapshots, restoreSnapshot } from '@sofagent/core';

// 章十：快照两源（listSnapshots → restoreSnapshot）打桩成确定性替身——
// 接线正确性 = 定位口径（追加序取末条）与透传参数，与引擎内部实现无关。
vi.mock('@sofagent/core', () => ({
  listSnapshots: vi.fn(() => [{ sha: 'sha-latest' }]),
  restoreSnapshot: vi.fn(async () => ['src/a.ts']),
}));

// 必要的 schemastery 替身：settings.register 分支的 require 会拿它构造 shape——缺席走 catch 降级
vi.mock('@deepseek-ai/schemastery', () => ({
  boolean: () => ({ __type: 'boolean' }),
  string: () => ({ __type: 'string' }),
  object: (shape: unknown) => ({ __type: 'object', shape }),
}));

describe('cordis-plugin-sofagent-rollback', () => {
  it('插件元数据完整（id/version/description/seam）', () => {
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-rollback');
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
// 断言面：① 订阅真实存在 ② disposer 收进复合卸载契约
//        ③ **默认关档不动作**（破坏性动作不得因接线而改变既有行为）
//        ④ 显式开档才走 listSnapshots → restoreSnapshot（追加序取末条 = 最新）
//        ⑤ 无快照 / 恢复失败 → 零动作、不抛（fail-open，不阻断宿主错误处理）
// ─────────────────────────────────────────────────────────────────────────────
describe('章十 · seam 事件接线', () => {
  const MANIFEST = require('../../plugins.json') as {
    plugins: Array<{
      id: string;
      seamHandlers?: string[];
      bridges?: Array<{ pkg: string; api: string }>;
    }>;
  };
  const entry = MANIFEST.plugins.find((p) => p.id === 'cordis-plugin-sofagent-rollback');
  const declared: string[] = entry?.seamHandlers ?? [];
  const ONE = ['agent/error'];

  const errSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOFAGENT_PROJECT_ROOT = '/proj';
    vi.mocked(listSnapshots).mockImplementation(() => [{ sha: 'sha-latest' }]);
    vi.mocked(restoreSnapshot).mockImplementation(async () => ['src/a.ts']);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SOFAGENT_PROJECT_ROOT;
  });

  /**
   * 宿主 ctx 替身。
   * @param flag 档位值——`'true'` 显式开档；`'false'` 显式关档；`undefined` 走声明默认值（关）
   */
  function hostCtx(flag?: string) {
    const subscribed = new Map<string, (...a: unknown[]) => unknown>();
    const disposed: string[] = [];
    const on = vi.fn((event: string, handler: (...a: unknown[]) => unknown) => {
      subscribed.set(event, handler);
      return () => {
        disposed.push(event);
      };
    });
    const settings =
      flag === undefined
        ? undefined
        : {
            register: vi.fn(() => ({
              get: () => ({ rollbackOnError: flag }),
              watch: () => () => undefined,
            })),
          };
    return { ctx: { provide: vi.fn(() => () => undefined), on, settings }, subscribed, disposed };
  }

  const errorPayload = () => ({ turn: 2, step: 3, error: new Error('agent 崩了') });

  it('seamHandlers 与 plugins.json 声明同集合（三处对账的插件侧）', () => {
    expect(declared.slice().sort()).toEqual([...ONE].sort());
  });

  it('bridges 声明覆盖快照两源（listSnapshots / restoreSnapshot）', () => {
    const keys = (entry?.bridges ?? []).map((b) => `${b.pkg}.${b.api}`).sort();
    expect(keys).toEqual(['@sofagent/core.listSnapshots', '@sofagent/core.restoreSnapshot'].sort());
  });

  it('apply 经 ctx.on 订阅 agent/error；复合 disposer 逐个反注册', async () => {
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

  it('默认关档（无 settings 面）：订阅在位但零动作——接线不改变既有行为', async () => {
    const spy = errSpy();
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await expect(subscribed.get('agent/error')!(errorPayload())).resolves.toBeUndefined();

    expect(listSnapshots).not.toHaveBeenCalled();
    expect(restoreSnapshot).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("显式关档（rollbackOnError = 'false'）：有快照也不撤销", async () => {
    const spy = errSpy();
    const { ctx, subscribed } = hostCtx('false');
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await subscribed.get('agent/error')!(errorPayload());

    expect(listSnapshots).not.toHaveBeenCalled();
    expect(restoreSnapshot).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('显式开档：取追加序末条（最新）快照恢复，参数逐字透传', async () => {
    const spy = errSpy();
    vi.mocked(listSnapshots).mockImplementation(() => [{ sha: 'sha-old' }, { sha: 'sha-latest' }]);
    const { ctx, subscribed } = hostCtx('true');
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await subscribed.get('agent/error')!(errorPayload());

    expect(listSnapshots).toHaveBeenCalledWith('/proj');
    expect(restoreSnapshot).toHaveBeenCalledWith('/proj', 'sha-latest'); // 末尾即最新
    spy.mockRestore();
  });

  it('显式开档但无可用快照：不撤销（先跑一次审计才会建快照）', async () => {
    const spy = errSpy();
    vi.mocked(listSnapshots).mockImplementation(() => []);
    const { ctx, subscribed } = hostCtx('true');
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await subscribed.get('agent/error')!(errorPayload());

    expect(restoreSnapshot).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('显式开档但恢复失败：不抛（fail-open，不阻断宿主错误处理）', async () => {
    const spy = errSpy();
    vi.mocked(restoreSnapshot).mockImplementation(async () => {
      throw new Error('快照损坏');
    });
    const { ctx, subscribed } = hostCtx('true');
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);

    await expect(subscribed.get('agent/error')!(errorPayload())).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
