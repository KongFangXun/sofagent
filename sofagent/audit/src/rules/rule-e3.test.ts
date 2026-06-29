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

  it('正好 100 行删除 → PASS（阈值以上才触发）', () => {
    const deletedLines = Array.from({ length: 100 }, () => '-code line');
    const ctx = makeCtx(
      [makeDiffFile('src/legacy.ts', deletedLines)],
      { task: 'login feature' }
    );
    const result = checkRuleE3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('单文件删 > 100 行 + task 关键词部分匹配文件路径 → PASS', () => {
    const deletedLines = Array.from({ length: 150 }, () => '-code line');
    const ctx = makeCtx(
      [makeDiffFile('src/feature-login.ts', deletedLines)],
      { task: 'implement feature feature' }
    );
    const result = checkRuleE3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('多文件大删除 + 与 task 无关 → WARN', () => {
    const deletedLines = Array.from({ length: 150 }, () => '-code line');
    const ctx = makeCtx(
      [
        makeDiffFile('src/legacy1.ts', deletedLines),
        makeDiffFile('src/legacy2.ts', deletedLines),
      ],
      { task: 'login feature' }
    );
    const result = checkRuleE3(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('2 个文件');
  });

  it('task 为空字符串 → PASS（无 task 跳过）', () => {
    const deletedLines = Array.from({ length: 101 }, () => '-some code line');
    const ctx = makeCtx(
      [makeDiffFile('src/legacy.ts', deletedLines)],
      { task: '' }
    );
    const result = checkRuleE3(ctx);
    expect(result.status).toBe('PASS');
  });
});
