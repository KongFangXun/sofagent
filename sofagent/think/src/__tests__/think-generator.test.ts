// ============================================================
// think-generator.test.ts · think 反思生成器测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateThinkEntry } from '../think-generator';
import type { DiffFile, AuditResult } from '@sofagent/core';

function makeAuditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    rules: [],
    exitCode: 0,
    ...overrides,
  } as AuditResult;
}

function makeDiffFile(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return { path, ...overrides } as DiffFile;
}

describe('generateThinkEntry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-think-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('空 diff 不生成条目', () => {
    generateThinkEntry([], makeAuditResult(), 'test-task', { dataDir: tmpDir, now: new Date(2026, 6, 14, 22, 0, 0) });
    expect(fs.existsSync(path.join(tmpDir, 'think.md'))).toBe(false);
  });

  it('有 diff 时生成条目并写入 think.md', () => {
    const diffFiles = [makeDiffFile('src/a.ts'), makeDiffFile('src/b.ts')];
    generateThinkEntry(diffFiles, makeAuditResult(), 'test-task', { dataDir: tmpDir, now: new Date(2026, 6, 14, 22, 0, 0) });
    expect(fs.existsSync(path.join(tmpDir, 'think.md'))).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, 'think.md'), 'utf-8');
    expect(content).toContain('test-task');
    expect(content).toContain('PASS');
    expect(content).toContain('2 个文件');
  });

  it('幂等：同 task + 同分钟不重复写入', () => {
    const diffFiles = [makeDiffFile('src/a.ts')];
    const now = new Date(2026, 6, 14, 22, 0, 0); // 本地时间
    generateThinkEntry(diffFiles, makeAuditResult(), 'same-task', { dataDir: tmpDir, now });
    generateThinkEntry(diffFiles, makeAuditResult(), 'same-task', { dataDir: tmpDir, now });
    const content = fs.readFileSync(path.join(tmpDir, 'think.md'), 'utf-8');
    // 格式化后的时间戳格式：## 2026-07-14 22:00 任务: same-task
    const matches = content.match(/## 2026-07-14 22:00/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('不同 task 都写入', () => {
    const diffFiles = [makeDiffFile('src/a.ts')];
    const now = new Date(2026, 6, 14, 22, 0, 0);
    generateThinkEntry(diffFiles, makeAuditResult(), 'task-a', { dataDir: tmpDir, now });
    // 不同 task 同一分钟也写入
    generateThinkEntry(diffFiles, makeAuditResult(), 'task-b', { dataDir: tmpDir, now });
    const content = fs.readFileSync(path.join(tmpDir, 'think.md'), 'utf-8');
    expect(content).toContain('task-a');
    expect(content).toContain('task-b');
  });

  it('自定义 dataDir 写入指定目录', () => {
    const customDir = path.join(tmpDir, 'custom');
    const diffFiles = [makeDiffFile('src/a.ts')];
    generateThinkEntry(diffFiles, makeAuditResult(), 'task', { dataDir: customDir, now: new Date(2026, 6, 14, 22, 0, 0) });
    expect(fs.existsSync(path.join(customDir, 'think.md'))).toBe(true);
  });

  it('think.md 不存在时首次创建', () => {
    expect(fs.existsSync(path.join(tmpDir, 'think.md'))).toBe(false);
    const diffFiles = [makeDiffFile('src/a.ts')];
    generateThinkEntry(diffFiles, makeAuditResult(), 'first-task', { dataDir: tmpDir, now: new Date(2026, 6, 14, 22, 0, 0) });
    expect(fs.existsSync(path.join(tmpDir, 'think.md'))).toBe(true);
  });

  it('触发 A3 规则时生成越界教训', () => {
    const diffFiles = [makeDiffFile('src/a.ts')];
    const result = makeAuditResult({
      rules: [{ name: 'A3 越界修改', number: 3, status: 'WARN', details: ['越界'] }],
      exitCode: 1,
    });
    generateThinkEntry(diffFiles, result, 'task', { dataDir: tmpDir, now: new Date(2026, 6, 14, 22, 0, 0) });
    const content = fs.readFileSync(path.join(tmpDir, 'think.md'), 'utf-8');
    expect(content).toContain('任务描述之外');
  });
});
