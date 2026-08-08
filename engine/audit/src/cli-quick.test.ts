// ============================================================
// cli-quick.test.ts · npx sofagent-audit 零配置 CLI 单测
// v1.2.9 (⑧-1)
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  formatQuickResult,
  generateQuickOutput,
} from './cli-quick';
import type { AuditResult, RuleCheck } from './reporter';

// 辅助：构造 RuleCheck
function makeRule(
  overrides: Partial<RuleCheck> = {}
): RuleCheck {
  return {
    name: 'A1 不碰敏感文件',
    number: 1,
    status: 'PASS',
    details: [],
    ...overrides,
  };
}

// 辅助：构造 AuditResult
function makeResult(
  rules: RuleCheck[],
  exitCode = 0
): AuditResult {
  return { rules, exitCode };
}

describe('formatQuickResult', () => {
  it('PASS 规则不输出行', () => {
    const rule = makeRule({ status: 'PASS' });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(0);
  });

  it('SKIPPED 规则不输出行', () => {
    const rule = makeRule({ status: 'SKIPPED' });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(0);
  });

  it('FAIL 规则输出 ❌ 行', () => {
    const rule = makeRule({
      name: 'A2 不泄密钥',
      status: 'FAIL',
      details: ['src/config.ts:42: 检测到硬编码密钥'],
    });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('❌');
    expect(lines[0]).toContain('A2 不泄密钥');
    expect(lines[0]).toContain('src/config.ts');
  });

  it('WARN 规则输出 ⚠️ 行', () => {
    const rule = makeRule({
      name: 'A5 诚实报告',
      status: 'WARN',
      details: ['src/utils.ts L15: console.log 残留'],
    });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('⚠️');
    expect(lines[0]).toContain('A5 诚实报告');
  });

  it('多条 details 输出多行', () => {
    const rule = makeRule({
      name: 'A2',
      status: 'FAIL',
      details: ['file1.ts:1: token1', 'file2.ts:2: token2'],
    });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(2);
  });

  it('无 details 的 FAIL 输出摘要行', () => {
    const rule = makeRule({
      name: 'A6 构建未坏',
      status: 'FAIL',
      details: [],
    });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('❌');
    expect(lines[0]).toContain('A6 构建未坏');
  });
});

describe('generateQuickOutput', () => {
  it('全 PASS 时输出通过消息', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
      makeRule({ name: 'A2', number: 2, status: 'PASS' }),
    ], 0);

    const output = generateQuickOutput(result, 'abc1234');
    expect(output).toContain('abc1234');
    expect(output).toContain('全部 2 条规则通过');
    expect(output).toContain('sofagent 审计');
  });

  it('有 FAIL 时输出违规详情 + 汇总', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
      makeRule({
        name: 'A2 不泄密钥',
        number: 2,
        status: 'FAIL',
        details: ['src/config.ts:42: token'],
      }),
      makeRule({
        name: 'A5 诚实报告',
        number: 5,
        status: 'WARN',
        details: ['src/utils.ts L15: console.log'],
      }),
    ], 2);

    const output = generateQuickOutput(result, 'abc1234');
    expect(output).toContain('abc1234');
    expect(output).toContain('❌');
    expect(output).toContain('A2 不泄密钥');
    expect(output).toContain('⚠️');
    expect(output).toContain('1 条违规');
    expect(output).toContain('1 条警告');
    expect(output).toContain('1 条通过');
  });

  it('只有 WARN 时输出警告汇总', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
      makeRule({
        name: 'A5',
        number: 5,
        status: 'WARN',
        details: ['console.log 残留'],
      }),
    ], 1);

    const output = generateQuickOutput(result, 'def5678');
    expect(output).toContain('⚠️');
    expect(output).toContain('1 条警告');
    expect(output).toContain('1 条通过');
  });

  it('包含 SKIPPED 时在汇总中显示', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
      makeRule({ name: 'A2', number: 2, status: 'SKIPPED' }),
    ], 0);

    const output = generateQuickOutput(result, 'abc1234');
    expect(output).toContain('1 条跳过');
  });

  it('产品签名行存在', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
    ], 0);

    const output = generateQuickOutput(result, 'abc1234');
    expect(output).toContain('sofagent 审计');
    expect(output).toContain('零 token');
  });
});
