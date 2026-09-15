// ============================================================
// cordis-plugin-sofagent-audit · 插件单测（v1.4.9 P2 合并批 · F3 验收吸收面）
// ============================================================
// 断言面 = F3 的三条硬要求：
//   ① seam 四值声明——原三值 + agent/turn-stopping（吸收原 -gate 的验收门禁 seam）
//   ② settings 验收门禁独立开关——acceptanceGate 字段在场且默认 'true'
//   ③ 原 -gate 目录已删（合并完成的落位断言）
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
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
