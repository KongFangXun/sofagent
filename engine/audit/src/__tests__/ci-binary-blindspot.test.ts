// ============================================================
// ci-binary-blindspot.test.ts · BUG-20 回归——二进制盲区三方口径统一
//
// 背景（三方矛盾）：
//   SECURITY.md / docs/LIMITATIONS.md 承诺：A2 对新增二进制输出 WARN（不拦截提交）；
//   rule-a2 注释默认 warn；但 commit-msg hook 恒传 --ci ⇒ ciMode 分支恒升 FAIL
//   ——本地每次 commit 都按 CI 语义拦 .bin，被拦用户顺手 --no-verify 绕全部规则。
//
// 修复语义（判据三面）：
//   ① hook 模板不再恒传 --ci（改传 --silent，输出面不变——--ci 本就隐含它）；
//   ② hook 读 .sofagent/config.yml 的 A2.ciBinaryBlindSpot: fail 时追加
//      --ci-binary=fail（缺省不追加 = 本地 WARN，与文档一致）；
//   ③ 引擎 --ci 场景判据不变恒 FAIL（CI 直跑不受本开关影响）。
//
// 本文件覆盖 ①②（模板静态断言 + 沙箱仓 hook→引擎端到端）与 ③（引擎 CLI 直跑）。
// 规则层单测见 rule-a2.test.ts 的「二进制盲区 --ci-binary 传参开关（BUG-20）」。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execFileSync, spawnSync } from 'child_process';

const HOOK = resolve(__dirname, '../../hooks/commit-msg');
const ENGINE_ENTRY = resolve(__dirname, '../../dist/index.js');

/** 迷你引擎 dist 脚手架参照 init.test.ts 先例（F-28 双 package.json + 迷你 dist） */
function makeSandboxRepo(): { repo: string; home: string } {
  const repo = mkdtempSync(join(tmpdir(), `bug20-repo-${Date.now()}`));
  const home = mkdtempSync(join(tmpdir(), `bug20-home-${Date.now()}`));
  mkdirSync(join(home, 'internal'), { recursive: true });
  // 迷你 dist：SOFAGENT_AUDIT_ENTRY 显式注入指向真引擎（构建产物），
  // 哈希基准绕行——init.test.ts 同款 SOFAGENT_HOME 隔离先例。
  return { repo, home };
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

describe('BUG-20：commit-msg hook 模板静态断言', () => {
  it('模板不再恒传 --silent --ci 组合（本地 hook 语义与 CI 解耦）', () => {
    const tpl = readFileSync(HOOK, 'utf-8');
    // 引擎调用行不得再出现 --silent --ci 相邻组合（--ci 会置 ciMode=true，
    // A2 二进制分支恒 FAIL——正是 BUG-20 的根因形态）
    expect(tpl).not.toContain('--silent --ci ');
    expect(tpl).not.toContain('--silent --ci"');
  });

  it('模板含 A2.ciBinaryBlindSpot config 读取 + --ci-binary=fail 追加逻辑', () => {
    const tpl = readFileSync(HOOK, 'utf-8');
    expect(tpl).toContain('ciBinaryBlindSpot');
    expect(tpl).toContain('--ci-binary=fail');
    // 只认精确键值（fail），warn/缺省不追加
    expect(tpl).toContain("grep -q 'ciBinaryBlindSpot:[[:space:]]*fail'");
  });
});

describe('BUG-20：沙箱仓 hook→引擎端到端（/tmp 隔离，SOFAGENT_HOME 放行 /tmp）', () => {
  let repo: string;
  let home: string;
  const binBytes = Buffer.from([0x00, 0x01, 0x02, 0x89, 0xff, 0xd4, 0x90, 0x8b, 0x03, 0x04]);

  beforeEach(() => {
    const sb = makeSandboxRepo();
    repo = sb.repo;
    home = sb.home;
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 't@t.com');
    git(repo, 'config', 'user.name', 'tester');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', '.');
    // 初始 commit 绕过 hook（被测 hook 尚未装）——init.test.ts 同款 -c core.hooksPath 旁路
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'init'], { cwd: repo });
    // 安装被测 hook 模板（真实安装形态——可执行）
    writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), readFileSync(HOOK, 'utf-8'));
    execFileSync('chmod', ['755', join(repo, '.git', 'hooks', 'commit-msg')]);
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
    try { rmSync(home, { recursive: true, force: true }); } catch { /* */ }
  });

/** 沙箱环境（vitest 全局 SOFAGENT_DATA 会盖过 SOFAGENT_HOME——init.test.ts F-17 同款显式双设） */
function sandboxEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SOFAGENT_HOME: home,
    SOFAGENT_DATA: join(home, 'data'),
    SOFAGENT_HOME_ALLOWED_PREFIXES: `/tmp:${tmpdir()}`,
    // 显式注入真引擎（构建产物）——commit-msg-hijack.test.ts 同款先例；
    // 沙箱仓无 engine/audit/dist ⇒ dist 完整性块自然跳过，不依赖全局包
    SOFAGENT_AUDIT_ENTRY: ENGINE_ENTRY,
  };
}

/** 提交一个新增二进制文件，返回 { code, out }（stdout+stderr 合并——hook 的 WARN 行打在 stderr） */
function commitBinary(msg: string): { code: number; out: string } {
  writeFileSync(join(repo, 'data.bin'), binBytes);
  git(repo, 'add', 'data.bin');
  const r = spawnSync('git', ['commit', '-m', msg], { cwd: repo, encoding: 'utf-8', env: sandboxEnv() });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

  it('验收 1a：默认配置（无 config.yml）提交 data.bin → WARN 放行（commit 成功）', () => {
    const r = commitBinary('feat: add binary payload');
    // WARN = 引擎 exit 1 → hook 放行（hook 对 exit 1 不阻断）→ commit 成功 exit 0
    expect(r.code).toBe(0);
    // 警告可见：commit 输出含 sofagent 警告行（hook 对 exit 1 打「检测到警告，但允许 commit」）
    expect(r.out).toContain('检测到警告');
    expect(r.out).toContain('二进制');
    // commit 确实落库
    expect(git(repo, 'log', '-1', '--pretty=%s')).toContain('binary payload');
  }, 60000);

  it('验收 1b：config A2.ciBinaryBlindSpot: fail 后重试 → FAIL 阻止（commit exit 非零）', () => {
    // 首笔默认放行（同上一用例语义，此处只为让仓库回到干净态）
    const warm = commitBinary('feat: first binary');
    expect(warm.code).toBe(0);
    // 配置升拦截（.sofagent/config.yml——hook 读取点；无签名裸 YAML 走 WARN 提示不阻断）
    mkdirSync(join(repo, '.sofagent'), { recursive: true });
    writeFileSync(join(repo, '.sofagent', 'config.yml'), 'A2:\n  ciBinaryBlindSpot: fail\n');
    writeFileSync(join(repo, 'b.bin'), binBytes);
    git(repo, 'add', 'b.bin');
    const blocked = (() => {
      const r = spawnSync('git', ['commit', '-m', 'feat: second binary should block'], { cwd: repo, encoding: 'utf-8', env: sandboxEnv() });
      return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    })();
    // FAIL = 引擎 exit 2 → hook exit 2 → git commit 失败
    expect(blocked.code).not.toBe(0);
    expect(blocked.out).toContain('commit 已阻止');
    expect(blocked.out).toContain('ciBinaryBlindSpot=fail');
    // 二进制未入库（commit 被拦）
    expect(git(repo, 'log', '--all', '--pretty=%s', '--', 'b.bin')).not.toContain('second binary');
  }, 60000);

  it('验收 2（引擎面）：CI 直跑 --diff HEAD~1..HEAD --ci 含 .bin → FAIL 不变（exit 2）', () => {
    // 先经 hook 放行一笔含 .bin 的 commit（默认 WARN 路径）
    const warm = commitBinary('feat: ci fixture binary');
    expect(warm.code).toBe(0);
    // CI 直跑：--ci 场景判据不变恒 FAIL（exit 2——execFileSync 会抛，捕获断言）
    let ciCode = 0;
    let ciOut = '';
    try {
      ciOut = execFileSync('node', [ENGINE_ENTRY, '--diff', 'HEAD~1..HEAD', '--ci'], {
        cwd: repo,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: sandboxEnv(),
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      ciCode = e.status ?? 1;
      ciOut = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(ciCode).toBe(2);
    expect(ciOut).toContain('CI 场景二进制入库默认拦截');
  }, 60000);
});
