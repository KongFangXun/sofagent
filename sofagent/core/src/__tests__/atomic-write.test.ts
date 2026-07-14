// ============================================================
// atomic-write.test.ts · 原子写入测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicWriteSync } from '../shared/atomic-write';

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
