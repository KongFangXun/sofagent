// ============================================================
// ab-testing/ab-promoter.ts · A/B 晋升决策器
// v1.0.4 新增
// candidate 连续胜出 → promote 替换 current
// ============================================================

import type { ABConfig, ABTestResult, PromotionDecision } from './types';

/**
 * 判断是否将 candidate 晋升为 current
 * @param result 本次 A/B 测试结果
 * @param history 历史 A/B 测试结果
 * @param config A/B 配置
 * @returns PromotionDecision 晋升决策
 */
export function decidePromotion(
  result: ABTestResult,
  history: ABTestResult[],
  config: ABConfig
): PromotionDecision {
  const threshold = config.promoteThreshold;

  // 非 candidate 胜出不晋升
  if (result.winner !== 'candidate') {
    return {
      shouldPromote: false,
      reason: result.winner === 'current'
        ? 'current 版本表现更好，不晋升'
        : '双方平局，不晋升',
      newConsecutiveWins: result.consecutiveWins,
    };
  }

  // candidate 胜出但未达到阈值
  if (result.consecutiveWins < threshold) {
    return {
      shouldPromote: false,
      reason: `candidate 胜出但连续胜出次数 ${result.consecutiveWins}/${threshold}，未达晋升阈值`,
      newConsecutiveWins: result.consecutiveWins,
    };
  }

  // 安全性检查：确保 candidate 不是退化
  const overallImprovement = result.candidateScore.overall - result.currentScore.overall;
  if (overallImprovement < -0.05) {
    return {
      shouldPromote: false,
      reason: `candidate 综合分低于 current（${overallImprovement.toFixed(2)}），不晋升`,
      newConsecutiveWins: 0,
    };
  }

  // candidate 胜出次数不够的非退化情况，重置
  if (result.consecutiveWins < threshold) {
    return {
      shouldPromote: false,
      reason: `candidate 连续胜出 ${result.consecutiveWins}/${threshold}，继续观察`,
      newConsecutiveWins: result.consecutiveWins,
    };
  }

  return {
    shouldPromote: true,
    reason: `candidate 连续 ${result.consecutiveWins} 次胜出（阈值: ${threshold}），综合提升 ${(overallImprovement * 100).toFixed(1)}%，建议晋升`,
    newConsecutiveWins: 0, // 晋升后重置计数器
  };
}
