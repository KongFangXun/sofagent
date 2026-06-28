// ============================================================
// rule-a7.test.ts · A7 不存盲改——文件名匹配边界测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA7 } from './rule-a7-read-before-write';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import type { LogEntry } from '../log-checker';
import { makeDiffFile, makeCtx } from '../test-utils';

function makeReadEntry(file: string): LogEntry {
  return {
    timestamp: new Date(),
    operation: 'read',
    file,
    raw: `读取文件 ${file}`,
  };
}

describe('A7 不存盲改', () => {
  it('修改的文件在日志中有 Read 记录 → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/config.ts')],
      { logEntries: [makeReadEntry('src/config.ts')] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('PASS');
  });

  it('修改的文件无 Read 记录 → FAIL', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/config.ts')],
      { logEntries: [makeReadEntry('src/other.ts')] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('精确 basename 匹配：config.ts 不应匹配 tsconfig.json', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/config.ts')],
      { logEntries: [makeReadEntry('tsconfig.json')] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('精确 basename 匹配：同名不同路径正确匹配', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/utils/config.ts')],
      { logEntries: [makeReadEntry('lib/utils/config.ts')] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('PASS');
  });

  it('无扩展名文件（Makefile）能被正确匹配', () => {
    const ctx = makeCtx(
      [makeDiffFile('Makefile')],
      { logEntries: [makeReadEntry('Makefile')] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('PASS');
  });

  it('无扩展名文件（Dockerfile）能被正确匹配', () => {
    const ctx = makeCtx(
      [makeDiffFile('Dockerfile')],
      { logEntries: [makeReadEntry('Dockerfile')] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('PASS');
  });

  it('无日志记录时 → WARN（不默认 PASS）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts')],
      { logEntries: [] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('未找到');
  });

  it('多个文件部分有 Read 记录 → FAIL 且列出未读取文件', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/a.ts'), makeDiffFile('src/b.ts'), makeDiffFile('src/c.ts')],
      { logEntries: [makeReadEntry('src/a.ts')] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('2 个文件');
  });

  it('仅匹配 Read 操作条目——Write 操作中的文件名不算读取', () => {
    const writeEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'write',
      file: 'src/config.ts',
      raw: '写入文件 src/config.ts',
    };
    const ctx = makeCtx(
      [makeDiffFile('src/config.ts')],
      { logEntries: [writeEntry] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('全部是 deleted 文件 + 无日志 → PASS（不触发 WARN）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/deleted.ts', [], 'deleted')],
      { logEntries: [] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('PASS');
  });

  it('--strict 模式 + 无日志 → FAIL', () => {
    const ctx: AuditContext = {
      diffFiles: [makeDiffFile('src/index.ts')],
      logEntries: [],
      strict: true,
    };
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('默认模式 + 无日志 → WARN（行为不变）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts')],
      { logEntries: [] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('WARN');
  });

  it('deleted 文件不纳入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/deleted.ts', [], 'deleted'), makeDiffFile('src/config.ts')],
      { logEntries: [makeReadEntry('src/config.ts')] }
    );
    const result = checkRuleA7(ctx);
    expect(result.status).toBe('PASS');
  });
});
