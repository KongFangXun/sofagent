// ============================================================
// rule-a1.test.ts · A1 不碰敏感——敏感文件检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA1 } from './rule-a1-sensitive-files';
import type { AuditContext } from './types';
import type { DiffFile } from '@sofagent/core';
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

  it('.env_backup → FAIL（下划线后缀）', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('.env_backup')]));
    expect(result.status).toBe('FAIL');
  });

  it('.env-backup → FAIL（连字符后缀）', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('.env-backup')]));
    expect(result.status).toBe('FAIL');
  });

  it('.env2 → FAIL（数字后缀）', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('.env2')]));
    expect(result.status).toBe('FAIL');
  });

  it('.еnv（西里尔同形字）→ FAIL（ASCII-only 检查）', () => {
    const result = checkRuleA1(makeCtx([makeDiffFile('.\u0435nv')]));
    expect(result.status).toBe('FAIL');
  });

  // v1.3.8 P0-3 回归：后缀式 .env 文件名——原模式 /^\.env[\w.-]*$/ 锚定 basename 点开头，
  // settings.env / production.env / config.env / 财务.env（含 SECRET=/API_KEY= 内容）全部漏检。
  // 修复：SENSITIVE_PATTERNS 补 /\.env$/i 后缀模式（保留原模式，不破坏 .env.local 前缀匹配）。
  describe('后缀式 .env 文件名（P0-3 回归）', () => {
    const suffixCases = ['settings.env', 'production.env', 'config.env', '财务.env', 'deploy/prod.env'];

    it.each(suffixCases)('%s → FAIL（后缀式 .env 不再绕过）', (path) => {
      const result = checkRuleA1(makeCtx([makeDiffFile(path)]));
      expect(result.status).toBe('FAIL');
    });

    it('普通非 .env 文件不误报：env-sample.md → PASS', () => {
      // .env 必须是结尾后缀，env-sample.md / environments.ts 这类词中含 env 的不受影响
      const result = checkRuleA1(makeCtx([makeDiffFile('docs/env-sample.md')]));
      expect(result.status).toBe('PASS');
    });

    it('前缀式 .env.local 仍 FAIL（原模式无回归）', () => {
      const result = checkRuleA1(makeCtx([makeDiffFile('.env.local')]));
      expect(result.status).toBe('FAIL');
    });
  });
});
