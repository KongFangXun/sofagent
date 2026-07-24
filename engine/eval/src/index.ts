/**
 * @sofagent/eval — 评分引擎
 * v1.2.0 从 sofagent/audit/src/eval/ 迁出
 */

export type {
  TestCase,
  TestCaseResult,
  EvalBreakdown,
  EvalResult,
  EvalConfig,
} from './types';

export { evalCase } from './eval-scorer';
export { runEval } from './eval-runner';
export { generateEvalReport, printEvalReport } from './eval-reporter';
