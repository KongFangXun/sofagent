// ============================================================
// silent-mode.test.ts · 沉默审计模式——纯 diff 规则测试
// v0.95 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA3 } from './rules/rule-a3-careful-modify';
import { checkRuleE1 } from './rules/rule-e1-no-test-files';
import { checkRuleE2 } from './rules/rule-e2-todo-undeclared';
import { checkRuleE3 } from './rules/rule-e3-large-deletion';
import { checkRuleA5 } from './rules/rule-a5-honest-report';
import { checkRuleA1 } from './rules/rule-a1-sensitive-files';
import { checkRuleE4 } from './rules/rule-e4-low-comment-ratio';
import type { AuditContext } from './rules/types';
import type { DiffFile } from './diff-parser';
import { makeDiffFile, makeCtx } from './test-utils';

describe('沉默审计模式 · 7 条纯 diff 规则', () => {
  describe('R1 无关文件', () => {
    it('文件数 ≤ 10 且与 task 相关 → PASS', () => {
      const files = Array.from({ length: 5 }, (_, i) => makeDiffFile(`src/file${i}.ts`));
      const ctx = makeCtx(files, { task: 'file module' });
      const result = checkRuleA3(ctx);
      expect(result.status).toBe('PASS');
    });

    it('文件数 > 10 且匹配率 < 50% → WARN', () => {
      const files = Array.from({ length: 15 }, (_, i) => makeDiffFile(`src/unrelated${i}.ts`));
      const ctx = makeCtx(files, { task: 'login page' });
      const result = checkRuleA3(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('15');
    });

    it('无 --task → PASS（跳过）', () => {
      const files = Array.from({ length: 15 }, (_, i) => makeDiffFile(`src/file${i}.ts`));
      const ctx = makeCtx(files);
      const result = checkRuleA3(ctx);
      expect(result.status).toBe('PASS');
    });

    it('文件数 > 10 且匹配率 ≥ 50% → PASS', () => {
      const files = Array.from({ length: 12 }, (_, i) => makeDiffFile(`src/login${i}.ts`));
      const ctx = makeCtx(files, { task: 'login' });
      const result = checkRuleA3(ctx);
      expect(result.status).toBe('PASS');
    });
  });

  describe('R2 测试缺失', () => {
    it('src/ 变了有 .test.ts → PASS', () => {
      const ctx = makeCtx([
        makeDiffFile('src/index.ts'),
        makeDiffFile('src/index.test.ts'),
      ]);
      const result = checkRuleE1(ctx);
      expect(result.status).toBe('PASS');
    });

    it('src/ 变了无测试文件 → WARN', () => {
      const ctx = makeCtx([
        makeDiffFile('src/index.ts'),
        makeDiffFile('src/config.ts'),
      ]);
      const result = checkRuleE1(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('测试文件');
    });

    it('无 src/ 变更 → PASS', () => {
      const ctx = makeCtx([
        makeDiffFile('README.md'),
        makeDiffFile('package.json'),
      ]);
      const result = checkRuleE1(ctx);
      expect(result.status).toBe('PASS');
    });

    it('src/ 变了有 .spec.js → PASS', () => {
      const ctx = makeCtx([
        makeDiffFile('src/utils.js'),
        makeDiffFile('src/utils.spec.js'),
      ]);
      const result = checkRuleE1(ctx);
      expect(result.status).toBe('PASS');
    });
  });

  describe('R3 TODO 未声明', () => {
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
  });

  describe('R4 大量删除', () => {
    it('单文件删 > 100 行 + 与 task 无关 → WARN', () => {
      // 生成 101 行删除
      const deletedLines = Array.from({ length: 101 }, () => '-some code line');
      const ctx = makeCtx(
        [makeDiffFile('src/legacy.ts', deletedLines)],
        { task: 'login feature' }
      );
      const result = checkRuleE3(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('101');
    });

    it('单文件删 > 100 行 + 与 task 相关 → PASS', () => {
      const deletedLines = Array.from({ length: 101 }, () => '-some code line');
      const ctx = makeCtx(
        [makeDiffFile('src/login.ts', deletedLines)],
        { task: 'login feature' }
      );
      const result = checkRuleE3(ctx);
      expect(result.status).toBe('PASS');
    });

    it('无 --task → PASS', () => {
      const deletedLines = Array.from({ length: 101 }, () => '-some code line');
      const ctx = makeCtx(
        [makeDiffFile('src/legacy.ts', deletedLines)]
      );
      const result = checkRuleE3(ctx);
      expect(result.status).toBe('PASS');
    });

    it('单文件删 ≤ 100 行 → PASS', () => {
      const deletedLines = Array.from({ length: 50 }, () => '-some code line');
      const ctx = makeCtx(
        [makeDiffFile('src/legacy.ts', deletedLines)],
        { task: 'login feature' }
      );
      const result = checkRuleE3(ctx);
      expect(result.status).toBe('PASS');
    });
  });

  describe('R5 占位 commit', () => {
    it('commit = "fix" → WARN', () => {
      const ctx = makeCtx([], { commitMsg: 'fix' });
      const result = checkRuleA5(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('占位符');
    });

    it('commit = "fix login bug" → PASS', () => {
      const ctx = makeCtx([], { commitMsg: 'fix login bug' });
      const result = checkRuleA5(ctx);
      expect(result.status).toBe('PASS');
    });

    it('commit = "" → FAIL', () => {
      const ctx = makeCtx([], { commitMsg: '' });
      const result = checkRuleA5(ctx);
      expect(result.status).toBe('FAIL');
      expect(result.details[0]).toContain('为空');
    });

    it('commit = "wip" → WARN', () => {
      const ctx = makeCtx([], { commitMsg: 'wip' });
      const result = checkRuleA5(ctx);
      expect(result.status).toBe('WARN');
    });

    it('commit = "update" → WARN', () => {
      const ctx = makeCtx([], { commitMsg: 'update' });
      const result = checkRuleA5(ctx);
      expect(result.status).toBe('WARN');
    });
  });

  describe('R11 敏感文件', () => {
    it('diff 含 .env → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('.env')]);
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('FAIL');
      expect(result.details[0]).toContain('敏感文件');
    });

    it('diff 含 id_rsa → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('id_rsa')]);
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('diff 含 credentials.json → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('credentials.json')]);
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('diff 含 *.pem → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('cert/server.pem')]);
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('diff 不含敏感文件 → PASS', () => {
      const ctx = makeCtx([
        makeDiffFile('src/index.ts'),
        makeDiffFile('README.md'),
      ]);
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('PASS');
    });

    it('不需要 --task 也能触发 FAIL', () => {
      const ctx = makeCtx([makeDiffFile('.env.local')]);
      // 不传 task
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('diff 含 .env.production → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('.env.production')]);
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('diff 含 *.key → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('ssl/private.key')]);
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('diff 含 id_ed25519 → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('id_ed25519')]);
      const result = checkRuleA1(ctx);
      expect(result.status).toBe('FAIL');
    });
  });

  describe('R12 低注释率', () => {
    it('新增 > 200 行 + 注释率 < 5% → WARN', () => {
      // 生成 210 行新增代码，0 行注释
      const addedLines = Array.from({ length: 210 }, (_, i) => `+const x${i} = ${i};`);
      const ctx = makeCtx([makeDiffFile('src/big-file.ts', addedLines)]);
      const result = checkRuleE4(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details[0]).toContain('注释行');
    });

    it('新增 > 200 行 + 注释率 ≥ 5% → PASS', () => {
      // 生成 200 行代码 + 11 行注释 = 211 行，注释率 ≈ 5.2%
      const codeLines = Array.from({ length: 200 }, (_, i) => `+const x${i} = ${i};`);
      const commentLines = Array.from({ length: 11 }, () => '+// this is a comment');
      const ctx = makeCtx([makeDiffFile('src/commented-file.ts', [...codeLines, ...commentLines])]);
      const result = checkRuleE4(ctx);
      expect(result.status).toBe('PASS');
    });

    it('新增 ≤ 200 行 → PASS', () => {
      const addedLines = Array.from({ length: 100 }, (_, i) => `+const x${i} = ${i};`);
      const ctx = makeCtx([makeDiffFile('src/small-file.ts', addedLines)]);
      const result = checkRuleE4(ctx);
      expect(result.status).toBe('PASS');
    });
  });
});
