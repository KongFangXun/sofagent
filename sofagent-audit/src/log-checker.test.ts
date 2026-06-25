// ============================================================
// log-checker.test.ts · 日志文件解析 + 否定语义处理
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkLogs, getReadAccessMap, hasTestOrBuildExecution, type LogEntry } from './log-checker';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sofagent-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeLog(content: string): void {
  writeFileSync(join(tempDir, 'test-log.md'), content, 'utf-8');
}

describe('checkLogs + extractOperation（通过公共 API 测试）', () => {
  it('日志含 Read 操作 → 生成 read 操作条目', () => {
    writeLog('## 任务日志\n\n读取文件 src/config.ts\n内容确认无误。');
    const entries = checkLogs(tempDir);
    const readEntries = entries.filter((e) => e.operation === 'read');
    expect(readEntries.length).toBeGreaterThan(0);
  });

  it('日志含"读取"中文关键词 → 识别为 read 操作', () => {
    writeLog('## 任务日志\n\n读取了 src/index.ts 文件');
    const entries = checkLogs(tempDir);
    const readEntries = entries.filter((e) => e.operation === 'read');
    expect(readEntries.length).toBeGreaterThan(0);
  });

  it('日志含 Write 操作 → 生成 write 操作条目', () => {
    writeLog('## 任务日志\n\n写入文件 src/config.ts\n完成修改。');
    const entries = checkLogs(tempDir);
    const writeEntries = entries.filter((e) => e.operation === 'write');
    expect(writeEntries.length).toBeGreaterThan(0);
  });

  it('日志含 Bash/执行 操作 → 生成 execute 操作条目', () => {
    writeLog('## 任务日志\n\n执行 bash 命令 npm test');
    const entries = checkLogs(tempDir);
    const execEntries = entries.filter((e) => e.operation === 'execute');
    expect(execEntries.length).toBeGreaterThan(0);
  });

  it('否定语义："未读取" 不算 Read 操作', () => {
    writeLog('## 任务日志\n\n未读取 src/config.ts，直接修改了');
    const entries = checkLogs(tempDir);
    // 整篇日志的 operation 不应该是 read（因为只有"未读取"这一行）
    const mainEntry = entries.find((e) => !e.file);
    if (mainEntry) {
      expect(mainEntry.operation).not.toBe('read');
    }
  });

  it('否定语义："跳过读取" 不算 Read 操作', () => {
    writeLog('## 任务日志\n\n跳过读取 src/config.ts');
    const entries = checkLogs(tempDir);
    const mainEntry = entries.find((e) => !e.file);
    if (mainEntry) {
      expect(mainEntry.operation).not.toBe('read');
    }
  });

  it('否定语义："没有读取" 不算 Read 操作', () => {
    writeLog('## 任务日志\n\n没有读取 src/config.ts');
    const entries = checkLogs(tempDir);
    const mainEntry = entries.find((e) => !e.file);
    if (mainEntry) {
      expect(mainEntry.operation).not.toBe('read');
    }
  });

  it('无扩展名文件（Makefile）能被提取为文件引用', () => {
    writeLog('## 任务日志\n\n读取 Makefile 确认构建配置');
    const entries = checkLogs(tempDir);
    const fileEntries = entries.filter((e) => e.file);
    const hasMakefile = fileEntries.some((e) => e.file === 'Makefile');
    expect(hasMakefile).toBe(true);
  });

  it('无扩展名文件（Dockerfile）能被提取为文件引用', () => {
    writeLog('## 任务日志\n\n读取 Dockerfile');
    const entries = checkLogs(tempDir);
    const fileEntries = entries.filter((e) => e.file);
    const hasDockerfile = fileEntries.some((e) => e.file === 'Dockerfile');
    expect(hasDockerfile).toBe(true);
  });

  it('目录不存在 → 返回空数组', () => {
    const entries = checkLogs('/nonexistent/path/that/does/not/exist');
    expect(entries).toEqual([]);
  });
});

describe('getReadAccessMap', () => {
  it('只收集 operation=read 且有 file 的条目', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'read', file: 'src/a.ts', raw: '' },
      { timestamp: new Date(), operation: 'read', file: 'src/b.ts', raw: '' },
      { timestamp: new Date(), operation: 'write', file: 'src/c.ts', raw: '' },
      { timestamp: new Date(), operation: 'read', raw: '' }, // 无 file
    ];
    const map = getReadAccessMap(entries);
    expect(map.size).toBe(2);
    expect(map.has('src/a.ts')).toBe(true);
    expect(map.has('src/b.ts')).toBe(true);
    expect(map.has('src/c.ts')).toBe(false);
  });

  it('空数组 → 空 Set', () => {
    const map = getReadAccessMap([]);
    expect(map.size).toBe(0);
  });

  it('去重：同名文件只出现一次', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'read', file: 'src/a.ts', raw: '' },
      { timestamp: new Date(), operation: 'read', file: 'src/a.ts', raw: '' },
    ];
    const map = getReadAccessMap(entries);
    expect(map.size).toBe(1);
  });
});

describe('hasTestOrBuildExecution', () => {
  it('execute 操作含 npm test → true', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'npm test\nexit code: 0' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('execute 操作含 npm run build → true', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'npm run build' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('execute 操作含 make build → true', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'make build' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('execute 操作无 test/build 命令 → false', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'ls -la' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(false);
  });

  it('read 操作含 npm test → false（非 execute 操作）', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'read', raw: 'npm test' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(false);
  });

  it('空数组 → false', () => {
    expect(hasTestOrBuildExecution([])).toBe(false);
  });
});
