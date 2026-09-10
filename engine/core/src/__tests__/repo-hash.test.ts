// ============================================================
// repo-hash.test.ts · 仓库标识 hash 单测
// ============================================================
//
// 三路覆盖（对齐 FORGE audit-middleware.mjs computeRepoHash 语义）：
//   1. git 目录：git rev-parse --show-toplevel → sha256(root) 前 12 位
//   2. 非 git 目录：exec 抛错 → 'nogit-' + sha256(cwd) 前 12 位
//   3. 超时回退：exec 抛超时错（等价非 git 路径）→ 同 nogit- 回退
//
// 隔离：全部 fake exec 注入，零真实 git 调用、零网络。
// ============================================================

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  computeRepoHash,
  clearRepoHashCache,
  REPO_HASH_PATTERN,
  type RepoHashExecFn,
} from '../repo-hash';

/** fake exec：可编程返回/抛错（记录调用参数供断言） */
function makeFakeExec(impl: (cmd: string, opts: { cwd: string; timeout: number }) => string): {
  exec: RepoHashExecFn;
  calls: Array<{ cmd: string; cwd: string; timeout: number }>;
} {
  const calls: Array<{ cmd: string; cwd: string; timeout: number }> = [];
  const exec: RepoHashExecFn = (cmd, opts) => {
    calls.push({ cmd, cwd: opts.cwd, timeout: opts.timeout });
    return impl(cmd, opts);
  };
  return { exec, calls };
}

describe('computeRepoHash', () => {
  it('git 目录：sha256(仓库根) 前 12 位', () => {
    // 测试：git rev-parse 返回仓库根 → hash = sha256(root) 前 12 位
    const { exec, calls } = makeFakeExec(() => '/repos/my-project\n');
    const hash = computeRepoHash('/any/cwd', exec);

    expect(hash).toBe(createHash('sha256').update('/repos/my-project').digest('hex').slice(0, 12));
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    // 命令形态与超时对齐 FORGE 语义
    expect(calls[0]!.cmd).toBe('git rev-parse --show-toplevel');
    expect(calls[0]!.timeout).toBe(3000);
  });

  it('git 输出 trim：尾部换行被剥离后再入 hash', () => {
    // 测试：execSync 返回带尾换行的根路径——trim 后参与计算
    const { exec } = makeFakeExec(() => '/repos/x  \n\n');
    const hash = computeRepoHash('/cwd', exec);
    expect(hash).toBe(createHash('sha256').update('/repos/x').digest('hex').slice(0, 12));
  });

  it('非 git 目录：回退 nogit-<sha256(cwd) 前 12 位>', () => {
    // 测试：git 不可用（抛错）→ nogit- 前缀 + cwd hash
    const { exec } = makeFakeExec(() => {
      throw new Error('not a git repository');
    });
    const hash = computeRepoHash('/plain/dir', exec);

    expect(hash).toBe('nogit-' + createHash('sha256').update('/plain/dir').digest('hex').slice(0, 12));
    expect(hash).toMatch(/^nogit-[0-9a-f]{12}$/);
  });

  it('超时回退：exec 超时抛错走 nogit- 路径（不区分错误类型）', () => {
    // 测试：3s 超时在 execSync 语义下抛 ETIMEDOUT——catch 统一回退
    const { exec } = makeFakeExec(() => {
      const err = new Error('spawnSync ETIMEDOUT') as NodeJS.ErrnoException;
      err.code = 'ETIMEDOUT';
      throw err;
    });
    const hash = computeRepoHash('/slow/repo', exec);
    expect(hash).toBe('nogit-' + createHash('sha256').update('/slow/repo').digest('hex').slice(0, 12));
  });

  it('空输出回退：git 返回空串 → nogit- 路径', () => {
    // 测试：root 为空串（不进 git 分支）→ 回退
    const { exec } = makeFakeExec(() => '\n');
    const hash = computeRepoHash('/empty', exec);
    expect(hash).toBe('nogit-' + createHash('sha256').update('/empty').digest('hex').slice(0, 12));
  });

  it('注入 execFn 时不读不写进程缓存（fake 零污染）', () => {
    // 测试：注入 exec 的调用不走缓存——同 cwd 两次注入不同 fake，各自生效
    const { exec: execA } = makeFakeExec(() => '/repo-A\n');
    const { exec: execB } = makeFakeExec(() => '/repo-B\n');
    const hashA = computeRepoHash('/same/cwd', execA);
    const hashB = computeRepoHash('/same/cwd', execB);
    expect(hashA).not.toBe(hashB);
    expect(hashA).toBe(createHash('sha256').update('/repo-A').digest('hex').slice(0, 12));
    expect(hashB).toBe(createHash('sha256').update('/repo-B').digest('hex').slice(0, 12));
  });

  it('缺省 execFn 时进程内缓存生效（同 cwd 二次调用零 exec）', () => {
    // 测试：缓存——第二次同 cwd 调用不再 exec（本机 git 实跑一次后命中缓存）
    clearRepoHashCache();
    const h1 = computeRepoHash(process.cwd());
    const h2 = computeRepoHash(process.cwd());
    expect(h1).toBe(h2);
    // 本仓库是 git 仓 → 12 位 hex 形态（非 nogit-）
    expect(h1).toMatch(/^[0-9a-f]{12}$/);
  });

  it('REPO_HASH_PATTERN 匹配两种形态、拒绝非法值', () => {
    // 测试：目录名形态守卫——段目录白名单（12 位 hex / nogit-12 位 hex）
    expect(REPO_HASH_PATTERN.test('abc123def456')).toBe(true);
    expect(REPO_HASH_PATTERN.test('nogit-abc123def456')).toBe(true);
    expect(REPO_HASH_PATTERN.test('2026')).toBe(false);
    expect(REPO_HASH_PATTERN.test('nogit-short')).toBe(false);
    expect(REPO_HASH_PATTERN.test('../../etc')).toBe(false);
  });

  it('真实临时非 git 目录：缺省 execFn 走 nogit- 回退', () => {
    // 测试：非 git 临时目录（真实 execSync）→ nogit- 前缀回退，且缓存
    clearRepoHashCache();
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-repo-hash-'));
    try {
      const hash = computeRepoHash(dir);
      expect(hash).toBe('nogit-' + createHash('sha256').update(dir).digest('hex').slice(0, 12));
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });
});
