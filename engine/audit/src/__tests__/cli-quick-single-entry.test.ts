// ============================================================
// cli-quick-single-entry.test.ts · quick→full 自动路由单提示行为锁
// v1.5.7 F6：cli-quick 带 --doctor 等完整引擎 flag 自动路由 full 时，
// 实测前两行叠打两条弃用提示（quick 侧 + full 侧各一条）。
// 修法：路由分支置 SOFAGENT_SINGLE_ENTRY=1（与 umbrella 路由同键同义），
// quick 侧提示已在上方打印、full 侧（index.ts）同键静默。
//
// 实测路径：spawn 真实 dist 产物（对齐仓内「行为面 dist 直调」先例，
//   见 cli-crash-exit-code.test.ts / cli-quick-unknown-args.test.ts 同址同手法）。
// 两条用例：
//   ① 路由场景（--doctor）：全输出只含一条弃用提示（quick 侧那条）；
//   ② 直连场景（普通 quick 审计参数）：quick 侧提示仍在（用户直敲旧命令可见）。
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
// build 产物——本测试在 npm test 前置 build 后运行
const QUICK_BIN = join(here, '..', '..', 'dist', 'cli-quick.js');

/** 弃用提示判据（quick 侧文案锚） */
const DEPRECATION_ANCHOR = '已收敛到单入口';

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  }
});

interface RunResult { status: number | undefined; output: string }

/**
 * 跑 QUICK_BIN 子进程并取「退出码 + stdout/stderr 合流」——不因非 0 退出而抛。
 * 用 spawnSync（而非 execFileSync）：弃用提示打在 stderr、正常报告打在 stdout，
 * 必须两流都收（execFileSync 成功路径只给 stdout，会漏掉 stderr 上的提示）。
 */
function runQuick(args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): RunResult {
  const r = spawnSync(process.execPath, [QUICK_BIN, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('quick→full 自动路由单提示（v1.5.7 F6）', () => {
  it('dist 产物存在（前置：npm run build --workspace=engine/audit）', () => {
    if (!existsSync(QUICK_BIN)) {
      throw new Error(`dist 产物缺失: ${QUICK_BIN}——先 npm run build --workspace=engine/audit`);
    }
  });

  it('路由场景（--doctor）：全输出仅一条弃用提示（quick 侧；full 侧同键静默）', () => {
    // 隔离 HOME：--doctor 路由进完整引擎后可能触碰全局安装态，隔离防宿主污染。
    // SOFAGENT_HOME_ALLOWED_PREFIXES 显式放行临时目录（前缀校验是 F24 第 4 项的
    // fail-loud 守卫——不放行会以「越界」崩溃，见 cli-crash-exit-code.test.ts 同坑）。
    const iso = mkdtempSync(join(tmpdir(), 'sofagent-f6-route-'));
    tmpDirs.push(iso);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SOFAGENT_HOME: join(iso, 'sofagent-home'),
      SOFAGENT_HOME_ALLOWED_PREFIXES: iso,
    };
    delete env.SOFAGENT_SINGLE_ENTRY;
    const r = runQuick(['--doctor'], { env, cwd: iso });
    const hits = r.output.split(DEPRECATION_ANCHOR).length - 1;
    expect(hits).toBe(1);
  });

  it('直连场景（普通 quick 参数）：quick 侧弃用提示仍在', () => {
    // 直敲旧命令（无完整引擎 flag、无 SOFAGENT_SINGLE_ENTRY）→ 提示必须可见
    const iso = mkdtempSync(join(tmpdir(), 'sofagent-f6-direct-'));
    tmpDirs.push(iso);
    // 最小 git 仓：quick 审计需要 git 上下文（无 flag 路由 → 不进 spawn 分支）
    execFileSync('git', ['init', '-q'], { cwd: iso });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: iso });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SOFAGENT_HOME: join(iso, 'sofagent-home'),
      SOFAGENT_HOME_ALLOWED_PREFIXES: iso,
    };
    delete env.SOFAGENT_SINGLE_ENTRY;
    const r = runQuick([], { env, cwd: iso });
    expect(r.output).toContain(DEPRECATION_ANCHOR);
    // 且不含 full 侧那条（未路由——直连不叠两条）
    const fullAnchor = 'sofagent-audit-full';
    expect(r.output.includes(fullAnchor)).toBe(false);
  });
});
