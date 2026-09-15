// ============================================================
// cordis-plugin-sofagent · 插件单测（v1.4.8 第8批 · 聚合编排层；v1.4.9 P2 合并批：9→6）
// ============================================================
// 断言面 = 三条硬约束（P2 合并后口径）：
//   ① 只编排不重实现 —— 注册的服务只有 6 个原子插件 + 本层的 sofagent.suite
//   ② 逐个降级不整挂失败 —— 缺一个原子插件，其余 5 个照常；failed 精确报出缺的那一个
//   ③ 不替代细粒度插件 —— 编排清单与 plugins.json 的 suite 段逐条一致（6 个原子插件全在）
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import plugin, { pluginMeta, capability, suite } from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(HERE, '..');
const SIBLINGS_DIR = path.resolve(PLUGIN_DIR, '..');

/** 聚合层 apply 的结果快照（与 src/index.ts 的 SuiteReport 同形） */
interface SuiteReport {
  loaded: string[];
  failed: Array<{ name: string; reason: string }>;
  total: number;
  capability: string;
  viaHost: string[];
  viaDirect: string[];
  unloadHook: 'ctx.on' | 'apply-return';
}

/** 假 ctx 的可选宿主能力开关（用于覆盖三条挂载/卸载路径） */
interface CtxOptions {
  /** 是否提供宿主惯用法 ctx.plugin（false = 裸 ctx，只能回落直呼 apply） */
  withHostPlugin?: boolean;
  /** 是否提供宿主生命周期钩子 ctx.on('dispose', …) */
  withDisposeHook?: boolean;
  /** ctx.plugin 是否抛错（模拟宿主拒收 → 必须回落直呼） */
  rejectHostMount?: boolean;
}

/**
 * 构造鸭子类型 ctx：**对齐 cordis 4.x 的真实契约**（实测 ~/.dsh/.../@deepseek-ai/cordis 4.0.2）。
 *   ① `provide(name, value)` **返回 disposer**（宿主实现走 fiber.effect，返回反注册函数）；
 *   ② `plugin(p)` 挂载插件并返回 ForkScope（含 `dispose`），句柄 dispose 时反向撤销该子插件的注册；
 *   ③ `on('dispose', fn)` 登记卸载监听。
 * 🔴 刻意不 import 任何宿主类型——与适配层红线同口径（ctx: unknown + 结构访问）。
 */
function makeCtx(opts: CtxOptions = {}) {
  const { withHostPlugin = true, withDisposeHook = true, rejectHostMount = false } = opts;
  const services = new Map<string, unknown>();
  /** ctx.on('dispose') 登记的回调（模拟宿主卸载事件触发面） */
  const onDispose: Array<() => unknown> = [];
  /** 经宿主路径挂载过的插件（断言「走的是宿主惯用法」） */
  const mounted: unknown[] = [];

  const ctx: Record<string, unknown> = {
    services,
    onDispose,
    mounted,
    provide: (name: string, service: unknown): (() => void) => {
      services.set(name, service);
      return () => {
        services.delete(name);
      };
    },
    sofagent: {},
  };

  if (withHostPlugin) {
    ctx.plugin = (p: { apply?: (c: unknown) => unknown }): { dispose: () => Promise<void> } => {
      if (rejectHostMount) throw new Error('宿主拒收（合成：契约不符）');
      mounted.push(p);
      // 宿主职责：调用插件 apply 并**按 fiber 托管其返回的 disposer**
      const childDisposers: Array<() => unknown> = [];
      const ret = typeof p?.apply === 'function' ? p.apply(ctx) : undefined;
      if (typeof ret === 'function') childDisposers.push(ret as () => unknown);
      return {
        dispose: async (): Promise<void> => {
          for (const undo of childDisposers.splice(0).reverse()) await undo();
        },
      };
    };
  }
  if (withDisposeHook) {
    ctx.on = (event: string, listener: () => unknown): (() => void) => {
      if (event === 'dispose') onDispose.push(listener);
      return () => {
        const i = onDispose.indexOf(listener);
        if (i >= 0) onDispose.splice(i, 1);
      };
    };
  }
  return ctx as {
    services: Map<string, unknown>;
    onDispose: Array<() => unknown>;
    mounted: unknown[];
    sofagent: Record<string, unknown>;
    plugin?: unknown;
    on?: unknown;
    provide: (name: string, service: unknown) => () => void;
  };
}

/** 取聚合层自己 provide 的报告 */
function reportOf(ctx: ReturnType<typeof makeCtx>): SuiteReport {
  return ctx.services.get('sofagent.suite') as SuiteReport;
}

describe('cordis-plugin-sofagent', () => {
  it('插件元数据完整（id/version/seam/description 与 package.json SSOT 对齐）', () => {
    const pkg = require('../package.json') as { version: string };
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent');
    expect(pluginMeta.version).toBe(pkg.version); // SSOT 对齐：版本跟随主版本（读 package.json）
    expect(pluginMeta.seam).toBe('non-seam:plugin-suite');
    expect(pluginMeta.description).toContain(`seam: ${pluginMeta.seam}`); // 描述不滞后于契约
  });

  it('编排清单恰好 6 条（v1.4.9 P2 合并批），且与 plugins.json 的 suite 段逐条一致', () => {
    const manifest = require('../../plugins.json') as {
      plugins: Array<{ id: string; kind?: string; capability: string; suite?: string[] }>;
    };
    const entry = manifest.plugins.find((p) => p.id === pluginMeta.id);
    expect(entry, 'plugins.json 未登记聚合条目').toBeDefined();
    expect(entry!.kind).toBe('suite'); // 聚合型条目（bridgePkg/bridgeApi 语义不适用）
    expect(capability).toBe(entry!.capability);
    expect(suite).toHaveLength(6);
    expect(suite.map(([, pkg]) => pkg).sort()).toEqual([...entry!.suite!].sort());
  });

  it('P2 合并落位：SUITE 不含已并入的 -gate/-ontology/-commons 三包', () => {
    const pkgs = suite.map(([, pkg]) => pkg);
    expect(pkgs).not.toContain('cordis-plugin-sofagent-gate');
    expect(pkgs).not.toContain('cordis-plugin-sofagent-ontology');
    expect(pkgs).not.toContain('cordis-plugin-sofagent-commons');
  });

  it('一次 apply 挂满 6 个能力，且 6 个 sofagent.* 服务逐个可访问', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx();
    await plugin.apply(ctx);
    const report = reportOf(ctx);
    expect(report.total).toBe(6);
    expect(report.failed).toEqual([]);
    expect([...report.loaded].sort()).toEqual(suite.map(([key]) => key).sort());
    // 逐个断言（不只看数组长度）——每个原子插件的能力确实挂上了
    for (const [key] of suite) {
      const svc = ctx.services.get(`sofagent.${key}`) as { invoke?: unknown } | undefined;
      expect(svc, `sofagent.${key} 未注册`).toBeDefined();
      expect(typeof svc!.invoke).toBe('function');
    }
    errSpy.mockRestore();
  });

  it('只编排不重实现：注册面 = 6 个原子服务 + sofagent.suite，本层不复制任何子插件逻辑', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx();
    await plugin.apply(ctx);
    const names = [...ctx.services.keys()].sort();
    expect(names).toHaveLength(7); // 6 原子 + 1 聚合报告
    expect(names.filter((n) => n !== 'sofagent.suite')).toHaveLength(6);
    expect(reportOf(ctx).capability).toBe(capability);
    errSpy.mockRestore();
  });

  it('逐个降级：某原子插件缺 dist/ → 其余 5 个照常加载，failed 精确报出缺的那一个', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fdeDist = path.join(SIBLINGS_DIR, 'cordis-plugin-sofagent-fde', 'dist', 'index.js');
    const stash = `${fdeDist}.__hidden__`;
    expect(fs.existsSync(fdeDist), '前置条件：fde 已 build（npm run build）').toBe(true);
    fs.renameSync(fdeDist, stash);
    try {
      // 清模块缓存后重新 import——否则拿到的是前面测试已缓存的 fde 模块，注入不生效
      vi.resetModules();
      const fresh = (await import('./index')).default;
      const ctx = makeCtx();
      await fresh.apply(ctx);
      const report = reportOf(ctx);
      expect(report.loaded).toHaveLength(5);
      expect(report.loaded).not.toContain('fde');
      expect(report.failed).toHaveLength(1); // 精确 1 个
      expect(report.failed[0].name).toBe('fde');
      expect(report.failed[0].reason.length).toBeGreaterThan(0);
      expect(ctx.services.get('sofagent.fde')).toBeUndefined();
      // 其余 5 个能力仍逐个可用（缺一个不让其余 5 个挂掉）
      for (const [key] of suite.filter(([k]) => k !== 'fde')) {
        expect(ctx.services.get(`sofagent.${key}`), `sofagent.${key} 应仍可用`).toBeDefined();
      }
    } finally {
      if (fs.existsSync(stash)) fs.renameSync(stash, fdeDist);
      errSpy.mockRestore();
    }
  });

  it('A2·挂载路径：ctx.plugin 在场时走宿主惯用法（逐插件带 inject 声明），不静默直呼', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx();
    await plugin.apply(ctx);
    const report = reportOf(ctx);
    expect(report.viaHost, '宿主路径挂载数').toHaveLength(6);
    expect(report.viaDirect, '宿主可用时回落路径应为空').toEqual([]);
    expect(ctx.mounted, '宿主 ctx.plugin 收到的插件数').toHaveLength(6);
    expect(report.loaded.length + report.failed.length, '守恒：loaded + failed = total').toBe(report.total);
    // 走宿主路径的插件必须自带 inject 声明——否则宿主无从做就绪门控（A2 根因 1）
    for (const p of ctx.mounted as Array<{ inject?: readonly string[] }>) {
      expect(Array.isArray(p.inject), '插件对象须声明 inject').toBe(true);
      expect(p.inject).toContain('settings');
      expect(p.inject).toContain('dynamicCordisRunner');
    }
    errSpy.mockRestore();
  });

  it('A2·卸载路径：聚合层卸载后本层与 6 个原子服务全部反注册（不留残留）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx();
    const dispose = await plugin.apply(ctx);
    expect(ctx.services.get('sofagent.suite'), '装载后本层报告服务在').toBeDefined();
    expect(ctx.services.get('sofagent.audit'), '装载后原子服务在').toBeDefined();
    expect(ctx.services.size, '装载面 = 6 原子 + 1 聚合报告').toBe(7);
    // 宿主生命周期钩子已登记（双保险之一）
    expect(ctx.onDispose).toHaveLength(1);
    expect(reportOf(ctx).unloadHook).toBe('ctx.on');
    // 触发卸载（模拟宿主 dispose 事件）
    await ctx.onDispose[0]();
    expect(ctx.services.get('sofagent.suite'), '卸载后本层服务须反注册').toBeUndefined();
    expect(ctx.services.get('sofagent.audit'), '卸载后原子服务须反注册').toBeUndefined();
    expect(ctx.services.size, '卸载后 ctx 上不留任何 sofagent.* 服务').toBe(0);
    // 幂等：apply 返回值再调一次不抛、不复活
    await dispose();
    expect(ctx.services.size).toBe(0);
    errSpy.mockRestore();
  });

  it('A2·回落路径：宿主拒收 ctx.plugin 时回落直呼 apply，逐个降级不整挂失败', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx({ rejectHostMount: true });
    await plugin.apply(ctx);
    const report = reportOf(ctx);
    expect(report.viaHost, '宿主拒收 → 不应有宿主路径挂载').toEqual([]);
    expect(report.viaDirect, '全部走回落直呼').toHaveLength(6);
    expect(report.loaded).toHaveLength(6);
    expect(report.failed).toEqual([]);
    expect(report.loaded.length + report.failed.length).toBe(report.total);
    errSpy.mockRestore();
  });

  it('A2·静默空转已修：子插件无 apply 时计入 failed，不得谎报 loaded', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doMock('cordis-plugin-sofagent-evolve', () => ({ default: { pluginMeta: {}, capability: '' } })); // 无 apply
    vi.resetModules();
    try {
      const fresh = (await import('./index')).default;
      const ctx = makeCtx({ withHostPlugin: false, withDisposeHook: false }); // 裸 ctx：必走回落分支
      await fresh.apply(ctx);
      const report = reportOf(ctx);
      expect(report.loaded, '无 apply 者不得计入 loaded').not.toContain('evolve');
      expect(report.failed.map((f) => f.name)).toContain('evolve');
      expect(report.loaded).toHaveLength(5);
      expect(report.loaded.length + report.failed.length, '守恒：6 = loaded + failed').toBe(6);
      expect(ctx.services.get('sofagent.evolve'), '缺 apply 者不得注册服务').toBeUndefined();
      expect(report.unloadHook, '裸 ctx 无 ctx.on → 仅靠 apply 返回值').toBe('apply-return');
    } finally {
      vi.doUnmock('cordis-plugin-sofagent-evolve');
      vi.resetModules();
      errSpy.mockRestore();
    }
  });
});
