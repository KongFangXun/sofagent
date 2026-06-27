// ============================================================
// qa-boundary-verify.test.ts · QA 独立验证边界用例（临时文件，验证后删除）
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleR11 } from './rules/rule-r11-sensitive-files';
import { checkRuleR12 } from './rules/rule-r12-low-comment-ratio';
import { checkRule07 } from './rules/rule-07-careful-modify';
import { checkRule10 } from './rules/rule-10-honest-report';
import { rules } from './rules';
import type { AuditContext } from './rules/types';
import type { DiffFile } from './diff-parser';

function makeDiffFile(path: string, lines: string[] = [], status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, status, lines };
}
function makeCtx(diffFiles: DiffFile[], opts?: Partial<AuditContext>): AuditContext {
  return { diffFiles, logEntries: [], ...opts };
}

describe('QA 边界验证 · R11 敏感文件', () => {
  it('.env → FAIL（不需 task/silent/logs）', () => {
    const result = checkRuleR11(makeCtx([makeDiffFile('.env')]));
    expect(result.status).toBe('FAIL');
  });
  it('.env.local → FAIL', () => {
    expect(checkRuleR11(makeCtx([makeDiffFile('.env.local')])).status).toBe('FAIL');
  });
  it('.env.production → FAIL', () => {
    expect(checkRuleR11(makeCtx([makeDiffFile('.env.production')])).status).toBe('FAIL');
  });
  it('id_rsa → FAIL', () => {
    expect(checkRuleR11(makeCtx([makeDiffFile('id_rsa')])).status).toBe('FAIL');
  });
  it('id_ed25519 → FAIL', () => {
    expect(checkRuleR11(makeCtx([makeDiffFile('id_ed25519')])).status).toBe('FAIL');
  });
  it('credentials.json → FAIL', () => {
    expect(checkRuleR11(makeCtx([makeDiffFile('credentials.json')])).status).toBe('FAIL');
  });
  it('server.pem → FAIL', () => {
    expect(checkRuleR11(makeCtx([makeDiffFile('cert/server.pem')])).status).toBe('FAIL');
  });
  it('private.key → FAIL', () => {
    expect(checkRuleR11(makeCtx([makeDiffFile('ssl/private.key')])).status).toBe('FAIL');
  });
  it('src/index.ts → PASS（普通文件不触发）', () => {
    expect(checkRuleR11(makeCtx([makeDiffFile('src/index.ts')])).status).toBe('PASS');
  });
});

describe('QA 边界验证 · R12 注释率精确边界', () => {
  it('新增正好 200 行 + 0 注释 → PASS（不触发）', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `+const x${i} = ${i};`);
    expect(checkRuleR12(makeCtx([makeDiffFile('src/b.ts', lines)])).status).toBe('PASS');
  });
  it('新增 201 行 + 0 注释 → WARN', () => {
    const lines = Array.from({ length: 201 }, (_, i) => `+const x${i} = ${i};`);
    expect(checkRuleR12(makeCtx([makeDiffFile('src/b.ts', lines)])).status).toBe('WARN');
  });
  it('新增 201 行 + 11 注释（≥5%）→ PASS', () => {
    const code = Array.from({ length: 190 }, (_, i) => `+const x${i} = ${i};`);
    const comments = Array.from({ length: 11 }, () => '+// comment');
    // total added = 201, comments = 11, ratio = 11/201 ≈ 5.5%
    expect(checkRuleR12(makeCtx([makeDiffFile('src/b.ts', [...code, ...comments])])).status).toBe('PASS');
  });
});

describe('QA 边界验证 · evidenceMode 标注完整性', () => {
  // 每条规则的 check 返回值都应带 evidenceMode
  it('铁律 #7 check 返回值带 evidenceMode', () => {
    const ctx = makeCtx([makeDiffFile('src/unrelated.ts')], { task: 'login' });
    const result = checkRule07(ctx);
    expect(result.evidenceMode).toBeDefined();
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('铁律 #10 check 返回值带 evidenceMode', () => {
    const ctx = makeCtx([], { commitMsg: 'fix login bug' });
    const result = checkRule10(ctx);
    expect(result.evidenceMode).toBeDefined();
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('所有 11 条规则的 check 返回值都带 evidenceMode', () => {
    // 构造一个能触发各规则的上下文
    const ctx: AuditContext = {
      diffFiles: [makeDiffFile('src/index.ts')],
      logEntries: [],
      task: 'test',
      commitMsg: 'fix login bug',
    };
    for (const rule of rules) {
      const result = rule.check(ctx);
      expect(result.evidenceMode, `${rule.name} should have evidenceMode`).toBeDefined();
    }
  });
});
