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

// ============================================================
// v1.4.9 G5b（T4）：连接器注册面测试——准入复用白名单 + 租户隔离
// ============================================================
import { registerConnector, listConnectors, getConnector, loadConnectorPolicy } from '../cli/plugin-gate';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CONN_DIR = mkdtempSync(join(tmpdir(), 'sofagent-connector-gate-'));

describe('G5b · 连接器注册（准入 fail-closed）', () => {
  it('白名单内来源 → 注册成功并可发现（验收 ①）', () => {
    const r = registerConnector(
      { name: 'crm-main', kind: 'saas', source: 'clawhub.ai', capabilities: ['salesforce'] },
      { dataDir: CONN_DIR, policy: POLICY },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.connector.kind).toBe('saas');
      expect(r.connector.sourceKind).toBe('host');
      expect(r.connector.tenant).toBe('default');
    }
    const lst = listConnectors({}, CONN_DIR);
    expect(lst.total).toBe(1);
    expect(lst.connectors[0]!.name).toBe('crm-main');
  });

  it('白名单外来源 → 拒绝（fail-closed，验收 ②）', () => {
    const r = registerConnector(
      { name: 'evil-conn', kind: 'rest', source: 'https://evil.example.com/adapter' },
      { dataDir: CONN_DIR, policy: POLICY },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('source-not-allowed');
    // 拒绝的连接器不出现在清单
    expect(listConnectors({}, CONN_DIR).connectors.some((c) => c.name === 'evil-conn')).toBe(false);
  });

  it('策略为 null（无白名单依据）→ 拒绝一切（空策略全拒）', () => {
    const r = registerConnector(
      { name: 'any-conn', kind: 'db', source: 'github.com' },
      { dataDir: CONN_DIR, policy: null },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('source-not-allowed');
  });

  it('本地路径 glob 白名单内 → 放行（local-path 形态）', () => {
    const r = registerConnector(
      { name: 'internal-db', kind: 'db', source: '/opt/plugins/pg-adapter', capabilities: ['postgres'], endpoint: 'db.internal:5432' },
      { dataDir: CONN_DIR, policy: POLICY },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.connector.sourceKind).toBe('local-path');
  });

  it('git-url 白名单内 → 放行（our-org 仓库形态）', () => {
    const r = registerConnector(
      { name: 'git-adapter', kind: 'rest', source: 'https://github.com/our-org/rest-adapter' },
      { dataDir: CONN_DIR, policy: POLICY },
    );
    expect(r.ok).toBe(true);
  });

  it('invalid-params：name 词法非法 / kind 非法 / source 空 → 拒绝', () => {
    expect(registerConnector({ name: '../escape', kind: 'db', source: 'clawhub.ai' }, { dataDir: CONN_DIR, policy: POLICY }).ok).toBe(false);
    const badKind = registerConnector({ name: 'ok-name', kind: 'grpc' as 'db', source: 'clawhub.ai' }, { dataDir: CONN_DIR, policy: POLICY });
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.reason).toBe('invalid-params');
    expect(registerConnector({ name: 'ok-name', kind: 'db', source: '' }, { dataDir: CONN_DIR, policy: POLICY }).ok).toBe(false);
  });

  it('租户词法非法 → 拒绝（路径穿越面）', () => {
    const r = registerConnector(
      { name: 'tenant-escape', kind: 'db', source: 'clawhub.ai', tenant: '../other' },
      { dataDir: CONN_DIR, policy: POLICY },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-params');
  });

  it('同租户重名 → 拒绝（防静默覆盖）；跨租户同名各自独立', () => {
    const dup = registerConnector(
      { name: 'crm-main', kind: 'saas', source: 'clawhub.ai' },
      { dataDir: CONN_DIR, policy: POLICY },
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe('duplicate-name');
    const other = registerConnector(
      { name: 'crm-main', kind: 'db', source: 'clawhub.ai', tenant: 'acme' },
      { dataDir: CONN_DIR, policy: POLICY },
    );
    expect(other.ok).toBe(true);
  });
});

describe('G5b · 连接器发现（过滤 + 租户隔离 + 与工具分列）', () => {
  it('按类型过滤（kind=db 只返回 db 条目）', () => {
    const { total, connectors } = listConnectors({ kind: 'db' }, CONN_DIR);
    expect(total).toBeGreaterThan(0);
    expect(connectors.every((c) => c.kind === 'db')).toBe(true);
  });

  it('按主机过滤（git-url 来源匹配 hostOf 提取的主机）', () => {
    const { connectors } = listConnectors({ host: 'github.com' }, CONN_DIR);
    expect(connectors.some((c) => c.name === 'git-adapter')).toBe(true);
    expect(connectors.every((c) => c.source.includes('github.com'))).toBe(true);
  });

  it('按本地路径前缀过滤（local-path 形态）', () => {
    const { connectors } = listConnectors({ host: '/opt/plugins' }, CONN_DIR);
    expect(connectors.some((c) => c.name === 'internal-db')).toBe(true);
  });

  it('按能力标签过滤（capability=postgres）', () => {
    const { connectors } = listConnectors({ capability: 'postgres' }, CONN_DIR);
    expect(connectors.some((c) => c.name === 'internal-db')).toBe(true);
    expect(connectors.every((c) => c.capabilities.includes('postgres'))).toBe(true);
  });

  it('租户隔离：default 租户看不到 acme 条目，反之亦然（验收 ④）', () => {
    const def = listConnectors({ tenant: 'default' }, CONN_DIR);
    const acme = listConnectors({ tenant: 'acme' }, CONN_DIR);
    expect(def.connectors.every((c) => c.tenant === 'default')).toBe(true);
    expect(acme.connectors.every((c) => c.tenant === 'acme')).toBe(true);
    expect(def.connectors.some((c) => c.name === 'crm-main')).toBe(true);
    expect(acme.connectors.some((c) => c.name === 'crm-main')).toBe(true); // 跨租户同名各自独立
  });

  it('清单只含连接器字段——不含 MCP 工具注册形态（分列铁律，验收 ③）', () => {
    const { connectors } = listConnectors({}, CONN_DIR);
    for (const c of connectors) {
      // 连接器条目无 handler / inputSchema / roles 等 tool-registry 字段
      expect((c as unknown as Record<string, unknown>).handler).toBeUndefined();
      expect((c as unknown as Record<string, unknown>).inputSchema).toBeUndefined();
      expect((c as unknown as Record<string, unknown>).roles).toBeUndefined();
    }
  });

  it('getConnector：同租户可见 / 跨租户不可见', () => {
    expect(getConnector('crm-main', 'default', CONN_DIR)?.kind).toBe('saas');
    expect(getConnector('crm-main', 'acme', CONN_DIR)?.kind).toBe('db');
    expect(getConnector('crm-main', 'other-tenant', CONN_DIR)).toBeNull();
  });
});

describe('G5b · 注册表与策略 fail-closed 故障注入（铁律 8）', () => {
  it('注册表损坏（非 JSON）→ 空表处理，新注册照常准入路径走', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'sofagent-connector-corrupt-'));
    mkdirSync(join(dir2, 'config'), { recursive: true });
    writeFileSync(join(dir2, 'config', 'connectors.json'), '{broken json!!', 'utf-8');
    // 读损坏表 → 空表（发现面空清单）
    expect(listConnectors({}, dir2).total).toBe(0);
    // 注册路径不受阻（重名判定基于空表——通过；落盘整写覆盖损坏文件）
    const r = registerConnector(
      { name: 'fresh', kind: 'rest', source: 'clawhub.ai' },
      { dataDir: dir2, policy: POLICY },
    );
    expect(r.ok).toBe(true);
    expect(listConnectors({}, dir2).total).toBe(1);
    rmSync(dir2, { recursive: true, force: true });
  });

  it('注册表结构非法（connectors 非数组）→ 空表处理', () => {
    const dir3 = mkdtempSync(join(tmpdir(), 'sofagent-connector-badshape-'));
    mkdirSync(join(dir3, 'config'), { recursive: true });
    writeFileSync(join(dir3, 'config', 'connectors.json'), '{"connectors": "not-an-array"}', 'utf-8');
    expect(listConnectors({}, dir3).total).toBe(0);
    rmSync(dir3, { recursive: true, force: true });
  });

  it('policy.yml 损坏 → null 策略 = 全拒（fail-closed）', () => {
    const dir4 = mkdtempSync(join(tmpdir(), 'sofagent-policy-corrupt-'));
    mkdirSync(join(dir4, 'config'), { recursive: true });
    writeFileSync(join(dir4, 'config', 'policy.yml'), '\t: : bad yaml [', 'utf-8');
    expect(loadConnectorPolicy(dir4)).toBeNull();
    const r = registerConnector({ name: 'x', kind: 'db', source: 'github.com' }, { dataDir: dir4 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('source-not-allowed');
    rmSync(dir4, { recursive: true, force: true });
  });

  it('policy.yml 不存在 → null 策略（缺省全拒——opt-in 语义）', () => {
    const dir5 = mkdtempSync(join(tmpdir(), 'sofagent-policy-absent-'));
    expect(loadConnectorPolicy(dir5)).toBeNull();
    rmSync(dir5, { recursive: true, force: true });
  });
});

rmSync(CONN_DIR, { recursive: true, force: true });
