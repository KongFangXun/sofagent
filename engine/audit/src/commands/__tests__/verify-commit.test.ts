// ============================================================
// verify-commit.test.ts · --verify-commit 归因歧义收紧测试（F-15）
// 路径②（parentSha === 用户传入的 X）存在取证洗白歧义：commit N 的 SHA
// 天然是 commit N+1 审计记录的 parentSha——绕过提交 B 后紧跟的正常提交 C
// 会让 verify-commit B 命中 C 的审计记录（B 从未被审计却拿到绿灯）。
// 收紧规则：路径②命中输出 ⚠️ 警示性中性结果 + EXIT=1，不再放绿灯。
// 路径 0（commitSha 精确匹配）与路径①（parentSha === parentOf(X)）不受影响。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

// 隔离：SOFAGENT_DATA 指向临时目录，loadHistory 读临时 history.jsonl
const savedData = process.env.SOFAGENT_DATA;

let repoDir: string;
let dataDir: string;

function git(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

function commitFile(name: string, content: string, msg: string, noVerify = false): string {
  writeFileSync(join(repoDir, name), content);
  git(['add', '.']);
  git(['commit', '-m', msg, ...(noVerify ? ['--no-verify'] : [])]);
  return git(['rev-parse', 'HEAD']);
}

// 写一条 pre-commit 审计记录（模拟 commit-msg hook 写入：
// parentSha = 审计时 HEAD = 新提交的父提交）
function preCommitEntry(parentSha: string, task: string, exitCode: number): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    diffRange: '--cached',
    task,
    exitCode,
    ruleResults: [],
    diffFileCount: 1,
    commitPhase: 'pre-commit',
    parentSha,
    commitSha: '',
  });
}

describe('--verify-commit 归因歧义收紧（F-15）', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    repoDir = join(tmpdir(), `sofagent-vc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dataDir = join(tmpdir(), `sofagent-vc-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(join(dataDir, 'audit'), { recursive: true });
    process.env.SOFAGENT_DATA = dataDir;

    git(['init', '-q']);
    git(['config', 'user.email', 't@t.com']);
    git(['config', 'user.name', 'tester']);
    writeFileSync(join(repoDir, 'base.txt'), 'base');
    git(['add', '.']);
    git(['commit', '-m', 'base commit']);
  });

  afterEach(() => {
    process.env.SOFAGENT_DATA = savedData;
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* cleanup */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* cleanup */ }
    vi.restoreAllMocks();
  });

  /**
   * 运行 runVerifyCommit 并捕获 exit code 与 stdout。
   * verify.ts 内部 git 命令继承 process.cwd()——须先 chdir 到测试仓库。
   * process.exit 会抛出（vi mock），同步捕获后返回。
   */
  async function runVerifyCommit(hash: string): Promise<{ code: number | undefined; out: string }> {
    const prevCwd = process.cwd();
    process.chdir(repoDir);
    const captured: string[] = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__EXIT__${code ?? 0}`);
    }) as never);

    const { runVerifyCommit: fn } = await import('../verify');
    let code: number | undefined;
    try {
      fn(hash);
    } catch (e) {
      const m = String((e as Error).message).match(/^__EXIT__(\d+)$/);
      if (m) code = parseInt(m[1]!, 10);
      else throw e;
    } finally {
      process.chdir(prevCwd);
    }
    return { code, out: captured.join('\n') };
  }

  it('攻击链：--no-verify 绕过 B 后正常提交 C → verify-commit B 走路径②输出 ⚠️ 且 EXIT=1（不再洗白）', async () => {
    // commit B（绕过）——工作区写敏感内容，--no-verify 提交，无审计记录
    const bypassSha = commitFile('leak.txt', 'sk-placeholder-12345', 'feat: 绕过提交', true);

    // commit C（正常）——审计记录的 parentSha = B 的 SHA（攻击链核心：SHA 撞上）
    const cSha = commitFile('c.txt', 'normal', 'feat: 正常功能提交');

    // history 只有 C 的审计记录（parentSha = bypassSha）
    writeFileSync(join(dataDir, 'audit/history.jsonl'), preCommitEntry(bypassSha, 'feat: 正常功能提交', 0) + '\n');

    // 攻击者主题行混淆变体（B 与 C 同 subject）也不应洗白——路径②与主题无关恒警示
    const r = await runVerifyCommit(bypassSha.slice(0, 10));
    expect(r.code).toBe(1);
    expect(r.out).toContain('⚠️');
    expect(r.out).not.toContain('✅ commit');
    void cSha;
  });

  it('攻击链变体：B 与 C 使用相同 subject → 路径②仍输出 ⚠️ 且 EXIT=1（主题行相同也放不了绿灯）', async () => {
    const subject = 'fix: same subject bypass';
    // 密钥格式运行时拼接（占位符分段），不字面写完整密钥串——避免被 A2 误伤且不污染仓库
    const fakeSecret = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const bypassSha = commitFile('leak2.txt', fakeSecret, subject, true);
    commitFile('c2.txt', 'normal', subject);

    writeFileSync(join(dataDir, 'audit/history.jsonl'), preCommitEntry(bypassSha, subject, 0) + '\n');

    const r = await runVerifyCommit(bypassSha.slice(0, 10));
    expect(r.code).toBe(1);
    expect(r.out).toContain('⚠️');
    expect(r.out).not.toContain('✅ commit');
  });

  it('回归：正常提交 C 自身 verify-commit 走路径①（parentSha === parentOf(C) = B）仍 ✅ EXIT=0', async () => {
    const bypassSha = commitFile('leak.txt', 'sk-placeholder-12345', 'feat: 绕过提交', true);
    const cSha = commitFile('c.txt', 'normal', 'feat: 正常功能提交');

    writeFileSync(join(dataDir, 'audit/history.jsonl'), preCommitEntry(bypassSha, 'feat: 正常功能提交', 0) + '\n');

    const r = await runVerifyCommit(cSha.slice(0, 10));
    expect(r.code).toBe(0);
    expect(r.out).toContain('✅');
    expect(r.out).toContain('按父提交 SHA 匹配');
  });

  it('回归：无审计记录的陌生 commit 仍 ❌ EXIT=1（原未命中路径不变）', async () => {
    // history 放一条 parentSha 与本仓库任何父子关系都无关的记录（避免路径①误撞）
    const unrelatedParent = '5'.repeat(40);
    writeFileSync(join(dataDir, 'audit/history.jsonl'), preCommitEntry(unrelatedParent, 'chore: unrelated', 0) + '\n');
    const strangerSha = commitFile('stranger.txt', 'x', 'chore: stranger');
    const r = await runVerifyCommit(strangerSha.slice(0, 10));
    expect(r.code).toBe(1);
    expect(r.out).toContain('❌');
    expect(r.out).toContain('未找到审计记录');
  });
});
