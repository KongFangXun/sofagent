// ============================================================
// diff-parser.failclosed.test.ts · git 失败 fail-closed 回归测试
// ============================================================
// v1.4.9 审 F02：<5MB execFileSync 快速路径与 parseStagedDiff 非 spill catch
// 在 git 进程失败时不再吞成空内容——必须带 DIFF_SPILL_FAILURE 码原样上抛（拒审）；
// git 成功 + 空输出 = 合法空 diff，照常返回空行集/空 files（防误伤）。
//
// 独立成文件的原因：vi.mock('child_process') 是文件级 hoist，会替换整个模块，
// 与 __tests__/diff-parser.test.ts 的真实 git 用例互斥，无法合并进同一文件。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileSyncMock, spawnSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
  spawnSync: spawnSyncMock,
}));

import { parseDiff, parseStagedDiff } from '../diff-parser';

/** git 退出码非 0 的 execFileSync 错误（与真实 spawn 错误同形：status + stderr） */
function gitFailure(status: number, stderr: string): Error {
  const err = new Error(`Command failed: git diff`) as NodeJS.ErrnoException;
  err.status = status;
  (err as unknown as { stderr: string }).stderr = stderr;
  return err;
}

beforeEach(() => {
  execFileSyncMock.mockReset();
  spawnSyncMock.mockReset();
});

describe('diff-parser · git 失败 fail-closed（F02）', () => {
  it('parseDiff: 快速路径内容 diff git 失败 → 带 DIFF_SPILL_FAILURE 码上抛（不再空内容过审）', () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) return 'ok\n'; // isInGitRepo / ref 验证
      if (args.includes('--name-status')) return 'M\ta.ts\n'; // 变更文件列表
      throw gitFailure(128, 'fatal: bad object'); // 内容 diff → git 失败
    });

    let caught: unknown;
    try {
      parseDiff('HEAD~1..HEAD', '/tmp/repo');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as NodeJS.ErrnoException).code).toBe('DIFF_SPILL_FAILURE');
    expect((caught as Error).message).toContain('拒绝以空内容过审');
    expect((caught as Error).message).toContain('a.ts');
  });

  it('parseStagedDiff: 非 spill catch git 失败 → 带 DIFF_SPILL_FAILURE 码上抛（不再吞成空 files）', () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) return 'ok\n';
      if (args.includes('--name-status')) return 'M\tsecret.txt\n';
      throw gitFailure(1, 'error: could not lock config');
    });

    let caught: unknown;
    try {
      parseStagedDiff();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as NodeJS.ErrnoException).code).toBe('DIFF_SPILL_FAILURE');
    expect((caught as Error).message).toContain('拒绝以空内容过审');
    expect((caught as Error).message).toContain('secret.txt');
  });

  it('git 成功 + 空输出 = 合法空 diff → 照常返回空 files / 空行集（防误伤）', () => {
    // 场景 1：name-status 空输出（无变更）→ 空 files，不抛
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) return 'ok\n';
      return ''; // name-status / 内容 diff 均为合法空输出
    });
    expect(parseDiff('HEAD~1..HEAD', '/tmp/repo')).toEqual([]);
    expect(parseStagedDiff()).toEqual([]);

    // 场景 2：name-status 有文件但内容 diff 输出为空 → 正常返回该文件（空行集），不抛
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) return 'ok\n';
      if (args.includes('--name-status')) return 'M\ta.ts\n';
      return '';
    });
    const files = parseDiff('HEAD~1..HEAD', '/tmp/repo');
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('a.ts');
  });
});
