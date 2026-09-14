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

// ============================================================
// P2-8：退出码语义的**披露面**锁（v1.4.9）
// ------------------------------------------------------------
// 缺陷：退出码此前只写在源码头注释里，`--help` 面零披露（quick 侧）
//   或只披露 0/1/2（完整引擎 verbose 侧）——用户（尤其 CI 里）拿到
//   3 / 4 无从查证。本条与 P1-15（解撞码）是同一问题的两面：
//   P1-15 让 3 与 4 语义可分，P2-8 让语义**可查**。
// 修法：两处 `--help` 面补全 0/1/2/3/4 五段语义，与 docs/HANDBOOK.md
//   的 exit code 清单同口径。
// 反向锁：两侧都必须**各自出现** 3 与 4 且绑定不同数字——回归到
//   「止于 0/1/2」或「退回 quick 零披露」都会让下面用例变红。
// ============================================================
describe('退出码 help 披露面（v1.4.9 P2-8）', () => {
  it('quick `--help`：披露全部四个码的语义（改前此处零披露）', () => {
    const r = run(QUICK_BIN, ['--help']);
    expect(r.status).toBe(0);
    expect(r.output).toContain('退出码');
    for (const seg of [
      '0 = 全通过',
      '1 = 有警告',
      '2 = 有违规',
      '3 = 非 git 仓库',
      '4 = 引擎崩溃',
    ]) {
      expect(r.output, `quick --help 缺披露: ${seg}`).toContain(seg);
    }
  });

  it('完整引擎 `--help --verbose`：披露 3 / 4（改前止于 0/1/2）', () => {
    const r = run(FULL_BIN, ['--help', '--verbose']);
    expect(r.status).toBe(0);
    expect(r.output).toContain('退出码');
    expect(r.output).toContain('3=非 git 仓库');
    expect(r.output).toContain('4=引擎崩溃');
    // 反向锁：历史形态「止于 2」不得回归（改前该行以「2=有违规」收尾）
    expect(r.output).not.toMatch(/^退出码: .*2=有违规$/m);
  });

  // ⚠️ 标题如实化（v1.4.9 收尾）：改前写「两侧 help 同口径」，前提本身是错的——
  //   两入口对「非 git 仓库」**本来就不同口径**（quick 给 3、完整引擎给 2）。
  //   本用例真正锁的是「两侧各自披露本入口的 3 / 4 语义」，故只改描述、断言一条不留删。
  it('两侧 help 各自披露本入口的 3 / 4 语义（3 为 quick 专属）', () => {
    const quick = run(QUICK_BIN, ['--help']).output;
    const full = run(FULL_BIN, ['--help', '--verbose']).output;
    for (const [name, out] of [['quick', quick], ['verbose', full]] as const) {
      expect(out, `${name} 缺「非 git 仓库」`).toContain('非 git 仓库');
      expect(out, `${name} 缺「引擎崩溃」`).toContain('引擎崩溃');
    }
  });

  // 🔴 真行为锁（v1.4.9 收尾新增）：两入口对同一处境给**不同**退出码——
  //   这不是缺陷而是**既定分工**：3 = 非 git 仓库是 quick 入口专属；完整引擎把
  //   「非 git 仓库」归入 2 档（`{ exitCode: 2, ..., error: 'NOT_A_GIT_REPO' }`）。
  //   ⚠️ 实测（2026-09-14，`node dist/index.js --silent` @ 空 tmp 目录）→ **exit 2**。
  //   本用例防的是「某天把完整引擎也改成返回 3」——那会让 3 重新变成两义码，
  //   正是 P1-15 解撞码要根治的形态。
  it('完整引擎在非 git 目录：归 2 档，绝不产出 3（3 为 quick 专属）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-p28-nogit-'));
    tmpDirs.push(dir);
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.SOFAGENT_HOME;
    delete env.SOFAGENT_HOME_ALLOWED_PREFIXES;
    // ⚠️ 必须带 --silent：无参数时完整引擎只打印帮助即 exit 0（不进入审计路径），
    //    那样断言「≠3」是**空转**（恒真）——只有走审计路径才真正暴露该码。
    const r = run(FULL_BIN, ['--silent'], { cwd: dir, env });
    expect(r.output).toContain('不在 git 仓库内');
    expect(r.status).not.toBe(EXIT_NOT_GIT_REPO);
    // 实测值锁（先测后写）：本入口把「非 git 仓库」归 2 档
    expect(r.status).toBe(2);
  });
});
