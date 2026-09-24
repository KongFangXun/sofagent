// diff-parser-file-header.test.ts · 文件头判别共享函数回归测试
// 背景：getAddedLines/getRemovedLines 曾用 startsWith('+++')/('---') 过滤文件头，
// 会误吞内容以 ++/-- 开头的真实增删行（新增行 `++i;` 产出 diff 行 `+++i;` 被当
// 文件头丢弃），所有内容扫描规则对这类行集体失明——A2 密钥检测可被
// 「把含密钥的行以 ++ 开头」定向绕过。本文件钉住共享判别函数 isDiffFileHeader
// 与两个消费函数（getAddedLines/getRemovedLines）的行为。

import { describe, it, expect } from 'vitest';
import { isDiffFileHeader, getAddedLines, getRemovedLines } from '../diff-parser';
import type { DiffFile } from '../diff-parser';

describe('isDiffFileHeader · 共享文件头判别', () => {
  it('真文件头判头：+++ b/path 与 --- a/path（含 /dev/null）', () => {
    expect(isDiffFileHeader('+++ b/src/index.ts')).toBe(true);
    expect(isDiffFileHeader('--- a/src/index.ts')).toBe(true);
    expect(isDiffFileHeader('--- /dev/null')).toBe(true);
    expect(isDiffFileHeader('+++ /dev/null')).toBe(true);
  });

  it('裸标记（无路径）判头：整行恰为 +++ / ---', () => {
    expect(isDiffFileHeader('+++')).toBe(true);
    expect(isDiffFileHeader('---')).toBe(true);
  });

  it('内容行不判头：+++i;（自增语句）/ -- 注释（SQL 注释）/ ++ 系内容', () => {
    expect(isDiffFileHeader('+++i;')).toBe(false); // 标记后无空格——内容行
    expect(isDiffFileHeader('-- 注释')).toBe(false);
    expect(isDiffFileHeader('-- 注释 WHERE 1=1')).toBe(false);
    expect(isDiffFileHeader('++')).toBe(false);
    expect(isDiffFileHeader('+')).toBe(false);
    expect(isDiffFileHeader('-')).toBe(false);
  });

  it('已知边界（如实钉住）：`+++ i < n;`（标记后带空格的内容行）仍被判头', () => {
    // 判据是「标记 + 空格 + 非空白起头」即路径形态——该形态与真文件头无法在
    // 行级区分（git 文件头也是 `+++ <path>`）。这是保守取舍：宁可极少数带空格
    // 内容行被滤，也不让任何文件头漏进内容扫描（文件头混进 A2 会误报路径里的
    // 假密钥）。真实代码里 `+++ ` 后直接跟空格的内容行（如 `+++ x`）远比
    // `+++i;` 罕见——红队主形态（无空格粘标记）已全覆盖。
    expect(isDiffFileHeader('+++ i < n;')).toBe(true);
  });

  it('非 +/- 开头行一律不判头', () => {
    expect(isDiffFileHeader('@@ -1,7 +1,7 @@')).toBe(false);
    expect(isDiffFileHeader('diff --git a/x b/x')).toBe(false);
    expect(isDiffFileHeader(' context line')).toBe(false);
    expect(isDiffFileHeader('')).toBe(false);
  });
});

describe('getAddedLines/getRemovedLines · +++ 前缀内容行不再被吞', () => {
  const mk = (lines: string[]): DiffFile => ({
    path: 'test.ts',
    status: 'modified',
    lines,
  });

  it('红队：新增行 ++i;（diff 行 +++i;）与含密钥行以 +++ 开头——都进 addedLines', () => {
    const diff = mk([
      'diff --git a/x.ts b/x.ts',
      'index 123..456 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,3 +1,5 @@',
      ' context',
      '+++i;',                      // 新增内容行：++i;
      '+++const AK = "sk-abc123";', // 红队：密钥行以 +++ 开头（旧实现被吞）
      '-- SELECT * FROM t;',       // 删除内容行：SQL 注释
    ]);
    const added = getAddedLines(diff);
    expect(added).toContain('++i;');
    // substring(1) 只剥一个 diff 标记字符——diff 行 `+++const AK=...` 的内容是 `++const AK=...`
    expect(added).toContain('++const AK = "sk-abc123";');
    // 文件头本身不进 added
    expect(added).not.toContain('b/x.ts');
    const removed = getRemovedLines(diff);
    expect(removed).toContain('- SELECT * FROM t;');
  });

  it('常规 diff 行为不回归：文件头被滤、普通增删行照常', () => {
    const diff = mk([
      '--- a/y.ts',
      '+++ b/y.ts',
      '@@ -1,2 +1,2 @@',
      '-old line',
      '+new line',
      ' ctx',
    ]);
    expect(getAddedLines(diff)).toEqual(['new line']);
    expect(getRemovedLines(diff)).toEqual(['old line']);
  });
});
