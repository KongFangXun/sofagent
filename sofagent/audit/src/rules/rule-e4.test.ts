// ============================================================
// rule-e4.test.ts · E4 不低注释——注释率检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleE4 } from './rule-e4-low-comment-ratio';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('E4 不低注释', () => {
  it('新增 > 200 行 + 注释率 < 5% → WARN', () => {
    const addedLines = Array.from({ length: 210 }, (_, i) => `+const x${i} = ${i};`);
    const ctx = makeCtx([makeDiffFile('src/big-file.ts', addedLines)]);
    const result = checkRuleE4(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('注释行');
  });

  it('新增 > 200 行 + 注释率 ≥ 5% → PASS', () => {
    const codeLines = Array.from({ length: 200 }, (_, i) => `+const x${i} = ${i};`);
    const commentLines = Array.from({ length: 11 }, () => '+// this is a comment');
    const ctx = makeCtx([makeDiffFile('src/commented-file.ts', [...codeLines, ...commentLines])]);
    const result = checkRuleE4(ctx);
    expect(result.status).toBe('PASS');
  });

  it('新增 ≤ 200 行 → PASS', () => {
    const addedLines = Array.from({ length: 100 }, (_, i) => `+const x${i} = ${i};`);
    const ctx = makeCtx([makeDiffFile('src/small-file.ts', addedLines)]);
    const result = checkRuleE4(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const addedLines = Array.from({ length: 210 }, (_, i) => `+const x${i} = ${i};`);
    const ctx = makeCtx([makeDiffFile('src/big-file.ts', addedLines)]);
    const result = checkRuleE4(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });
});
