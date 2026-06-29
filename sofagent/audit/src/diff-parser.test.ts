// ============================================================
// diff-parser.test.ts · git diff 输出解析 + 边界情况
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDiff, getAddedLines, getRemovedLines, parseNumstat } from './diff-parser';
import type { DiffFile, NumstatEntry } from './diff-parser';

// Mock execFileSync 以避免依赖真实 git 仓库
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'child_process';

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

describe('parseDiff', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('解析标准 modified 文件', () => {
    const nameStatusOutput = 'M\tsrc/index.ts';
    const diffOutput = `diff --git a/src/index.ts b/src/index.ts
index 1234567..abcdefg 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 line1
+new line
 line3`;

    mockExecFileSync
      .mockReturnValueOnce(nameStatusOutput) // git diff --name-status
      .mockReturnValueOnce(diffOutput); // git diff <range> -- <path>

    const result = parseDiff('HEAD~1..HEAD');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/index.ts');
    expect(result[0].status).toBe('modified');
    expect(result[0].lines.length).toBeGreaterThan(0);
  });

  it('解析 added 文件', () => {
    mockExecFileSync
      .mockReturnValueOnce('A\tsrc/new-file.ts')
      .mockReturnValueOnce('diff --git a/src/new-file.ts b/src/new-file.ts\n+new content');

    const result = parseDiff('HEAD~1..HEAD');
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('added');
    expect(result[0].path).toBe('src/new-file.ts');
  });

  it('解析 deleted 文件', () => {
    mockExecFileSync
      .mockReturnValueOnce('D\tsrc/old-file.ts')
      .mockReturnValueOnce('diff --git a/src/old-file.ts b/src/old-file.ts\n-old content');

    const result = parseDiff('HEAD~1..HEAD');
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('deleted');
    expect(result[0].path).toBe('src/old-file.ts');
  });

  it('解析 renamed 文件（R100）', () => {
    mockExecFileSync
      .mockReturnValueOnce('R100\tsrc/old.ts\tsrc/new.ts')
      .mockReturnValueOnce('diff --git a/src/old.ts b/src/new.ts\nrename from src/old.ts\nrename to src/new.ts');

    const result = parseDiff('HEAD~1..HEAD');
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('renamed');
    expect(result[0].oldPath).toBe('src/old.ts');
    expect(result[0].path).toBe('src/new.ts');
  });

  it('空输出 → 返回空数组', () => {
    mockExecFileSync.mockReturnValueOnce('');
    const result = parseDiff('HEAD~1..HEAD');
    expect(result).toEqual([]);
  });

  it('多个文件变更', () => {
    const nameStatusOutput = 'M\tsrc/a.ts\nM\tsrc/b.ts\nA\tsrc/c.ts';
    mockExecFileSync
      .mockReturnValueOnce(nameStatusOutput)
      .mockReturnValueOnce('diff --git a/src/a.ts b/src/a.ts\n+change a')
      .mockReturnValueOnce('diff --git a/src/b.ts b/src/b.ts\n+change b')
      .mockReturnValueOnce('diff --git a/src/c.ts b/src/c.ts\n+new c');

    const result = parseDiff('HEAD~1..HEAD');
    expect(result).toHaveLength(3);
    expect(result[0].path).toBe('src/a.ts');
    expect(result[1].path).toBe('src/b.ts');
    expect(result[2].path).toBe('src/c.ts');
  });

  it('非法 range 字符 → 返回空数组并报错', () => {
    // range 包含分号——命令注入尝试
    const result = parseDiff('HEAD~1..HEAD; rm -rf /');
    expect(result).toEqual([]);
  });

  it('range 包含 --flag → 被拒绝', () => {
    const result = parseDiff('--output=/etc/passwd');
    expect(result).toEqual([]);
  });

  it('合法 range（HEAD~1..HEAD）→ 正常执行', () => {
    mockExecFileSync.mockReturnValueOnce('');
    const result = parseDiff('HEAD~1..HEAD');
    expect(result).toEqual([]);
    expect(mockExecFileSync).toHaveBeenCalled();
  });

  it('合法 range（含 ^ 和 ~）→ 正常执行', () => {
    mockExecFileSync.mockReturnValueOnce('');
    const result = parseDiff('HEAD~3..HEAD~1');
    expect(result).toEqual([]);
  });

  it('git diff 失败 → 返回空数组', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    const result = parseDiff('HEAD~1..HEAD');
    expect(result).toEqual([]);
  });
});

describe('getAddedLines', () => {
  it('提取以 + 开头的行', () => {
    const file: DiffFile = {
      path: 'test.ts',
      status: 'modified',
      lines: [
        'diff --git a/test.ts b/test.ts',
        '--- a/test.ts',
        '+++ b/test.ts',
        '@@ -1,2 +1,3 @@',
        ' unchanged',
        '+added line',
        '+another added',
      ],
    };
    const added = getAddedLines(file);
    expect(added).toEqual(['added line', 'another added']);
  });

  it('不包含 +++ 行', () => {
    const file: DiffFile = {
      path: 'test.ts',
      status: 'modified',
      lines: ['+++ b/test.ts', '+real addition'],
    };
    const added = getAddedLines(file);
    expect(added).toEqual(['real addition']);
  });
});

describe('getRemovedLines', () => {
  it('提取以 - 开头的行', () => {
    const file: DiffFile = {
      path: 'test.ts',
      status: 'modified',
      lines: [
        '--- a/test.ts',
        '-removed line',
        '-another removed',
        ' unchanged',
      ],
    };
    const removed = getRemovedLines(file);
    expect(removed).toEqual(['removed line', 'another removed']);
  });

  it('不包含 --- 行', () => {
    const file: DiffFile = {
      path: 'test.ts',
      status: 'modified',
      lines: ['--- a/test.ts', '-real removal'],
    };
    const removed = getRemovedLines(file);
    expect(removed).toEqual(['real removal']);
  });
});

describe('parseNumstat', () => {
  it('解析标准 numstat 输出', () => {
    const output = '10\t5\tsrc/index.ts\n0\t20\tsrc/legacy.ts\n200\t0\tsrc/new-file.ts';
    const result = parseNumstat(output);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ path: 'src/index.ts', addedLines: 10, deletedLines: 5 });
    expect(result[1]).toEqual({ path: 'src/legacy.ts', addedLines: 0, deletedLines: 20 });
    expect(result[2]).toEqual({ path: 'src/new-file.ts', addedLines: 200, deletedLines: 0 });
  });

  it('处理二进制文件（- 标记）', () => {
    const output = '-\t-\tassets/logo.png\n5\t3\tsrc/app.ts';
    const result = parseNumstat(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: 'assets/logo.png', addedLines: 0, deletedLines: 0 });
    expect(result[1]).toEqual({ path: 'src/app.ts', addedLines: 5, deletedLines: 3 });
  });

  it('空输出 → 返回空数组', () => {
    const result = parseNumstat('');
    expect(result).toEqual([]);
  });

  it('处理大数字统计', () => {
    const output = '99999\t50000\tsrc/big-file.ts';
    const result = parseNumstat(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'src/big-file.ts', addedLines: 99999, deletedLines: 50000 });
  });
});
