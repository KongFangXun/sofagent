// ============================================================
// diff-parser.test.ts · git diff 解析器测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { parseDiff, parseNumstat } from '../diff-parser';

describe('parseNumstat', () => {
  it('解析标准 numstat 格式', () => {
    const output = [
      '3\t2\tsrc/a.ts',
      '0\t10\tsrc/b.ts',
    ].join('\n');
    const results = parseNumstat(output);
    expect(results).toHaveLength(2);
    expect(results[0]!.path).toBe('src/a.ts');
    expect(results[0]!.addedLines).toBe(3);
    expect(results[0]!.deletedLines).toBe(2);
    expect(results[1]!.path).toBe('src/b.ts');
    expect(results[1]!.addedLines).toBe(0);
    expect(results[1]!.deletedLines).toBe(10);
  });

  it('空字符串返回空数组', () => {
    expect(parseNumstat('')).toEqual([]);
  });

  it('二进制文件返回 -/-', () => {
    const output = '-\t-\timage.png';
    const results = parseNumstat(output);
    expect(results).toHaveLength(1);
    expect(results[0]!.addedLines).toBe(0);
    expect(results[0]!.deletedLines).toBe(0);
  });

  it('忽略空行', () => {
    const output = '\n\n3\t2\tsrc/a.ts\n\n0\t1\tsrc/b.ts\n';
    const results = parseNumstat(output);
    expect(results).toHaveLength(2);
  });
});

describe('parseDiff', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-diff-'));
    execSync('git init && git config user.email "t@t.com" && git config user.name "T"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('有变更时返回 DiffFile 数组', () => {
    fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'const x = 1;\n');
    execSync('git add src.ts && git commit -m "add src"', { cwd: tmpDir });
    const files = parseDiff('HEAD~1..HEAD', tmpDir);
    expect(files.length).toBeGreaterThan(0);
    const file = files[0]!;
    expect(file.path).toBeTruthy();
    expect(['added', 'modified', 'deleted', 'renamed']).toContain(file.status);
    expect(Array.isArray(file.lines)).toBe(true);
  });

  it('多文件变更正确解析', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'b');
    execSync('git add . && git commit -m "add files"', { cwd: tmpDir });
    const files = parseDiff('HEAD~1..HEAD', tmpDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    // 所有返回的 file 都有有效 path
    for (const f of files) {
      expect(typeof f.path).toBe('string');
      expect(f.path.length).toBeGreaterThan(0);
    }
  });
});
