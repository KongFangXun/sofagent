// ============================================================
// hook-install.test.ts · v1.4.5 T1/T4 测试
// T1: core.hooksPath 尊重——repo 配 .githooks 后 hook 落配置目录
// T4: 用户自有 hook 链式保留——.pre-sofagent 保存 + wrapper 先执行用户 hook
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { resolveHooksDir, installHooks, preserveUserHook, buildChainedContent } from './hook-install';

/** 建临时 git 仓库（含初始 commit——保证 rev-parse --show-toplevel 可用） */
function makeRepo(): string {
  const repo = join(tmpdir(), `sofagent-hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.email', 'test@sofagent.dev');
  git('config', 'user.name', 'sofagent-test');
  writeFileSync(join(repo, 'README.md'), '# test\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  // macOS tmpdir 是符号链接（/var → /private/var），git rev-parse 返回真实路径——
  // 统一 realfs 路径，避免断言两边路径形态不一致
  return realpathSync(repo);
}

/** 建三个模板文件 */
function makeTemplates(dir: string): string {
  const tpl = join(dir, 'hook-templates');
  mkdirSync(tpl, { recursive: true });
  writeFileSync(join(tpl, 'pre-commit'), '#!/bin/bash\n# sofagent pre-commit hook v1.4.4\nexit 0\n');
  writeFileSync(join(tpl, 'commit-msg'), '#!/bin/bash\n# sofagent commit-msg hook v1.4.4\nexit 0\n');
  writeFileSync(join(tpl, 'post-commit'), '#!/bin/bash\n# sofagent post-commit hook v1.4.4\nexit 0\n');
  return tpl;
}

describe('resolveHooksDir（T1：core.hooksPath 尊重）', () => {
  let repo: string;
  let cwdBackup: string;

  beforeEach(() => {
    repo = makeRepo();
    cwdBackup = process.cwd();
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(cwdBackup);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  it('resolveHooksDir_未配置hooksPath_缺省gitHooks目录', () => {
    const r = resolveHooksDir(repo);
    expect(r).not.toBeNull();
    expect(r!.configured).toBe(false);
    expect(r!.hooksDir).toBe(join(repo, '.git', 'hooks'));
  });

  it('resolveHooksDir_配置相对hooksPath_以仓库顶层resolve', () => {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo, stdio: 'pipe' });
    const r = resolveHooksDir(repo);
    expect(r!.configured).toBe(true);
    expect(r!.hooksDir).toBe(join(repo, '.githooks'));
  });

  it('installHooks_hooksPath配置时_hook落在配置目录且可执行', () => {
    // TDD 失败测试还原：repo 配 core.hooksPath=.githooks → 装 hook →
    // 断言 .githooks/pre-commit 存在（而非 .git/hooks/pre-commit）
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo, stdio: 'pipe' });
    const tpl = makeTemplates(tmpdir());
    const logs: string[] = [];
    const result = installHooks({ cwd: repo, templateDir: tpl, log: (m) => logs.push(m) });

    expect(result.configured).toBe(true);
    expect(result.hooksDir).toBe(join(repo, '.githooks'));
    expect(existsSync(join(repo, '.githooks', 'pre-commit'))).toBe(true);
    expect(existsSync(join(repo, '.githooks', 'commit-msg'))).toBe(true);
    expect(existsSync(join(repo, '.githooks', 'post-commit'))).toBe(true);
    // 缺省目录不该被创建（装错位置的旁证）
    expect(existsSync(join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);

    // git 视角：hooksPath 生效——git rev-parse --git-path hooks 指向配置目录
    const gitPath = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repo, encoding: 'utf-8' }).trim();
    expect(join(repo, gitPath)).toContain('.githooks');

    rmSync(tpl, { recursive: true, force: true });
  });

  it('installHooks_未配置hooksPath_保持缺省gitHooks行为（回归保护）', () => {
    const tpl = makeTemplates(tmpdir());
    const result = installHooks({ cwd: repo, templateDir: tpl, log: () => {} });
    expect(result.configured).toBe(false);
    expect(existsSync(join(repo, '.git', 'hooks', 'commit-msg'))).toBe(true);
    rmSync(tpl, { recursive: true, force: true });
  });
});

describe('preserveUserHook / buildChainedContent（T4：链式保留）', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `sofagent-chain-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('preserveUserHook_用户自有hook_保存为pre-sofagent并返回文件名', () => {
    writeFileSync(join(dir, 'pre-commit'), '#!/bin/sh\necho user-lint\n');
    const preName = preserveUserHook(dir, 'pre-commit');
    expect(preName).toBe('pre-commit.pre-sofagent');
    expect(readFileSync(join(dir, 'pre-commit.pre-sofagent'), 'utf-8')).toContain('user-lint');
  });

  it('preserveUserHook_sofagent自家hook_返回null（走升级覆盖）', () => {
    writeFileSync(join(dir, 'commit-msg'), '#!/bin/bash\n# sofagent commit-msg hook v1.4.4\nexit 0\n');
    expect(preserveUserHook(dir, 'commit-msg')).toBeNull();
  });

  it('preserveUserHook_目标不存在_返回null', () => {
    expect(preserveUserHook(dir, 'post-commit')).toBeNull();
  });

  it('buildChainedContent_shortCircuit_用户hook失败时同码短路', () => {
    const tpl = '#!/bin/bash\n# sofagent pre-commit hook v1.4.4\necho sofagent\nexit 0\n';
    const chained = buildChainedContent(tpl, 'pre-commit.pre-sofagent', 'short-circuit');
    expect(chained.startsWith('#!/bin/bash')).toBe(true);
    expect(chained).toContain('pre-commit.pre-sofagent');
    expect(chained).toContain('exit $_SOFAGENT_PRE_RC');
    expect(chained).not.toContain('#!/bin/bash\n# sofagent'); // 模板 shebang 已剥（单 shebang）
    expect(chained.match(/#!/g)?.length).toBe(1);
    // 用户 hook 与 sofagent 主体先后顺序：pre 段在前，模板主体在后
    expect(chained.indexOf('_SOFAGENT_PRE=')).toBeLessThan(chained.indexOf('sofagent pre-commit hook'));
  });

  it('buildChainedContent_ignoreRc_post-commit永不因用户hook退出', () => {
    const tpl = '#!/bin/bash\n# sofagent post-commit hook v1.4.4\nexit 0\n';
    const chained = buildChainedContent(tpl, 'post-commit.pre-sofagent', 'ignore-rc');
    expect(chained).toContain('|| true');
    expect(chained).not.toContain('_SOFAGENT_PRE_RC');
  });

  it('installHooks_接管用户hook_链式wrapper落盘且原hook保留', () => {
    const repo = makeRepo();
    const tpl = makeTemplates(tmpdir());
    // 预置用户自有 pre-commit（如 lint-staged）
    const userHook = '#!/bin/sh\necho "user lint"\nexit 0\n';
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), userHook);
    chmodSync(join(repo, '.git', 'hooks', 'pre-commit'), 0o755);

    const result = installHooks({ cwd: repo, templateDir: tpl, log: () => {} });
    const chainedEntry = result.installed.find((i) => i.destName === 'pre-commit');
    expect(chainedEntry?.chained).toBe(true);
    expect(readFileSync(join(repo, '.git', 'hooks', 'pre-commit.pre-sofagent'), 'utf-8')).toContain('user lint');
    expect(readFileSync(join(repo, '.git', 'hooks', 'pre-commit'), 'utf-8')).toContain('pre-commit.pre-sofagent');

    rmSync(tpl, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
});
