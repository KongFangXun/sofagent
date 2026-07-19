// ============================================================
// LOOP/index.ts · LOOP 引擎 barrel export
// v1.1.6：StateGraph 单任务 LOOP + Workflow 消费引擎
//
// 编排智能来自外部平台（WorkBuddy 等），sofagent LOOP 负责执行层。
// checkpoint 保留在 graph/ 下（被 daemon 和 LOOP 共用）。
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
  DEFAULT_MAX_RETRIES,
  type LoopGraphDeps,
  type AuditOutcome,
  type HumanDecision,
} from './nodes';

// Graph & Routing（单任务 LOOP）
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
