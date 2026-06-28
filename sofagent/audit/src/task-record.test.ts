// ============================================================
// task-record.test.ts · JSONL 结构化任务日志记录器测试
// v0.94 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  createTaskRecord,
  serializeTaskRecord,
  serializeTaskRecords,
  parseTaskRecords,
  type TaskRecord,
} from './task-record';

describe('task-record JSONL', () => {
  describe('createTaskRecord', () => {
    it('生成正确结构——带 file 和 context', () => {
      const record = createTaskRecord('read', 'src/index.ts', '审查入口文件');
      expect(record.op).toBe('read');
      expect(record.file).toBe('src/index.ts');
      expect(record.context).toBe('审查入口文件');
      expect(record.ts).toBeDefined();
      // ts 应该是有效的 ISO 8601 时间戳
      expect(new Date(record.ts).toISOString()).toBe(record.ts);
    });

    it('生成正确结构——无 file 无 context', () => {
      const record = createTaskRecord('execute');
      expect(record.op).toBe('execute');
      expect(record.file).toBeUndefined();
      expect(record.context).toBeUndefined();
      expect(record.ts).toBeDefined();
    });

    it('支持所有操作类型', () => {
      expect(createTaskRecord('read').op).toBe('read');
      expect(createTaskRecord('write').op).toBe('write');
      expect(createTaskRecord('execute').op).toBe('execute');
    });
  });

  describe('serializeTaskRecord', () => {
    it('输出单行 JSON', () => {
      const record: TaskRecord = {
        ts: '2024-01-01T00:00:00.000Z',
        op: 'read',
        file: 'src/index.ts',
      };
      const json = serializeTaskRecord(record);
      expect(json).toBe('{"ts":"2024-01-01T00:00:00.000Z","op":"read","file":"src/index.ts"}');
      // 确认是单行
      expect(json.split('\n')).toHaveLength(1);
    });

    it('可选字段为 undefined 时不出现在 JSON 中', () => {
      const record: TaskRecord = {
        ts: '2024-01-01T00:00:00.000Z',
        op: 'execute',
      };
      const json = serializeTaskRecord(record);
      const parsed = JSON.parse(json);
      expect(parsed.op).toBe('execute');
      expect(parsed.file).toBeUndefined();
      expect(parsed.context).toBeUndefined();
    });
  });

  describe('serializeTaskRecords', () => {
    it('多条记录序列化为多行 JSONL', () => {
      const records: TaskRecord[] = [
        { ts: '2024-01-01T00:00:00.000Z', op: 'read', file: 'src/a.ts' },
        { ts: '2024-01-01T00:01:00.000Z', op: 'write', file: 'src/b.ts' },
        { ts: '2024-01-01T00:02:00.000Z', op: 'execute', context: 'npm test' },
      ];
      const jsonl = serializeTaskRecords(records);
      const lines = jsonl.split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).file).toBe('src/a.ts');
      expect(JSON.parse(lines[1]).file).toBe('src/b.ts');
      expect(JSON.parse(lines[2]).context).toBe('npm test');
    });

    it('空数组 → 空字符串', () => {
      expect(serializeTaskRecords([])).toBe('');
    });
  });

  describe('parseTaskRecords', () => {
    it('解析多行 JSONL', () => {
      const jsonl = [
        '{"ts":"2024-01-01T00:00:00.000Z","op":"read","file":"src/a.ts"}',
        '{"ts":"2024-01-01T00:01:00.000Z","op":"write","file":"src/b.ts"}',
      ].join('\n');
      const records = parseTaskRecords(jsonl);
      expect(records).toHaveLength(2);
      expect(records[0].op).toBe('read');
      expect(records[0].file).toBe('src/a.ts');
      expect(records[1].op).toBe('write');
      expect(records[1].file).toBe('src/b.ts');
    });

    it('跳过非法 JSON', () => {
      const jsonl = [
        'this is not json',
        '{"ts":"2024-01-01T00:00:00.000Z","op":"read","file":"src/a.ts"}',
        '{ broken',
        '{"ts":"2024-01-01T00:01:00.000Z","op":"write","file":"src/b.ts"}',
      ].join('\n');
      const records = parseTaskRecords(jsonl);
      expect(records).toHaveLength(2);
      expect(records[0].file).toBe('src/a.ts');
      expect(records[1].file).toBe('src/b.ts');
    });

    it('空字符串 → 空数组', () => {
      expect(parseTaskRecords('')).toEqual([]);
    });
  });

  describe('round-trip 一致性', () => {
    it('序列化→解析 round-trip 一致', () => {
      const original: TaskRecord[] = [
        { ts: '2024-01-01T00:00:00.000Z', op: 'read', file: 'src/a.ts', context: '审查' },
        { ts: '2024-01-01T00:01:00.000Z', op: 'write', file: 'src/b.ts' },
        { ts: '2024-01-01T00:02:00.000Z', op: 'execute', context: 'npm test' },
      ];
      const jsonl = serializeTaskRecords(original);
      const parsed = parseTaskRecords(jsonl);
      expect(parsed).toEqual(original);
    });

    it('单条记录 round-trip', () => {
      const original = createTaskRecord('read', 'src/index.ts', '入口文件');
      const json = serializeTaskRecord(original);
      const parsed = parseTaskRecords(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].op).toBe(original.op);
      expect(parsed[0].file).toBe(original.file);
      expect(parsed[0].context).toBe(original.context);
    });
  });
});
