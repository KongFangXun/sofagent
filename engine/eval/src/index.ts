// ── API 分级契约（v1.4.1 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/eval — 评分引擎
 * v1.2.0 从 sofagent/audit/src/eval/ 迁出
 */

/* @public */ export type {
  TestCase,
  TestCaseResult,
  EvalBreakdown,
  EvalResult,
  EvalConfig,
} from './types';

/* @public */ export { evalCase } from './eval-scorer';
/* @public */ export { runEval, defaultRunFunction } from './eval-runner';
/* @public */ export { generateEvalReport, printEvalReport } from './eval-reporter';
