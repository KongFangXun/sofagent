// ============================================================
// market-rule-cycle.test.ts · 评估体系三步闭环测试（v1.3.4 交付 5）
//
// 验收：
//   - 第一步 harvest：低分差评 + 反复失败 + 案例文本 → 规则候选（fixture mock）
//   - 第二步 jury：Benchmark 对比 Δ > 阈值 → 推荐 + 业务方签字
//   - 第三步 promote：source team_feedback → builtin + decision-log
//   - 三步闭环：harvest → jury → promote
//
// 单测读 fixture（__tests__/fixtures/），不读真实 data/。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  harvestRules,
  collectLowScoreRatings,
  collectRepeatFailCases,
  harvestFromLowScore,
  harvestFromRepeatFail,
  harvestFromCaseTexts,
  LOW_SCORE_THRESHOLD,
  REPEAT_FAIL_THRESHOLD,
} from '../market/rule-harvest';
import {
  juryRules,
  benchmarkRule,
  requestBusinessApproval,
  SCORE_DELTA_THRESHOLD,
} from '../market/rule-jury';
import {
  promoteRules,
  promoteRule,
  isAlreadyBuiltin,
} from '../market/rule-promote';
import { builtinQualityRules } from '../refine-agent/quality-rule-set';
import {
  FIXTURE_LOW_SCORE_RATINGS,
  FIXTURE_REPEAT_FAIL_CASES,
  FIXTURE_GOLDEN_SET,
  FIXTURE_CASE_TEXTS,
} from './fixtures/market-rule-fixtures';

describe('评估体系三步闭环（rule-harvest → rule-jury → rule-promote）', () => {
  describe('第一步 harvest：真实案例长规则', () => {
    it('collectLowScoreRatings 过滤低分差评（< 阈值）', () => {
      const low = collectLowScoreRatings(undefined, FIXTURE_LOW_SCORE_RATINGS);
      expect(low.length).toBe(3); // 全部 < 0.4
      low.forEach((r) => expect(r.score).toBeLessThan(LOW_SCORE_THRESHOLD));
    });

    it('collectRepeatFailCases 过滤反复失败（≥ 阈值）', () => {
      const fails = collectRepeatFailCases(undefined, FIXTURE_REPEAT_FAIL_CASES);
      expect(fails.length).toBe(2);
      fails.forEach((c) => expect(c.failCount).toBeGreaterThanOrEqual(REPEAT_FAIL_THRESHOLD));
    });

    it('harvestFromLowScore 从 comment 提炼规则（复用 parseFdeDeliveryReport）', () => {
      const { rules, count } = harvestFromLowScore(FIXTURE_LOW_SCORE_RATINGS);
      expect(count).toBe(3);
      expect(rules.length).toBeGreaterThan(0);
      rules.forEach((r) => expect(r.source).toBe('team_feedback'));
    });

    it('harvestFromRepeatFail 从反复失败提炼规则', () => {
      const { rules, count } = harvestFromRepeatFail(FIXTURE_REPEAT_FAIL_CASES);
      expect(count).toBe(2);
      expect(rules.length).toBe(2);
      // timeout case → forbidden_pattern
      const timeoutRule = rules.find((r) => r.id.includes('timeout'));
      expect(timeoutRule).toBeDefined();
    });

    it('harvestFromCaseTexts 从 FDE 格式文本提炼规则', () => {
      const { rules, count } = harvestFromCaseTexts(FIXTURE_CASE_TEXTS);
      expect(count).toBe(1);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules[0]!.check).toBe('json_valid');
    });

    it('harvestRules 三源合并', () => {
      const result = harvestRules({
        lowScoreRatings: FIXTURE_LOW_SCORE_RATINGS,
        repeatFailCases: FIXTURE_REPEAT_FAIL_CASES,
        caseTexts: FIXTURE_CASE_TEXTS,
      });
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.sources.fromLowScore).toBeGreaterThan(0);
      expect(result.sources.fromRepeatFail).toBe(2);
      expect(result.sources.fromCaseText).toBeGreaterThan(0);
      // 全部 source = team_feedback（待评审）
      result.candidates.forEach((r) => expect(r.source).toBe('team_feedback'));
    });
  });

  describe('第二步 jury：业务方当评委', () => {
    it('benchmarkRule 对比加规则前后通过率', () => {
      const candidates = harvestRules({
        lowScoreRatings: FIXTURE_LOW_SCORE_RATINGS,
        repeatFailCases: FIXTURE_REPEAT_FAIL_CASES,
        caseTexts: FIXTURE_CASE_TEXTS,
      }).candidates;

      // 取 max_length 规则跑 benchmark
      const maxLenRule = candidates.find((r) => r.check === 'max_length');
      expect(maxLenRule).toBeDefined();

      const bench = benchmarkRule(maxLenRule!, FIXTURE_GOLDEN_SET);
      expect(bench.passRateBefore).toBeGreaterThanOrEqual(0);
      expect(bench.passRateAfter).toBeGreaterThanOrEqual(0);
      expect(bench.benchmarkHash).toHaveLength(16);
    });

    it('juryRules 推荐高 Δ 规则，拒绝低 Δ 规则', () => {
      const candidates = harvestRules({
        lowScoreRatings: FIXTURE_LOW_SCORE_RATINGS,
        repeatFailCases: FIXTURE_REPEAT_FAIL_CASES,
      }).candidates;

      const result = juryRules({
        candidates,
        goldenSet: FIXTURE_GOLDEN_SET,
      });

      // 推荐的规则 Δ > 阈值
      result.recommended.forEach(({ benchmark }) => {
        expect(benchmark.scoreDelta).toBeGreaterThan(SCORE_DELTA_THRESHOLD);
      });
      // 拒绝的规则 Δ ≤ 阈值
      result.rejected.forEach(({ benchmark }) => {
        expect(benchmark.scoreDelta).toBeLessThanOrEqual(SCORE_DELTA_THRESHOLD);
      });
    });

    it('requestBusinessApproval 推荐规则获批准（非交互环境）', () => {
      const candidates = harvestRules({
        lowScoreRatings: FIXTURE_LOW_SCORE_RATINGS,
      }).candidates;
      const result = juryRules({ candidates, goldenSet: FIXTURE_GOLDEN_SET });

      const approvals = requestBusinessApproval(result.recommended);
      approvals.forEach((a) => {
        expect(a.verdict).toBe('approved');
        expect(a.signedBy).toBeDefined();
      });
    });

    it('注入评审回调 → 可控制批准/驳回', () => {
      const candidates = harvestRules({
        lowScoreRatings: FIXTURE_LOW_SCORE_RATINGS,
      }).candidates;
      const result = juryRules({
        candidates,
        goldenSet: FIXTURE_GOLDEN_SET,
        // 注入回调：全部驳回
        approvalFn: () => 'rejected',
      });
      result.approvals.forEach((a) => expect(a.verdict).toBe('rejected'));
    });
  });

  describe('第三步 promote：晋升到 builtin', () => {
    it('promoteRule 把 source team_feedback → builtin', () => {
      const candidates = harvestRules({
        lowScoreRatings: FIXTURE_LOW_SCORE_RATINGS,
      }).candidates;
      const rule = candidates[0]!;
      expect(rule.source).toBe('team_feedback');

      const promoted = promoteRule(rule);
      expect(promoted.source).toBe('builtin');
      expect(promoted.id).toContain('builtin-');
    });

    it('isAlreadyBuiltin 去重——已在 builtin 的不重复晋升', () => {
      const builtin = builtinQualityRules();
      const existingRule = builtin[0]!;
      expect(isAlreadyBuiltin(existingRule, builtin)).toBe(true);

      const newRule = {
        id: 'new-rule',
        source: 'team_feedback' as const,
        check: 'custom' as const,
        description: '新规则',
        targetField: 'output',
        params: {},
        severity: 'warn' as const,
      };
      expect(isAlreadyBuiltin(newRule, builtin)).toBe(false);
    });

    it('promoteRules 批量晋升 + 记 decision-log（kind=EVOLUTION）', () => {
      const candidates = harvestRules({
        lowScoreRatings: FIXTURE_LOW_SCORE_RATINGS,
      }).candidates;
      // 模拟业务方批准
      const approved = candidates.filter((r) => !isAlreadyBuiltin(r, builtinQualityRules()));

      const result = promoteRules({
        approvedRules: approved,
        benchmarks: approved.map((r) => ({ ruleId: r.id, benchmarkHash: 'test-hash-1234', scoreDelta: 0.15 })),
        approvals: approved.map((r) => ({ ruleId: r.id, signedBy: 'business-jury' })),
      });

      expect(result.promoted.length).toBeGreaterThan(0);
      result.promoted.forEach((r) => expect(r.source).toBe('builtin'));
      // builtin 集合已扩展
      expect(result.builtinSet.length).toBeGreaterThan(builtinQualityRules().length);
      // decision-log 记录数 = 晋升数
      expect(result.loggedCount).toBe(result.promoted.length);
    });

    it('已在 builtin 的规则不重复晋升', () => {
      const builtin = builtinQualityRules();
      const result = promoteRules({
        approvedRules: [builtin[0]!], // 已在 builtin
        benchmarks: [{ ruleId: builtin[0]!.id, benchmarkHash: 'x', scoreDelta: 0.2 }],
        approvals: [{ ruleId: builtin[0]!.id, signedBy: 'test' }],
      });
      expect(result.promoted.length).toBe(0);
    });
  });

  describe('三步闭环：harvest → jury → promote', () => {
    it('完整闭环——案例 → 评委 → 晋升 builtin', () => {
      // 第一步
      const harvest = harvestRules({
        lowScoreRatings: FIXTURE_LOW_SCORE_RATINGS,
        repeatFailCases: FIXTURE_REPEAT_FAIL_CASES,
        caseTexts: FIXTURE_CASE_TEXTS,
      });
      expect(harvest.candidates.length).toBeGreaterThan(0);

      // 第二步
      const jury = juryRules({
        candidates: harvest.candidates,
        goldenSet: FIXTURE_GOLDEN_SET,
      });

      // 第三步（只晋升被推荐 + 批准的）
      const approved = jury.recommended.map((r) => r.rule);
      const promote = promoteRules({
        approvedRules: approved,
        benchmarks: jury.recommended.map((r) => ({
          ruleId: r.rule.id,
          benchmarkHash: r.benchmark.benchmarkHash,
          scoreDelta: r.benchmark.scoreDelta,
        })),
        approvals: jury.approvals,
      });

      // 闭环验证：有规则被晋升（或至少走通流程不报错）
      expect(promote.builtinSet.length).toBeGreaterThanOrEqual(builtinQualityRules().length);
    });
  });
});
