// ============================================================
// domain/workflow.ts · 编排域（workflow/crud/dispatch/route/router/runtime/graph/middleware/compat + 编排核心散件）——域级 barrel（v1.5.7 F32）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/orchestrator/domain/workflow），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/workflow"。
// ============================================================
/* @public */ export { composeWithReactAgent, compose } from '../composer';
/* @public */ export type { ComposeInput, ComposeResult, ComposeVariant } from '../composer';
/* @public */ export { runDAG, detectFileConflicts, ORCHESTRATOR_PROMPT } from '../dag-runner';
/* @public */ export type { DAGResult, DagRunnerDeps, CreateReactAgentFn } from '../dag-runner';
/* @public */ export {
  parseWorkflowYaml,
  toSubAgentConfigs,
  parseWorkflowToSubAgents,
  mapAgentType,
  resolveAgent,
  WorkflowParseError,
} from '../workflow-parser';
/* @public */ export type { WorkflowNode, ParsedWorkflow, SubAgentConfig, MergeCriterion, WorkflowApprover } from '../workflow-parser';
/* @public */ export {
  submitWorkflow,
  WorkflowSubmitError,
  validateMergeCriteria,
  validateApprover,
  validateVisibility,
  WORKFLOW_SCHEMA,
} from '../workflow/container';
/* @public */ export type { WorkflowSubmitInput, WorkflowContainerHandle } from '../workflow/container';
/* @public */ export { createDshSeamConverter, DSH_SEAM_FIELD_MAPPINGS } from '../workflow/dsh-seam';
/* @public */ export type { DshSeamConverter, DshSeamFieldMapping } from '../workflow/dsh-seam';
/* @public */ export {
  workflowCreate,
  workflowUpdate,
  workflowNodeAdd,
  workflowDiffPreview,
  workflowMergeBranch,
  diffLines,
} from '../crud/workflow-store';
/* @public */ export type { StoredWorkflow, CrudResult, WorkflowMergeBranchInput } from '../crud/workflow-store';
/* @public */ export {
  gateOrThrow,
  SchemaGateError,
  validateCronSchedule,
  validateWorkflowCrons,
  workflowCreateSchema,
  workflowUpdateSchema,
  workflowNodeAddSchema,
  workflowDiffPreviewSchema,
} from '../crud/schema-gate';
/* @public */ export type {
  WorkflowCreateInput,
  WorkflowUpdateInput,
  WorkflowNodeAddInput,
  WorkflowDiffPreviewInput,
} from '../crud/schema-gate';
/* @public */ export { analyzeWorkflowGaps, DEFAULT_THRESHOLDS } from '../gap-analyzer';
/* @public */ export type { WorkflowGap, GapKind, GapAnalysisResult, GapThresholds } from '../gap-analyzer';
/* @public */ export { routeRequest } from '../route/route-request';
/* @public */ export type {
  RouteRequestInput,
  RouteResult,
  RouteWorkflowResult,
  RouteFallbackResult,
} from '../route/route-request';
/* @public */ export { BUILTIN_AGENTS, ENGINEER_AGENT, REVIEWER_AGENT } from '../builtin-agents';
/* @public */ export { launch, shutdown, readRuntimeState, writeRuntimeState, spawnSubAgent } from '../launcher';
/* @public */ export { parseSubagentRunArgs } from '../cli-args';
/* @public */ export type { SubagentRunArgs } from '../cli-args';
/* @public */ export { runLOOPIteration } from '../loop-runner';
/* @public */ export type { LOOPResult, LOOPOptions } from '../loop-runner';
/* @public */ export {
  FileCheckpointer,
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  type CheckpointRecord,
} from '../graph';
/* @public */ export {
  resolveWorktreeConflict,
  fileInScope,
  appendConflictRecord,
  readConflictRecords,
  resolveConflictsPath,
  WORKTREE_CONFLICTS_REL,
} from '../conflict-resolver';
/* @public */ export type {
  ConflictParty,
  MergeConflictInput,
  ConflictResolution,
  ConflictRecord,
  ConflictFileVerdict,
  ConflictWinner,
  ConflictRule,
} from '../conflict-resolver';
/* @public */ export {
  appendMetrics,
  aggregateRecent,
  truncateToLastK,
  readAll,
  HISTORY_MAX_ENTRIES,
} from '../ab-history';
/* @public */ export type { PlanMetrics, AggregateMetrics } from '../ab-history';
/* @public */ export {
  runABScheduledTask,
  checkThreshold,
  startExploration,
  judgeAndPromote,
  loadState,
  saveState,
  initialState,
  resolveStatePath,
  resolveHistoryPath,
  planToVariant,
  DEFAULT_THRESHOLD,
  DEFAULT_PROMOTE_THRESHOLD,
  DEFAULT_EXPLORE_CANDIDATES,
  DEFAULT_CURRENT_PLAN,
} from '../ab-scheduler';
/* @public */ export type {
  ABSchedulerState,
  ABScheduleConfig,
  ABSchedulerDeps,
  ABPhase,
  RunOutcome,
} from '../ab-scheduler';
/* @public */ export { activateWorkflow, resolveTools, extractSkillBody, assembleSystemPrompt } from '../activate';
/* @public */ export type { EnterpriseAgentConfig, ActivateResult, ActivateOptions } from '../activate';
/* @public */ export { ModelRouter, createDefaultRouter, LOCAL_UNAVAILABLE_MSG } from '../model-router';
/* @public */ export type { ModelRoute, TaskContext, TaskComplexity, Sensitivity, RouteTarget, RouteReason, ModelRouterDeps } from '../model-router';
/* @public */ export { loadModelRouterConfig, resolveRouterConfigPath, DEFAULT_ROUTER_CONFIG, ModelRouterConfigError, ModelRouterConfigSchema, applyRegistryOverrides } from '../model-router-config';
/* @public */ export type { ModelRouterConfig, FallbackPolicy } from '../model-router-config';
/* @public */ export {
  registerModel,
  switchModel,
  rollbackModel,
  rollbackWeightsVersion,
  retireModel,
  restoreModel,
  loadRegistry,
  saveRegistry,
  resolveModelRegistryPath,
  readActiveEndpoints,
  registerLocalEndpoint,
  readLocalEndpoints,
  DEFAULT_OLLAMA_ENDPOINT,
  ModelRegistryError,
} from '../model-registry';
/* @public */ export type {
  ModelRegistryEntry,
  ModelRegistryEvent,
  ModelRegistryFile,
  ModelRegistryOpOptions,
  ModelRegistryOpResult,
  RegisterModelInput,
  ModelSource,
  ModelStatus,
  EndpointProfile,
  LocalLane,
  RegisterLocalEndpointInput,
  LocalEndpointView,
} from '../model-registry';
/* @public */ export { PolicyEngine, slotLaneOf, resolveTargetModel } from '../router/policy-engine';
/* @public */ export type { TaskClass, PolicyRouteInput, PolicyDecision, PolicyEngineDeps, DispatchOutcome } from '../router/policy-engine';
/* @public */ export { SlotManager, DEFAULT_SLOT_CONFIG, SlotManagerConfigError } from '../router/slot-manager';
/* @public */ export type {
  SlotLane,
  QueuePriority,
  AcquireKind,
  SlotManagerConfig,
  SlotAcquireRequest,
  SlotLease,
  QueueTicket,
  AcquireOutcome,
  WaitDecision,
  SlotSnapshot,
  SlotManagerState,
} from '../router/slot-manager';
/* @public */ export { IntentTriage, DEFAULT_TRIAGE_CONFIG } from '../router/intent-triage';
/* @public */ export type {
  TriageLayer,
  L0MappingEntry,
  EmbeddingClassifyResult,
  IntentTriageConfig,
  TriageOutcome,
  IntentTriageDeps,
} from '../router/intent-triage';
/* @public */ export {
  MAX_OPTIONS,
  validateQuestions,
  tempBucketKey,
  computeEscalationThreshold,
  gradeOf,
  stateDigest,
  toAuditRecord,
  DEFAULT_GRADE_THRESHOLDS,
  DecisionChannelUnavailableError,
  UnconfiguredDecisionChannel,
  createUnconfiguredDecisionChannel,
} from '../router/decision-channel';
/* @public */ export type {
  DecisionPrimitive,
  EvidenceReadiness,
  DecisionState,
  DecisionQuestion,
  DecisionStatus,
  AbstainReason,
  DecisionAnswer,
  DecisionResult,
  DecisionChannel,
  DecisionGrade,
  GradeThresholds,
  DecisionAuditRecord,
} from '../router/decision-channel';
/* @public */ export { DecisionDispatcher, RouteDispositionSchema, DISPOSITION_SCHEMA_FAMILY } from '../router/decision-dispatch';
/* @public */ export type { RouteDisposition, DispatchTransport, DispatchResult, DecisionDispatcherDeps } from '../router/decision-dispatch';
/* @public */ export { runMultiInstanceVote, DEFAULT_VOTE_CONFIG, MultiInstanceVoteError } from '../multi-instance-vote';
/* @public */ export type {
  MultiInstanceVoteConfig,
  VoteOutcome,
  VoteTally,
  VoteDecision,
  VoteRoute,
  InstanceRunner,
  InstanceContext,
  VoteInstanceTask,
  VoteInstanceOutput,
} from '../multi-instance-vote';
/* @public */ export {
  checkWeightsDir,
  hashDir,
  appendVersion,
  manifestPath,
  WEIGHTS_MANIFEST_SCHEMA_VERSION,
} from '../weights-manifest';
/* @public */ export type { WeightsManifest, WeightsVersion, ManifestCheck } from '../weights-manifest';
/* @public */ export {
  loadRoutePolicy,
  isEndpointDenied,
  DEFAULT_ROUTE_POLICY,
} from '../route-policy';
/* @public */ export type {
  RoutePolicy,
  RoutePreference,
  RoutePolicyResolution,
} from '../route-policy';
/* @public */ export {
  extractControlGraphState,
  writeControlGraphState,
  splitWaves,
  mapNodeStates,
  buildEvidenceChain,
  CONTROL_GRAPH_SCHEMA_VERSION,
} from '../loop-state-extractor';
/* @public */ export type {
  ControlGraphState,
  WaveState,
  NodeState,
  Evidence,
  WaveTrigger,
} from '../loop-state-extractor';
/* @public */ export {
  createExecutionBackend,
} from '../execution-backend';
/* @public */ export type {
  ExecutionBackend,
  ExecutionTask,
  ExecutionResult,
} from '../execution-backend';
/* @public */ export {
  parseFDERegistry,
  loadFDERegistry,
  filterByCadence,
  highRiskNodes,
} from '../fde-registry';
/* @public */ export type {
  FDECadence,
  FDERisk,
  FDERegistryNode,
  FDERegistryParseResult,
} from '../fde-registry';
/* @public */ export { resolveAgentFactory, resetAgentFactoryCache } from '../agent-factory';
/* @public */ export type { ResolvedAgentFactory, AgentFactory, InvocableAgent } from '../agent-factory';
/* @public */ export { buildPrDecisionExplanation, composePrBodyWithExplanation } from '../runtime/pr-explainer';
/* @public */ export type { PrExplanation, PrExplanationInput } from '../runtime/pr-explainer';
