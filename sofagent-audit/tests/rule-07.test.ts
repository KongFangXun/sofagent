import { describe, it, expect } from 'vitest';
import type { DiffFile } from '../src/diff-parser';
import { checkRule07 } from '../src/rules/rule-07-careful-modify';

function makeDiff(path: string, status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, status, lines: [] };
}

describe('铁律 #7 谨慎修改', () => {
  it('无 task 参数 → PASS 并提示', () => {
    const r = checkRule07([makeDiff('src/app.ts')]);
    expect(r.status).toBe('PASS');
    expect(r.details[0]).toContain('未提供 --task');
  });

  it('所有文件与 task 相关 → PASS', () => {
    const r = checkRule07(
      [makeDiff('src/login.ts'), makeDiff('src/login.test.ts')],
      'fix login page bug',
    );
    expect(r.status).toBe('PASS');
  });

  it('文件名含 task 关键词 → PASS', () => {
    const r = checkRule07(
      [makeDiff('src/auth-login.ts')],
      'fix login page',
    );
    expect(r.status).toBe('PASS');
  });

  it('超过 30% 不相关 → WARN', () => {
    // 5 files, only 1 related = 4/5 = 80% unrelated > 30%
    const r = checkRule07(
      [
        makeDiff('src/login.ts'),
        makeDiff('src/unrelated-1.ts'),
        makeDiff('src/unrelated-2.ts'),
        makeDiff('src/unrelated-3.ts'),
        makeDiff('src/unrelated-4.ts'),
      ],
      '修复登录页 bug',
    );
    expect(r.status).toBe('WARN');
  });

  it('低风险文件不计入比例 → PASS', () => {
    // package-lock.json is LOW_RISK_PATTERNS — excluded from denominator
    const r = checkRule07(
      [makeDiff('src/login.ts'), makeDiff('package-lock.json')],
      'fix login bug',
    );
    expect(r.status).toBe('PASS');
  });

  it('30% 以内不相关 → PASS', () => {
    // 4 files, 1 unrelated = 1/4 = 25% < 30%
    const r = checkRule07(
      [
        makeDiff('src/login.ts'),
        makeDiff('src/auth.ts'),
        makeDiff('src/session.ts'),
        makeDiff('src/unrelated.ts'),
      ],
      'fix login auth session',
    );
    expect(r.status).toBe('PASS');
  });
});
