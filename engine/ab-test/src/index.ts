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
// v1.3.5 交付 1：MCP run_ab_test 消费（latest.json 持久化）
export { persistABTestResult } from './persistence';
