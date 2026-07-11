// ============================================================
// ab-testing/ab-runner.ts · A/B 测试运行器
// v1.0.4 新增
// current vs candidate 并行对比评测
// ============================================================

import type { ABConfig, ABTestResult } from './types';
import type { ScoreBreakdown, TestCase } from '../eval/types';
import { scoreCase } from '../eval/eval-scorer';

/**
 * 模拟 Agent 运行（生产环境替换为实际 launcher 调用）
 */
async function simulateAgentRun(
  testCase: TestCase,
  _agentPath: string
): Promise<Record<string, unknown>> {
  // 模拟：直接返回 testCase 的 expected（表示 Agent 表现完美）
  // 实际使用时替换为真实的 Agent 启动和结果收集逻辑
  return { ...testCase.expected };
}

/**
 * 运行单次 A/B 测试对比
 * @param config A/B 配置
 * @param testCases 测试用例集
 * @param previousConsecutiveWins 历史连续胜出次数
 */
export async function runABTest(
  config: ABConfig,
  testCases: TestCase[],
  previousConsecutiveWins: number = 0
): Promise<ABTestResult> {
  if (testCases.length < config.minSampleSize) {
    // 样本不足，返回平局
    return {
      currentScore: { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 },
      candidateScore: { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 },
      winner: 'tie',
      margin: 0,
      consecutiveWins: previousConsecutiveWins,
    };
  }

  let currentTotal: ScoreBreakdown = { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 };
  let candidateTotal: ScoreBreakdown = { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 };

  for (const testCase of testCases) {
    const currentOutput = await simulateAgentRun(testCase, config.current);
    const candidateOutput = await simulateAgentRun(testCase, config.candidate);

    const currentScore = scoreCase(currentOutput, testCase.expected);
    const candidateScore = scoreCase(candidateOutput, testCase.expected);

    currentTotal = addScores(currentTotal, currentScore);
    candidateTotal = addScores(candidateTotal, candidateScore);
  }

  // 平均分
  const n = testCases.length;
  const avgCurrent = divideScore(currentTotal, n);
  const avgCandidate = divideScore(candidateTotal, n);

  const weights = config.scoreWeights;
  const currentWeighted = avgCurrent.exactMatch * weights.exactMatch
    + avgCurrent.semanticSimilarity * weights.semanticSimilarity
    + avgCurrent.ruleCompliance * weights.ruleCompliance;
  const candidateWeighted = avgCandidate.exactMatch * weights.exactMatch
    + avgCandidate.semanticSimilarity * weights.semanticSimilarity
    + avgCandidate.ruleCompliance * weights.ruleCompliance;

  const margin = candidateWeighted - currentWeighted;
  const minMargin = 0.01; // 最小分差阈值

  let winner: 'current' | 'candidate' | 'tie';
  let consecutiveWins = previousConsecutiveWins;

  if (margin > minMargin) {
    winner = 'candidate';
    consecutiveWins = previousConsecutiveWins + 1;
  } else if (margin < -minMargin) {
    winner = 'current';
    consecutiveWins = 0;
  } else {
    winner = 'tie';
    // tie 不重置计数器，但也不累加
  }

  return {
    currentScore: avgCurrent,
    candidateScore: avgCandidate,
    winner,
    margin,
    consecutiveWins,
  };
}

/**
 * 评分加法
 */
function addScores(a: ScoreBreakdown, b: ScoreBreakdown): ScoreBreakdown {
  return {
    exactMatch: a.exactMatch + b.exactMatch,
    semanticSimilarity: a.semanticSimilarity + b.semanticSimilarity,
    ruleCompliance: a.ruleCompliance + b.ruleCompliance,
    overall: a.overall + b.overall,
  };
}

/**
 * 评分除法
 */
function divideScore(s: ScoreBreakdown, n: number): ScoreBreakdown {
  return {
    exactMatch: s.exactMatch / n,
    semanticSimilarity: s.semanticSimilarity / n,
    ruleCompliance: s.ruleCompliance / n,
    overall: s.overall / n,
  };
}
