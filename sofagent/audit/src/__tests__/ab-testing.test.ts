// ============================================================
// ab-testing.test.ts · Sub Agent A/B 自进化测试
// v1.0.4 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { decidePromotion } from '../ab-testing/ab-promoter';
import { DEFAULT_SCORE_WEIGHTS } from '../ab-testing/types';
import type { ABConfig, ABTestResult } from '../ab-testing/types';

function makeResult(winner: 'current' | 'candidate' | 'tie', consecutiveWins: number, margin: number): ABTestResult {
  const baseCurrent = { exactMatch: 0.7, semanticSimilarity: 0.8, ruleCompliance: 0.6, overall: 0.72 };
  const candidateOverall = margin > 0 ? 0.72 + margin : 0.72 + margin; // margin 可正可负
  return {
    currentScore: baseCurrent,
    candidateScore: {
      exactMatch: 0.7 + margin,
      semanticSimilarity: 0.8 + margin,
      ruleCompliance: 0.6 + margin,
      overall: candidateOverall,
    },
    winner,
    margin,
    consecutiveWins,
  };
}

const config: ABConfig = {
  current: 'subagents/agent.yml',
  candidate: 'subagents/agent.candidate.yml',
  evalSet: 'eval/golden-set.yml',
  promoteThreshold: 2,
  minSampleSize: 10,
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
};

describe('ab-promoter', () => {
  it('current 胜出 → 不晋升', () => {
    const result = makeResult('current', 0, -0.1);
    const decision = decidePromotion(result, [], config);
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toContain('current');
  });

  it('平局 → 不晋升', () => {
    const result = makeResult('tie', 0, 0);
    const decision = decidePromotion(result, [], config);
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toContain('平局');
  });

  it('candidate 胜出但未达阈值 → 不晋升', () => {
    const result = makeResult('candidate', 1, 0.1);
    const decision = decidePromotion(result, [], config);
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toContain('1/2');
  });

  it('candidate 连续胜出达阈值 → 晋升', () => {
    const result = makeResult('candidate', 2, 0.1);
    const decision = decidePromotion(result, [], config);
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toContain('建议晋升');
    expect(decision.newConsecutiveWins).toBe(0);
  });

  it('candidate 胜出但综合分下降 → 不晋升', () => {
    const result = makeResult('candidate', 2, -0.1);
    const decision = decidePromotion(result, [], config);
    expect(decision.shouldPromote).toBe(false);
  });
});
