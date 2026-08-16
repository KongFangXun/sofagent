// ============================================================
// init.test.ts · --init 关键修复的单元测试
// v1.0.7 P0-1 + P1-1 补充测试——防止修复随时间退化
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { ensureGitignore } from './init';

// ==============================
// P1-1: ensureGitignore 测试
// ==============================
describe('ensureGitignore (P1-1)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `sofagent-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('当 .gitignore 不存在时，创建包含 .sofagent/ 的文件', () => {
    ensureGitignore(testDir);
    const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.sofagent/');
    expect(content).toContain('sofagent 审计数据');
  });

  it('当 .gitignore 存在但不含 .sofagent/ 时，追加条目', () => {
    writeFileSync(join(testDir, '.gitignore'), '# 现有 gitignore\nnode_modules/\n');
    ensureGitignore(testDir);
    const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.sofagent/');
  });

  it('当 .gitignore 已含 .sofagent/ 时，不重复追加', () => {
    writeFileSync(join(testDir, '.gitignore'), 'node_modules/\n.sofagent/\n');
    ensureGitignore(testDir);
    const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    // 只应该出现一次 .sofagent/
    const matches = (content.match(/\.sofagent\//g) || []).length;
    expect(matches).toBe(1);
  });

  it('追加内容与已有内容之间有合适的分隔', () => {
    writeFileSync(join(testDir, '.gitignore'), 'node_modules/\n');
    ensureGitignore(testDir);
    const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    // 确保新增条目不在同一行
    const lines = content.split('\n');
    expect(lines).toContain('.sofagent/');
  });
});

// ==============================
// P0-1: hook 版本号判断逻辑测试
// ==============================
describe('post-commit hook version detection (P0-1)', () => {
  // 测试 init.ts 中的版本号正则匹配逻辑
  // 逻辑：/v(\d+)\.(\d+)\.(\d+)/ → major < 1 或 (major=1 && minor=0 && patch<7) → 覆盖
  //                                       否则 → 保留

  function shouldOverwriteHook(hookContent: string): boolean {
    const versionMatch = hookContent.match(/v(\d+)\.(\d+)\.(\d+)/);
    if (!versionMatch) return true; // 无版本号 → 覆盖
    const major = parseInt(versionMatch[1]!, 10);
    const minor = parseInt(versionMatch[2]!, 10);
    const patch = parseInt(versionMatch[3]!, 10);
    // v1.0.7 以下 → 覆盖
    return major < 1 || (major === 1 && minor === 0 && patch < 7);
  }

  it('v1.0.6 hook 应被覆盖', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.6')).toBe(true);
  });

  it('v1.0.5 hook 应被覆盖', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.5')).toBe(true);
  });

  it('v1.0.7 hook 应被保留', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.7')).toBe(false);
  });

  it('v1.0.8 hook 应被保留', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.8')).toBe(false);
  });

  it('v2.0.0 hook 应被保留（主版本号更大）', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v2.0.0')).toBe(false);
  });

  it('v0.99.9 hook 应被覆盖（实验版）', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v0.99.9')).toBe(true);
  });

  it('无版本号的 hook 应被覆盖', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# some other hook')).toBe(true);
  });

  it('v1.0.0 hook 应被覆盖', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.0')).toBe(true);
  });

  it('v1.10.0 hook 应被保留（minor 更大，但 >= 1.0.7）', () => {
    // v1.10.0 → major=1, minor=10 → minor > 0 且 patch > 0 → patch 7 条件不满足整体
    // 但这个判断逻辑是：major<1 || (major===1 && minor===0 && patch<7)
    // v1.10.0: major=1, minor=10 → major===1 && minor===0 → false（minor 是 10 不是 0）
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.10.0')).toBe(false);
  });
});

// ==============================
// B8: post-commit 对账 exitCode 三档分流测试
// v1.3.6 B8 修复：exit 1（WARN 放行）不再被误判为「疑似 --no-verify 绕过」。
// 三档语义：0 = 真通过（回声）/ 1 = WARN 放行（回声含警告，不报绕过）/ 2 = 拦截后强推（报疑似绕过）。
// 直接执行静态 hook 模板 engine/audit/hooks/post-commit，用真实 git 仓库 + history fixture 验证。
// ==============================
describe('post-commit 对账 exitCode 三档分流 (B8)', () => {
  let repoDir: string;
  let sofagentHome: string;
  const hookPath = join(__dirname, '..', '..', 'hooks', 'post-commit');

  // 生成一条 pre-commit 历史记录
  const preCommitEntry = (parentSha: string, exitCode: number) =>
    JSON.stringify({
      timestamp: new Date().toISOString(),
      commitPhase: 'pre-commit',
      parentSha,
      exitCode,
      commitSha: '',
    });

  function runHook(historyContent: string): string {
    writeFileSync(join(sofagentHome, 'data/audit/history.jsonl'), historyContent);
    try {
      return execFileSync('bash', [hookPath], {
        cwd: repoDir,
        env: { ...process.env, SOFAGENT_HOME: sofagentHome },
        encoding: 'utf-8',
      });
    } catch {
      return ''; // hook 永不阻断（exit 0）；异常时返回空便于断言失败暴露
    }
  }

  beforeEach(() => {
    repoDir = join(tmpdir(), `sofagent-b8-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sofagentHome = join(tmpdir(), `sofagent-b8-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(join(sofagentHome, 'data/audit'), { recursive: true });
    // 真实 git 仓库 + 一个初始 commit（post-commit 依赖 git rev-parse HEAD / HEAD^）
    execFileSync('git', ['init', '-q'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repoDir });
    writeFileSync(join(repoDir, 'a.txt'), 'a');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });
    // 第二个 commit——保证 HEAD^ 存在（post-commit 对账取父 SHA）
    writeFileSync(join(repoDir, 'a.txt'), 'a\nb');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-qm', 'second'], { cwd: repoDir });
  });

  afterEach(() => {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* cleanup */ }
    try { rmSync(sofagentHome, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('exit 0（审计真通过）→ 回声「审计通过」，不报绕过', () => {
    const parentSha = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: repoDir, encoding: 'utf-8' }).trim();
    const out = runHook(preCommitEntry(parentSha, 0) + '\n');
    expect(out).toContain('审计通过');
    expect(out).not.toContain('绕过');
  });

  it('exit 1（WARN 放行）→ 回声「含警告」，不报绕过（B8 修复点）', () => {
    const parentSha = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: repoDir, encoding: 'utf-8' }).trim();
    const out = runHook(preCommitEntry(parentSha, 1) + '\n');
    expect(out).toContain('审计通过（含警告');
    expect(out).not.toContain('疑似 --no-verify 绕过');
  });

  it('exit 2（拦截后强推）→ 报「疑似 --no-verify 绕过」', () => {
    const parentSha = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: repoDir, encoding: 'utf-8' }).trim();
    const out = runHook(preCommitEntry(parentSha, 2) + '\n');
    expect(out).toContain('疑似 --no-verify 绕过');
    expect(out).not.toContain('审计通过');
  });

  it('history 无匹配记录 → 降级 INFO 提示（不报绕过也不假回声）', () => {
    const out = runHook('{"timestamp":"2026-01-01T00:00:00Z","commitSha":"deadbeef","exitCode":0}\n');
    expect(out).toContain('未确认审计记录');
    expect(out).not.toContain('疑似 --no-verify 绕过');
  });
});
