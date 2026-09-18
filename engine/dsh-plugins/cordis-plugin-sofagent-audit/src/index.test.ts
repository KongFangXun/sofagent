// ============================================================
// cordis-plugin-sofagent-audit · 插件单测（v1.4.9 P2 合并批 · F3 验收吸收面）
// ============================================================
// 断言面 = F3 的三条硬要求：
//   ① seam 四值声明——原三值 + agent/turn-stopping（吸收原 -gate 的验收门禁 seam）
//   ② settings 验收门禁独立开关——acceptanceGate 字段在场且默认 'true'
//   ③ 原 -gate 目录已删（合并完成的落位断言）
// ============================================================

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pluginDefault, { pluginMeta, capability, invoke } from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 必要的 schemastery 替身：settings.register 分支的 require 会拿它构造 shape——缺席走 catch 降级 */
vi.mock('@deepseek-ai/schemastery', () => ({
  boolean: () => ({ __type: 'boolean' }),
  string: () => ({ __type: 'string' }),
  object: (shape: unknown) => ({ __type: 'object', shape }),
}));

// 章十：agent/turn-stopping 的续跑指令经宿主消息工厂构造（`@deepseek-ai/dsh-llm`）——
// 打桩成确定性替身，避免用例依赖宿主包是否装在当前环境（缺席时 handler 会 fail-open，
// 那样就测不到真正的续跑路径）。
vi.mock('@deepseek-ai/dsh-llm', () => ({
  createUserMessage: (input: Record<string, unknown>) => ({ __fakeUserMessage: true, ...input }),
}));

describe('cordis-plugin-sofagent-audit（F3 验收吸收）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('插件元数据完整（id/version/description/seam 四值）', () => {
    const pkg = require('../package.json') as { version: string };
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-audit');
    expect(pluginMeta.version).toBe(pkg.version); // SSOT 对齐：版本跟随主版本（读 package.json）
    expect(pluginMeta.seam).toBe('tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping');
    expect(pluginMeta.description).toContain('seam: tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping');
    expect(pluginMeta.description).toContain('验收硬门禁'); // P2 新描述
  });

  it('seam 四值：与 plugins.json 清单逐字一致（三载体对账的门禁面）', () => {
    const manifest = require('../../plugins.json') as {
      plugins: Array<{ id: string; seam: string; capability: string }>;
    };
    const entry = manifest.plugins.find((p) => p.id === 'cordis-plugin-sofagent-audit');
    expect(entry).toBeDefined();
    expect(pluginMeta.seam).toBe(entry!.seam);
    expect(capability).toBe(entry!.capability);
    // 四值逐段拆分断言（+ 号并列形态）
    const tokens = entry!.seam.split(' + ').map((s) => s.trim());
    expect(tokens).toEqual(['tools/result', 'tools/pre-execute', 'fs/write-intent', 'agent/turn-stopping']);
  });

  it('settings 验收门禁独立开关：register 收到 acceptanceGate 字段且 base 默认 true', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const register = vi.fn(() => ({ get: () => ({ enabled: true, rules: '24', acceptanceGate: 'true' }), watch: () => () => undefined }));
    const ctx = {
      provide: vi.fn(() => () => undefined),
      settings: { register },
    };
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    expect(register).toHaveBeenCalledTimes(1);
    const [ns, , opts] = register.mock.calls[0] as [string, unknown, { base: Record<string, string> }];
    expect(ns).toBe('sofagent-audit');
    expect(opts.base.rules).toBe('24'); // 既有字段不回归
    expect(opts.base.acceptanceGate).toBe('true'); // F3 新开关，默认开
    errSpy.mockRestore();
  });

  it('能力说明非空', () => {
    expect(capability.length).toBeGreaterThan(10);
  });

  it('invoke 可调用（成功或降级，不挂死）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await invoke().catch((e) => e);
    expect(r).toBeDefined();
    errSpy.mockRestore();
  });

  it('原 -gate 目录已删（合并完成的落位断言）', () => {
    const siblings = path.resolve(HERE, '..');
    expect(fs.existsSync(path.join(siblings, 'cordis-plugin-sofagent-gate'))).toBe(false);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// v1.5.0 章十 · seam 事件接线（seam 从声明到实现）
// 断言面：① 订阅真实存在（ctx.on 的调用形态与事件名集合）② disposer 收进复合卸载契约
//        ③ 拦截位的**真实判定**见效（判定源 = 引擎 checkDangerousCommand / checkAcceptance）
//        ④ 放行位不动作 ⑤ 判据不成立时不拦（fail-open）
// ─────────────────────────────────────────────────────────────────────────────
describe('章十 · seam 事件接线', () => {
  const MANIFEST = require('../../plugins.json') as {
    plugins: Array<{ id: string; seamHandlers?: string[] }>;
  };
  const declared: string[] =
    MANIFEST.plugins.find((p) => p.id === 'cordis-plugin-sofagent-audit')?.seamHandlers ?? [];
  const FOUR = ['tools/result', 'tools/pre-execute', 'fs/write-intent', 'agent/turn-stopping'];

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-audit-seam-'));

  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    delete process.env.SOFAGENT_TASK_ID;
    delete process.env.SOFAGENT_PROJECT_ROOT;
    delete process.env.SOFAGENT_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** 宿主 ctx 替身：记录订阅名 + 保留 disposer（对齐 cordis `ctx.on(event, h) → disposer`） */
  function hostCtx(extra: Record<string, unknown> = {}) {
    const subscribed = new Map<string, (...a: unknown[]) => unknown>();
    const disposed: string[] = [];
    const on = vi.fn((event: string, handler: (...a: unknown[]) => unknown) => {
      subscribed.set(event, handler);
      return () => {
        disposed.push(event);
      };
    });
    return { ctx: { provide: vi.fn(() => () => undefined), on, ...extra }, subscribed, disposed };
  }

  it('seamHandlers 与 plugins.json 声明同集合（三处对账的插件侧）', () => {
    expect(declared.slice().sort()).toEqual([...FOUR].sort());
  });

  it('apply 经 ctx.on 订阅四个事件位；复合 disposer 逐个反注册', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, subscribed, disposed } = hostCtx();
    const disposer = (pluginDefault.apply as (c: unknown) => unknown)(ctx) as
      | (() => Promise<void>)
      | undefined;
    expect([...subscribed.keys()].sort()).toEqual([...FOUR].sort());
    expect(typeof disposer).toBe('function');
    await disposer!();
    expect(disposed.slice().sort()).toEqual([...FOUR].sort());
    errSpy.mockRestore();
  });

  it('tools/pre-execute：危险命令 → deny 决策（真判定源 checkDangerousCommand）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const next = vi.fn(() => 'allow');
    const verdict = await subscribed.get('tools/pre-execute')!(
      { name: 'bash', arguments: { command: 'rm -rf /' } },
      next,
    );
    expect(verdict).toMatchObject({ kind: 'deny' });
    expect(String((verdict as { reason?: unknown }).reason)).toContain('sofagent 工具门禁');
    expect(next).not.toHaveBeenCalled(); // 拦截 = 不调 next（瀑布流被否，工具不执行）
    errSpy.mockRestore();
  });

  it('tools/pre-execute：安全命令与非命令工具都放行（不扩大拦截面）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const handler = subscribed.get('tools/pre-execute')!;

    const next1 = vi.fn(() => 'allow');
    expect(await handler({ name: 'bash', arguments: { command: 'ls -la' } }, next1)).toBe('allow');
    expect(next1).toHaveBeenCalledTimes(1);

    const next2 = vi.fn(() => 'allow');
    expect(await handler({ name: 'read_file', arguments: { path: 'a.md' } }, next2)).toBe('allow');
    expect(next2).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('fs/write-intent：放行接线（调 next 并原样返回其值）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const next = vi.fn(() => 'write-intent');
    const ret = await subscribed.get('fs/write-intent')!({ path: 'x.md' }, { id: 'actor' }, next);
    expect(ret).toBe('write-intent');
    expect(next).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('agent/turn-stopping：无任务标识 → 不拦截（fail-open，无验收可判）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.SOFAGENT_TASK_ID;
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const steer = vi.fn();
    const agent = { steer };
    await expect(subscribed.get('agent/turn-stopping')!({ agent, turn: 1 })).resolves.toBeUndefined();
    expect(steer).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('agent/turn-stopping：验收未通过 → 续跑一次；同 turn 不重复；未定义验收不拦', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 真实验收定义：grep-absent 命中标记文件 → 该条件不通过（无需跑 build/test，确定且快）
    // ⚠️ criterion.path 的语义是**相对 projectRoot**（引擎侧 `join(projectRoot, path)`），
    // 传绝对路径会被拼成 `<proj>/<abs>` → 目标不存在 → 引擎按「零命中」判**通过**（假绿）。
    const proj = path.join(tmp, 'proj');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'marker.txt'), 'SOFAGENT_ACCEPTANCE_MARKER\n');
    const dataDir = path.join(tmp, 'data');
    const orch = require('@sofagent/orchestrator') as {
      saveAcceptanceDefinition: (d: string, def: unknown) => string;
    };
    orch.saveAcceptanceDefinition(dataDir, {
      taskId: 't-seam',
      criteria: [
        { type: 'grep-absent', pattern: 'SOFAGENT_ACCEPTANCE_MARKER', path: 'marker.txt' },
      ],
    });

    process.env.SOFAGENT_DATA = dataDir;
    process.env.SOFAGENT_PROJECT_ROOT = proj;
    process.env.SOFAGENT_TASK_ID = 't-seam';
    const { ctx, subscribed } = hostCtx();
    (pluginDefault.apply as (c: unknown) => unknown)(ctx);
    const handler = subscribed.get('agent/turn-stopping')!;
    const steer = vi.fn();
    const agent = { steer };

    await handler({ agent, turn: 1 });
    expect(steer).toHaveBeenCalledTimes(1); // 验收不过 → 续跑一条修正指令
    await handler({ agent, turn: 1 });
    expect(steer).toHaveBeenCalledTimes(1); // 同一 (agent, turn) 至多一次（防无限续跑）
    await handler({ agent, turn: 2 });
    expect(steer).toHaveBeenCalledTimes(2); // 新 turn 重新判定

    process.env.SOFAGENT_TASK_ID = 't-undefined'; // 未定义验收 → failedCount=-1 → 不拦
    await handler({ agent, turn: 3 });
    expect(steer).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });
});
