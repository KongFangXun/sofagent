// ============================================================
// cli-quick-single-entry.test.ts · 旧命令 shim 退役后的「零弃用提示」行为锁
//
// 沿革：
//   v1.5.7 F6 —— cli-quick 带 --doctor 等完整引擎 flag 自动路由 full 时曾叠打两条弃用提示；
//     修法是路由分支置 SOFAGENT_SINGLE_ENTRY=1，使 full 侧同键静默 ⇒ 当时锁定「全输出恰好一条提示」。
//   v1.5.9 退役 —— 12 个旧命令 shim 的兼容期已届满（登记 v1.5.6 + 一个 minor），
//     按 v2.0.0 章六「兼容层退役清单」显式退役：**旧 bin 名与弃用提示一并移除**。
//     ⇒ 本测试随之**反向**：两种调用形态下都**不得再出现弃用提示**（提示存在反而是回潮）。
//
// 实测路径：spawn 真实 dist 产物（对齐仓内「行为面 dist 直调」先例）。
// 两条用例：
//   ① 路由场景（--doctor）：全输出零弃用提示；
//   ② 直连场景（普通 quick 审计参数）：同样零弃用提示（直敲也不再有 shim 提示）。
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

/** 已退役的弃用提示锚（出现即回潮） */
const DEPRECATION_ANCHOR = '已收敛到单入口';
/** 旧命令名锚（退役后不应再出现在输出里） */
const LEGACY_CMD_ANCHOR = 'sofagent-audit-full';

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  }
});

interface RunResult { status: number | undefined; output: string }

/**
 * 跑 QUICK_BIN 子进程并取「退出码 + stdout/stderr 合流」——不因非 0 退出而抛。
 * 用 spawnSync（而非 execFileSync）：本用例要证明 stderr 上**没有**提示，
 * 必须两流都收（execFileSync 成功路径只给 stdout，会漏看 stderr）。
 */
function runQuick(args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): RunResult {
  const r = spawnSync(process.execPath, [QUICK_BIN, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('旧命令 shim 退役后零弃用提示（v1.5.9 退役 · 承接 v1.5.7 F6）', () => {
  it('dist 产物存在（前置：npm run build --workspace=engine/audit）', () => {
    if (!existsSync(QUICK_BIN)) {
      throw new Error(`dist 产物缺失: ${QUICK_BIN}——先 npm run build --workspace=engine/audit`);
    }
  });

  it('路由场景（--doctor）：全输出零弃用提示', () => {
    // 隔离 HOME：--doctor 路由进完整引擎后可能触碰全局安装态，隔离防宿主污染。
    // SOFAGENT_HOME_ALLOWED_PREFIXES 显式放行临时目录（前缀校验是 F24 第 4 项的
    // fail-loud 守卫——不放行会以「越界」崩溃，见 cli-crash-exit-code.test.ts 同坑）。
    const iso = mkdtempSync(join(tmpdir(), 'sofagent-retire-route-'));
    tmpDirs.push(iso);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SOFAGENT_HOME: join(iso, 'sofagent-home'),
      SOFAGENT_HOME_ALLOWED_PREFIXES: iso,
    };
    const r = runQuick(['--doctor'], { env, cwd: iso });
    expect(r.output.includes(DEPRECATION_ANCHOR)).toBe(false);
  });

  it('直连场景（普通 quick 参数）：同样零弃用提示，且无旧命令名', () => {
    const iso = mkdtempSync(join(tmpdir(), 'sofagent-retire-direct-'));
    tmpDirs.push(iso);
    // 最小 git 仓：quick 审计需要 git 上下文（无 flag 路由 → 不进 spawn 分支）
    execFileSync('git', ['init', '-q'], { cwd: iso });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: iso });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SOFAGENT_HOME: join(iso, 'sofagent-home'),
      SOFAGENT_HOME_ALLOWED_PREFIXES: iso,
    };
    const r = runQuick([], { env, cwd: iso });
    expect(r.output.includes(DEPRECATION_ANCHOR)).toBe(false);
    expect(r.output.includes(LEGACY_CMD_ANCHOR)).toBe(false);
  });
});
