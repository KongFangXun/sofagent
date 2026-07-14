/**
 * @sofagent/ab-test
 *
 * A/B 测试框架 — 对比实验 / 指标显著性 / 实验报告
 */

export type {
  ABConfig,
  ABTestResult,
  PromotionDecision,
  ScoreWeights,
} from './types';
export { DEFAULT_SCORE_WEIGHTS } from './types';

export { decidePromotion } from './ab-promoter';
export { runABTest } from './ab-runner';
