// ============================================================
// rule-07.test.ts · 铁律 #7 谨慎修改——中英匹配 + 20% 阈值测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRule07 } from './rule-07-careful-modify';
import type { AuditContext } from './types';
import type { DiffFile } from '../diff-parser';

function makeDiffFile(path: string): DiffFile {
  return { path, status: 'modified', lines: [] };
}

function makeCtx(diffFiles: DiffFile[], task?: string): AuditContext {
  return { diffFiles, logEntries: [], task };
}

describe('铁律 #7 谨慎修改', () => {
  it('无 task 参数 → PASS（跳过检查）', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')]);
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
    expect(result.details[0]).toContain('未提供');
  });

  it('任务描述含英文文件名 + diff 文件匹配 → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/components/login.tsx')],
      '修复 login.tsx 的 bug'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('任务描述含中文关键词 + diff 文件路径含英文 → 中文关键词无法匹配英文路径，触发 WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/auth/login.ts')],
      '修复登录认证逻辑'
    );
    const result = checkRule07(ctx);
    // 中文 "登录" "认证" "逻辑" 无法匹配英文路径 "src/auth/login.ts"
    // 1/1 文件不匹配 = 100% > 20% → WARN
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('1/1');
  });

  it('20% 阈值：5 个文件中 1 个不匹配 → PASS（20% 不超过阈值）', () => {
    const files = [
      makeDiffFile('src/login.ts'),
      makeDiffFile('src/auth.ts'),
      makeDiffFile('src/session.ts'),
      makeDiffFile('src/token.ts'),
      makeDiffFile('README.md'), // 不在任务范围
    ];
    const ctx = makeCtx(files, 'login auth session token');
    const result = checkRule07(ctx);
    // 1/5 = 20%，条件是 > 20%，所以 1/5 不触发 WARN
    expect(result.status).toBe('PASS');
  });

  it('20% 阈值：5 个文件中 2 个不匹配 → WARN（40% 超过阈值）', () => {
    const files = [
      makeDiffFile('src/login.ts'),
      makeDiffFile('src/auth.ts'),
      makeDiffFile('README.md'),
      makeDiffFile('CHANGELOG.md'),
      makeDiffFile('docs/guide.md'),
    ];
    const ctx = makeCtx(files, 'login auth');
    const result = checkRule07(ctx);
    // README.md 和 CHANGELOG.md 已被 LOW_RISK_PATTERNS 排除
    // 剩余 3 个文件中 docs/guide.md 不匹配 → 1/3 = 33% > 20% → WARN
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('1/3');
  });

  it('低风险文件（package-lock.json）不计入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('package-lock.json')],
      '修复 login 模块'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（README.md）不计入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('README.md')],
      '修复 login 模块'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（LICENSE 全大写）被正确识别', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('LICENSE')],
      '修复 login 模块'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（Readme.md 混合大小写）被正确识别', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('Readme.md')],
      '修复 login 模块'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（CHANGELOG.md）不计入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('CHANGELOG.md')],
      '修复 login 模块'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件在子目录也排除（无 ^ 锚点）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('packages/foo/README.md')],
      '修复 login 模块'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（tsconfig.json）不计入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('tsconfig.json')],
      '修复 login 模块'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('路径模式匹配：任务描述含路径片段', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/components/Button.tsx'), makeDiffFile('src/components/Input.tsx')],
      '重构 src/components 目录下的组件'
    );
    const result = checkRule07(ctx);
    expect(result.status).toBe('PASS');
  });

  it('阈值不是 30%：3 个文件中 1 个不匹配 → PASS（33% 在旧 30% 阈值会 WARN，新 20% 也 WARN）', () => {
    // 1/3 = 33% > 20% → WARN
    const files = [
      makeDiffFile('src/login.ts'),
      makeDiffFile('src/auth.ts'),
      makeDiffFile('docs/ unrelated.md'),
    ];
    const ctx = makeCtx(files, 'login auth');
    const result = checkRule07(ctx);
    expect(result.status).toBe('WARN');
  });
});
