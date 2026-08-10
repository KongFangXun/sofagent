// ============================================================
// preflight-check.test.mjs · FORGE preflight-check 跑前自检测试
// FORGE preflight-check 跑前自检模块
//
// 覆盖：六项检查各覆盖 PASS 与 FAIL 分支；shouldHalt/passed 语义；
// API 探测最多一次（同 baseURL 去重）；formatPreflightReport 输出。
//
// 用法：npx vitest run FORGE/src/preflight-check.test.mjs
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runPreflight, formatPreflightReport, PREFLIGHT_MIN_DISK_MB } from './driver-base.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ─── 测试夹具 ──────────────────────────────────────────────

let tmpRepo;   // 模拟 repoRoot（真实存在的临时目录）
let tmpRunDir; // 模拟 runDir

beforeEach(() => {
  tmpRepo = mkdtempSync(join(tmpdir(), 'preflight-repo-'));
  tmpRunDir = join(tmpRepo, 'runs', 'loop', '2026-01-01', 'run-01');
});

afterEach(() => {
  try { rmSync(tmpRepo, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** 全 PASS 注入集：管道非 FIFO + fetch 可达 + statfs 充足 */
function allPassInject(overrides = {}) {
  return {
    fstatSyncImpl: () => ({ isFIFO: () => false }),
    fetchImpl: async () => ({ status: 200 }),
    statfsImpl: async () => ({ bavail: 1024 * 1024, bsize: 1024 }), // 1TB
    ...overrides,
  };
}

const MODEL_CONFIGS = {
  A: { model: 'glm-5.2', baseURL: 'https://api.example.com/v4', apiKeyEnv: 'TEST_KEY_A' },
  B: { model: 'glm-5.2', baseURL: 'https://api.example.com/v4', apiKeyEnv: 'TEST_KEY_B' },
};

const TOOL_CONFIG_OK = { globalSoft: 35, globalHard: 45, perspectiveSoft: 15, perspectiveHard: 20 };

// ─── ① cwd 路径 ─────────────────────────────────────────────

describe('preflight ① cwd 路径', () => {
  it('PASS：repoRoot 存在且是目录', async () => {
    const r = await runPreflight({ repoRoot: tmpRepo, __inject: allPassInject() });
    const cwd = r.checks.find(c => c.id === 'cwd');
    expect(cwd.status).toBe('PASS');
  });

  it('FAIL：repoRoot 不存在 → HALT', async () => {
    const r = await runPreflight({
      repoRoot: join(tmpRepo, 'no-such-dir'),
      __inject: allPassInject(),
    });
    const cwd = r.checks.find(c => c.id === 'cwd');
    expect(cwd.status).toBe('FAIL');
    expect(cwd.level).toBe('HALT');
    expect(r.shouldHalt).toBe(true);
    expect(cwd.fix).toBeTruthy(); // 必须给修复建议
  });

  it('FAIL：repoRoot 是文件不是目录 → HALT', async () => {
    const filePath = join(tmpRepo, 'a-file.txt');
    const { writeFileSync } = await import('fs');
    writeFileSync(filePath, 'x');
    const r = await runPreflight({ repoRoot: filePath, __inject: allPassInject() });
    const cwd = r.checks.find(c => c.id === 'cwd');
    expect(cwd.status).toBe('FAIL');
    expect(cwd.level).toBe('HALT');
  });
});

// ─── ② stdout 管道（设计修正：WARN 不 HALT）────────────────

describe('preflight ② stdout 管道', () => {
  it('PASS：终端直连（非 FIFO）', async () => {
    const r = await runPreflight({ repoRoot: tmpRepo, __inject: allPassInject() });
    const out = r.checks.find(c => c.id === 'stdout');
    expect(out.status).toBe('PASS');
  });

  it('FAIL：stdout 是管道 → WARN 不阻塞（shouldHalt 保持 false）', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo,
      __inject: allPassInject({ fstatSyncImpl: () => ({ isFIFO: () => true }) }),
    });
    const out = r.checks.find(c => c.id === 'stdout');
    expect(out.status).toBe('FAIL');
    expect(out.level).toBe('WARN'); // 设计修正：管道不 HALT
    expect(r.shouldHalt).toBe(false); // WARN 不阻塞
    expect(r.warnings.length).toBe(1);
  });
});

// ─── ③ API 可达 ─────────────────────────────────────────────

describe('preflight ③ API 可达', () => {
  beforeEach(() => {
    process.env.TEST_KEY_A = 'k-a';
    process.env.TEST_KEY_B = 'k-b';
  });
  afterEach(() => {
    delete process.env.TEST_KEY_A;
    delete process.env.TEST_KEY_B;
  });

  it('PASS：fetch 返回 HTTP 状态码', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo, modelConfigs: MODEL_CONFIGS, roles: ['A', 'B'],
      __inject: allPassInject(),
    });
    const apis = r.checks.filter(c => c.id === 'api');
    expect(apis.length).toBe(2);
    for (const a of apis) expect(a.status).toBe('PASS');
  });

  it('FAIL：fetch 抛错（网络不可达）→ HALT', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo, modelConfigs: MODEL_CONFIGS, roles: ['A'],
      __inject: allPassInject({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }),
    });
    const api = r.checks.find(c => c.id === 'api');
    expect(api.status).toBe('FAIL');
    expect(api.level).toBe('HALT');
    expect(r.shouldHalt).toBe(true);
  });

  it('最多一次：同 baseURL 的两个角色只探测一次', async () => {
    let callCount = 0;
    await runPreflight({
      repoRoot: tmpRepo, modelConfigs: MODEL_CONFIGS, roles: ['A', 'B'],
      __inject: allPassInject({ fetchImpl: async () => { callCount++; return { status: 200 }; } }),
    });
    expect(callCount).toBe(1); // A/B 共用 baseURL，只探测一次
  });

  it('key 缺失不探测（交给 driver 的 missingEnvs 检查拦截）', async () => {
    delete process.env.TEST_KEY_A;
    let callCount = 0;
    const r = await runPreflight({
      repoRoot: tmpRepo, modelConfigs: MODEL_CONFIGS, roles: ['A', 'B'],
      __inject: allPassInject({ fetchImpl: async () => { callCount++; return { status: 200 }; } }),
    });
    expect(callCount).toBe(1); // 只剩 B 需要探测
    expect(r.shouldHalt).toBe(false);
  });
});

// ─── ④ 工具预算配置 ─────────────────────────────────────────

describe('preflight ④ 工具预算配置', () => {
  it('PASS：soft <= hard', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo, toolConfig: TOOL_CONFIG_OK, __inject: allPassInject(),
    });
    const budget = r.checks.find(c => c.id === 'budget');
    expect(budget.status).toBe('PASS');
  });

  it('FAIL：soft > hard（预算倒挂）→ HALT', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo,
      toolConfig: { globalSoft: 45, globalHard: 35 },
      __inject: allPassInject(),
    });
    const budget = r.checks.find(c => c.id === 'budget');
    expect(budget.status).toBe('FAIL');
    expect(budget.level).toBe('HALT');
    expect(r.shouldHalt).toBe(true);
  });

  it('FAIL：预算不是正数 → HALT', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo,
      toolConfig: { globalSoft: 0, globalHard: -1 },
      __inject: allPassInject(),
    });
    const budget = r.checks.find(c => c.id === 'budget');
    expect(budget.status).toBe('FAIL');
  });

  it('未传 toolConfig → 跳过且 PASS', async () => {
    const r = await runPreflight({ repoRoot: tmpRepo, __inject: allPassInject() });
    const budget = r.checks.find(c => c.id === 'budget');
    expect(budget.status).toBe('PASS');
  });
});

// ─── ⑤ runDir 可写 ──────────────────────────────────────────

describe('preflight ⑤ runDir 可写', () => {
  it('PASS：不存在时幂等自动 mkdir + 写探针成功', async () => {
    const r = await runPreflight({ repoRoot: tmpRepo, runDir: tmpRunDir, __inject: allPassInject() });
    const rd = r.checks.find(c => c.id === 'rundir');
    expect(rd.status).toBe('PASS');
    const { existsSync } = await import('fs');
    expect(existsSync(tmpRunDir)).toBe(true); // 目录已自动创建
  });

  it('FAIL：mkdir 抛权限错误 → HALT', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo, runDir: tmpRunDir,
      __inject: allPassInject({
        mkdirSyncImpl: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; },
      }),
    });
    const rd = r.checks.find(c => c.id === 'rundir');
    expect(rd.status).toBe('FAIL');
    expect(rd.level).toBe('HALT');
    expect(rd.detail).toContain('EACCES');
    expect(r.shouldHalt).toBe(true);
  });

  it('未传 runDir → 跳过且 PASS', async () => {
    const r = await runPreflight({ repoRoot: tmpRepo, __inject: allPassInject() });
    const rd = r.checks.find(c => c.id === 'rundir');
    expect(rd.status).toBe('PASS');
  });
});

// ─── ⑥ 磁盘空间 ─────────────────────────────────────────────

describe('preflight ⑥ 磁盘空间', () => {
  it('PASS：剩余空间充足', async () => {
    const r = await runPreflight({ repoRoot: tmpRepo, __inject: allPassInject() });
    const disk = r.checks.find(c => c.id === 'disk');
    expect(disk.status).toBe('PASS');
  });

  it('FAIL：剩余 < 200MB → WARN 不阻塞', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo,
      // 100MB 可用（bavail * bsize）
      __inject: allPassInject({ statfsImpl: async () => ({ bavail: 100, bsize: 1024 * 1024 }) }),
    });
    const disk = r.checks.find(c => c.id === 'disk');
    expect(disk.status).toBe('FAIL');
    expect(disk.level).toBe('WARN'); // 磁盘是 WARN 不 HALT
    expect(r.shouldHalt).toBe(false);
  });

  it('低版本 Node（无 statfs）→ 自动跳过且 PASS', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo,
      __inject: allPassInject({ statfsImpl: null }), // null = 模拟无 statfs
    });
    const disk = r.checks.find(c => c.id === 'disk');
    expect(disk.status).toBe('PASS');
    expect(disk.detail).toContain('跳过');
  });

  it('statfs 抛错 → 降级跳过不阻塞', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo,
      __inject: allPassInject({ statfsImpl: async () => { throw new Error('ENOSYS'); } }),
    });
    const disk = r.checks.find(c => c.id === 'disk');
    expect(disk.status).toBe('PASS'); // 异常降级为跳过
    expect(r.shouldHalt).toBe(false);
  });

  it('PREFLIGHT_MIN_DISK_MB 常量 = 200', () => {
    expect(PREFLIGHT_MIN_DISK_MB).toBe(200);
  });
});

// ─── 整体语义 ───────────────────────────────────────────────

describe('preflight 整体语义', () => {
  it('全 PASS：shouldHalt=false 且 passed=true', async () => {
    process.env.TEST_KEY_A = 'k-a'; // 有 key 才会探测 API
    try {
      const r = await runPreflight({
        repoRoot: tmpRepo, runDir: tmpRunDir,
        modelConfigs: MODEL_CONFIGS, roles: ['A'], toolConfig: TOOL_CONFIG_OK,
        __inject: allPassInject(),
      });
      // cwd + stdout + api×1 + budget + rundir + disk = 6 项
      expect(r.checks.length).toBe(6);
      expect(r.shouldHalt).toBe(false);
      expect(r.passed).toBe(true);
      expect(r.failures.length).toBe(0);
      expect(r.warnings.length).toBe(0);
    } finally {
      delete process.env.TEST_KEY_A;
    }
  });

  it('任一 HALT 失败 → shouldHalt=true', async () => {
    const r = await runPreflight({
      repoRoot: join(tmpRepo, 'missing'),
      toolConfig: TOOL_CONFIG_OK,
      __inject: allPassInject(),
    });
    expect(r.shouldHalt).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it('只有 WARN 失败 → shouldHalt=false 但 passed=false', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo,
      __inject: allPassInject({
        fstatSyncImpl: () => ({ isFIFO: () => true }),       // 管道 WARN
        statfsImpl: async () => ({ bavail: 1, bsize: 1024 }), // 磁盘 WARN
      }),
    });
    expect(r.shouldHalt).toBe(false);
    expect(r.passed).toBe(false);
    expect(r.warnings.length).toBe(2);
  });
});

// ─── formatPreflightReport ──────────────────────────────────

describe('formatPreflightReport', () => {
  it('全过输出含 ✅ 与 loopName', async () => {
    const r = await runPreflight({ repoRoot: tmpRepo, loopName: 'fresh-eyes-loop', __inject: allPassInject() });
    const report = formatPreflightReport(r);
    expect(report).toContain('preflight-check');
    expect(report).toContain('fresh-eyes-loop');
    expect(report).toContain('✅');
    expect(report).toContain('全部通过');
  });

  it('HALT 失败输出含 ❌ 与修复建议', async () => {
    const r = await runPreflight({
      repoRoot: join(tmpRepo, 'missing'), loopName: 'release-gate-loop',
      __inject: allPassInject(),
    });
    const report = formatPreflightReport(r);
    expect(report).toContain('❌');
    expect(report).toContain('修复建议');
    expect(report).toContain('未通过');
  });

  it('WARN 失败输出含 ⚠️ 但结论是通过', async () => {
    const r = await runPreflight({
      repoRoot: tmpRepo,
      __inject: allPassInject({ fstatSyncImpl: () => ({ isFIFO: () => true }) }),
    });
    const report = formatPreflightReport(r);
    expect(report).toContain('⚠️');
    expect(report).toContain('警告');
  });
});
