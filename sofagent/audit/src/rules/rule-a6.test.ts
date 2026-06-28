// ============================================================
// rule-a6.test.ts · A6 不坏构建——构建配置破坏性修改检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA6 } from './rule-a6-build-broken';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A6 不坏构建', () => {
  it('vite.config.ts 删除 > 5 行 → WARN', () => {
    const deletedLines = Array.from({ length: 6 }, () => '-old code');
    const result = checkRuleA6(makeCtx([makeDiffFile('vite.config.ts', deletedLines)]));
    expect(result.status).toBe('WARN');
  });

  it('vite.config.ts 删除 ≤ 5 行 → PASS', () => {
    const deletedLines = Array.from({ length: 3 }, () => '-old code');
    const result = checkRuleA6(makeCtx([makeDiffFile('vite.config.ts', deletedLines)]));
    expect(result.status).toBe('PASS');
  });

  it('package.json 删除 > 5 行 → WARN', () => {
    const deletedLines = Array.from({ length: 10 }, () => '-old dep');
    const result = checkRuleA6(makeCtx([makeDiffFile('package.json', deletedLines)]));
    expect(result.status).toBe('WARN');
  });

  it('非构建文件 → PASS', () => {
    const deletedLines = Array.from({ length: 20 }, () => '-old code');
    const result = checkRuleA6(makeCtx([makeDiffFile('src/index.ts', deletedLines)]));
    expect(result.status).toBe('PASS');
  });

  it('构建文件无删除 → PASS', () => {
    const result = checkRuleA6(makeCtx([makeDiffFile('vite.config.ts', ['+new line'])]));
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const deletedLines = Array.from({ length: 6 }, () => '-old code');
    const result = checkRuleA6(makeCtx([makeDiffFile('vite.config.ts', deletedLines)]));
    expect(result.evidenceMode).toBe('git-diff');
  });
});
