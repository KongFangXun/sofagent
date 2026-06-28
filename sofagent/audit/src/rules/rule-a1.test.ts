// ============================================================
// rule-a1.test.ts · A1 不碰敏感——敏感文件检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA1 } from './rule-a1-sensitive-files';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A1 不碰敏感', () => {
  it('.env → FAIL', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('.env')]));
    expect(result.status).toBe('FAIL');
  });

  it('.env.local → FAIL', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('.env.local')]));
    expect(result.status).toBe('FAIL');
  });

  it('.env.production → FAIL', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('.env.production')]));
    expect(result.status).toBe('FAIL');
  });

  it('id_rsa → FAIL', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('id_rsa')]));
    expect(result.status).toBe('FAIL');
  });

  it('id_ed25519 → FAIL', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('id_ed25519')]));
    expect(result.status).toBe('FAIL');
  });

  it('credentials.json → FAIL', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('credentials.json')]));
    expect(result.status).toBe('FAIL');
  });

  it('*.pem → FAIL', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('cert/server.pem')]));
    expect(result.status).toBe('FAIL');
  });

  it('*.key → FAIL', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('ssl/private.key')]));
    expect(result.status).toBe('FAIL');
  });

  it('普通文件 → PASS', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('src/index.ts')]));
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('.env')]));
    expect(result.evidenceMode).toBe('git-diff');
  });
});
