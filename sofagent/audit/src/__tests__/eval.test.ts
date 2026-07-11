// ============================================================
// eval.test.ts · eval harness 单元测试
// v1.0.4 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { scoreCase } from '../eval/eval-scorer';
import { generateEvalReport } from '../eval/eval-reporter';
import type { ScoreBreakdown, EvalResult, TestCase, TestCaseResult } from '../eval/types';

describe('eval-scorer', () => {
  it('精确匹配：完全一致应得满分', () => {
    const actual = { result: 'PASS', rules_triggered: [] };
    const expected = { result: 'PASS', rules_triggered: [] };
    const score = scoreCase(actual, expected);
    expect(score.exactMatch).toBe(1);
    expect(score.ruleCompliance).toBe(1);
    expect(score.overall).toBeGreaterThanOrEqual(0.9);
  });

  it('精确匹配：结果不同应得低分', () => {
    const actual = { result: 'FAIL', rules_triggered: [] };
    const expected = { result: 'PASS', rules_triggered: [] };
    const score = scoreCase(actual, expected);
    expect(score.exactMatch).toBeLessThan(1);
  });

  it('规则合规：违规规则命中应正确计分', () => {
    const actual = { result: 'FAIL', rules_triggered: ['A2'] };
    const expected = { result: 'FAIL', rules_triggered: ['A2'] };
    const score = scoreCase(actual, expected);
    expect(score.ruleCompliance).toBe(1);
  });

  it('规则合规：漏报违规规则应扣分', () => {
    const actual = { result: 'FAIL', rules_triggered: ['A2'] };
    const expected = { result: 'FAIL', rules_triggered: ['A1', 'A2'] };
    const score = scoreCase(actual, expected);
    expect(score.ruleCompliance).toBeLessThan(1);
  });

  it('语义相似度：相近文本应得较高分', () => {
    const actual = { description: 'fix login page bug' };
    const expected = { description: 'fix login page issue' };
    const score = scoreCase(actual, expected);
    expect(score.semanticSimilarity).toBeGreaterThan(0);
  });
});

describe('eval-reporter', () => {
  it('生成 markdown 报告包含汇总和详细结果', () => {
    const result: EvalResult = {
      total: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      duration: 100,
      results: [
        {
          testId: 'test-1',
          passed: true,
          actual: { result: 'PASS' },
          expected: { result: 'PASS' },
          score: { exactMatch: 1, semanticSimilarity: 1, ruleCompliance: 1, overall: 1 },
          duration: 10,
        },
        {
          testId: 'test-2',
          passed: false,
          actual: { result: 'FAIL' },
          expected: { result: 'PASS' },
          score: { exactMatch: 0, semanticSimilarity: 0.5, ruleCompliance: 0, overall: 0.1 },
          duration: 15,
          error: 'unexpected failure',
        },
      ],
    };

    const report = generateEvalReport(result);
    expect(report).toContain('sofagent Eval 报告');
    expect(report).toContain('汇总');
    expect(report).toContain('test-1');
    expect(report).toContain('test-2');
    expect(report).toContain('失败用例');
  });
});
