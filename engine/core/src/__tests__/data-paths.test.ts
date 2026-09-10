// ============================================================
// data-paths.test.ts · getConfigFile 向上遍历查找（原 TODO(v1.4.0) 收口）
// ============================================================
// 场景：git commit 在 monorepo 子目录执行时 process.cwd() 不是项目根——
// getConfigFile 须向上逐级找 .sofagent/config.yml（至 .git 根截断），
// 找不到回退 legacy 路径保持旧行为。
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import {
  getConfigFile,
  resolveTenantDataDir,
  validateTenantId,
  DEFAULT_TENANT,
} from '../data-paths';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sofagent-cfgpath-test-'));
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('getConfigFile 向上遍历查找', () => {
  it('子目录调用向上找到项目根的 config.yml（monorepo 场景）', () => {
    // 测试：proj/.sofagent/config.yml 存在，从 proj/sub/deep 调用应向上命中
    const proj = join(tmp, 'proj-a');
    mkdirSync(join(proj, '.sofagent'), { recursive: true });
    mkdirSync(join(proj, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(proj, '.sofagent', 'config.yml'), 'audit:\n  strict: true\n');
    const found = getConfigFile(join(proj, 'sub', 'deep'));
    expect(found).toBe(join(proj, '.sofagent', 'config.yml'));
  });

  it('到 .git 根仍未命中则截断——不越出仓库找别家的 .sofagent', () => {
    // 测试：outer/.sofagent/config.yml 存在但 inner（有 .git）没有——
    // 从 inner/sub 调用不得上溯到 outer（出仓库后的 config 不属于本项目）
    const outer = join(tmp, 'proj-b');
    mkdirSync(join(outer, '.sofagent'), { recursive: true });
    writeFileSync(join(outer, '.sofagent', 'config.yml'), 'audit:\n  strict: true\n');
    const inner = join(outer, 'inner-repo');
    mkdirSync(join(inner, '.git'), { recursive: true });
    mkdirSync(join(inner, 'sub'), { recursive: true });
    const found = getConfigFile(join(inner, 'sub'));
    // 应回退到 inner/sub 的 legacy 路径（不存在，由 loadConfig fallback 处理）
    expect(found).toBe(join(inner, 'sub', '.sofagent', 'config.yml'));
    expect(existsSync(found)).toBe(false);
  });

  it('当前目录就有 config.yml 直接命中（旧行为不变）', () => {
    // 测试：非子目录场景零回归
    const proj = join(tmp, 'proj-c');
    mkdirSync(join(proj, '.sofagent'), { recursive: true });
    writeFileSync(join(proj, '.sofagent', 'config.yml'), 'audit:\n  strict: true\n');
    expect(getConfigFile(proj)).toBe(join(proj, '.sofagent', 'config.yml'));
  });

  it('无任何 config 命中时回退 legacy 路径（保持旧行为）', () => {
    // 测试：目录树里没有 .sofagent/config.yml → 返回 cwd 下 legacy 路径
    const proj = join(tmp, 'proj-d');
    mkdirSync(proj, { recursive: true });
    expect(getConfigFile(proj)).toBe(join(proj, '.sofagent', 'config.yml'));
  });

  it('显式 startDir 参数优先于 process.cwd（测试隔离语义保留）', () => {
    // 测试：传 startDir 时不受真实 cwd 影响（loadConfig(tmpDir) 隔离依赖）
    const proj = join(tmp, 'proj-e');
    mkdirSync(join(proj, '.sofagent'), { recursive: true });
    writeFileSync(join(proj, '.sofagent', 'config.yml'), 'audit:\n  strict: true\n');
    const found = getConfigFile(proj);
    expect(found).toBe(join(proj, '.sofagent', 'config.yml'));
    expect(dirname(found)).not.toContain(process.cwd());
  });
});

// ═══════════════════════════════════════════════════════════
// G7 多租户 v0（v1.4.7）：租户路径隔离 + 默认兼容
// ═══════════════════════════════════════════════════════════
describe('G7 resolveTenantDataDir 租户路径隔离', () => {
  it('缺省租户返回 data/ 本身——单租户零迁移（data/default/ 不物化）', () => {
    const base = mkdtempSync(join(tmpdir(), 'g7-default-'));
    try {
      expect(resolveTenantDataDir(DEFAULT_TENANT, base)).toBe(base);
      expect(resolveTenantDataDir(undefined, base)).toBe(base); // 缺省链 → default
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('具名租户落在 data/<tenant>/——路径隔离 v0', () => {
    const base = mkdtempSync(join(tmpdir(), 'g7-named-'));
    try {
      expect(resolveTenantDataDir('acme', base)).toBe(join(base, 'acme'));
      expect(resolveTenantDataDir('org-42', base)).toBe(join(base, 'org-42'));
      // 两租户路径互不包含
      const a = resolveTenantDataDir('acme', base);
      const b = resolveTenantDataDir('beta', base);
      expect(a).not.toBe(b);
      expect(a.startsWith(b)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('路径穿越/非法租户名 fail-loud 抛错（不静默降级 default）', () => {
    const base = mkdtempSync(join(tmpdir(), 'g7-bad-'));
    try {
      expect(() => resolveTenantDataDir('../escape', base)).toThrow();
      expect(() => resolveTenantDataDir('a/b', base)).toThrow();
      expect(() => resolveTenantDataDir('', base)).toThrow();
      expect(() => resolveTenantDataDir('.hidden', base)).toThrow(); // 点开头拒绝
      expect(() => validateTenantId('ok-name_1')).not.toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('SOFAGENT_TENANT 环境变量生效（显式参数优先）', () => {
    const base = mkdtempSync(join(tmpdir(), 'g7-env-'));
    const prev = process.env.SOFAGENT_TENANT;
    try {
      process.env.SOFAGENT_TENANT = 'from-env';
      expect(resolveTenantDataDir(undefined, base)).toBe(join(base, 'from-env'));
      expect(resolveTenantDataDir('explicit-wins', base)).toBe(join(base, 'explicit-wins'));
    } finally {
      if (prev === undefined) delete process.env.SOFAGENT_TENANT;
      else process.env.SOFAGENT_TENANT = prev;
      rmSync(base, { recursive: true, force: true });
    }
  });
});
