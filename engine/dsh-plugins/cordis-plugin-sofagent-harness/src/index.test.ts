// ============================================================
// cordis-plugin-sofagent-harness · 插件单测（v1.4.8 第8批 · 聚合编排层）
// ============================================================
// 断言面 = 第 8 批的三条硬约束：
//   ① 只编排不重实现 —— 注册的服务只有 9 个原子插件 + 本层的 sofagent.harness
//   ② 逐个降级不整挂失败 —— 缺一个原子插件，其余 8 个照常；failed 精确报出缺的那一个
//   ③ 不替代细粒度插件 —— 编排清单与 plugins.json 的 suite 段逐条一致（9 个原子插件全在）
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import plugin, { pluginMeta, capability, suite } from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(HERE, '..');
const SIBLINGS_DIR = path.resolve(PLUGIN_DIR, '..');

/** 聚合层 apply 的结果快照（与 src/index.ts 的 HarnessReport 同形） */
interface HarnessReport {
  loaded: string[];
  failed: Array<{ name: string; reason: string }>;
  total: number;
  capability: string;
}

/**
 * 构造鸭子类型 ctx：只记录 provide 注册的服务。
 * 🔴 刻意不 import 任何宿主类型——与适配层红线同口径（ctx: unknown + 结构访问）。
 */
function makeCtx() {
  const services = new Map<string, unknown>();
  return {
    services,
    provide: (name: string, service: unknown): void => {
      services.set(name, service);
    },
  };
}

/** 取聚合层自己 provide 的报告 */
function reportOf(ctx: ReturnType<typeof makeCtx>): HarnessReport {
  return ctx.services.get('sofagent.harness') as HarnessReport;
}

describe('cordis-plugin-sofagent-harness', () => {
  it('插件元数据完整（id/version/seam/description 与 package.json SSOT 对齐）', () => {
    const pkg = require('../package.json') as { version: string };
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-harness');
    expect(pluginMeta.version).toBe(pkg.version); // SSOT 对齐：版本跟随主版本（读 package.json）
    expect(pluginMeta.seam).toBe('non-seam:plugin-suite');
    expect(pluginMeta.description).toContain(`seam: ${pluginMeta.seam}`); // 描述不滞后于契约
  });

  it('编排清单恰好 9 条，且与 plugins.json 的 suite 段逐条一致', () => {
    const manifest = require('../../plugins.json') as {
      plugins: Array<{ id: string; kind?: string; capability: string; suite?: string[] }>;
    };
    const entry = manifest.plugins.find((p) => p.id === pluginMeta.id);
    expect(entry, 'plugins.json 未登记 harness').toBeDefined();
    expect(entry!.kind).toBe('suite'); // 聚合型条目（bridgePkg/bridgeApi 语义不适用）
    expect(capability).toBe(entry!.capability);
    expect(suite).toHaveLength(9);
    expect(suite.map(([, pkg]) => pkg).sort()).toEqual([...entry!.suite!].sort());
  });

  it('一次 apply 挂满 9 个能力，且 9 个 sofagent.* 服务逐个可访问', async () => {
    const ctx = makeCtx();
    await plugin.apply(ctx);
    const report = reportOf(ctx);
    expect(report.total).toBe(9);
    expect(report.failed).toEqual([]);
    expect([...report.loaded].sort()).toEqual(suite.map(([key]) => key).sort());
    // 逐个断言（不只看数组长度）——每个原子插件的能力确实挂上了
    for (const [key] of suite) {
      const svc = ctx.services.get(`sofagent.${key}`) as { invoke?: unknown } | undefined;
      expect(svc, `sofagent.${key} 未注册`).toBeDefined();
      expect(typeof svc!.invoke).toBe('function');
    }
  });

  it('只编排不重实现：注册面 = 9 个原子服务 + sofagent.harness，本层不复制任何子插件逻辑', async () => {
    const ctx = makeCtx();
    await plugin.apply(ctx);
    const names = [...ctx.services.keys()].sort();
    expect(names).toHaveLength(10); // 9 原子 + 1 聚合报告
    expect(names.filter((n) => n !== 'sofagent.harness')).toHaveLength(9);
    expect(reportOf(ctx).capability).toBe(capability);
  });

  it('逐个降级：某原子插件缺 dist/ → 其余 8 个照常加载，failed 精确报出缺的那一个', async () => {
    const gateDist = path.join(SIBLINGS_DIR, 'cordis-plugin-sofagent-gate', 'dist', 'index.js');
    const stash = `${gateDist}.__hidden__`;
    expect(fs.existsSync(gateDist), '前置条件：gate 已 build（npm run build）').toBe(true);
    fs.renameSync(gateDist, stash);
    try {
      // 清模块缓存后重新 import——否则拿到的是前面测试已缓存的 gate 模块，注入不生效
      vi.resetModules();
      const fresh = (await import('./index')).default;
      const ctx = makeCtx();
      await fresh.apply(ctx);
      const report = reportOf(ctx);
      expect(report.loaded).toHaveLength(8);
      expect(report.loaded).not.toContain('gate');
      expect(report.failed).toHaveLength(1); // 精确 1 个
      expect(report.failed[0].name).toBe('gate');
      expect(report.failed[0].reason.length).toBeGreaterThan(0);
      expect(ctx.services.get('sofagent.gate')).toBeUndefined();
      // 其余 8 个能力仍逐个可用（缺一个不让其余 8 个挂掉）
      for (const [key] of suite.filter(([k]) => k !== 'gate')) {
        expect(ctx.services.get(`sofagent.${key}`), `sofagent.${key} 应仍可用`).toBeDefined();
      }
    } finally {
      if (fs.existsSync(stash)) fs.renameSync(stash, gateDist);
    }
  });
});
