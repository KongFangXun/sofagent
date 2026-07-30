// ============================================================
// worktree-isolation.test.ts · git worktree 隔离原语测试（v1.2.3）
//
// 覆盖：
// - create() 创建 worktree 目录与分支
// - cleanup() 后目录消失且分支删除
// - create() / cleanup() 幂等
// - 两个 WorktreeHandle 并发写不同文件互不影响
// - sweepStaleWorktrees() 回收死进程 worktree、保留活进程
// - diff() 返回正确的 git diff（含未跟踪新文件）
// - 注册表 jsonl 正确写入
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  createWorktree,
  sweepStaleWorktrees,
  readWorktreeRegistry,
  appendWorktreeRegistry,
  resolveRegistryPath,
  pidAlive,
} from '../worktree-isolation';

let tmpDir: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

/**
 * 列出匹配分支名（--format 不带前缀标记）。
 * 注意：`git branch --list` 对"在 worktree 中检出"的分支会加 '+ ' 前缀，
 * 断言一律走本函数。
 */
function branchList(pattern: string, cwd: string): string {
  return git(['branch', '--list', pattern, '--format=%(refname:short)'], cwd).trim();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-wt-'));
  git(['init'], tmpDir);
  git(['config', 'user.email', 't@t.com'], tmpDir);
  git(['config', 'user.name', 'T'], tmpDir);
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
  git(['add', '.'], tmpDir);
  git(['commit', '-m', 'init'], tmpDir);
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // worktree 残留强制清理失败时忽略（临时目录由 OS 回收）
  }
});

// ════════════════════════════════════════
// create / cleanup 生命周期
// ════════════════════════════════════════

describe('worktree 生命周期', () => {
  it('create() 创建 .sofagent/worktrees/wt-{uuid} 目录与 sofagent/wt-{uuid} 分支', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-1' });
    await h.create();
    try {
      expect(fs.existsSync(h.path)).toBe(true);
      expect(h.path).toContain(path.join('.sofagent', 'worktrees', 'wt-'));
      expect(h.branch).toMatch(/^sofagent\/wt-/);
      // 分支真实存在
      expect(branchList(h.branch, tmpDir)).toBe(h.branch);
      // worktree 内的文件来自主分支 HEAD
      expect(fs.readFileSync(path.join(h.path, 'README.md'), 'utf-8')).toBe('# Test\n');
    } finally {
      await h.cleanup();
    }
  });

  it('cleanup() 后目录消失且分支删除', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-1' });
    await h.create();
    await h.cleanup();
    expect(fs.existsSync(h.path)).toBe(false);
    expect(branchList(h.branch, tmpDir)).toBe('');
  });

  it('create() 幂等——重复调用不报错', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-1' });
    await h.create();
    try {
      await expect(h.create()).resolves.toBeUndefined();
      expect(fs.existsSync(h.path)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it('cleanup() 幂等——重复调用不报错；未 create 直接 cleanup 也不报错', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-1' });
    await h.create();
    await h.cleanup();
    await expect(h.cleanup()).resolves.toBeUndefined();
    // SubAgent 异常退出兜底场景：从未 create 的句柄也能安全 cleanup
    const orphan = createWorktree({ repoRoot: tmpDir, agentId: 'eng-2' });
    await expect(orphan.cleanup()).resolves.toBeUndefined();
  });
});

// ════════════════════════════════════════
// 并发隔离
// ════════════════════════════════════════

describe('并发隔离', () => {
  it('两个 WorktreeHandle 并发：各自 worktree 中写不同文件，互不影响', async () => {
    const a = createWorktree({ repoRoot: tmpDir, agentId: 'agent-a' });
    const b = createWorktree({ repoRoot: tmpDir, agentId: 'agent-b' });
    await Promise.all([a.create(), b.create()]);
    try {
      fs.writeFileSync(path.join(a.path, 'a-only.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.join(b.path, 'b-only.ts'), 'export const b = 2;\n');

      // 文件互相不可见
      expect(fs.existsSync(path.join(a.path, 'b-only.ts'))).toBe(false);
      expect(fs.existsSync(path.join(b.path, 'a-only.ts'))).toBe(false);
      // 主工作树也不可见（未合并前）
      expect(fs.existsSync(path.join(tmpDir, 'a-only.ts'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'b-only.ts'))).toBe(false);

      // 各自 diff 只含自己的文件
      const diffA = await a.diff();
      const diffB = await b.diff();
      expect(diffA).toContain('a-only.ts');
      expect(diffA).not.toContain('b-only.ts');
      expect(diffB).toContain('b-only.ts');
      expect(diffB).not.toContain('a-only.ts');
    } finally {
      await Promise.all([a.cleanup(), b.cleanup()]);
    }
  });
});

// ════════════════════════════════════════
// diff()
// ════════════════════════════════════════

describe('diff()', () => {
  it('返回相对主工作树的 git diff——含未跟踪新文件与已跟踪文件修改', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-1' });
    await h.create();
    try {
      // 未跟踪新文件
      fs.writeFileSync(path.join(h.path, 'feature.ts'), 'export const answer = 42;\n');
      const diffNew = await h.diff();
      expect(diffNew).toContain('feature.ts');
      expect(diffNew).toContain('+export const answer = 42;');

      // 已跟踪文件修改
      fs.appendFileSync(path.join(h.path, 'README.md'), 'extra line\n');
      const diffMod = await h.diff();
      expect(diffMod).toContain('+extra line');
    } finally {
      await h.cleanup();
    }
  });

  it('未 create 调用 diff() 报错', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-1' });
    await expect(h.diff()).rejects.toThrow(/create/);
  });
});

// ════════════════════════════════════════
// 注册表 jsonl
// ════════════════════════════════════════

describe('注册表', () => {
  it('create/cleanup 各记录一行到 data/audit/worktree-registry.jsonl', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-reg' });
    await h.create();
    await h.cleanup();

    const registryPath = resolveRegistryPath(tmpDir);
    expect(registryPath).toContain(path.join('data', 'audit', 'worktree-registry.jsonl'));
    expect(fs.existsSync(registryPath)).toBe(true);

    const mine = readWorktreeRegistry(registryPath).filter((e) => e.agentId === 'eng-reg');
    expect(mine.map((e) => e.event)).toEqual(['create', 'cleanup']);
    expect(mine[0]!.branch).toBe(h.branch);
    expect(mine[0]!.path).toBe(h.path);
    expect(mine[0]!.pid).toBe(process.pid);
  });
});

// ════════════════════════════════════════
// sweepStaleWorktrees
// ════════════════════════════════════════

describe('sweepStaleWorktrees()', () => {
  it('回收"进程已死"的 worktree，保留活进程的；sweep 事件写入注册表', async () => {
    const dead = createWorktree({ repoRoot: tmpDir, agentId: 'dead-agent' });
    const alive = createWorktree({ repoRoot: tmpDir, agentId: 'alive-agent' });
    await dead.create();
    await alive.create();

    // 模拟"杀进程"：把 dead-agent 的注册表最后一条 create 记录 pid
    // 改写为不存在的 pid（999999）——sweep 据此判定进程已死
    const registryPath = resolveRegistryPath(tmpDir);
    appendWorktreeRegistry(registryPath, {
      ts: new Date().toISOString(),
      event: 'create',
      agentId: 'dead-agent',
      branch: dead.branch,
      path: dead.path,
      pid: 999999,
    });

    const result = await sweepStaleWorktrees({ repoRoot: tmpDir });

    // 死进程的 worktree 被回收：目录删除 + 分支删除
    expect(result.swept).toContain(dead.path);
    expect(fs.existsSync(dead.path)).toBe(false);
    expect(branchList(dead.branch, tmpDir)).toBe('');

    // 活进程（当前测试进程）的 worktree 保留
    expect(result.kept).toContain(alive.path);
    expect(fs.existsSync(alive.path)).toBe(true);
    expect(branchList(alive.branch, tmpDir)).toBe(alive.branch);

    // sweep 事件已写入注册表
    const events = readWorktreeRegistry(registryPath).map((e) => e.event);
    expect(events).toContain('sweep');

    await alive.cleanup();
  });

  it('全部 worktree 进程存活时不回收任何目录', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'living' });
    await h.create();
    const result = await sweepStaleWorktrees({ repoRoot: tmpDir });
    expect(result.swept).toHaveLength(0);
    expect(result.kept).toContain(h.path);
    expect(fs.existsSync(h.path)).toBe(true);
    await h.cleanup();
  });
});

// ════════════════════════════════════════
// pidAlive
// ════════════════════════════════════════

describe('pidAlive', () => {
  it('当前进程存活；不存在的 pid 判定为死', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(999999)).toBe(false);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
  });
});
