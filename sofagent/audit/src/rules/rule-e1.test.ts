// ============================================================
// rule-e1.test.ts · E1 不落测试——测试文件缺失检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleE1 } from './rule-e1-no-test-files';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('E1 不落测试', () => {
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

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([
      makeDiffFile('src/index.ts'),
      makeDiffFile('src/index.test.ts'),
    ]);
    const result = checkRuleE1(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('src/ 下 .jsx 有 .test.jsx → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/Component.jsx'),
      makeDiffFile('src/Component.test.jsx'),
    ]);
    const result = checkRuleE1(ctx);
    expect(result.status).toBe('PASS');
  });

  it('src/ 下 .spec.tsx 匹配 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/component.tsx'),
      makeDiffFile('src/component.spec.tsx'),
    ]);
    const result = checkRuleE1(ctx);
    expect(result.status).toBe('PASS');
  });

  it('非 src/ 目录变更 + 无测试文件 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('docs/guide.md'),
      makeDiffFile('scripts/deploy.sh'),
    ]);
    const result = checkRuleE1(ctx);
    expect(result.status).toBe('PASS');
  });

  it('src/ 仅有测试文件变更 → PASS（无需额外测试覆盖）', () => {
    const ctx = makeCtx([
      makeDiffFile('src/utils.test.ts'),
    ]);
    const result = checkRuleE1(ctx);
    expect(result.status).toBe('PASS');
  });
});
