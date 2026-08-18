// ============================================================
// verify-commit.test.ts · --verify-commit 归因消歧测试
// parentSha 匹配后叠加 commit 主题行二次校验，防跨 commit 误认领：
// commit N 的 SHA 天然是 commit N+1 审计记录的 parentSha——绕过提交 B 后
// 紧跟的正常提交 C 会让 B 的 verify-commit 命中 C 的审计记录（假 PASS）。
// 消歧规则：记录 task（hook 写入时来自 commit message 主题行）与被验证
// commit 的 message 主题行一致才认领；不一致不认领，报未审计非 0 退出。
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

// 写一条 pre-commit 审计记录（模拟 commit-msg hook 写入：task = commit 主题行，
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

describe('--verify-commit 归因消歧', () => {
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

  it('绕过场景：相邻 commit 的审计记录（task 主题不匹配）不被认领，报未审计非 0 退出', async () => {
    // commit B（绕过）——工作区写敏感内容，--no-verify 提交，无审计记录
    const bypassSha = commitFile('leak.txt', 'sk-placeholder-12345', 'feat: 绕过提交', true);
    const parentOfBypass = git(['rev-parse', 'HEAD^'], { allowFail: true });

    // commit C（正常）——审计记录的 parentSha = B 的 SHA（攻击链核心：SHA 撞上）
    // 审计记录 task = C 的主题行
    const cSha = commitFile('c.txt', 'normal', 'feat: 正常功能提交');

    // history 只有 C 的审计记录（parentSha = bypassSha）
    writeFileSync(join(dataDir, 'audit/history.jsonl'), preCommitEntry(bypassSha, 'feat: 正常功能提交', 0) + '\n');

    const { code, out } = await runVerifyCommit(bypassSha.slice(0, 10));
    expect(code).toBe(1);
    expect(out).toContain('--no-verify 绕过');
    expect(out).not.toContain('✅ commit');
    // C 自身验证仍应通过（回归保护）
    const c = await runVerifyCommit(cSha.slice(0, 10));
    expect(c.code).toBe(0);
    expect(c.out).toContain('✅');
    void parentOfBypass;
  });

  it('正常提交：task 与 commit 主题一致 → verify-commit 仍 PASS（exit 0）', async () => {
    const baseSha = git(['rev-parse', 'HEAD']);
    // 模拟：在 base 之上审计通过后正常提交（审计记录 task = commit 主题）
    const sha = commitFile('ok.txt', 'ok', 'feat: 消歧正常路径');
    writeFileSync(join(dataDir, 'audit/history.jsonl'), preCommitEntry(baseSha, 'feat: 消歧正常路径', 0) + '\n');

    const { code, out } = await runVerifyCommit(sha.slice(0, 10));
    expect(code).toBe(0);
    expect(out).toContain('✅');
    expect(out).toContain('主题行匹配');
  });

  it('WARN 放行提交：匹配记录 exitCode=1 → 状态显示 WARN，exit 0 语义保留（0=通过/1=WARN/2=FAIL 分流不受消歧影响）', async () => {
    const baseSha = git(['rev-parse', 'HEAD']);
    const sha = commitFile('warn.txt', 'warn-content', 'chore: warn 放行提交');
    // 审计 WARN 放行（exitCode=1）——commit 合法走过审计
    writeFileSync(join(dataDir, 'audit/history.jsonl'), preCommitEntry(baseSha, 'chore: warn 放行提交', 1) + '\n');

    const { code, out } = await runVerifyCommit(sha.slice(0, 10));
    expect(code).toBe(0);
    expect(out).toContain('WARN');
  });
});
