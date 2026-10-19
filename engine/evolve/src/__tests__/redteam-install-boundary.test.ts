// ============================================================
// redteam-install-boundary.test.ts · v1.6.0 BUG-26
// evolve redteam 安装态断链显式化——runner 路径缺失时 exit 3 + 指引文案
// （不再与「失明（BLIND）」判定撞退出码）。
// 用例：
//   一、负例：mock 不存在路径（SOFAGENT_REDTEAM_RUNNER_DIR 指空目录）→
//      exit 3 + stderr 含「安装态不可用」与「git clone」指引
//   二、正例（仓内回归锚）：--help 无 runner 依赖，行为不变 exit 0
// 执行形态：spawn CLI dist（cli.js）——与 f14-proposer-cli.test.ts 同接线级形态。
// ============================================================
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLI_BIN = path.join(__dirname, '..', '..', 'dist', 'cli.js');

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sof-bug26-'));
}

interface RunResult { status: number | undefined; output: string }

function runCli(args: string[], env: Record<string, string>): RunResult {
  try {
    const output = execFileSync(process.execPath, [CLI_BIN, ...args], {
      encoding: 'utf8',
      cwd: tmpDir(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: String(output) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('BUG-26 · evolve redteam 安装态断链显式 exit 3', () => {
  it('一、runner 缺失（安装态）→ exit 3 + 「属仓内工具面」指引，非 ENOENT 崩溃', () => {
    // 安装态模拟：runner 位于仓内 tools/check/——从 node_modules 内跑 dist 时
    // resolve(__dirname,'..','..','..','tools') 不存在。本用例用 monkey-patch 不可行
    // （CLI 是独立进程），改验证行为契约本身：把 CLI 拷到无 tools 祖先的临时目录跑。
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'evolve-dist'), { recursive: true });
    fs.copyFileSync(CLI_BIN, path.join(dir, 'evolve-dist', 'cli.js'));
    // 依赖的 dist 邻件（cli.js import 链）不拷——只需跑到 redteam 分支的
    // existsSync 校验（它先于 runner spawn，且不 import 其它模块）。
    let out = '';
    let code: number | undefined;
    try {
      out = execFileSync(process.execPath, [path.join(dir, 'evolve-dist', 'cli.js'), 'redteam', '--list'], {
        encoding: 'utf8',
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      code = 0;
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      code = e.status;
    }
    expect(code).toBe(3);
    expect(out).toContain('red-team-runner 属仓内工具面，安装态不可用');
    expect(out).toContain('git clone');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('二、仓内 --help 行为不变（exit 0，帮助面不触发 runner 校验）', () => {
    const r = runCli(['--help'], {});
    expect(r.status).toBe(0);
    expect(r.output).toContain('redteam');
  });
});
