// ============================================================
// refine-agent.test.ts · Refine Agent 单测（v1.3.3 交付 T04）
// ============================================================
//
// 五层各一测试 + 与 Onboard 的串行验证。
//
// 测试策略：
//   - L1 判定：复用 judgeRunResult，不单独测（已在 loop-agent 测过）
//   - L2 质量判定：测 quality-judge + quality-rule-set（核心新增）
//   - L3 定位：测 Refine 复用 loop-agent L3（注入 mock diffReport）
//   - L4 修复：测 Refine 复用 loop-agent L4（注入 mock）
//   - L5 收敛：测 Refine 驱动整体收敛行为
//   - 串行验证：Onboard 收敛 PASS → onConverged → Refine 自动触发
// ============================================================

import { describe, it, expect } from 'vitest';
import type { OnboardRunOutcome } from '../loop-agent/driver';
import type { DiffReport } from '../loop-agent/diff-report';
import {
  loadQualityRuleSet,
  builtinQualityRules,
  parseFdeDeliveryReport,
  teamFeedbacksToRules,
  matchQualityRules,
  evaluateRule,
  summarizeQualityResults,
  type QualityRule,
  type QualityRuleSet,
} from '../refine-agent/quality-rule-set';
import { judgeQuality, qualityResultToDiffMismatch, qualityFeedbackText } from '../refine-agent/quality-judge';
import { runRefineLoop, createRefineOnConvergedCallback } from '../refine-agent/refine-driver';
import { runOnboardLoop } from '../loop-agent/driver';
import type { JudgeVerdict } from '../loop-agent/judge';

// ────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────

/** 构造成功的运行产出（L1 passed） */
function makePassedOutcome(output: string): OnboardRunOutcome {
  return {
    exitCode: 0,
    stdout: output,
    output,
    durationMs: 100,
  };
}

/** 构造空规则集 */
function emptyRuleSet(): QualityRuleSet {
  return { rules: [], sourceCounts: { builtin: 0, fde_delivery: 0, team_feedback: 0 } };
}

// ────────────────────────────────────────────────────────────
// L2-1: 质量规则集加载（三来源）
// ────────────────────────────────────────────────────────────

describe('质量规则集加载（三来源）', () => {
  it('来源 1：内置模板加载三条硬编码规则', () => {
    const rules = builtinQualityRules();
    expect(rules).toHaveLength(3);
    expect(rules.some((r) => r.check === 'has_example')).toBe(true);
    expect(rules.some((r) => r.check === 'max_length')).toBe(true);
    expect(rules.some((r) => r.check === 'min_few_shot')).toBe(true);
  });

  it('来源 2：FDE delivery-report.md 解析为质量规则', () => {
    const report = [
      '## Quality Rule: max_length|output|maxLength=300|输出不超300字',
      '- Quality: required_keyword|skill_description|keywords=准确性,完整性|工具描述含关键词',
      '## Quality Rule: invalid_type|field|x=y|无效类型应跳过',
    ].join('\n');
    const feedbacks = parseFdeDeliveryReport(report);
    expect(feedbacks).toHaveLength(2);
    expect(feedbacks[0]!.check).toBe('max_length');
    expect(feedbacks[0]!.params.maxLength).toBe(300);
    expect(feedbacks[1]!.check).toBe('required_keyword');
    expect(feedbacks[1]!.params.keywords).toEqual(['准确性', '完整性']);
  });

  it('来源 3：团队反馈（quality_rule 类型）转为质量规则', () => {
    const feedbacks = [
      { content: 'max_length|output|maxLength=200|团队规则', type: 'quality_rule' },
      { content: 'has_example|skill_description|exampleKeywords=例子|带例子', type: 'quality_rule' },
      { content: '不应被解析', type: 'correction' },
    ];
    const rules = teamFeedbacksToRules(feedbacks);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.source).toBe('team_feedback');
    expect(rules[0]!.id).toContain('team-');
  });

  it('三来源合并加载——sourceCounts 统计正确', () => {
    const ruleSet = loadQualityRuleSet({
      fdeDeliveryReport: '## Quality Rule: has_example|skill_description|exampleKeywords=例子|FDE规则',
      teamFeedbacks: [{ content: 'min_few_shot|skill_few_shot|minCount=3|团队规则', type: 'quality_rule' }],
    });
    expect(ruleSet.sourceCounts.builtin).toBe(3);
    expect(ruleSet.sourceCounts.fde_delivery).toBe(1);
    expect(ruleSet.sourceCounts.team_feedback).toBe(1);
    expect(ruleSet.rules).toHaveLength(5);
  });
});

// ────────────────────────────────────────────────────────────
// L2-2: 质量规则匹配（evaluateRule + matchQualityRules）
// ────────────────────────────────────────────────────────────

describe('质量规则匹配', () => {
  it('has_example：包含示例关键词 → 通过', () => {
    const rule: QualityRule = {
      id: 'test-has-example',
      source: 'builtin',
      check: 'has_example',
      description: '测试',
      targetField: 'skill_description',
      params: { exampleKeywords: ['example', '示例'] },
      severity: 'warn',
    };
    const result = evaluateRule(rule, '这是一个工具，example: 用法如下');
    expect(result.passed).toBe(true);
  });

  it('has_example：无示例关键词 → 失败', () => {
    const rule: QualityRule = {
      id: 'test-has-example',
      source: 'builtin',
      check: 'has_example',
      description: '测试',
      targetField: 'skill_description',
      params: { exampleKeywords: ['example', '示例'] },
      severity: 'warn',
    };
    const result = evaluateRule(rule, '这是一个工具，没有任何标注');
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('未包含');
  });

  it('max_length：超限 → 失败', () => {
    const rule: QualityRule = {
      id: 'test-max-length',
      source: 'builtin',
      check: 'max_length',
      description: '测试',
      targetField: 'output',
      params: { maxLength: 10 },
      severity: 'warn',
    };
    const longText = 'a'.repeat(20);
    const result = evaluateRule(rule, longText);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('超过上限');
  });

  it('min_few_shot：不足 → 失败', () => {
    const rule: QualityRule = {
      id: 'test-min-few-shot',
      source: 'builtin',
      check: 'min_few_shot',
      description: '测试',
      targetField: 'skill_few_shot',
      params: { minCount: 3 },
      severity: 'warn',
    };
    const result = evaluateRule(rule, '1. 第一条\n2. 第二条');
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('不足');
  });

  it('matchQualityRules：对多个字段跑规则集', () => {
    const ruleSet: QualityRuleSet = {
      rules: [
        {
          id: 'r1', source: 'builtin', check: 'has_example', description: 'd',
          targetField: 'skill_description', params: { exampleKeywords: ['example'] }, severity: 'warn',
        },
        {
          id: 'r2', source: 'builtin', check: 'max_length', description: 'd',
          targetField: 'output', params: { maxLength: 50 }, severity: 'warn',
        },
      ],
      sourceCounts: { builtin: 2, fde_delivery: 0, team_feedback: 0 },
    };
    const results = matchQualityRules(
      { skill_description: '无标注的描述', output: 'short output' },
      ruleSet,
    );
    expect(results).toHaveLength(2);
    expect(results[0]!.passed).toBe(false); // has_example 失败
    expect(results[1]!.passed).toBe(true); // max_length 通过
    expect(summarizeQualityResults(results)).toContain('1 通过 / 1 失败');
  });
});

// ────────────────────────────────────────────────────────────
// L2-3: 质量判定器（judgeQuality → DiffReport）
// ────────────────────────────────────────────────────────────

describe('L2 质量判定器（judgeQuality → DiffReport）', () => {
  it('产出满足全部质量规则 → 空 mismatches（L2 PASS）', async () => {
    const outcome = makePassedOutcome(
      JSON.stringify({
        output: '简短输出',
        skill_description: '工具描述，example: 用法如下',
        skill_few_shot: '1. 第一条\n2. 第二条',
      }),
    );
    const ruleSet = loadQualityRuleSet();
    const report = await judgeQuality(outcome, 'test-task', { taskId: 'test-task', ruleSet });
    expect(report.mismatches).toHaveLength(0);
  });

  it('产出违反质量规则 → 生成 DiffReport mismatch', async () => {
    const longOutput = 'a'.repeat(600);
    const outcome = makePassedOutcome(
      JSON.stringify({
        output: longOutput,
        skill_description: '无示例的描述',
        skill_few_shot: '只有一条',
      }),
    );
    const ruleSet = loadQualityRuleSet();
    const report = await judgeQuality(outcome, 'test-task', { taskId: 'test-task', ruleSet });
    expect(report.mismatches.length).toBeGreaterThan(0);
    // max_length 应该有 mismatch
    const maxLengthMismatch = report.mismatches.find(
      (m) => m.type === 'value_error' && m.field === 'output',
    );
    expect(maxLengthMismatch).toBeDefined();
  });

  it('qualityResultToDiffMismatch：has_example → field_missing', () => {
    const rule: QualityRule = {
      id: 'r', source: 'builtin', check: 'has_example', description: 'd',
      targetField: 'skill_description', params: {}, severity: 'warn',
    };
    const mismatch = qualityResultToDiffMismatch(
      { ruleId: 'r', passed: false, check: 'has_example', targetField: 'skill_description', detail: '失败', severity: 'warn' },
      rule,
    );
    expect(mismatch.type).toBe('field_missing');
  });

  it('qualityResultToDiffMismatch：max_length → value_error', () => {
    const rule: QualityRule = {
      id: 'r', source: 'builtin', check: 'max_length', description: 'd',
      targetField: 'output', params: { maxLength: 100 }, severity: 'warn',
    };
    const mismatch = qualityResultToDiffMismatch(
      { ruleId: 'r', passed: false, check: 'max_length', targetField: 'output', detail: '超限', severity: 'warn' },
      rule,
    );
    expect(mismatch.type).toBe('value_error');
  });

  it('qualityFeedbackText：生成修复反馈文本', () => {
    const verdict: JudgeVerdict = { state: 'passed', detail: 'L1 通过', durationMs: 100 };
    const diffReport: DiffReport = {
      taskId: 't',
      timestamp: new Date().toISOString(),
      expectedSource: 'test',
      mismatches: [
        { type: 'field_missing', field: 'skill_description', expected: 'example', severity: 'warn' },
      ],
    };
    const feedback = qualityFeedbackText(diffReport, verdict);
    expect(feedback).toContain('质量修复指引');
    expect(feedback).toContain('skill_description');
  });

  it('qualityFeedbackText：无差异 → 空字符串', () => {
    const verdict: JudgeVerdict = { state: 'passed', detail: '通过', durationMs: 100 };
    const diffReport: DiffReport = {
      taskId: 't',
      timestamp: new Date().toISOString(),
      expectedSource: 'test',
      mismatches: [],
    };
    const feedback = qualityFeedbackText(diffReport, verdict);
    expect(feedback).toBe('');
  });
});

// ────────────────────────────────────────────────────────────
// L3-L5：Refine 循环驱动（复用 loop-agent 引擎）
// ────────────────────────────────────────────────────────────

describe('Refine 循环驱动（runRefineLoop）', () => {
  it('L1 passed + L2 质量通过 → 收敛 converged', async () => {
    const mockRunner = async (): Promise<OnboardRunOutcome> =>
      makePassedOutcome(
        JSON.stringify({
          output: '简短输出',
          skill_description: '描述，example: 示例',
          skill_few_shot: '1. 第一条\n2. 第二条',
        }),
      );

    const result = await runRefineLoop('测试任务', {
      runner: mockRunner,
      maxRounds: 3,
      l5ConvergeThreshold: 2,
    });

    expect(result.finalState).toBe('passed');
    expect(result.convergence).toBe('converged');
  });

  it('L1 passed + L2 质量违规 → 进入修复循环', async () => {
    let callCount = 0;
    const mockRunner = async (): Promise<OnboardRunOutcome> => {
      callCount++;
      if (callCount === 1) {
        // 第一轮：输出超长 + 无示例
        return makePassedOutcome(
          JSON.stringify({
            output: 'a'.repeat(600),
            skill_description: '无示例',
            skill_few_shot: '只有一条',
          }),
        );
      }
      // 后续轮：修正为合格
      return makePassedOutcome(
        JSON.stringify({
          output: '修正后的简短输出',
          skill_description: '描述，example: 示例',
          skill_few_shot: '1. 第一条\n2. 第二条',
        }),
      );
    };

    const result = await runRefineLoop('测试任务', {
      runner: mockRunner,
      maxRounds: 5,
      l5ConvergeThreshold: 1,
    });

    expect(callCount).toBeGreaterThan(1); // 至少跑了两轮（第一轮违规→修复→第二轮合格）
  });

  it('无规则集 → 空 DiffReport（跳过质量判定）', async () => {
    const mockRunner = async (): Promise<OnboardRunOutcome> =>
      makePassedOutcome('任意输出');

    const result = await runRefineLoop('测试任务', {
      runner: mockRunner,
      maxRounds: 3,
      l5ConvergeThreshold: 1,
      ruleSet: emptyRuleSet(),
    });

    expect(result.finalState).toBe('passed');
  });
});

// ────────────────────────────────────────────────────────────
// Onboard → Refine 串行验证（onConverged 自动触发）
// ────────────────────────────────────────────────────────────

describe('Onboard → Refine 串行验证', () => {
  it('Onboard 收敛 PASS → onConverged 回调 → 自动触发 Refine', async () => {
    let refineTriggered = false;

    // Onboard runner：所有轮次都通过
    const onboardRunner = async (): Promise<OnboardRunOutcome> =>
      makePassedOutcome(JSON.stringify({ result: 'ok' }));

    // Refine runner
    const refineRunner = async (): Promise<OnboardRunOutcome> => {
      refineTriggered = true;
      return makePassedOutcome(
        JSON.stringify({
          output: '简短',
          skill_description: 'example: 示例',
          skill_few_shot: '1. 第一条\n2. 第二条',
        }),
      );
    };

    // 创建 onConverged 回调
    const onConverged = createRefineOnConvergedCallback({
      runner: refineRunner,
      l5ConvergeThreshold: 1,
    });

    // 跑 Onboard 循环（注入 l2Judge 使其走 L5 收敛逻辑）
    const onboardResult = await runOnboardLoop('Onboard 任务', {
      runner: onboardRunner,
      maxRounds: 3,
      l5Config: { convergeThreshold: 1, divergeThreshold: 3 },
      l2Judge: async (): Promise<DiffReport> => ({
        taskId: 'test',
        timestamp: new Date().toISOString(),
        expectedSource: 'test',
        mismatches: [], // L2 无差异 → 收敛
      }),
      onConverged,
    });

    expect(onboardResult.convergence).toBe('converged');
    expect(refineTriggered).toBe(true);
  });

  it('onConverged 回调异常不影响 Onboard 结果', async () => {
    const onboardRunner = async (): Promise<OnboardRunOutcome> =>
      makePassedOutcome(JSON.stringify({ result: 'ok' }));

    const onConverged = async (): Promise<void> => {
      throw new Error('Refine 触发失败（模拟）');
    };

    const result = await runOnboardLoop('Onboard 任务', {
      runner: onboardRunner,
      maxRounds: 3,
      l5Config: { convergeThreshold: 1, divergeThreshold: 3 },
      l2Judge: async (): Promise<DiffReport> => ({
        taskId: 'test',
        timestamp: new Date().toISOString(),
        expectedSource: 'test',
        mismatches: [],
      }),
      onConverged,
    });

    // Onboard 仍然收敛（onConverged 异常不阻断）
    expect(result.convergence).toBe('converged');
  });
});
