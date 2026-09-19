// ============================================================
// FORGE barrel export
// v1.5.0：StateGraph 单任务 FORGE + Workflow 两类消费入口
//
// 编排智能来自外部平台（WorkBuddy 等），sofagent FORGE 负责执行层。
// checkpoint 保留在 graph/ 下（被 daemon 和 FORGE 共用）。
//
// ── 定位边界（v1.4.8 条目 10）──
// 本域 = LOOP StateGraph 单任务 FORGE：状态机为
// engineer → audit → reviewer → human_confirm 四节点图，判据 = audit
// 对错门禁（PASS/WARN/FAIL）+ reviewer IS_PASS。
// 与 loop-agent/（工程级崩溃判定）、refine-agent/（质量好坏判据）的判据与
// 状态机均不同——三者各自独立，不合并。
// ============================================================

// State
export {
  LoopStateAnnotation,
  emptyArtifacts,
  type LoopGraphState,
  type LoopArtifacts,
  type LoopNodeName,
  type LoopFinalStatus,
  type AuditVerdict,
} from './state';

// Nodes & Dependencies
export {
  defaultDeps,
  makeEngineerNode,
  makeAuditNode,
  makeReviewerNode,
  makeHumanConfirmNode,
  parseReviewerPass,
  resolveLLMModel,
  resolveMaxTurns,
  DEFAULT_MAX_RETRIES,
  DEFAULT_ENGINEER_MAX_TURNS,
  DEFAULT_REVIEWER_MAX_TURNS,
  type LoopGraphDeps,
  type AuditOutcome,
  type HumanDecision,
} from './nodes';

// Graph & Routing（单任务 FORGE）
export {
  runLoopGraph,
  resumeLoopGraph,
  buildLoopGraph,
  resolveCheckpointDir,
  resolveResumeNode,
  routeAfterAudit,
  routeAfterHuman,
  type LoopGraphResult,
  type LoopGraphOptions,
} from './graph';

// v1.2.4 P2b：Checker 节点
export {
  makeFormatCheckerNode,
  makeFactCheckerNode,
  makeSourceValidatorNode,
  makeCheckerNode,
  resolveLoopMode,
  recordCheckerFailures,
  DEFAULT_LOOP_CONTROL,
  type CheckerResult,
  type ControlledLoopMode,
  type LoopControlConfig,
} from './checker-nodes';
