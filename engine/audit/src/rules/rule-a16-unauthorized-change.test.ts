// ============================================================
// rule-a16-unauthorized-change.test.ts · A16 非授权文件变更测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA16 } from './rule-a16-unauthorized-change';
import { makeDiffFile, makeCtx } from '../test-utils';

const defaultConfig = {
  A16: {
    enabled: true,
    protected_dirs: ['config/', '.env', 'secrets/', '.sofagent/config.yml'],
    sensitive_types: ['.xlsx', '.docx', '.pdf', '.db', '.sqlite', '.pem', '.key'],
  },
};

describe('A16 非授权文件变更', () => {
  it('保护目录内文件被修改 → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('config/settings.json', ['+modified'])],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('WARN');
  });

  it('保护目录外正常修改 → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+// normal change'])],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('PASS');
  });

  it('敏感类型文件被删除 → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('data/report.xlsx', [], 'deleted')],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('WARN');
  });

  it('规则 disabled → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('config/settings.json', ['+modified'])],
      { config: { A16: { enabled: false } } as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+console.log(1);'])],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('敏感类型文件被修改（非删除）→ PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('data/report.pdf', ['+modified content'])],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('PASS');
  });

  // v1.2.5 §4.9.3: 审计引擎源码自保护
  it('diff 修改 engine/audit/src/rules/runner.ts → WARN（审计引擎源码）', () => {
    const ctx = makeCtx(
      [makeDiffFile('engine/audit/src/rules/runner.ts', ['+const x = 1;'], 'modified')],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('审计引擎源码被修改');
  });

  it('diff 修改 rule-a1-sensitive-files.ts → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('engine/audit/src/rules/rule-a1-sensitive-files.ts', ['+modified'], 'modified')],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('WARN');
  });

  it('diff 修改 engine/core/src/shared/secret-patterns.ts → WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('engine/core/src/shared/secret-patterns.ts', ['+modified'], 'modified')],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('WARN');
  });

  it('diff 修改 engine/audit/src/reporter.ts → PASS（不在保护范围）', () => {
    const ctx = makeCtx(
      [makeDiffFile('engine/audit/src/reporter.ts', ['+modified'], 'modified')],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('PASS');
  });

  it('diff 修改 engine/core/src/data-paths.ts → PASS（非 audit/）', () => {
    const ctx = makeCtx(
      [makeDiffFile('engine/core/src/data-paths.ts', ['+modified'], 'modified')],
      { config: defaultConfig as any }
    );
    const result = checkRuleA16(ctx);
    expect(result.status).toBe('PASS');
  });
});
