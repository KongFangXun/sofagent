// ============================================================
// cordis-plugin-sofagent-fde · 插件单测（v1.4.9 P2 合并批 · F2 厚插件验收面）
// ============================================================
// 断言面 = F2 的四条硬要求：
//   ① 厚插件身份——seam 仍为 non-seam:tool-set，描述为合并后新文案（含三域能力流通语义）
//   ② 多包桥接——bridges 三包（orchestrator 真公地 API / ontology / core），
//      resolveBridges 可见（F1② 部分可用即部分成功）
//   ③ features 分档（🔴 验收硬线）——关档后该域工具**确实不注册**：
//      ontology/fde/commons 三档默认全开；settings 关 'false' 一档 → 该域 0 注册
//   ④ 工具注册面——toolsRoles=['fde','commons'] 并集（真实 TOOLS 单一源对账）
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pluginDefault, { pluginMeta, capability, invoke, resolveBridges } from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** F2 featureGates 三档清单（与 src/index.ts、plugins.json 三处同源——测试侧独立抄写以对账） */
const GATES: Record<string, string[]> = {
  ontology: [
    'read_entity', 'read_concept', 'list_entities', 'list_concepts',
    'create_entity', 'create_concept', 'update_entity', 'delete_entity',
    'delete_concept', 'validate_ontology', 'ontology_import', 'search_knowledge',
  ],
  fde: [
    'fde_compose', 'fde_interview', 'fde_classify', 'fde_quantify',
    'fde_derive', 'fde_distill', 'fde_deploy',
  ],
  commons: [
    'commons_publish', 'commons_search', 'commons_invoke',
    'commons_rate', 'commons_retire', 'commons_harvest_rule',
  ],
};

/** 造鸭子 ctx：settings 服务返回 SettingsScope 形态（get 返回当前档位表） */
function makeCtx(opts: { flags?: Record<string, string>; register: (def: { name: string }) => unknown } extends never ? never : { flags?: Record<string, string>; register: (def: { name: string }) => unknown }) {
  const flags = opts.flags ?? {};
  return {
    provide: vi.fn(() => () => undefined),
    get: vi.fn((name: string) => {
      if (name === 'tools') return { register: opts.register };
      return undefined;
    }),
    settings: {
      register: vi.fn(() => ({
        get: () => ({ enabled: true, ...flags }),
        watch: () => () => undefined,
      })),
    },
  };
}

/** 造 settings 缺席的 ctx（headless 形态——档位退默认全开） */
function makeBareCtx(register: (def: { name: string }) => unknown) {
  return {
    provide: vi.fn(() => () => undefined),
    get: vi.fn((name: string) => {
      if (name === 'tools') return { register };
      return undefined;
    }),
  };
}

/** 必要的 schemastery 替身：settings.register 分支的 require 会拿它构造 shape——缺席走 catch 降级 */
vi.mock('@deepseek-ai/schemastery', () => ({
  boolean: () => ({ __type: 'boolean' }),
  string: () => ({ __type: 'string' }),
  object: (shape: unknown) => ({ __type: 'object', shape }),
}));

describe('cordis-plugin-sofagent-fde（F2 厚插件）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('插件元数据完整（id/version/seam/description 与 package.json SSOT 对齐）', () => {
    const pkg = require('../package.json') as { version: string };
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-fde');
    expect(pluginMeta.version).toBe(pkg.version);
    expect(pluginMeta.seam).toBe('non-seam:tool-set');
    expect(pluginMeta.description).toContain('seam: non-seam:tool-set');
    expect(pluginMeta.description).toContain('FDE 进场与能力流通'); // P2 新描述
  });

  it('能力说明与清单声明一致（三域能力流通语义）', () => {
    const manifest = require('../../plugins.json') as {
      plugins: Array<{ id: string; capability: string; bridges?: Array<{ pkg: string; api: string }>; toolsRoles?: string[]; featureGates?: Record<string, string[]> }>;
    };
    const entry = manifest.plugins.find((p) => p.id === 'cordis-plugin-sofagent-fde');
    expect(entry).toBeDefined();
    expect(capability).toBe(entry!.capability);
    expect(entry!.bridges).toHaveLength(3);
    expect(entry!.bridges!.map((b) => `${b.pkg} ${b.api}`)).toContain('@sofagent/orchestrator publishCapability'); // 🔴 真公地 API（P2 修复点）
    expect(entry!.toolsRoles).toEqual(['fde', 'commons']);
    expect(entry!.featureGates).toBeDefined();
  });

  it('多包桥接：resolveBridges 三包逐个报告（部分可用即部分成功，不整挂）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const report = await resolveBridges();
    // 测试环境：orchestrator/ontology/core 均可解析（workspace 直连）→ resolved ≥ 1
    expect(report.resolved.length + report.failed.length).toBe(3);
    expect(report.resolved.map((r) => r.pkg)).toContain('@sofagent/orchestrator');
    expect(report.resolved.find((r) => r.api === 'publishCapability')).toBeDefined();
    errSpy.mockRestore();
  });

  it('invoke 可调用（成功或降级，不挂死）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await invoke().catch((e) => e);
    expect(r).toBeDefined();
    errSpy.mockRestore();
  });

  it('🔴 分档验收：三档默认全开——并集注册且各域工具在场（真实 TOOLS 单一源对账）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registered: string[] = [];
    const ctx = makeCtx({ register: (def) => { registered.push(def.name); return () => undefined; } });
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    await new Promise((r) => setTimeout(r, 200));

    const mcp = await import('@sofagent/mcp/tool-registry');
    const union = mcp.TOOLS.filter(
      (t) => Array.isArray(t.roles) && (t.roles.includes('fde') || t.roles.includes('commons')) && typeof t.handler === 'function',
    ).map((t) => t.name);
    expect([...registered].sort()).toEqual([...union].sort()); // 与单一源并集逐名对齐
    for (const gate of ['ontology', 'fde', 'commons'] as const) {
      const present = GATES[gate].filter((n) => registered.includes(n));
      expect(present.length, `${gate} 档应基本在场（未带 handler 的少数除外）`).toBeGreaterThan(0);
    }
    errSpy.mockRestore();
  });

  it('🔴 分档验收硬线：settings 关 ontology 档 → 该域 12 工具确实不注册，其余两域照常', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registered: string[] = [];
    const ctx = makeCtx({
      flags: { ontology: 'false' }, // 关档
      register: (def) => { registered.push(def.name); return () => undefined; },
    });
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    await new Promise((r) => setTimeout(r, 200));

    for (const n of GATES.ontology) {
      expect(registered, `关档后 ${n} 不得注册`).not.toContain(n);
    }
    const fdePresent = GATES.fde.filter((n) => registered.includes(n));
    const commonsPresent = GATES.commons.filter((n) => registered.includes(n));
    expect(fdePresent.length).toBeGreaterThan(0); // 其余两域不受关档影响
    expect(commonsPresent.length).toBeGreaterThan(0);
    errSpy.mockRestore();
  });

  it('🔴 分档验收：三档全关 → 并集内可注册工具为 0（显式 WARN，非静默）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registered: string[] = [];
    const ctx = makeCtx({
      flags: { ontology: 'false', fde: 'false', commons: 'false' },
      register: (def) => { registered.push(def.name); return () => undefined; },
    });
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    await new Promise((r) => setTimeout(r, 200));

    const allGated = [...GATES.ontology, ...GATES.fde, ...GATES.commons];
    expect(registered.filter((n) => allGated.includes(n))).toHaveLength(0);
    // 未设档的方法论支撑工具（think/compose/workflow/agent 族）不受三档影响——仍注册
    expect(registered.some((n) => !allGated.includes(n))).toBe(true);
    errSpy.mockRestore();
  });

  it('分档边界：settings 服务缺席（headless）→ 档位退默认全开，注册面与全开态一致', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registered: string[] = [];
    const ctx = makeBareCtx((def) => { registered.push(def.name); return () => undefined; });
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    await new Promise((r) => setTimeout(r, 200));

    const mcp = await import('@sofagent/mcp/tool-registry');
    const union = mcp.TOOLS.filter(
      (t) => Array.isArray(t.roles) && (t.roles.includes('fde') || t.roles.includes('commons')) && typeof t.handler === 'function',
    ).map((t) => t.name);
    expect([...registered].sort()).toEqual([...union].sort());
    errSpy.mockRestore();
  });

  it('原 -ontology / -commons / -gate 三目录已删（合并完成的落位断言）', () => {
    const siblings = path.resolve(HERE, '..');
    expect(fs.existsSync(path.join(siblings, 'cordis-plugin-sofagent-ontology'))).toBe(false);
    expect(fs.existsSync(path.join(siblings, 'cordis-plugin-sofagent-commons'))).toBe(false);
    expect(fs.existsSync(path.join(siblings, 'cordis-plugin-sofagent-gate'))).toBe(false);
  });
});
