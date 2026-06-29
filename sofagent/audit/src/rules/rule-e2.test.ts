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

  it('FIXME + 未提 fixme → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// FIXME: broken logic'])],
      { commitMsg: 'refactor code' }
    );
    const result = checkRuleE2(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('FIXME');
  });

  it('diff 含多个 TODO + commitMsg 提了 todo → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// TODO: item1', '+// TODO: item2'])],
      { commitMsg: 'add todo items for cleanup' }
    );
    const result = checkRuleE2(ctx);
    expect(result.status).toBe('PASS');
  });

  it('无 commitMsg 但有 TODO → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// TODO: implement later'])],
      // 不传 commitMsg
    );
    const result = checkRuleE2(ctx);
    expect(result.status).toBe('WARN');
  });

  it('commitMsg 含 FIXME（大写）但 diff 中 FIXME 是小写 → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// fixme: broken thing'])],
      { commitMsg: 'address FIXME comments' }
    );
    const result = checkRuleE2(ctx);
    expect(result.status).toBe('PASS');
  });
});
