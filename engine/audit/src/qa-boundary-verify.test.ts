// ============================================================
// qa-boundary-verify.test.ts · QA 独立验证边界用例（正式测试）
// A1/A3/A5/E4 行为级边界断言——验证审计规则在真实文件场景下的判定正确性
// ============================================================

import { describe, it, expect } from 'vitest';
import { scanA1 } from './rules/rule-a1-sensitive-files';
import { scanE4 } from './rules/rule-e4-low-comment-ratio';
import type { DiffFile } from '@sofagent/core';
import { makeDiffFile, makeCtx } from './test-utils';

describe('QA 边界验证 · R11 敏感文件', () => {
  it('.env → FAIL（不需 task/silent/logs）', () => {
    const result = scanA1(makeCtx([makeDiffFile('.env')]));
    expect(result.status).toBe('FAIL');
  });
  it('.env.local → FAIL', () => {
    expect(scanA1(makeCtx([makeDiffFile('.env.local')])).status).toBe('FAIL');
  });
  it('.env.production → FAIL', () => {
    expect(scanA1(makeCtx([makeDiffFile('.env.production')])).status).toBe('FAIL');
  });
  it('id_rsa → FAIL', () => {
    expect(scanA1(makeCtx([makeDiffFile('id_rsa')])).status).toBe('FAIL');
  });
  it('id_ed25519 → FAIL', () => {
    expect(scanA1(makeCtx([makeDiffFile('id_ed25519')])).status).toBe('FAIL');
  });
  it('credentials.json → FAIL', () => {
    expect(scanA1(makeCtx([makeDiffFile('credentials.json')])).status).toBe('FAIL');
  });
  it('server.pem → FAIL', () => {
    expect(scanA1(makeCtx([makeDiffFile('cert/server.pem')])).status).toBe('FAIL');
  });
  it('private.key → FAIL', () => {
    expect(scanA1(makeCtx([makeDiffFile('ssl/private.key')])).status).toBe('FAIL');
  });
  it('src/index.ts → PASS（普通文件不触发）', () => {
    expect(scanA1(makeCtx([makeDiffFile('src/index.ts')])).status).toBe('PASS');
  });
});

describe('QA 边界验证 · R12 注释率精确边界', () => {
  it('新增正好 200 行 + 0 注释 → PASS（不触发）', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `+const x${i} = ${i};`);
    expect(scanE4(makeCtx([makeDiffFile('src/b.ts', lines)])).status).toBe('PASS');
  });
  it('新增 201 行 + 0 注释 → WARN', () => {
    const lines = Array.from({ length: 201 }, (_, i) => `+const x${i} = ${i};`);
    expect(scanE4(makeCtx([makeDiffFile('src/b.ts', lines)])).status).toBe('WARN');
  });
  it('新增 201 行 + 11 注释（≥5%）→ PASS', () => {
    const code = Array.from({ length: 190 }, (_, i) => `+const x${i} = ${i};`);
    const comments = Array.from({ length: 11 }, () => '+// comment');
    // total added = 201, comments = 11, ratio = 11/201 ≈ 5.5%
    expect(scanE4(makeCtx([makeDiffFile('src/b.ts', [...code, ...comments])])).status).toBe('PASS');
  });
});
// v1.4.8 条目 7：本文件原「evidenceMode 标注完整性」段已并入 evidence-mode.test.ts
// （装配路径 RuleCheck 携带 evidenceMode 的唯一集中断言点）。
