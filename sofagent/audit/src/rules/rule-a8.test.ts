// ============================================================
// rule-a8.test.ts · A8 不逃验证——构建文件白名单 + 测试命令检测
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA8 } from './rule-a8-verify-before-continue';
import { hasTestOrBuildExecution } from '../log-checker';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import type { LogEntry } from '../log-checker';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A8 不逃验证', () => {
  it('无构建文件变更 → PASS（跳过检查）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts')],
      { logEntries: [] }
    );
    const result = checkRuleA8(ctx);
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
      { logEntries: [execEntry] }
    );
    const result = checkRuleA8(ctx);
    expect(result.status).toBe('PASS');
  });

  it('构建文件变更 + 无日志 → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('package.json')],
      { logEntries: [] }
    );
    const result = checkRuleA8(ctx);
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
      { logEntries: [readEntry] }
    );
    const result = checkRuleA8(ctx);
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
      { logEntries: [execEntry] }
    );
    const result = checkRuleA8(ctx);
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
      { logEntries: [execEntry] }
    );
    const result = checkRuleA8(ctx);
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
      { logEntries: [execEntry] }
    );
    const result = checkRuleA8(ctx);
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
      { logEntries: [execEntry] }
    );
    const result = checkRuleA8(ctx);
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
      { logEntries: [execEntry] }
    );
    const result = checkRuleA8(ctx);
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
      { logEntries: [execEntry] }
    );
    const result = checkRuleA8(ctx);
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

  it('检测 docker build 命令', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'docker build -t myapp .' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('检测 docker compose build 命令', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'docker compose build' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('检测 tsc 命令', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'npx tsc --noEmit' },
    ];
    expect(hasTestOrBuildExecution(entries)).toBe(true);
  });

  it('make clean 不触发（只匹配 make build/test）', () => {
    const entries: LogEntry[] = [
      { timestamp: new Date(), operation: 'execute', raw: 'make clean' },
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
