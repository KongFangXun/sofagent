// ============================================================
// hook-install.test.ts · v1.4.5 T1/T4 测试
// T1: core.hooksPath 尊重——repo 配 .githooks 后 hook 落配置目录
// T4: 用户自有 hook 链式保留——.pre-sofagent 保存 + wrapper 先执行用户 hook
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { resolveHooksDir, installHooks, preserveUserHook, buildChainedContent, injectEngineEntryMark, resolveEngineEntryForHook } from './hook-install';

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

/** 建三个模板文件（mkdtemp 唯一目录——固定共享路径在并发测试进程下会互相清场） */
function makeTemplates(): string {
  const tpl = mkdtempSync(join(tmpdir(), 'sofagent-hook-tpl-'));
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
    const tpl = makeTemplates();
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
    const tpl = makeTemplates();
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
    const tpl = makeTemplates();
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

// ============================================================
// F43（v1.5.7）· hook 绑定安装时刻引擎入口
// ------------------------------------------------------------
// 缺陷：npx 装的 hook 运行时按解析链落到机器全局 dist——升级全局包后首个
//   commit 被「全局哈希不匹配」拦截；未装全局包时 hook 解析不到引擎 exit 1。
// 修法：安装器把解析时刻的引擎绝对入口写进 hook 头部标记行
//   `# SOFAGENT_ENGINE_ENTRY=<abs>`，hook 运行优先消费记录值。
// ============================================================
describe('injectEngineEntryMark / resolveEngineEntryForHook（F43）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sofagent-f43-'));
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('合法绝对入口：标记行紧跟 shebang 之后', () => {
    const entry = join(dir, 'engine-entry.js');
    writeFileSync(entry, '// fake dist index\n');
    const out = injectEngineEntryMark('#!/bin/bash\n# sofagent commit-msg hook v1.5.6\nexit 0\n', entry);
    const lines = out.split('\n');
    expect(lines[0]).toBe('#!/bin/bash');
    expect(lines[1]).toBe(`# SOFAGENT_ENGINE_ENTRY=${entry}`);
  });

  it('幂等：二次注入刷新记录值（旧标记行被替换而非追加）', () => {
    const oldEntry = join(dir, 'old.js');
    const newEntry = join(dir, 'new.js');
    writeFileSync(oldEntry, 'a');
    writeFileSync(newEntry, 'b');
    const once = injectEngineEntryMark('#!/bin/bash\nbody\n', oldEntry);
    const twice = injectEngineEntryMark(once, newEntry);
    expect(twice.match(/^# SOFAGENT_ENGINE_ENTRY=/gm)?.length).toBe(1);
    expect(twice).toContain(`# SOFAGENT_ENGINE_ENTRY=${newEntry}`);
    expect(twice).not.toContain(`# SOFAGENT_ENGINE_ENTRY=${oldEntry}`);
  });

  it('非法入口（不存在文件/相对路径/null）：模板原样返回不注入', () => {
    const tpl = '#!/bin/bash\nexit 0\n';
    expect(injectEngineEntryMark(tpl, join(dir, 'no-such.js'))).toBe(tpl);
    expect(injectEngineEntryMark(tpl, 'relative/path.js')).toBe(tpl);
    expect(injectEngineEntryMark(tpl, null)).toBe(tpl);
    expect(injectEngineEntryMark(tpl, undefined)).toBe(tpl);
  });

  it('无 shebang 模板：标记行置于文件头（防御形态）', () => {
    const entry = join(dir, 'e.js');
    writeFileSync(entry, 'x');
    const out = injectEngineEntryMark('body only\n', entry);
    expect(out.startsWith(`# SOFAGENT_ENGINE_ENTRY=${entry}\n`)).toBe(true);
  });

  it('installHooks 传 engineEntry：三个 hook 落盘均含标记行', () => {
    const repo = makeRepo();
    const tpl = makeTemplates();
    const entry = join(dir, 'audit-dist-index.js');
    writeFileSync(entry, '// dist\n');
    try {
      installHooks({ cwd: repo, templateDir: tpl, log: () => {}, engineEntry: entry });
      for (const name of ['pre-commit', 'commit-msg', 'post-commit']) {
        const content = readFileSync(join(repo, '.git', 'hooks', name), 'utf-8');
        expect(content).toContain(`# SOFAGENT_ENGINE_ENTRY=${entry}`);
      }
    } finally {
      rmSync(tpl, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('installHooks 未传 engineEntry：落盘内容不含标记行（回退链行为保留）', () => {
    const repo = makeRepo();
    const tpl = makeTemplates();
    try {
      installHooks({ cwd: repo, templateDir: tpl, log: () => {} });
      const content = readFileSync(join(repo, '.git', 'hooks', 'commit-msg'), 'utf-8');
      expect(content).not.toContain('# SOFAGENT_ENGINE_ENTRY=');
    } finally {
      rmSync(tpl, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('resolveEngineEntryForHook：返回存在的绝对入口（本包 dist/index.js）', () => {
    const entry = resolveEngineEntryForHook();
    expect(entry).not.toBeNull();
    expect(entry!.startsWith('/')).toBe(true);
    expect(existsSync(entry!)).toBe(true);
    // 构建态指向 dist/index.js；vitest src 直跑态指向 src/index.ts（双候选任一）
    expect(
      entry!.endsWith(join('dist', 'index.js')) || entry!.endsWith(join('src', 'index.ts')),
    ).toBe(true);
  });
});
