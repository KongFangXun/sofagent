// ============================================================
// rule-e3.test.ts · E3 不滥删除——大量删除检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleE3 } from './rule-e3-large-deletion';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('E3 不滥删除', () => {
  it('单文件删 > 100 行 + 与 task 无关 → WARN', () => {
    const deletedLines = Array.from({ length: 101 }, () => '-some code line');
    const ctx = makeCtx(
      [makeDiffFile('src/legacy.ts', deletedLines)],
      { task: 'login feature' }
    );
    const result = checkRuleE3(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('101');
  });

  it('单文件删 > 100 行 + 与 task 相关 → PASS', () => {
    const deletedLines = Array.from({ length: 101 }, () => '-some code line');
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts', deletedLines)],
      { task: 'login feature' }
    );
    const result = checkRuleE3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('无 --task → PASS', () => {
    const deletedLines = Array.from({ length: 101 }, () => '-some code line');
    const ctx = makeCtx([makeDiffFile('src/legacy.ts', deletedLines)]);
    const result = checkRuleE3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('单文件删 ≤ 100 行 → PASS', () => {
    const deletedLines = Array.from({ length: 50 }, () => '-some code line');
    const ctx = makeCtx(
      [makeDiffFile('src/legacy.ts', deletedLines)],
      { task: 'login feature' }
    );
    const result = checkRuleE3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const deletedLines = Array.from({ length: 101 }, () => '-some code line');
    const ctx = makeCtx(
      [makeDiffFile('src/legacy.ts', deletedLines)],
      { task: 'login feature' }
    );
    const result = checkRuleE3(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });
});
