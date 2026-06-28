// ============================================================
// rule-e2.test.ts · E2 不空标记——TODO 未声明检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleE2 } from './rule-e2-todo-undeclared';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('E2 不空标记', () => {
  it('diff 含 TODO + commitMsg 提了 todo → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// TODO: fix this later'])],
      { commitMsg: 'refactor: clean up TODO items' }
    );
    const result = checkRuleE2(ctx);
    expect(result.status).toBe('PASS');
  });

  it('diff 含 TODO + commitMsg 没提 → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// TODO: fix this later'])],
      { commitMsg: 'refactor: clean up code' }
    );
    const result = checkRuleE2(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('TODO');
  });

  it('diff 不含 TODO → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+console.log("hello");'])],
      { commitMsg: 'add logging' }
    );
    const result = checkRuleE2(ctx);
    expect(result.status).toBe('PASS');
  });

  it('diff 含 FIXME + commitMsg 提了 fixme → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// FIXME: broken logic'])],
      { commitMsg: 'address fixme comments' }
    );
    const result = checkRuleE2(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// TODO: fix this later'])],
      { commitMsg: 'clean up TODO items' }
    );
    const result = checkRuleE2(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });
});
