// ============================================================
// plugin-runner-gate.test.ts · F-9：plugin 规则供应链防线三态测试
// ============================================================
// 此前零防线：ruleset JSON 一行 {"type":"plugin","plugin":"evil-pkg"} 即在
// 审计进程内 require 任意代码（RCE，已在隔离环境实测复现）。
// 修复后三态：
//   ① 无 opt-in → 拒绝（错误含环境变量名与 SECURITY 指引）
//   ② opt-in + 裸名第三方包 → 拒绝（来源白名单）
//   ③ opt-in + @sofagent/ scope → 放行（_setModuleLoader stub 断言调用，不真装包）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _setModuleLoader, _resetModuleLoader, loadPlugin } from '../plugin-runner';

describe('F-9 · plugin 规则供应链防线（默认拒绝 + opt-in + 来源白名单）', () => {
  let savedAllow: string | undefined;

  beforeEach(() => {
    savedAllow = process.env.SOFAGENT_ALLOW_PLUGIN_RULES;
  });

  afterEach(() => {
    if (savedAllow === undefined) delete process.env.SOFAGENT_ALLOW_PLUGIN_RULES;
    else process.env.SOFAGENT_ALLOW_PLUGIN_RULES = savedAllow;
    _resetModuleLoader();
    vi.restoreAllMocks();
  });

  it('① 无 opt-in + type=plugin → 拒绝，错误含环境变量名与 SECURITY 指引', () => {
    delete process.env.SOFAGENT_ALLOW_PLUGIN_RULES;
    expect(() => loadPlugin('evil-pkg')).toThrow(/SOFAGENT_ALLOW_PLUGIN_RULES/);
    expect(() => loadPlugin('evil-pkg')).toThrow(/SECURITY\.md/);
  });

  it('② opt-in + 裸名第三方包 → 拒绝（来源白名单：仅 @sofagent/ 或绝对路径）', () => {
    process.env.SOFAGENT_ALLOW_PLUGIN_RULES = '1';
    expect(() => loadPlugin('evil-pkg')).toThrow(/白名单/);
    expect(() => loadPlugin('relative/path/pkg')).toThrow(/白名单/);
  });

  it('③ opt-in + @sofagent/ scope → 放行（stub 断言调用，不真装包）', () => {
    process.env.SOFAGENT_ALLOW_PLUGIN_RULES = '1';
    const loader = vi.fn(() => ({ run: vi.fn() }));
    _setModuleLoader(loader);
    loadPlugin('@sofagent/fake-plugin');
    expect(loader).toHaveBeenCalledWith('@sofagent/fake-plugin');
  });

  it('④ opt-in + 绝对路径 → 放行（本地开发形态）', () => {
    process.env.SOFAGENT_ALLOW_PLUGIN_RULES = '1';
    const loader = vi.fn(() => ({ run: vi.fn() }));
    _setModuleLoader(loader);
    loadPlugin('/tmp/dev-plugin.js');
    expect(loader).toHaveBeenCalledWith('/tmp/dev-plugin.js');
  });
});
