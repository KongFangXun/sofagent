// ============================================================
// rule-a18-junk-file.test.ts · A18 垃圾文件测试
// v1.1.4 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA18 } from './rule-a18-junk-file';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A18 垃圾文件', () => {
  it('提交 a.txt（单字母文件名）→ WARN', () => {
    const ctx = makeCtx([makeDiffFile('a.txt', ['+junk'])]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('a.txt');
  });

  it('提交 tests/a.test.ts（正规测试文件）→ PASS（豁免）', () => {
    const ctx = makeCtx([makeDiffFile('tests/a.test.ts', ['+test'])]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('PASS');
  });

  it('提交 new-name.txt（可疑命名）→ WARN', () => {
    const ctx = makeCtx([makeDiffFile('new-name.txt', ['+junk'])]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('new-name.txt');
  });

  it('无垃圾文件 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/index.ts', ['+code']),
      makeDiffFile('src/utils.ts', ['+code']),
    ]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('PASS');
  });

  it('临时测试文件 test1.js → WARN', () => {
    const ctx = makeCtx([makeDiffFile('test1.js', ['+tmp'])]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('WARN');
  });

  it('正规测试文件 *.spec.ts → PASS（豁免）', () => {
    const ctx = makeCtx([makeDiffFile('src/foo.spec.ts', ['+test'])]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')]);
    const result = checkRuleA18(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('ruleClass 标注为 能力拐杖', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')]);
    const result = checkRuleA18(ctx);
    expect(result.ruleClass).toBe('能力拐杖');
  });
});
