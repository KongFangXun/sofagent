// ============================================================
// atomic-write.test.ts · 原子写入测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicWriteSync, atomicWriteWithMergeSync, mergeAppendMissing } from '../shared/atomic-write';

describe('atomicWriteSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-atomic-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('写入文件并正确读取', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    atomicWriteSync(filePath, 'hello world');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');
  });

  it('覆盖已有文件', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'old content');
    atomicWriteSync(filePath, 'new content');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
  });

  it('写入空字符串', () => {
    const filePath = path.join(tmpDir, 'empty.txt');
    atomicWriteSync(filePath, '');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('');
  });

  it('写入包含特殊字符的内容', () => {
    const filePath = path.join(tmpDir, 'special.txt');
    const content = 'line1\nline2\twith tab\nline3 with "quotes" and \'single quotes\'';
    atomicWriteSync(filePath, content);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
  });
});

// ── v1.3.0 (交付 11)：进化链路写保护——写前 mtime 检测 + 合并 ──
describe('atomicWriteWithMergeSync / mergeAppendMissing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-atomic-merge-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('mergeAppendMissing: 保留 existing 中未在 incoming 的行', () => {
    const existing = 'lineA\nlineB';
    const incoming = 'lineB\nlineC';
    // lineA 只在 existing——应保留；lineC 只在 incoming——应写入
    const merged = mergeAppendMissing(existing, incoming);
    expect(merged).toContain('lineA');
    expect(merged).toContain('lineC');
    expect(merged).toContain('lineB');
  });

  it('atomicWriteWithMergeSync: 文件不存在时直接写入', () => {
    const filePath = path.join(tmpDir, 'new.txt');
    atomicWriteWithMergeSync(filePath, 'hello', mergeAppendMissing);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');
  });

  it('atomicWriteWithMergeSync: 他人改写后重读合并（不盲目覆盖）', () => {
    const filePath = path.join(tmpDir, 'merge.txt');
    // 首次写入
    atomicWriteWithMergeSync(filePath, 'mine-1', mergeAppendMissing);
    // 模拟"其他进程"在写入前追加了一行（进化经验）
    fs.appendFileSync(filePath, '\nother-process-added', 'utf-8');
    // 再次写入——应保留 other-process-added，不覆盖
    atomicWriteWithMergeSync(filePath, 'mine-2', mergeAppendMissing);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('other-process-added');
    expect(content).toContain('mine-2');
  });

  it('atomicWriteWithMergeSync: 缺省 merge = 覆盖（mtime 检测仅告警）', () => {
    const filePath = path.join(tmpDir, 'overwrite.txt');
    atomicWriteWithMergeSync(filePath, 'v1');
    atomicWriteWithMergeSync(filePath, 'v2');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('v2');
  });
});
