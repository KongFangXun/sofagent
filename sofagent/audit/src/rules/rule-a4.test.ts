// ============================================================
// rule-a4.test.ts · A4 不删配置——配置文件删除检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA4 } from './rule-a4-config-deleted';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';

function makeDiffFile(path: string, status: DiffFile['status'] = 'deleted'): DiffFile {
  return { path, status, lines: [] };
}

function makeCtx(diffFiles: DiffFile[]): AuditContext {
  return { diffFiles, logEntries: [] };
}

describe('A4 不删配置', () => {
  it('删除 .gitignore → WARN', () => {
    const result = checkRuleA4(makeCtx([makeDiffFile('.gitignore')]));
    expect(result.status).toBe('WARN');
  });

  it('删除 tsconfig.json → WARN', () => {
    const result = checkRuleA4(makeCtx([makeDiffFile('tsconfig.json')]));
    expect(result.status).toBe('WARN');
  });

  it('删除 package-lock.json → WARN', () => {
    const result = checkRuleA4(makeCtx([makeDiffFile('package-lock.json')]));
    expect(result.status).toBe('WARN');
  });

  it('删除 *.lock 文件 → WARN', () => {
    const result = checkRuleA4(makeCtx([makeDiffFile('app.lock')]));
    expect(result.status).toBe('WARN');
  });

  it('删除非配置文件 → PASS', () => {
    const result = checkRuleA4(makeCtx([makeDiffFile('src/index.ts')]));
    expect(result.status).toBe('PASS');
  });

  it('修改（非删除）配置文件 → PASS', () => {
    const result = checkRuleA4(makeCtx([makeDiffFile('.gitignore', 'modified')]));
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const result = checkRuleA4(makeCtx([makeDiffFile('.gitignore')]));
    expect(result.evidenceMode).toBe('git-diff');
  });
});
