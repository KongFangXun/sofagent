import { describe, it, expect } from 'vitest';
import type { DiffFile } from '../src/diff-parser';
import { getAddedLines, getRemovedLines } from '../src/diff-parser';

describe('diff-parser helpers', () => {
  it('getAddedLines 提取新增行', () => {
    const diff: DiffFile = {
      path: 'test.ts',
      status: 'modified',
      lines: [
        'diff --git a/test.ts b/test.ts',
        '--- a/test.ts',
        '+++ b/test.ts',
        '@@ -1,3 +1,4 @@',
        ' old line',
        '-removed line',
        '+added line',
        ' unchanged',
      ],
    };
    const added = getAddedLines(diff);
    expect(added).toEqual(['added line']);
  });

  it('getRemovedLines 提取删除行', () => {
    const diff: DiffFile = {
      path: 'test.ts',
      status: 'modified',
      lines: [
        '--- a/test.ts',
        '+++ b/test.ts',
        '-removed line',
        '+new line',
        '-another removed',
      ],
    };
    const removed = getRemovedLines(diff);
    expect(removed).toEqual(['removed line', 'another removed']);
  });

  it('空 diff → 空数组', () => {
    const diff: DiffFile = { path: 'x.ts', status: 'modified', lines: [] };
    expect(getAddedLines(diff)).toEqual([]);
    expect(getRemovedLines(diff)).toEqual([]);
  });
});
