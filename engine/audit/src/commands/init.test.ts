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
// H-01 (v1.4.2): pre-commit 主防线——三层防线第一层
// staged 清理发生在 commit 对象生成前，是对当次 commit 唯一直接生效的防线
// （commit-msg 阶段 git 主进程持内存 index 快照，reset 只护磁盘 index）。
// ==============================
describe('pre-commit 主防线（H-01 三层防线第一层）', () => {
  let repoDir: string;
  const hookPath = join(__dirname, '..', '..', 'hooks', 'pre-commit');

  beforeEach(() => {
    repoDir = join(tmpdir(), `sofagent-h01-pre-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repoDir });
    writeFileSync(join(repoDir, 'a.txt'), 'a');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
  });

  afterEach(() => {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  function runHook(): { status: number; output: string } {
    try {
      const out = execFileSync('bash', [hookPath], { cwd: repoDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, output: out };
    } catch (e: any) {
      return { status: e.status ?? -1, output: `${e.stdout || ''}${e.stderr || ''}` };
    }
  }

  function stageSofagentFile(name = 'secret.yml'): void {
    mkdirSync(join(repoDir, '.sofagent'), { recursive: true });
    writeFileSync(join(repoDir, '.sofagent', name), 'k: v\n');
    execFileSync('git', ['add', '-f', `.sofagent/${name}`], { cwd: repoDir });
  }

  it('staged 含 .sofagent/ → reset 移出 + ℹ️ 提示（主防线当次生效）', () => {
    stageSofagentFile();
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.output).toContain('已将 .sofagent/ 移出暂存区');
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoDir, encoding: 'utf-8' });
    expect(staged).not.toContain('.sofagent/');
    // 非 sofagent 暂存不受影响（单路径 reset 只动 .sofagent/）
    expect(staged).toContain('a.txt');
  });

  it('index.lock 存在且 .sofagent/ 已暂存 → fail-loud 拒绝（exit 1 + 提示）', () => {
    stageSofagentFile();
    writeFileSync(join(repoDir, '.git/index.lock'), '');
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.output).toContain('无法将 .sofagent/ 移出暂存区');
    // 暂存区无损：条目仍在，锁解除后重试可被正常 reset
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoDir, encoding: 'utf-8' });
    expect(staged).toContain('.sofagent/secret.yml');
  });

  it('staged 无 .sofagent/ 条目 → 零成本放行（index.lock 存在也不误伤）', () => {
    writeFileSync(join(repoDir, '.git/index.lock'), '');
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.output).not.toContain('移出暂存区');
  });

  it('端到端：三 hook 装齐后 git add -f .sofagent + commit → HEAD tree 不含 .sofagent/', () => {
    // 安装三 hook（模拟 --install-hook；commit-msg 走 hooks/ 目录真实模板）
    const hooksDir = join(repoDir, '.git', 'hooks');
    for (const h of ['pre-commit', 'commit-msg', 'post-commit']) {
      writeFileSync(join(hooksDir, h), readFileSync(join(__dirname, '..', '..', 'hooks', h), 'utf-8'));
      execFileSync('chmod', ['755', join(hooksDir, h)]);
    }
    // 迷你 dist + 哈希基准预写：让 commit-msg 的 AUDIT_CMD 探测与完整性校验走通
    mkdirSync(join(repoDir, 'engine/audit/dist'), { recursive: true });
    writeFileSync(join(repoDir, 'engine/audit/dist/index.js'), 'process.exit(0);\n');
    const home = join(tmpdir(), `sofagent-h01-e2e-home-${Date.now()}`);
    mkdirSync(join(home, 'internal'), { recursive: true });
    const hash = execFileSync('shasum', ['-a', '256', join(repoDir, 'engine/audit/dist/index.js')], { encoding: 'utf-8' }).split(' ')[0];
    writeFileSync(join(home, 'internal/audit-hash.txt'), hash);

    stageSofagentFile('e2e.yml');
    let commitEnv = { ...process.env, SOFAGENT_HOME: home };
    try {
      execFileSync('git', ['commit', '-qm', 'e2e: 三层防线'], { cwd: repoDir, env: commitEnv });
    } catch { /* commit-msg FAIL 时 commit 失败也是合法结果 */ }
    // 主防线断言：无论 commit 是否成功，HEAD tree（若产生）不含 .sofagent/
    let headTree = '';
    try {
      headTree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], { cwd: repoDir, encoding: 'utf-8' });
    } catch { /* 无 commit 产生（首 commit 被拦）也算通过 */ }
    expect(headTree).not.toContain('.sofagent/');
    try { rmSync(home, { recursive: true, force: true }); } catch { /* cleanup */ }
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
    // 迷你 dist——满足 hook 顶部 AUDIT_CMD 探测（CI 无全局 sofagent-audit，
    // 无此 fixture 时 hook 静默 exit 0，对账回声不输出——与 H-01 describe 同款先例）
    mkdirSync(join(repoDir, 'engine/audit/dist'), { recursive: true });
    writeFileSync(join(repoDir, 'engine/audit/dist/index.js'), 'process.exit(0);\n');
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

// ==============================
// H-01 (v1.4.2): commit-msg reset fail-loud 化 + post-commit HEAD tree 对账兜底
// index.lock 竞态回归锁（参照 v1.3.9 sandbox 时序竞态先例）：reset 失败必须拒绝
// commit（exit 非零 + 明确提示），不再静默放行 .sofagent/ 入库；post-commit 侧
// 扫描 HEAD tree 命中 .sofagent/ 即告警（best-effort，永不阻断）。
// ==============================
describe('commit-msg reset fail-loud（H-01 index.lock 竞态）', () => {
  let repoDir: string;
  let sofagentHome: string;
  const hookPath = join(__dirname, '..', '..', 'hooks', 'commit-msg');

  beforeEach(() => {
    repoDir = join(tmpdir(), `sofagent-h01-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sofagentHome = join(tmpdir(), `sofagent-h01-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(join(sofagentHome, 'internal'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repoDir });
    // 迷你 dist：让 hook 的 AUDIT_CMD 探测与哈希基准生成（SOFAGENT_HOME 隔离）走通
    mkdirSync(join(repoDir, 'engine/audit/dist'), { recursive: true });
    writeFileSync(join(repoDir, 'engine/audit/dist/index.js'), 'process.exit(0);\n');
    // 暂存普通文件（hook 开头空 diff 直接放行，必须先有暂存内容）
    writeFileSync(join(repoDir, 'a.txt'), 'a');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
  });

  afterEach(() => {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* cleanup */ }
    try { rmSync(sofagentHome, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  function runHook(): { status: number; output: string } {
    const msgFile = join(repoDir, 'COMMIT_MSG');
    writeFileSync(msgFile, 'test: H-01 回归\n');
    try {
      const out = execFileSync('bash', [hookPath, msgFile], {
        cwd: repoDir,
        env: { ...process.env, SOFAGENT_HOME: sofagentHome },
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output: out };
    } catch (e: any) {
      return { status: e.status ?? -1, output: `${e.stdout || ''}${e.stderr || ''}` };
    }
  }

  function stageSofagentFile(name = 'secret.yml'): void {
    mkdirSync(join(repoDir, '.sofagent'), { recursive: true });
    // 使用拼接避免审计规则误报（A2 不泄密钥检测 sk-xxx 模式，先例：support-bundle.test.ts）
    const fakeKey = 'sk-' + 'testplaceholder';
    writeFileSync(join(repoDir, '.sofagent', name), `llm:\n  apiKey: ${fakeKey}\n`);
    execFileSync('git', ['add', '-f', `.sofagent/${name}`], { cwd: repoDir });
  }

  it('index.lock 存在且 .sofagent/ 已暂存 → reset 失败拒绝 commit（exit 非零 + 明确提示）', () => {
    stageSofagentFile();
    // 人造 index.lock——模拟 git 并发持锁窗口，reset 写 index 必失败（退出码 128）
    writeFileSync(join(repoDir, '.git/index.lock'), '');
    const r = runHook();
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('无法将 .sofagent/ 移出暂存区');
    // 暂存区无损：.sofagent/secret.yml 仍在 staged，锁解除后重试可被正常 reset
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoDir, encoding: 'utf-8' });
    expect(staged).toContain('.sofagent/secret.yml');
  });

  it('无锁正常路径 → .sofagent/ 被移出暂存区，hook 放行（exit 0）', () => {
    stageSofagentFile();
    const r = runHook();
    expect(r.status).toBe(0);
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoDir, encoding: 'utf-8' });
    expect(staged).not.toContain('.sofagent/');
  });

  it('暂存区无 .sofagent/ 条目时跳过 reset——index.lock 存在也不误伤放行', () => {
    // 零成本消除竞态触发面：无条目 → 不进 reset 分支，审计正常走完（迷你 dist exit 0）
    writeFileSync(join(repoDir, '.git/index.lock'), '');
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.output).not.toContain('无法将 .sofagent/ 移出暂存区');
  });
});

describe('post-commit HEAD tree 对账兜底（H-01）', () => {
  let repoDir: string;
  let sofagentHome: string;
  const hookPath = join(__dirname, '..', '..', 'hooks', 'post-commit');

  beforeEach(() => {
    repoDir = join(tmpdir(), `sofagent-h01-post-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sofagentHome = join(tmpdir(), `sofagent-h01-post-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(join(sofagentHome, 'data/audit'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repoDir });
    // 迷你 dist——满足 hook 顶部 AUDIT_CMD 探测
    mkdirSync(join(repoDir, 'engine/audit/dist'), { recursive: true });
    writeFileSync(join(repoDir, 'engine/audit/dist/index.js'), 'process.exit(0);\n');
    writeFileSync(join(repoDir, 'a.txt'), 'a');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });
  });

  afterEach(() => {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* cleanup */ }
    try { rmSync(sofagentHome, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  function runHook(): string {
    try {
      return execFileSync('bash', [hookPath], {
        cwd: repoDir,
        env: { ...process.env, SOFAGENT_HOME: sofagentHome },
        encoding: 'utf-8',
      });
    } catch {
      return ''; // post-commit 永不阻断（exit 0）
    }
  }

  it('HEAD tree 含 .sofagent/ → 告警入库违规（best-effort，exit 0）', () => {
    mkdirSync(join(repoDir, '.sofagent'), { recursive: true });
    writeFileSync(join(repoDir, '.sofagent/leak.yml'), 'k: v\n');
    execFileSync('git', ['add', '-f', '.sofagent/leak.yml'], { cwd: repoDir });
    execFileSync('git', ['commit', '-qm', 'leak'], { cwd: repoDir });
    const out = runHook();
    expect(out).toContain('已入库');
    expect(out).toContain('git rm --cached');
  });

  it('HEAD tree 干净 → 无入库告警', () => {
    const out = runHook();
    expect(out).not.toContain('已入库');
  });
});
