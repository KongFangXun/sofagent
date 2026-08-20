// ── API 分级契约（v1.3.9 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/ab-test
 *
 * A/B 测试框架 — 对比实验 / 指标显著性 / 实验报告
 */

/* @public */ export type {
  ABConfig,
  ABTestResult,
  PromotionDecision,
  ScoreWeights,
} from './types';
/* @public */ export { DEFAULT_SCORE_WEIGHTS } from './types';

/* @public */ export { decidePromotion } from './ab-promoter';
/* @public */ export { runABTest } from './ab-runner';
// v1.3.5 交付 1：MCP run_ab_test 消费（latest.json 持久化）
/* @public */ export { persistABTestResult } from './persistence';
