// ============================================================
// eval.test.ts · 评测模块测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { evalCase } from '../eval-scorer';
import { generateEvalReport } from '../eval-reporter';
import { defaultRunFunction } from '../eval-runner';
import type { EvalResult } from '../types';

describe('evalCase', () => {
  it('完全匹配返回满分', () => {
    const actual = { result: 'PASS', rules_triggered: [] };
    const expected = { result: 'PASS', rules_triggered: [] };
    const score = evalCase(actual, expected);
    expect(score.exactMatch).toBe(1);
    expect(score.ruleCompliance).toBe(1);
    expect(score.overall).toBeGreaterThan(0.9);
  });

  it('完全不匹配返回低分', () => {
    const actual = { result: 'FAIL', rules_triggered: ['A2'] };
    const expected = { result: 'PASS', rules_triggered: [] };
    const score = evalCase(actual, expected);
    expect(score.exactMatch).toBeLessThan(1);
    expect(score.ruleCompliance).toBeLessThan(1);
  });

  it('字符串部分匹配给出中间分数', () => {
    const actual = { output: 'hello world this is a test' };
    const expected = { output: 'hello world another test' };
    const score = evalCase(actual, expected);
    expect(score.semanticSimilarity).toBeGreaterThan(0);
    expect(score.semanticSimilarity).toBeLessThan(1);
  });

  it('空 expected 返回满分', () => {
    const actual = { x: 1 };
    const expected: Record<string, unknown> = {};
    const score = evalCase(actual, expected);
    expect(score.exactMatch).toBe(1);
    // exactMatch 1.0 + 空字段 semanticSimilarity 0 + ruleCompliance 1.0 = 0.8
    expect(score.overall).toBeCloseTo(0.8, 2);
  });

  it('result 字段合规检查', () => {
    const actual = { result: 'FAIL', severity: 'P0', rules_triggered: ['A1', 'A2'] };
    const expected = { result: 'FAIL', rules_triggered: ['A1'] };
    const score = evalCase(actual, expected);
    // result 匹配，rules_triggered 包含 A1
    expect(score.ruleCompliance).toBeGreaterThan(0);
  });
});

describe('generateEvalReport', () => {
  it('生成包含统计信息的 Markdown 报告', () => {
    const result: EvalResult = {
      total: 10,
      passed: 8,
      failed: 2,
      passRate: 0.8,
      results: [
        {
          testId: 'test_001',
          passed: true,
          actual: { result: 'PASS' },
          expected: { result: 'PASS' },
          score: { exactMatch: 1, semanticSimilarity: 1, ruleCompliance: 1, overall: 1 },
          duration: 100,
        },
        {
          testId: 'test_002',
          passed: false,
          actual: { result: 'FAIL' },
          expected: { result: 'PASS' },
          score: { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 },
          duration: 200,
          error: 'timeout',
        },
      ],
      duration: 1000,
    };
    const report = generateEvalReport(result);
    expect(report).toContain('sofagent Eval 报告');
    expect(report).toContain('80.0%');
    expect(report).toContain('test_001');
    expect(report).toContain('test_002');
    expect(report).toContain('失败用例');
    expect(report).toContain('timeout');
  });

  it('100% 通过率报告', () => {
    const result: EvalResult = {
      total: 5,
      passed: 5,
      failed: 0,
      passRate: 1.0,
      results: [],
      duration: 500,
    };
    const report = generateEvalReport(result);
    expect(report).toContain('100.0%');
    expect(report).toContain('✅');
  });
});

// 形态边界锁定：mock 与 golden set schema 不同形，误用必须"响亮"而非静默返回 PASS
describe('defaultRunFunction 形态边界', () => {
  it('收到 golden set 结构化 diffFiles 时显式报错（不静默返回 PASS）', async () => {
    await expect(
      defaultRunFunction({
        diffFiles: [{ path: '.env', status: 'added', lines: ['+API_KEY=sk-abc'] }],
        task: '添加配置文件',
      }),
    ).rejects.toThrow(/diffFiles/);
  });

  it('空对象 {} 显式报错（白名单拦截，不静默 PASS）', async () => {
    await expect(defaultRunFunction({})).rejects.toThrow(/diff: string/);
  });

  it('缺 diff 字段的 { task } 显式报错（白名单拦截）', async () => {
    await expect(defaultRunFunction({ task: 'x' })).rejects.toThrow(/task/);
  });

  it('{ diff: "" } 是合法输入，返回 PASS（空 diff 非错误）', async () => {
    const actual = await defaultRunFunction({ diff: '' });
    expect(actual['result']).toBe('PASS');
    expect(actual['rules_triggered']).toEqual([]);
  });

  it('{ diff: string } 形态仍正常工作（违规关键词判 FAIL）', async () => {
    const actual = await defaultRunFunction({ diff: '+const k = "sk-1234567890"' });
    expect(actual['result']).toBe('FAIL');
    expect(actual['rules_triggered']).toContain('A2');
  });

  it('{ diff: string } 干净输入判 PASS', async () => {
    const actual = await defaultRunFunction({ diff: '+const k = process.env.API_KEY' });
    expect(actual['result']).toBe('PASS');
    expect(actual['rules_triggered']).toEqual([]);
  });
});
