// ============================================================
// cli-crash-exit-code.test.ts · 引擎崩溃专属退出码行为锁
// v1.4.9 P1-15：崩溃码 3 → 4，与 cli-quick 的「非 git 仓库 ⇒ 3」解撞
// ------------------------------------------------------------
// 缺陷（实测两义并存，非推测）：
//   `SOFAGENT_HOME=/tmp/x node dist/cli-quick.js` → 3（引擎崩溃）
//   `cd <非 git 空目录> && node dist/cli-quick.js` → 3（非 git 仓库）
//   同一个 3 承载两种语义 ⇒ 定位只能靠 stderr 猜。
// 修法：崩溃兜底（index.ts / cli-quick.ts 顶部 uncaughtException/unhandledRejection）
//   改用专属码 4，3 留给「非 git 仓库」单义使用。
//
// 实测路径：spawn 真实 dist 产物（对齐仓内「行为面 dist 直调」先例，
//   见 cli-quick-unknown-args.test.ts 同址同手法）。
// ⚠️ 本文件是本项**唯一的漂移兜底**：index.ts 与 cli-quick.ts 的崩溃处理块是
//   手同步的，没有共享常量。任一文件被改回 3 都会让下面的对应用例变红。
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
// build 产物——本测试在 npm test 前置 build 后运行
const FULL_BIN = join(here, '..', '..', 'dist', 'index.js');
const QUICK_BIN = join(here, '..', '..', 'dist', 'cli-quick.js');

/** 引擎崩溃专属码（v1.4.9 P1-15） */
const EXIT_ENGINE_CRASH = 4;
/** 非 git 仓库（cli-quick 口径） */
const EXIT_NOT_GIT_REPO = 3;

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  }
});

/**
 * 构造「越界 SOFAGENT_HOME」环境——触发 core/data-paths.ts 的 R6 fail-loud
 * （throw ⇒ 被 CLI 顶部 uncaughtException 兜底捕获 ⇒ 专属崩溃码）。
 *
 * 必须显式清掉 `SOFAGENT_HOME_ALLOWED_PREFIXES`：开发者本机若放行过 /tmp，
 * 白名单会放过这个路径，崩溃不触发，用例会以「假红」形态失败。
 */
function crashEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, SOFAGENT_HOME: join(tmpdir(), 'sofagent-p115-out-of-prefix') };
  delete env.SOFAGENT_HOME_ALLOWED_PREFIXES;
  return env;
}

interface RunResult { status: number | undefined; output: string }

/** 跑一个 CLI 子进程并取「退出码 + stdout/stderr 合流」——不因非 0 退出而抛。 */
function run(bin: string, args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): RunResult {
  try {
    const output = execFileSync(process.execPath, [bin, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    return { status: 0, output: String(output) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('引擎崩溃专属退出码（v1.4.9 P1-15）', () => {
  it('dist 产物存在（前置：npm run build --workspace=engine/audit）', () => {
    for (const bin of [FULL_BIN, QUICK_BIN]) {
      if (!existsSync(bin)) {
        throw new Error(`dist 产物缺失: ${bin}——先 npm run build --workspace=engine/audit`);
      }
    }
  });

  it('完整引擎（dist/index.js）：崩溃 → exit 4（不是 1，也不是 3）', () => {
    const r = run(FULL_BIN, ['--help'], { env: crashEnv() });
    expect(r.status).toBe(EXIT_ENGINE_CRASH);
    expect(r.output).toContain('引擎异常退出');
    // 撞码回归：修复前此处是 3（与「非 git 仓库」同码）
    expect(r.status).not.toBe(EXIT_NOT_GIT_REPO);
    expect(r.status).not.toBe(1);
  });

  it('quick 入口（dist/cli-quick.js）：崩溃 → exit 4（两侧手同步块不得漂移）', () => {
    const r = run(QUICK_BIN, [], { env: crashEnv() });
    expect(r.status).toBe(EXIT_ENGINE_CRASH);
    expect(r.output).toContain('引擎异常退出');
    expect(r.status).not.toBe(EXIT_NOT_GIT_REPO);
  });

  it('非 git 仓库仍走 exit 3（改码后 3/4 单义可辨——本项修复的实质）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-p115-nogit-'));
    tmpDirs.push(dir);
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.SOFAGENT_HOME;
    delete env.SOFAGENT_HOME_ALLOWED_PREFIXES;
    const r = run(QUICK_BIN, [], { cwd: dir, env });
    expect(r.status).toBe(EXIT_NOT_GIT_REPO);
    expect(r.output).toContain('不在 git 仓库内');
    // 反向锁：非 git 仓库（正常业务分支）绝不能落进崩溃码
    expect(r.status).not.toBe(EXIT_ENGINE_CRASH);
  });
});
