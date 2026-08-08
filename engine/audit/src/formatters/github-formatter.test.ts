// ============================================================
// github-formatter.test.ts · GitHub Annotations 格式化器单测
// v1.2.9 (⑧-3)
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  extractFileLine,
  formatGithubAnnotations,
  generateGithubOutput,
} from './github-formatter';
import type { AuditResult, RuleCheck } from '../reporter';

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

describe('extractFileLine', () => {
  it('从 "file.ts:42" 格式提取文件和行号', () => {
    const result = extractFileLine('src/config.ts:42: 检测到硬编码密钥');
    expect(result).toEqual({ file: 'src/config.ts', line: 42 });
  });

  it('从 "file.ts L15" 格式提取文件和行号', () => {
    const result = extractFileLine('src/utils.ts L15: console.log 残留');
    expect(result).toEqual({ file: 'src/utils.ts', line: 15 });
  });

  it('从 "file.ts(99" 格式提取文件和行号', () => {
    const result = extractFileLine('lib/auth.ts(99,5): token 泄漏');
    expect(result).toEqual({ file: 'lib/auth.ts', line: 99 });
  });

  it('只有文件路径无行号时返回 line=1', () => {
    const result = extractFileLine('检查了 src/config.ts');
    expect(result).toEqual({ file: 'src/config.ts', line: 1 });
  });

  it('无文件路径时返回 null', () => {
    const result = extractFileLine('这是一条没有文件信息的消息');
    expect(result).toBeNull();
  });
});

describe('formatGithubAnnotations', () => {
  it('FAIL 规则输出为 ::error annotation', () => {
    const result = makeResult([
      makeRule({
        name: 'A2 不泄密钥',
        number: 2,
        status: 'FAIL',
        details: ['src/config.ts:42: 检测到硬编码的API密钥'],
      }),
    ], 2);

    const annotations = formatGithubAnnotations(result);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain('::error');
    expect(annotations[0]).toContain('file=src/config.ts');
    expect(annotations[0]).toContain('line=42');
    expect(annotations[0]).toContain('A2 不泄密钥');
  });

  it('WARN 规则输出为 ::warning annotation', () => {
    const result = makeResult([
      makeRule({
        name: 'A5 诚实报告',
        number: 5,
        status: 'WARN',
        details: ['src/utils.ts L15: console.log 残留'],
      }),
    ], 1);

    const annotations = formatGithubAnnotations(result);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain('::warning');
    expect(annotations[0]).toContain('file=src/utils.ts');
    expect(annotations[0]).toContain('line=15');
  });

  it('PASS 和 SKIPPED 规则不输出 annotation', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS', details: ['ok'] }),
      makeRule({ name: 'A2', number: 2, status: 'SKIPPED', details: ['skip'] }),
    ], 0);

    const annotations = formatGithubAnnotations(result);
    expect(annotations).toHaveLength(0);
  });

  it('多条 details 输出多条 annotation', () => {
    const result = makeResult([
      makeRule({
        name: 'A2 不泄密钥',
        number: 2,
        status: 'FAIL',
        details: [
          'src/config.ts:42: token1',
          'src/auth.ts:15: token2',
        ],
      }),
    ], 2);

    const annotations = formatGithubAnnotations(result);
    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toContain('file=src/config.ts');
    expect(annotations[1]).toContain('file=src/auth.ts');
  });

  it('无文件位置的 detail 输出无位置 annotation', () => {
    const result = makeResult([
      makeRule({
        name: 'E2 无 TODO',
        number: 22,
        status: 'WARN',
        details: ['发现未声明的 TODO'],
      }),
    ], 1);

    const annotations = formatGithubAnnotations(result);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain('::warning');
    expect(annotations[0]).not.toContain('file=');
  });

  it('workspaceRoot 将绝对路径转为相对路径', () => {
    const result = makeResult([
      makeRule({
        name: 'A2',
        number: 2,
        status: 'FAIL',
        details: ['/home/runner/work/repo/src/config.ts:42: token'],
      }),
    ], 2);

    const annotations = formatGithubAnnotations(result, {
      workspaceRoot: '/home/runner/work/repo',
    });
    expect(annotations[0]).toContain('file=src/config.ts');
  });

  it('空 details 的 FAIL 规则输出摘要', () => {
    const result = makeResult([
      makeRule({
        name: 'A6 构建未坏',
        number: 6,
        status: 'FAIL',
        details: [],
      }),
    ], 2);

    const annotations = formatGithubAnnotations(result);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain('::error');
    expect(annotations[0]).toContain('A6 构建未坏');
  });
});

describe('generateGithubOutput', () => {
  it('PASS 时输出签名行 + 通过消息', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
    ], 0);

    const output = generateGithubOutput(result, 24);
    expect(output).toContain('[sofagent]');
    expect(output).toContain('PASS');
    expect(output).toContain('全部通过');
  });

  it('FAIL 时输出签名行 + error annotation', () => {
    const result = makeResult([
      makeRule({
        name: 'A2',
        number: 2,
        status: 'FAIL',
        details: ['src/config.ts:42: token'],
      }),
    ], 2);

    const output = generateGithubOutput(result, 24);
    expect(output).toContain('[sofagent]');
    expect(output).toContain('FAIL');
    expect(output).toContain('::error');
  });

  it('WARN 时输出签名行 + warning annotation', () => {
    const result = makeResult([
      makeRule({
        name: 'A5',
        number: 5,
        status: 'WARN',
        details: ['src/utils.ts L15: console.log'],
      }),
    ], 1);

    const output = generateGithubOutput(result, 24);
    expect(output).toContain('WARN');
    expect(output).toContain('::warning');
  });
});
