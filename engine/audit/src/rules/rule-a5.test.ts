// ============================================================
// rule-a5.test.ts · A5 不瞒真相——commit message 占位符检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { scanA5 } from './rule-a5-honest-report';
import type { AuditContext } from './types';
import type { DiffFile } from '@sofagent/core';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A5 不瞒真相', () => {
  it('commit = "fix" → WARN', () => {
    const result = scanA5(makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'fix' }));
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('占位符');
  });

  it('commit = "fix login bug" → PASS', () => {
    const result = scanA5(makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'fix login bug' }));
    expect(result.status).toBe('PASS');
  });

  it('commit = "" → FAIL', () => {
    const result = scanA5(makeCtx([makeDiffFile('src/index.ts')], { commitMsg: '' }));
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('为空');
  });

  it('commit = "wip" → WARN', () => {
    const result = scanA5(makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'wip' }));
    expect(result.status).toBe('WARN');
  });

  it('commit = "update" → WARN', () => {
    const result = scanA5(makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'update' }));
    expect(result.status).toBe('WARN');
  });

  it('commit = "chore" → WARN', () => {
    const result = scanA5(makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'chore' }));
    expect(result.status).toBe('WARN');
  });

  it('commit 太短 (< 5 字符) → WARN', () => {
    const result = scanA5(makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'ab' }));
    expect(result.status).toBe('WARN');
  });

  it('commitMsg = "" 与 undefined 行为不同（bug 修复回归）', () => {
    const resultEmpty = scanA5(makeCtx([makeDiffFile('src/index.ts')], { commitMsg: '' }));
    expect(resultEmpty.status).toBe('FAIL');
    expect(resultEmpty.details[0]).toContain('为空');
    const ctxUndefined: AuditContext = { diffFiles: [makeDiffFile('src/index.ts')], logEntries: [] };
    const resultUndefined = scanA5(ctxUndefined);
    expect(resultUndefined.details.some(d => d.includes('为空'))).toBe(false);
  });
});
