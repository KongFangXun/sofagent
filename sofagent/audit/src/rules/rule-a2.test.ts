// ============================================================
// rule-a2.test.ts · A2 不泄密钥——密钥泄漏检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA2 } from './rule-a2-secret-leak';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A2 不泄密钥', () => {
  it('新增行含 AWS Access Key → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/config.ts', ['+const key = "AKIAIOSFODNN7EXAMPLE"'])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 Private Key → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/key.ts', ['+-----BEGIN RSA PRIVATE KEY-----'])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 OpenAI API Key → FAIL', () => {
    const longKey = 'sk-' + 'a'.repeat(48);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${longKey}"`])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 GitHub Token → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/ci.ts', ['+const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"'])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('无密钥 → PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['+const x = 1;'])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['+const x = 1;'])]);
    const result = checkRuleA2(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });
});
