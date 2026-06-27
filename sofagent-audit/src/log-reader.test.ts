// ============================================================
// log-reader.test.ts · LogFormat 可插拔接口测试
// v0.94 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { MarkdownLogReader, JSONLLogReader, pickLogReader } from './log-reader';

describe('LogFormat 可插拔', () => {
  describe('pickLogReader', () => {
    it('.md 文件 → MarkdownLogReader', () => {
      const reader = pickLogReader('task-log.md');
      expect(reader).toBeInstanceOf(MarkdownLogReader);
    });

    it('.jsonl 文件 → JSONLLogReader', () => {
      const reader = pickLogReader('task-log.jsonl');
      expect(reader).toBeInstanceOf(JSONLLogReader);
    });

    it('无扩展名文件 → MarkdownLogReader（默认）', () => {
      const reader = pickLogReader('task-log');
      expect(reader).toBeInstanceOf(MarkdownLogReader);
    });

    it('.txt 文件 → MarkdownLogReader（默认）', () => {
      const reader = pickLogReader('task-log.txt');
      expect(reader).toBeInstanceOf(MarkdownLogReader);
    });
  });

  describe('JSONLLogReader', () => {
    it('解析 JSONL 提取操作类型——含 read → read', () => {
      const jsonl = [
        JSON.stringify({ ts: '2024-01-01T00:00:00Z', op: 'read', file: 'src/a.ts' }),
        JSON.stringify({ ts: '2024-01-01T00:01:00Z', op: 'write', file: 'src/b.ts' }),
      ].join('\n');
      const reader = new JSONLLogReader();
      expect(reader.extractOperation(jsonl)).toBe('read');
    });

    it('解析 JSONL 提取操作类型——只有 write → write', () => {
      const jsonl = [
        JSON.stringify({ ts: '2024-01-01T00:00:00Z', op: 'write', file: 'src/b.ts' }),
      ].join('\n');
      const reader = new JSONLLogReader();
      expect(reader.extractOperation(jsonl)).toBe('write');
    });

    it('解析 JSONL 提取操作类型——只有 execute → execute', () => {
      const jsonl = [
        JSON.stringify({ ts: '2024-01-01T00:00:00Z', op: 'execute', context: 'npm test' }),
      ].join('\n');
      const reader = new JSONLLogReader();
      expect(reader.extractOperation(jsonl)).toBe('execute');
    });

    it('解析 JSONL 提取操作类型——无有效记录 → other', () => {
      const jsonl = 'invalid line\n{"ts":"2024-01-01","op":"unknown"}';
      const reader = new JSONLLogReader();
      expect(reader.extractOperation(jsonl)).toBe('other');
    });

    it('解析 JSONL 提取文件引用', () => {
      const jsonl = [
        JSON.stringify({ ts: '2024-01-01T00:00:00Z', op: 'read', file: 'src/a.ts' }),
        JSON.stringify({ ts: '2024-01-01T00:01:00Z', op: 'read', file: 'src/b.ts' }),
        JSON.stringify({ ts: '2024-01-01T00:02:00Z', op: 'write', file: 'src/a.ts' }),
      ].join('\n');
      const reader = new JSONLLogReader();
      const refs = reader.extractFileReferences(jsonl);
      expect(refs).toHaveLength(2);
      expect(refs).toContain('src/a.ts');
      expect(refs).toContain('src/b.ts');
    });

    it('非法 JSON 行被跳过', () => {
      const jsonl = [
        'this is not json',
        JSON.stringify({ ts: '2024-01-01T00:00:00Z', op: 'read', file: 'src/a.ts' }),
        '{ broken json',
        JSON.stringify({ ts: '2024-01-01T00:01:00Z', op: 'write', file: 'src/b.ts' }),
      ].join('\n');
      const reader = new JSONLLogReader();
      const refs = reader.extractFileReferences(jsonl);
      expect(refs).toHaveLength(2);
      expect(reader.extractOperation(jsonl)).toBe('read');
    });

    it('空内容 → other + 空数组', () => {
      const reader = new JSONLLogReader();
      expect(reader.extractOperation('')).toBe('other');
      expect(reader.extractFileReferences('')).toEqual([]);
    });
  });

  describe('MarkdownLogReader', () => {
    it('保持现有 MD 解析行为——读取操作', () => {
      const content = '## 任务日志\n\n读取文件 src/config.ts\n内容确认无误。';
      const reader = new MarkdownLogReader();
      expect(reader.extractOperation(content)).toBe('read');
    });

    it('保持现有 MD 解析行为——写入操作', () => {
      const content = '## 任务日志\n\n写入文件 src/config.ts';
      const reader = new MarkdownLogReader();
      expect(reader.extractOperation(content)).toBe('write');
    });

    it('保持现有 MD 解析行为——执行操作', () => {
      const content = '## 任务日志\n\n执行 bash 命令 npm test';
      const reader = new MarkdownLogReader();
      expect(reader.extractOperation(content)).toBe('execute');
    });

    it('保持现有 MD 解析行为——否定语义过滤', () => {
      const content = '## 任务日志\n\n未读取 src/config.ts';
      const reader = new MarkdownLogReader();
      expect(reader.extractOperation(content)).not.toBe('read');
    });

    it('保持现有 MD 解析行为——文件引用提取', () => {
      const content = '## 任务日志\n\n读取 src/config.ts 和 src/index.ts';
      const reader = new MarkdownLogReader();
      const refs = reader.extractFileReferences(content);
      expect(refs).toContain('src/config.ts');
      expect(refs).toContain('src/index.ts');
    });

    it('保持现有 MD 解析行为——Makefile 提取', () => {
      const content = '## 任务日志\n\n读取 Makefile 确认构建配置';
      const reader = new MarkdownLogReader();
      const refs = reader.extractFileReferences(content);
      expect(refs).toContain('Makefile');
    });
  });
});
