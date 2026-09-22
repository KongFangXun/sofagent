// ============================================================
// cli-quick-unknown-args.test.ts · quick 模式未知参数 fail-loud 行为锁
// v1.4.7 批次 M 任务二：--ruleset* 等语义拼错形态 exit 2（用法错误），
// 纯未知 flag 保留 warn exit 0——CI 假绿直通车封堵。
//
// 实测路径：spawn 真实 dist 产物（对齐仓内「行为面 dist 直调」先例），
// 三形态断言：--rulesets 复数 / --ruleset=security 等号 / --bogus-flag 噪声。
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/cli-quick.js（build 产物——本测试在 npm test 前置 build 后运行）
const QUICK_BIN = join(here, '..', '..', 'dist', 'cli-quick.js');

/** F1 用例的临时仓库（afterAll 统一清理）。 */
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 清理失败不影响判定 */ }
  }
});

describe('cli-quick 未知参数 fail-loud（v1.4.7 M）', () => {
  it('dist 产物存在（前置：npm run build --workspace=engine/audit）', () => {
    if (!existsSync(QUICK_BIN)) {
      throw new Error(`dist 产物缺失: ${QUICK_BIN}——先 npm run build --workspace=engine/audit`);
    }
  });

  it('--rulesets 复数拼错 → exit 2（安全语义形态不静默放行）', () => {
    try {
      execFileSync(process.execPath, [QUICK_BIN, '--rulesets', 'security'], { encoding: 'utf-8' });
      throw new Error('应 exit 2 但 exit 0');
    } catch (err) {
      const e = err as { status?: number; stderr?: string; stdout?: string };
      expect(e.status).toBe(2);
      expect(`${e.stdout ?? ''}${e.stderr ?? ''}`).toContain('未知参数');
    }
  });

  it('--ruleset=security 等号拼错 → exit 2', () => {
    try {
      execFileSync(process.execPath, [QUICK_BIN, '--ruleset=security'], { encoding: 'utf-8' });
      throw new Error('应 exit 2 但 exit 0');
    } catch (err) {
      const e = err as { status?: number };
      expect(e.status).toBe(2);
    }
  });

  it('--bogus-flag 纯噪声 → warn 但 exit 0/1（不升级中断）', () => {
    // 在 git 仓库内跑 quick 审计——审计自身发现决定 exit 0/1，未知 flag 只 warn
    const out = execFileSync(process.execPath, [QUICK_BIN, '--bogus-flag', '--version'], {
      encoding: 'utf-8',
    });
    // --version 走版本打印分支（快路径），未知 flag 不中断
    expect(out).toBeTruthy();
  });
});

// ============================================================
// v1.5.1 F1 · diff 范围有效性 fail-loud 行为锁
// ------------------------------------------------------------
// 缺陷（实测可复现）：`node dist/cli-quick.js nonsense-range` → **exit 0** +
//   「✅ [sofagent] 无文件变更」= 假绿。无效 ref 被 parseDiff 吞成空数组后，
//   与「合法范围确实无变更」共用同一条 exit 0 路径；而同文件对「非 git 仓库」
//   「diff 解析失败」都 fail-loud（exit 3）——唯独无效范围放行，CI 里敲错 ref 即得绿灯。
//
// 修法：显式范围进「空 diff 成功」分支前先验证**可解析**（逐端点 rev-parse）。
//
// 本块双向钉住：无效范围 ⇒ exit 3 + 文案（改前 exit 0）；合法空范围 ⇒ 仍 exit 0
//   （不得把守卫做成「凡空 diff 即红」）；合法有变更范围 ⇒ 不被守卫误拦。
// ============================================================
describe('cli-quick diff 范围有效性（v1.5.1 F1）', () => {
  /** 与 cli-quick「diff 解析失败」路径同码（非 git 仓库 = 3、引擎崩溃 = 4）。 */
  const EXIT_DIFF_PARSE_FAILED = 3;

  interface RunResult { status: number | undefined; output: string }

  /** 跑 dist 产物并取「退出码 + stdout/stderr 合流」——非 0 退出不抛。 */
  function run(args: string[], cwd?: string): RunResult {
    try {
      const output = execFileSync(process.execPath, [QUICK_BIN, ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(cwd === undefined ? {} : { cwd }),
      });
      return { status: 0, output: String(output) };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  it('无效范围 nonsense-range → exit 3 fail-loud（改前：exit 0 + 「无文件变更」假绿）', () => {
    const r = run(['nonsense-range']);
    expect(r.status).toBe(EXIT_DIFF_PARSE_FAILED);
    expect(r.output).toContain('diff 解析失败');
    expect(r.output).toContain('nonsense-range');
    // 反向锁：无效范围绝不能落进成功文案
    expect(r.output).not.toContain('无文件变更');
  });

  it('无效范围的另一种形态（合法语法 + 不存在端点）→ exit 3', () => {
    const r = run(['no-such-ref-xyz..HEAD']);
    expect(r.status).toBe(EXIT_DIFF_PARSE_FAILED);
    expect(r.output).toContain('diff 解析失败');
  });

  it('合法但确实无变更的范围 HEAD..HEAD → 仍 exit 0（守卫不得把空 diff 一律判红）', () => {
    const r = run(['HEAD..HEAD']);
    expect(r.status).toBe(0);
    expect(r.output).toContain('无文件变更');
    expect(r.output).toContain('HEAD..HEAD');
  });

  it('合法且有变更的范围 HEAD~2..HEAD → 不被新守卫误拦（非 3）', () => {
    // 固定口径（CI 浅克隆适配）：本用例依赖 HEAD~2 存在——CI 默认 fetch-depth: 1 下
    // 宿主仓无深层历史，ref 不可解析会被 F1 守卫判 exit 3（本地全历史则绿，假红两连）。
    // 自建三 commit 临时仓显式固定被测口径，不依赖宿主克隆深度；断言强度不变。
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-f1-depth-'));
    tmpDirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 3; i++) {
      execFileSync(
        'git',
        ['-c', 'user.email=t@example.invalid', '-c', 'user.name=f1', 'commit', '--allow-empty', '-q', '-m', `c${i}`],
        { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    }
    const r = run(['HEAD~2..HEAD'], dir);
    expect(r.status).not.toBe(EXIT_DIFF_PARSE_FAILED);
    expect(r.output).not.toContain('diff 解析失败');
  });

  it('默认范围在根 commit 仓库仍走空树补审（exit 0，不被新守卫误判为无效范围）', () => {
    // 硬约束锁：守卫必须**只封「非默认范围的无效 ref」**这一条路径。默认范围
    // `HEAD~1..HEAD` 在根 commit 仓库里同样「不可解析」（无 HEAD~1），若守卫前置到
    // hasBaseline 分支之前，v1.4.5 P1 的根 commit 空树补审会被打成 exit 3——本用例双向钉住。
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-f1-rootcommit-'));
    tmpDirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync(
      'git',
      ['-c', 'user.email=t@example.invalid', '-c', 'user.name=f1', 'commit', '--allow-empty', '-q', '-m', 'init'],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const r = run([], dir);
    expect(r.status).toBe(0);
    expect(r.output).not.toContain('diff 解析失败');
  });
});
