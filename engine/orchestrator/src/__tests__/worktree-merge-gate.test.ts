// ============================================================
// worktree-merge-gate.test.ts · 审计合并卡关测试（v1.2.3）
//
// 覆盖：
// - audit PASS → merge --no-ff 合并成功，主分支有 merge commit
// - audit FAIL → 不合并，worktree 被清理，拒绝原因记录 + 通知重试
// - 分支无新提交 → noop
// - 文本冲突 + incoming scope 声明 → 自动仲裁合并
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  createWorktree,
  readWorktreeRegistry,
  resolveRegistryPath,
} from '../worktree-isolation';
import { runMergeGate } from '../worktree-merge-gate';
import { readConflictRecords, resolveConflictsPath } from '../conflict-resolver';

let tmpDir: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

/** 列出匹配分支名（--format 不带 worktree 检出 '+' 前缀） */
function branchList(pattern: string, cwd: string): string {
  return git(['branch', '--list', pattern, '--format=%(refname:short)'], cwd).trim();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-gate-'));
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
    // 临时目录由 OS 回收
  }
});

// ════════════════════════════════════════
// audit PASS → merge
// ════════════════════════════════════════

describe('audit PASS → merge --no-ff', () => {
  it('合并成功：主分支可见文件、存在 merge commit、worktree 回收、注册表记录 merge', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-pass' });
    await h.create();
    // SubAgent 在 worktree 内产出（未提交——gate 负责兜底提交）
    fs.mkdirSync(path.join(h.path, 'src'), { recursive: true });
    fs.writeFileSync(path.join(h.path, 'src', 'feature.ts'), 'export const answer = 42;\n');

    const result = await runMergeGate(h, { repoRoot: tmpDir, task: '新增 src/feature.ts 模块' });

    expect(result.status).toBe('merged');
    expect(['PASS', 'WARN']).toContain(result.auditVerdict);
    expect(result.mergeCommitSha).toBeTruthy();

    // 主工作树可见产出文件
    expect(fs.existsSync(path.join(tmpDir, 'src', 'feature.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'src', 'feature.ts'), 'utf-8')).toContain('answer');

    // --no-ff merge commit 存在（可追溯 SubAgent 来源）
    const log = git(['log', '--oneline', '-3'], tmpDir);
    expect(log).toContain('merge(worktree)');
    expect(log).toContain('eng-pass');

    // worktree 已回收
    expect(fs.existsSync(h.path)).toBe(false);
    expect(branchList(h.branch, tmpDir)).toBe('');

    // 注册表记录了 merge 事件
    const events = readWorktreeRegistry(resolveRegistryPath(tmpDir)).map((e) => e.event);
    expect(events).toContain('merge');
  }, 30000 /* P0-11: 真实 git 合并耗时长，vitest 默认 5000ms 会 50% 超时假绿 */);
});

// ════════════════════════════════════════
// audit FAIL → reject
// ════════════════════════════════════════

describe('audit FAIL → 拒绝合并', () => {
  it('不合并、worktree 被清理、拒绝原因写入注册表、notifyRetry 被调用', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-fail' });
    await h.create();
    // A1 不碰敏感：.env 直接 FAIL。
    // 注意：本机全局 gitignore（core.excludesFile）通常忽略 .env——
    // gate 的 add --force 保证它仍被提交并进入审计视野
    fs.writeFileSync(path.join(h.path, '.env'), 'API_KEY=sk-supersecret\n');

    const retries: Array<{ agentId: string; reason: string }> = [];
    const result = await runMergeGate(h, {
      repoRoot: tmpDir,
      task: '误交密钥配置',
      notifyRetry: (agentId, reason) => {
        retries.push({ agentId, reason });
      },
    });

    expect(result.status).toBe('rejected');
    expect(result.auditVerdict).toBe('FAIL');
    expect(result.rejectionReason).toContain('A1');

    // 主分支没有 .env（产出未进入主分支）
    expect(fs.existsSync(path.join(tmpDir, '.env'))).toBe(false);

    // worktree 已清理（目录 + 分支）
    expect(fs.existsSync(h.path)).toBe(false);
    expect(branchList(h.branch, tmpDir)).toBe('');

    // 拒绝原因写入注册表
    const entries = readWorktreeRegistry(resolveRegistryPath(tmpDir));
    const reject = entries.find((e) => e.event === 'audit-reject' && e.agentId === 'eng-fail');
    expect(reject).toBeDefined();
    expect(reject!.detail).toContain('A1');

    // 编排引擎收到重试通知
    expect(retries).toHaveLength(1);
    expect(retries[0]!.agentId).toBe('eng-fail');
    expect(retries[0]!.reason).toContain('A1');
  }, 30000 /* P0-11: 真实 git 合并不设超时会 50% 超时假绿 */);
});

// ════════════════════════════════════════
// noop
// ════════════════════════════════════════

describe('分支无新提交 → noop', () => {
  it('不合并不清理，worktree 保留', async () => {
    const h = createWorktree({ repoRoot: tmpDir, agentId: 'eng-noop' });
    await h.create();

    const result = await runMergeGate(h, { repoRoot: tmpDir });

    expect(result.status).toBe('noop');
    expect(fs.existsSync(h.path)).toBe(true);
    expect(branchList(h.branch, tmpDir)).toBe(h.branch);
    await h.cleanup();
  }, 30000 /* P0-11: 真实 git 合并不设超时会 50% 超时假绿 */);
});

// ════════════════════════════════════════
// 文本冲突 → 自动仲裁
// ════════════════════════════════════════

describe('文本冲突 + incoming scope 声明 → 自动仲裁合并', () => {
  it('incoming 写在自己 scope 内 → -X theirs 合并，冲突记录落盘', async () => {
    // worktree 从 init 分出后，主分支先在 README 末尾追加一行
    const h = createWorktree({
      repoRoot: tmpDir,
      agentId: 'eng-conflict',
      responsibilityScope: ['README.md'],
    });
    await h.create();
    fs.appendFileSync(path.join(tmpDir, 'README.md'), 'main change\n');
    git(['add', '.'], tmpDir);
    git(['commit', '-m', 'main update readme'], tmpDir);
    // worktree 在同一位置追加不同内容 → 合并时必然文本冲突
    fs.appendFileSync(path.join(h.path, 'README.md'), 'agent change\n');

    const result = await runMergeGate(h, {
      repoRoot: tmpDir,
      task: '更新 README.md 说明',
    });

    expect(result.status).toBe('conflict-resolved');
    expect(result.conflict?.resolution).toBe('incoming-wins');
    expect(result.mergeCommitSha).toBeTruthy();
    // incoming 全赢 → 冲突 hunk 整体取 incoming 侧（-X theirs 语义）：
    // README 含 agent 的修改，main 侧冲突行被丢弃（仲裁不修改原始 diff，
    // 只决定用谁的结果——输家产出由重试机制在新的 main 上重做）
    const readme = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(readme).toContain('agent change');
    expect(readme).not.toContain('main change');

    // 冲突记录落盘
    const records = readConflictRecords(resolveConflictsPath(tmpDir));
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe('resolved');
    expect(records[0]!.files).toContain('README.md');
    expect(records[0]!.incoming.agentId).toBe('eng-conflict');
  }, 30000 /* P0-11: 真实 git 合并不设超时会 50% 超时假绿 */);
});
