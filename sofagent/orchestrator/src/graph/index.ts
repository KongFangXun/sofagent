// ============================================================
// graph/index.ts · graph 模块 barrel export
// v1.1.4 新增
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
  type Workflow,
  type WorkflowNode,
  type WorkflowOptions,
} from './state';

// Checkpoint
export {
  FileCheckpointer,
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  type CheckpointRecord,
} from './checkpoint';

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

// Graph & Routing
export {
  runLoopGraph,
  resumeLoopGraph,
  runLoopWorkflow,
  loadWorkflow,
  buildLoopGraph,
  resolveCheckpointDir,
  resolveResumeNode,
  routeAfterAudit,
  routeAfterHuman,
  type LoopGraphResult,
  type LoopGraphOptions,
  type WorkflowResult,
} from './loop-graph';
