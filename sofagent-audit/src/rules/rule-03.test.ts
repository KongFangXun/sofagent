// ============================================================
// rule-03.test.ts · 铁律 #3 验证再干——构建文件白名单 + 测试命令检测
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRule03 } from './rule-03-verify-before-continue';
import { hasTestOrBuildExecution } from '../log-checker';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import type { LogEntry } from '../log-checker';

function makeDiffFile(path: string): DiffFile {
  return { path, status: 'modified', lines: [] };
}

function makeCtx(diffFiles: DiffFile[], logEntries: LogEntry[]): AuditContext {
  return { diffFiles, logEntries };
}

describe('铁律 #3 验证再干', () => {
  it('无构建文件变更 → PASS（跳过检查）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts')],
      []
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('PASS');
  });

  it('构建文件变更 + 有测试执行记录 → PASS', () => {
    const execEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'execute',
      raw: 'npm test\nexit code: 0',
    };
    const ctx = makeCtx(
      [makeDiffFile('package.json')],
      [execEntry]
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('PASS');
  });

  it('构建文件变更 + 无日志 → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('package.json')],
      []
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('WARN');
  });

  it('构建文件变更 + 日志存在但无 test/build 命令 → FAIL', () => {
    const readEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'read',
      raw: '读取文件 package.json',
    };
    const ctx = makeCtx(
      [makeDiffFile('package.json')],
      [readEntry]
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('BUILD_FILES 白名单包含 Dockerfile', () => {
    const execEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'execute',
      raw: 'npm run build',
    };
    const ctx = makeCtx(
      [makeDiffFile('Dockerfile')],
      [execEntry]
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('PASS');
  });

  it('BUILD_FILES 白名单包含 docker-compose.yml', () => {
    const execEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'execute',
      raw: 'make build',
    };
    const ctx = makeCtx(
      [makeDiffFile('docker-compose.yml')],
      [execEntry]
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('PASS');
  });

  it('BUILD_FILES 白名单包含 Makefile', () => {
    const execEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'execute',
      raw: 'make test',
    };
    const ctx = makeCtx(
      [makeDiffFile('Makefile')],
      [execEntry]
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('PASS');
  });

  it('BUILD_FILES 白名单包含 .env.example', () => {
    const execEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'execute',
      raw: 'npm test',
    };
    const ctx = makeCtx(
      [makeDiffFile('.env.example')],
      [execEntry]
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('PASS');
  });

  it('BUILD_FILES 白名单包含 tsconfig.json', () => {
    const execEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'execute',
      raw: 'npm run build',
    };
    const ctx = makeCtx(
      [makeDiffFile('tsconfig.json')],
      [execEntry]
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('PASS');
  });

  it('BUILD_FILES 白名单包含 vite.config.ts', () => {
    const execEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'execute',
      raw: 'pnpm build',
    };
    const ctx = makeCtx(
      [makeDiffFile('vite.config.ts')],
      [execEntry]
    );
    const result = checkRule03(ctx);
    expect(result.status).toBe('PASS');
  });
});

describe('hasTestOrBuildExecution', () => {
  it('检测 npm test 命令', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'npm test' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('检测 npm run build 命令', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'npm run build' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('检测 yarn test 命令', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'yarn test' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('检测 make 命令', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'make build' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('非 execute 操作的日志不触发', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'read', raw: 'npm test' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(false);
  });

  it('无匹配命令时返回 false', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'ls -la' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(false);
  });
});
