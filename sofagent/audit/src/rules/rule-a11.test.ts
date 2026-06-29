// ============================================================
// rule-a11.test.ts · A11 不滥资源——资源消耗检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA11 } from './rule-a11-no-abuse';
import { makeDiffFile, makeCtx } from '../test-utils';
import type { DiffFile } from '../diff-parser';

describe('A11 不滥资源', () => {
  it('新增文件 > 50 → WARN', () => {
    const files: DiffFile[] = Array.from({ length: 51 }, (_, i) =>
      makeDiffFile(`src/new-${i}.ts`, [], 'added')
    );
    const ctx = makeCtx(files);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('51');
  });

  it('新增文件 ≤ 50 → PASS', () => {
    const files: DiffFile[] = Array.from({ length: 10 }, (_, i) =>
      makeDiffFile(`src/new-${i}.ts`, [], 'added')
    );
    const ctx = makeCtx(files);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('PASS');
  });

  it('单文件新增行 > 10000 → WARN', () => {
    const lines = Array.from({ length: 10001 }, () => '+code line');
    const ctx = makeCtx([makeDiffFile('src/huge.ts', lines)]);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('10001');
  });

  it('单文件新增行 ≤ 10000 → PASS', () => {
    const lines = Array.from({ length: 100 }, () => '+code line');
    const ctx = makeCtx([makeDiffFile('src/small.ts', lines)]);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('PASS');
  });

  it('删除文件 > 20 → FAIL', () => {
    const files: DiffFile[] = Array.from({ length: 21 }, (_, i) =>
      makeDiffFile(`src/deleted-${i}.ts`, [], 'deleted')
    );
    const ctx = makeCtx(files);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('21');
  });

  it('删除文件 ≤ 20 → PASS', () => {
    const files: DiffFile[] = Array.from({ length: 5 }, (_, i) =>
      makeDiffFile(`src/deleted-${i}.ts`, [], 'deleted')
    );
    const ctx = makeCtx(files);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('PASS');
  });

  it('正常变更 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/index.ts', ['+const x = 1;']),
      makeDiffFile('src/utils.ts', ['+export function foo() {}']),
    ]);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('PASS');
  });

  it('同时触发新增文件 WARN 和删除 files FAIL → 最终 FAIL', () => {
    const addedFiles: DiffFile[] = Array.from({ length: 51 }, (_, i) =>
      makeDiffFile(`src/new-${i}.ts`, [], 'added')
    );
    const deletedFiles: DiffFile[] = Array.from({ length: 21 }, (_, i) =>
      makeDiffFile(`src/del-${i}.ts`, [], 'deleted')
    );
    const ctx = makeCtx([...addedFiles, ...deletedFiles]);
    const result = checkRuleA11(ctx);
    // FAIL 优先级最高
    expect(result.status).toBe('FAIL');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')]);
    const result = checkRuleA11(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('仅 modified 文件（不新增也不删除）→ PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/a.ts', ['+line'], 'modified'),
      makeDiffFile('src/b.ts', ['+line'], 'modified'),
    ]);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('PASS');
  });
});
