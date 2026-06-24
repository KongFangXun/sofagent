import { describe, it, expect } from 'vitest';
import type { LogEntry } from '../src/log-checker';
import { getReadAccessMap, hasTestOrBuildExecution } from '../src/log-checker';

describe('log-checker helpers', () => {
  it('getReadAccessMap 提取 read 操作的文件', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'read', raw: 'Read a.ts', file: 'a.ts' },
      { timestamp: new Date(), operation: 'read', raw: 'Read b.ts', file: 'b.ts' },
      { timestamp: new Date(), operation: 'write', raw: 'Write c.ts', file: 'c.ts' },
    ];
    const files = getReadAccessMap(entries);
    expect(files.size).toBe(2);
    expect(files.has('a.ts')).toBe(true);
    expect(files.has('b.ts')).toBe(true);
    expect(files.has('c.ts')).toBe(false);
  });

  it('getReadAccessMap 空日志 → 空 set', () => {
    expect(getReadAccessMap([]).size).toBe(0);
  });

  it('hasTestOrBuildExecution 检测 npm test', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'npm test --coverage' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('hasTestOrBuildExecution 检测 yarn build', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'yarn build' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('hasTestOrBuildExecution 无执行记录 → false', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'read', raw: 'Read file' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(false);
  });

  it('hasTestOrBuildExecution 检测 pnpm test', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'pnpm test' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('hasTestOrBuildExecution 检测 make', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'make build' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });
});
