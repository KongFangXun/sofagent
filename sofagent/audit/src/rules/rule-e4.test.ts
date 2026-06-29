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

  it('空文件变更 → PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/empty.ts', [])]);
    const result = checkRuleE4(ctx);
    expect(result.status).toBe('PASS');
  });

  it('新增 201 行 + 注释率恰好 5% → PASS', () => {
    const codeLines = Array.from({ length: 191 }, (_, i) => `+const x${i} = ${i};`);
    // 10 条注释行，10/201 ≈ 4.975%，略低于 5%
    const commentLines = Array.from({ length: 10 }, () => '+// comment');
    const ctx = makeCtx([makeDiffFile('src/file.ts', [...codeLines, ...commentLines])]);
    const result = checkRuleE4(ctx);
    // 10/201 = 4.975% < 5% → WARN
    expect(result.status).toBe('WARN');
  });

  it('# 注释被识别（Python 风格）', () => {
    const codeLines = Array.from({ length: 191 }, (_, i) => `+x${i} = ${i}`);
    const commentLines = Array.from({ length: 15 }, () => '+# this is a python comment');
    const ctx = makeCtx([makeDiffFile('src/script.py', [...codeLines, ...commentLines])]);
    const result = checkRuleE4(ctx);
    expect(result.status).toBe('PASS');
  });

  it('/* */ 注释被识别', () => {
    const codeLines = Array.from({ length: 191 }, (_, i) => `+const x${i} = ${i};`);
    const commentLines = Array.from({ length: 15 }, () => '+/* block comment */');
    const ctx = makeCtx([makeDiffFile('src/file.ts', [...codeLines, ...commentLines])]);
    const result = checkRuleE4(ctx);
    expect(result.status).toBe('PASS');
  });

  it('空行不计入新增代码行', () => {
    const codeLines = Array.from({ length: 191 }, (_, i) => `+const x${i} = ${i};`);
    const blankLines = Array.from({ length: 50 }, () => '+');
    const commentLines = Array.from({ length: 10 }, () => '+// comment');
    const ctx = makeCtx([makeDiffFile('src/file.ts', [...codeLines, ...blankLines, ...commentLines])]);
    const result = checkRuleE4(ctx);
    expect(result.status).toBe('WARN');
  });
});
