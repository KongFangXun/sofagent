// ============================================================
// doctor-refresh-e2e.test.ts · v1.5.3 章四 --refresh 端到端（真实 CLI spawn）
// ============================================================
// 上一批「全绿放行」的根因：只测了 runDoctorRefresh 的**函数面**，没测 **CLI 路由面**——
// runDoctorRefresh 未从 core barrel 导出 ⇒ audit CLI 的 --refresh 恒落
// 「不支持 --refresh」分支却无锁；core CLI 更是零 --refresh 路由。
//
// 本文件补**真实子进程**端到端（走 build 产物 dist，与 cli-crash-exit-code.test.ts
// 同址同手法）：
//   Route A（audit CLI · dist/index.js）：
//     - `--doctor --refresh`（探测 core barrel 已导出 runDoctorRefresh）
//     - 裸 `--refresh`（探测 audit index.ts 的 flag 自动路由）
//   Route B（core CLI · dist/cli.js）：
//     - 裸 `--refresh`（探测 cli.ts 的 flag 自动路由）
//     - `doctor --refresh`（子命令形式，与裸 flag 等价）
//
// ⚠️ 前提：先 `npm run build --workspaces`（本测试直调 dist，不读源码）。
// ============================================================
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url)); // engine/core/src/__tests__
const CORE_BIN = join(here, '..', '..', 'dist', 'cli.js');           // engine/core/dist/cli.js
const AUDIT_BIN = join(here, '..', '..', '..', 'audit', 'dist', 'index.js'); // engine/audit/dist/index.js

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  }
});

/** 沙箱项目目录（含既有 config.yml —— 触发备份段，且不触碰真实仓库/~/.sofagent） */
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sofagent-refresh-e2e-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, '.sofagent'), { recursive: true });
  writeFileSync(join(dir, '.sofagent', 'config.yml'), '# e2e 旧配置\naudit: {}\n', 'utf-8');
  return dir;
}

/** 清掉 SOFAGENT_HOME（避免越界 R6 fail-loud 崩溃干扰——与 cli-crash 测试同款防御） */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SOFAGENT_HOME;
  delete env.SOFAGENT_HOME_ALLOWED_PREFIXES;
  return env;
}

interface RunResult { status: number | undefined; output: string }

/** 跑一个真实 CLI 子进程并取「退出码 + stdout/stderr 合流」——不因非 0 退出而抛 */
function run(bin: string, args: string[], cwd: string): RunResult {
  try {
    const output = execFileSync(process.execPath, [bin, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: cleanEnv(),
    });
    return { status: 0, output: String(output) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('doctor --refresh 端到端（v1.5.3 章四 · 真实 CLI spawn）', () => {
  it('dist 产物存在（前置：npm run build --workspaces）', () => {
    for (const bin of [CORE_BIN, AUDIT_BIN]) {
      if (!existsSync(bin)) {
        throw new Error(`dist 产物缺失: ${bin}——先 npm run build --workspaces`);
      }
    }
  });

  it('Route A · audit CLI `--doctor --refresh`：exit 0 + 三段输出（core barrel 已导出 runDoctorRefresh）', () => {
    const dir = sandbox();
    const r = run(AUDIT_BIN, ['--doctor', '--refresh'], dir);
    expect(r.status).toBe(0);
    expect(r.output).toContain('refresh 完成');
    expect(r.output).toContain('已备份当前配置');
    // 反向锁：修复前 core 未导出 ⇒ 恒落此分支 exit 1
    expect(r.output).not.toContain('不支持 --refresh');
  });

  it('Route A · audit CLI 裸 `--refresh`：exit 0（自动路由到 doctor refresh）', () => {
    const dir = sandbox();
    const r = run(AUDIT_BIN, ['--refresh'], dir);
    expect(r.status).toBe(0);
    expect(r.output).toContain('refresh 完成');
  });

  it('Route B · core CLI 裸 `--refresh`：exit 0（cli.ts flag 自动路由，非 Unknown subcommand）', () => {
    const dir = sandbox();
    const r = run(CORE_BIN, ['--refresh'], dir);
    expect(r.status).toBe(0);
    expect(r.output).toContain('refresh 完成');
    // 反向锁：修复前此写法落 default 分支报 Unknown subcommand exit 1
    expect(r.output).not.toContain('Unknown subcommand');
  });

  it('Route B · core CLI `doctor --refresh`：exit 0（子命令形式，与裸 flag 等价）', () => {
    const dir = sandbox();
    const r = run(CORE_BIN, ['doctor', '--refresh'], dir);
    expect(r.status).toBe(0);
    expect(r.output).toContain('refresh 完成');
  });
});
