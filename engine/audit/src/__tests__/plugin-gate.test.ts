// ============================================================
// plugin-gate.test.ts · 插件来源白名单 + app_tool_policy 测试（v1.4.8 一/二章）
// ============================================================
import { describe, expect, it } from 'vitest';
import {
  classifySource,
  validatePluginSource,
  managedHooksOnly,
  validateAppTool,
  lintAppToolPolicy,
  type PluginPolicy,
} from '../cli/plugin-gate';

const POLICY: PluginPolicy = {
  plugin_sources: {
    allowlist: [
      { kind: 'git-url', pattern: 'https://github.com/our-org/*' },
      { kind: 'host', pattern: 'clawhub.ai' },
      { kind: 'local-path', pattern: '/opt/plugins/*' },
    ],
    allowManagedHooksOnly: true,
  },
  app_tool_policy: {
    apps: {
      'clawhub-plugin-a': ['run_audit', 'get_think'],
    },
  },
};

describe('第一章 · 插件来源白名单（三类来源各测 + 拒绝路径）', () => {
  it('git-url 白名单内（org glob）→ 放行', () => {
    const v = validatePluginSource('https://github.com/our-org/our-plugin', POLICY);
    expect(v.allowed).toBe(true);
  });

  it('git-url 白名单外 org → 拒绝', () => {
    const v = validatePluginSource('https://github.com/evil-org/plugin', POLICY);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toContain('不在企业白名单');
  });

  it('git-url 经 host 项命中（ssh 形态 host=github.com 未列入）→ 拒绝', () => {
    const v = validatePluginSource('git@github.com:anyone/plugin.git', POLICY);
    // github.com 整主机不在白名单（只有 our-org glob 与 clawhub.ai）→ 拒
    expect(v.allowed).toBe(false);
  });

  it('host 白名单内（clawhub.ai）→ 放行', () => {
    const v = validatePluginSource('clawhub.ai', POLICY);
    expect(v.allowed).toBe(true);
  });

  it('host 白名单外 → 拒绝', () => {
    const v = validatePluginSource('skillhub.example.com', POLICY);
    expect(v.allowed).toBe(false);
  });

  it('local-path 白名单内（glob 尾通配）→ 放行', () => {
    const v = validatePluginSource('/opt/plugins/internal-a', POLICY);
    expect(v.allowed).toBe(true);
  });

  it('local-path 白名单外 → 拒绝', () => {
    const v = validatePluginSource('/tmp/unknown-plugin', POLICY);
    expect(v.allowed).toBe(false);
  });

  it('未配置 policy（单机默认）→ 一律放行', () => {
    expect(validatePluginSource('https://github.com/any/any').allowed).toBe(true);
    expect(validatePluginSource('/tmp/x').allowed).toBe(true);
  });

  it('来源形态分类', () => {
    expect(classifySource('https://github.com/a/b').kind).toBe('git-url');
    expect(classifySource('git@github.com:a/b.git').kind).toBe('git-url');
    expect(classifySource('/opt/x').kind).toBe('local-path');
    expect(classifySource('./rel').kind).toBe('local-path');
    expect(classifySource('clawhub.ai').kind).toBe('host');
  });

  it('托管 hook 独裁模式——配置 true 生效 / 未配置 false', () => {
    expect(managedHooksOnly(POLICY)).toBe(true);
    expect(managedHooksOnly(undefined)).toBe(false);
    expect(managedHooksOnly({})).toBe(false);
  });
});

describe('第二章 · app_tool_policy（允许/拒绝/未声明三路径）', () => {
  it('声明的 app×tool → 允许', () => {
    const v = validateAppTool('clawhub-plugin-a', 'run_audit', POLICY);
    expect(v.allowed).toBe(true);
    expect(v.source).toBe('app_tool_policy');
  });

  it('声明的 app 但 tool 未列 → 拒绝（fail-closed）', () => {
    const v = validateAppTool('clawhub-plugin-a', 'write_think', POLICY);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toContain('未声明调用 tool「write_think」');
  });

  it('未声明的 app → 拒绝（fail-closed）', () => {
    const v = validateAppTool('unknown-app', 'run_audit', POLICY);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toContain('未在策略中声明');
  });

  it('未配置 app_tool_policy（单机默认）→ 一律允许', () => {
    expect(validateAppTool('any-app', 'any-tool', undefined).allowed).toBe(true);
    expect(validateAppTool('any-app', 'any-tool', {}).allowed).toBe(true);
  });

  it('安装侧 lint——声明了不存在的 app 出警告', () => {
    const w = lintAppToolPolicy(POLICY, ['some-other-plugin']);
    expect(w.length).toBe(1);
    expect(w[0]).toContain('clawhub-plugin-a');
  });
});
