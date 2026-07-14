// ============================================================
// ab-test.test.ts · A/B 测试引擎测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { decidePromotion } from '../ab-promoter';
import { DEFAULT_SCORE_WEIGHTS } from '../types';
import type { ABTestResult, ABConfig } from '../types';

function makeResult(winner: 'current' | 'candidate' | 'tie', margin: number, consecutiveWins: number, candidateOverall = 0.8, currentOverall = 0.7): ABTestResult {
  return {
    currentScore: { exactMatch: currentOverall, semanticSimilarity: currentOverall, ruleCompliance: currentOverall, overall: currentOverall },
    candidateScore: { exactMatch: candidateOverall, semanticSimilarity: candidateOverall, ruleCompliance: candidateOverall, overall: candidateOverall },
    winner,
    margin,
    consecutiveWins,
  };
}

const defaultConfig: ABConfig = {
  current: '/fake/current',
  candidate: '/fake/candidate',
  evalSet: '/fake/eval.yaml',
  promoteThreshold: 3,
  minSampleSize: 5,
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
};

describe('decidePromotion', () => {
  it('candidate 显著优于 current 且达到阈值 → promote', () => {
    const result = makeResult('candidate', 0.15, 3, 0.9, 0.7);
    const decision = decidePromotion(result, [], defaultConfig);
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toContain('建议晋升');
  });

  it('candidate 胜出但未达阈值 → hold', () => {
    const result = makeResult('candidate', 0.1, 1, 0.8, 0.7);
    const decision = decidePromotion(result, [], defaultConfig);
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toContain('未达晋升阈值');
  });

  it('current 胜出 → reject', () => {
    const result = makeResult('current', -0.1, 0, 0.6, 0.8);
    const decision = decidePromotion(result, [], defaultConfig);
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toContain('current 版本');
  });

  it('平局 → hold', () => {
    const result = makeResult('tie', 0, 2, 0.75, 0.75);
    const decision = decidePromotion(result, [], defaultConfig);
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toContain('平局');
  });
});

describe('DEFAULT_SCORE_WEIGHTS', () => {
  it('权重和为 1.0', () => {
    const sum = DEFAULT_SCORE_WEIGHTS.exactMatch + DEFAULT_SCORE_WEIGHTS.semanticSimilarity + DEFAULT_SCORE_WEIGHTS.ruleCompliance;
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('各项权重 > 0', () => {
    expect(DEFAULT_SCORE_WEIGHTS.exactMatch).toBeGreaterThan(0);
    expect(DEFAULT_SCORE_WEIGHTS.semanticSimilarity).toBeGreaterThan(0);
    expect(DEFAULT_SCORE_WEIGHTS.ruleCompliance).toBeGreaterThan(0);
  });

  it('精确匹配权重最高', () => {
    expect(DEFAULT_SCORE_WEIGHTS.exactMatch).toBeGreaterThan(DEFAULT_SCORE_WEIGHTS.semanticSimilarity);
    expect(DEFAULT_SCORE_WEIGHTS.exactMatch).toBeGreaterThan(DEFAULT_SCORE_WEIGHTS.ruleCompliance);
  });
});
