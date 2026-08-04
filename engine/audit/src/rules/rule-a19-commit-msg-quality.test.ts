// ============================================================
// rule-a19-commit-msg-quality.test.ts · A19 msg 质量测试
// v1.1.4 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA19 } from './rule-a19-commit-msg-quality';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A19 msg 质量', () => {
  it('commitMsg = "add"（黑名单 + 长度不足）→ FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'add' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('FAIL');
    // "add" 既长度不足（3<8）又命中黑名单——长度检查优先返回
    expect(result.details[0]).toMatch(/长度不足|黑名单/);
  });

  it('commitMsg = "feat: add login" → PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'feat: add login' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('PASS');
  });

  it('commitMsg = ""（空）→ PASS（降级）', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: '' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('PASS');
  });

  it('commitMsg = "update"（黑名单）→ FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'update' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('黑名单');
  });

  it('commitMsg 未提供（undefined）→ PASS（降级）', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')]);
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('PASS');
  });

  it('commitMsg = "fix"（黑名单 + 长度不足）→ FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'fix' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('commitMsg 长度刚好 7（< 8）→ FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: '1234567' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('长度不足');
  });

  it('commitMsg 长度 8 且非黑名单 → PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: '12345678' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('PASS');
  });

  it('commitMsg = "修复 bug"（中文加权 2×2+4=8）→ PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: '修复 bug' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('PASS');
  });

  it('commitMsg = "加注释"（中文加权 3×2=6 < 8）→ FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: '加注释' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('长度不足');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'valid message' });
    const result = checkRuleA19(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('ruleClass 标注为 业务底线', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { commitMsg: 'valid message' });
    const result = checkRuleA19(ctx);
    expect(result.ruleClass).toBe('业务底线');
  });
});
