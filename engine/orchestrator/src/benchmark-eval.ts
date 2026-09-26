// ============================================================
// benchmark-eval.ts · benchmark 评测域窄入口（v1.5.3 第 7 批）
// ============================================================
// 背景：train 拆为独立包 @sofagent/train 后，train-eval-loop 需消费
//   case-evaluator（evaluateCase）+ evaluation-log（appendEvaluationRecord）。
//
// 为何不复用既有 `./benchmark` 子路径：该路径只指向 benchmark-designer
// **单文件**（既有消费者 engine/mcp/src/__tests__/evaluate.test.ts 经它取
// readBenchmarkLayout / benchmarksRoot）——改动其指向会破坏既有消费者。
//
// 故新增本窄入口，聚合 benchmark 评测域两模块（非破坏新增：不动既有子路径、
// 不动根 barrel 符号集）。
//
// 依赖深度自检：本文件 re-export 的两模块均只依赖 node 内建 +
// @sofagent/core + @sofagent/rules，不上溯 orchestrator 内部——窄入口不泄漏。
// ============================================================

// ── 用例评测（case-evaluator）──
export {
  evaluateCase,
  defaultScoringFn,
  evalBridgeScoringFn,
  DEFAULT_EVALUATE_TIMEOUT_MS,
} from './benchmark/case-evaluator';
export type {
  EvaluateCaseInput,
  AgentExecutionContext,
  CaseEvaluation,
  EvaluationFailureCode,
} from './benchmark/case-evaluator';

// ── 评测台账（evaluation-log）──
export {
  getEvaluationLogPath,
  appendEvaluationRecord,
  readEvaluationLog,
  verifyEvaluationChain,
} from './benchmark/evaluation-log';
export type {
  EvaluationLogInput,
  EvaluationLogRecord,
  EvaluationChainCheckResult,
} from './benchmark/evaluation-log';
