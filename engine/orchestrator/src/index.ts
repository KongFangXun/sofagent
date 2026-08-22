// ── API 分级契约（v1.3.9 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/orchestrator
 *
 * 编排引擎 — 多 Agent 协作 / 工作流调度 / prompt 模板
 */

// Composer
/* @public */ export { composeWithDeepAgents, compose } from './composer';
/* @public */ export type { ComposeInput, ComposeResult, ComposeVariant } from './composer';

// DAG Runner（编排执行器 · v1.1.8 新增）
/* @public */ export { runDAG, detectFileConflicts, ORCHESTRATOR_PROMPT } from './dag-runner';
/* @public */ export type { DAGResult, DagRunnerDeps, CreateReactAgentFn } from './dag-runner';

// Workflow Parser（YAML → SubAgent 映射 · v1.1.8 新增）
/* @public */ export {
  parseWorkflowYaml,
  toSubAgentConfigs,
  parseWorkflowToSubAgents,
  mapAgentType,
  resolveAgent,
  WorkflowParseError,
} from './workflow-parser';
/* @public */ export type { WorkflowNode, ParsedWorkflow, SubAgentConfig, MergeCriterion, WorkflowApprover } from './workflow-parser';

// Workflow Container（外部提交通道 · v1.3.6 交付 ①）
/* @public */ export {
  submitWorkflow,
  WorkflowSubmitError,
  validateMergeCriteria,
  validateApprover,
  WORKFLOW_SCHEMA,
} from './workflow/container';
/* @public */ export type { WorkflowSubmitInput, WorkflowContainerHandle } from './workflow/container';
// DSH workflow seam 互转契约位（v1.3.6 交付 ①——真实互转待 DSH 正式版）
/* @public */ export { createDshSeamConverter, DSH_SEAM_FIELD_MAPPINGS } from './workflow/dsh-seam';
/* @public */ export type { DshSeamConverter, DshSeamFieldMapping } from './workflow/dsh-seam';

// Ontology 运行时层（v1.3.6 交付 ②——Action 注册表 / Schema 校验 / 注入管线）
/* @public */ export {
  ActionRegistry,
  globalActionRegistry,
  validateToolCall,
  createOntologyValidator,
  ENTITY_SCHEMA,
  CONCEPT_SCHEMA,
  RELATIONS_SCHEMA,
  validateAgainstSchema,
  CORE_CONTRACTS,
  validateOntologyPayload,
  importOntology,
  RELATION_KEYS,
  ONTOLOGY_IMPORT_DSH_MAPPING,
} from './ontology';
/* @public */ export type {
  ActionRegistration,
  OntologyVerdict,
  OntologyVerdictStatus,
  OntologyValidatorOptions,
  OntologyValidator,
  JsonSchema,
  SchemaValidationResult,
  CoreContract,
  ContractMeta,
  RelationDirection,
  RelationCardinality,
  StateMachineContract,
  EntityImport,
  ConceptImport,
  RelationImport,
  OntologyImportPayload,
  OntologyValidationResult,
  OntologyImportResult,
  OntologyImportOptions,
  RelationKey,
} from './ontology';

// Harness SDK（SubAgent 托管 SDK · v1.3.6 交付 ③ · v1.3.8 交付⑥ sandbox:true 启用）
/* @public */ export {
  harness,
  wrap,
  wrapTools,
  createSandboxHandle,
  registerGraphBuilder,
  getGraphBuilder,
  listGraphBuilders,
  clearGraphBuilders,
  isSideEffectTool,
  SIDE_EFFECT_TOOL_PATTERNS,
} from './harness-sdk';
/* @public */ export type {
  GraphBuilder,
  ApprovalMode,
  HarnessWrapOptions,
  HarnessToolCallEvent,
  HarnessApprovalEvent,
  WrappableAgent,
  WrappedAgent,
  SandboxHandle,
} from './harness-sdk';

// Route（入口路由 · v1.3.3 新增）
/* @public */ export { routeRequest } from './route/route-request';
/* @public */ export type {
  RouteRequestInput,
  RouteResult,
  RouteWorkflowResult,
  RouteFallbackResult,
} from './route/route-request';

// Team（L2 团队协作协议 · v1.3.3 新增）
// team-state：CRDT 文档 + 同步通道抽象
/* @public */ export {
  initTeamState,
  addMember,
  updateMemberStatus,
  addTask,
  setFileLock,
  appendFeedback,
  saveTeamState,
  loadTeamState,
  mergeTeamState,
  LocalTeamSyncChannel,
} from './team/team-state';
/* @public */ export type {
  TeamStateDoc,
  MemberState,
  TaskState,
  FileLockEntry,
  FeedbackEntry,
  TeamSyncChannel,
} from './team/team-state';
// intent-bus：意图总线
/* @public */ export { IntentBus, matchIntent } from './team/intent-bus';
/* @public */ export type { IntentEvent, Subscription, ConvergenceResult } from './team/intent-bus';
// protocol：冲突消解 + 反馈放大
/* @public */ export {
  resolveConflict,
  detectFileLockConflict,
  amplifyFeedback,
  getFeedback,
  getFeedbackByType,
} from './team/protocol';
/* @public */ export type {
  TeamConflictParty,
  ConflictResolutionResult,
  FeedbackType,
  AmplifyFeedbackInput,
} from './team/protocol';
// team-manager：团队生命周期 + 编排
/* @public */ export {
  TeamManager,
  createTeam,
  parseTeamYaml,
  getTeamStatePath,
  TeamYamlError,
} from './team/team-manager';
/* @public */ export type {
  TeamYaml,
  TeamYamlMember,
  TeamYamlBroadcastChannel,
  TeamManagerOptions,
  EnqueueSubAgentInput,
} from './team/team-manager';

// Registry & Definitions
/* @public */ export { loadDefinition, listAgents } from './registry';
/* @public */ export type { SubAgentDefinition } from './registry';

// Built-in Agents
/* @public */ export { BUILTIN_AGENTS, ENGINEER_AGENT, REVIEWER_AGENT } from './builtin-agents';

// Launcher
/* @public */ export { launch, shutdown, readRuntimeState, writeRuntimeState, spawnSubAgent } from './launcher';

// CLI args parsing (v1.1.5 审-8：--mode <deploy|sustain> 纯函数，可单测)
/* @public */ export { parseSubagentRunArgs } from './cli-args';
/* @public */ export type { SubagentRunArgs } from './cli-args';

// Audit Sub Agent
/* @public */ export { readAuditHistory, analyzeCostBaseline, generateAuditReport } from './audit-sub-agent';

// LOOP Runner (v1.1.3 — 串行路径)
/* @public */ export { runLOOPIteration } from './loop-runner';
/* @public */ export type { LOOPResult, LOOPOptions } from './loop-runner';

// Tools & ToolGate (v1.1.9 / v1.2.0)
/* @public */ export { ENGINEER_TOOLS, REVIEWER_TOOLS, checkDangerousCommand, createToolGate, toolGate, wrapToolsWithGate, convertToLangGraphTools } from './tools';
/* @public */ export type { ToolGateOptions, ExecutableTool } from './tools';

// Graph (v1.1.3 — LangGraph StateGraph 节点级流转)
/* @public */ export {
  runLoopGraph,
  resumeLoopGraph,
  buildLoopGraph,
  resolveCheckpointDir,
  resolveResumeNode,
  routeAfterAudit,
  routeAfterHuman,
  emptyArtifacts,
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
} from './loop';
/* @public */ export type {
  LoopGraphState,
  LoopArtifacts,
  LoopNodeName,
  LoopFinalStatus,
  AuditVerdict,
  LoopGraphDeps,
  AuditOutcome,
  HumanDecision,
  LoopGraphResult,
  LoopGraphOptions,
} from './loop';

// Checkpoint（共享基础设施，被 daemon 和 LOOP 共用）
/* @public */ export {
  FileCheckpointer,
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  type CheckpointRecord,
} from './graph';

// HITL Channel（v1.2.2 P3b · Storage-backed 异步人工确认）
/* @public */ export {
  HITL_OPTIONS,
  shouldUseAsyncHITL,
  writeHITLRequest,
  readHITLResponse,
  writeHITLResponse,
  type HITLDecision,
  type HITLRequest,
  type HITLResponse,
} from './hitl';

// Worktree Isolation（v1.2.3 · 并行 SubAgent 文件级隔离底座 · AD-4）
/* @public */ export {
  createWorktree,
  sweepStaleWorktrees,
  pidAlive,
  appendWorktreeRegistry,
  readWorktreeRegistry,
  listActiveWorktrees,
  resolveRegistryPath,
  WORKTREE_BASE_DIR,
  WORKTREE_BRANCH_PREFIX,
  WORKTREE_REGISTRY_REL,
} from './worktree-isolation';
/* @public */ export type {
  WorktreeHandle,
  CreateWorktreeOptions,
  WorktreeRegistryEntry,
  SweepOptions,
  SweepResult,
} from './worktree-isolation';

// Worktree Merge Gate（v1.2.3 · 审计合并卡关）
/* @public */ export { runMergeGate } from './worktree-merge-gate';
/* @public */ export type { MergeGateOptions, MergeGateResult, MergeGateStatus } from './worktree-merge-gate';

// v1.3.1 交付 3：并行编排（ParallelScheduler / 波次卡关 / MergeQueue）
/* @public */ export { ParallelScheduler } from './loop/parallel-scheduler';
/* @public */ export type {
  ParallelTask,
  ParallelTaskResult,
  ParallelWaveResult,
  ParallelSchedulerOptions,
} from './loop/parallel-scheduler';
/* @public */ export { runWaveMergeGate, isMergeGatePass } from './loop/merge-gate';
/* @public */ export type {
  WaveWorktree,
  WaveGateDecision,
  WaveGateOptions,
} from './loop/merge-gate';
/* @public */ export { MergeQueue } from './loop/merge-queue';
/* @public */ export type {
  MergeQueueItem,
  DuplicatePushPolicy,
} from './loop/merge-queue';

// v1.3.1 交付 4：Durable Execution（L1 checkpoint 续跑 + L2 工具幂等性）
/* @public */ export { CheckpointManager, DEFAULT_CHECKPOINT_RETENTION_DAYS } from './durable/checkpoint-manager';
/* @public */ export type { CheckpointManagerOptions, CheckpointFileInfo } from './durable/checkpoint-manager';
/* @public */ export {
  SideEffectLedger,
  sideEffectId,
  resolveSideEffectLedgerPath,
  SIDE_EFFECT_LEDGER_REL,
} from './durable/side-effect-ledger';
/* @public */ export type { SideEffectEntry } from './durable/side-effect-ledger';
/* @public */ export { shouldExecute, markExecuted } from './durable/idempotency-check';
/* @public */ export type { IdempotencyDecision } from './durable/idempotency-check';
/* @public */ export { resumePendingLoops, scanPendingCheckpoints, isPendingRecord } from './durable/resume';
/* @public */ export type {
  PendingCheckpointInfo,
  ResumeLoopsOptions,
  ResumeLoopsSummary,
} from './durable/resume';

// v1.3.8 交付三：Durable Execution L3（WAL 事务级恢复——write-ahead log）
/* @public */ export { WalWriter, newTaskId, WAL_REL_PATH } from './durable/wal-writer';
/* @public */ export type { WalRecord, WalRecordType, SideEffectSpec } from './durable/wal-writer';
/* @public */ export {
  UndoRegistry,
  createUndoRegistry,
  gitRestore,
  deleteWrittenFile,
} from './durable/undo-registry';
/* @public */ export type { UndoTier, UndoResult, UndoFn, WarnHook } from './durable/undo-registry';
/* @public */ export { scanWAL, recoverWAL } from './durable/wal-recovery';
/* @public */ export type {
  WalTrx,
  WalTrxState,
  WalScanResult,
  WalRecoveryResult,
  ReExecuteFn,
  RecoverWarnFn,
} from './durable/wal-recovery';

// v1.3.1 交付 8：Onboard Agent L1（循环驱动 + L1 判定器）
/* @public */ export { runOnboardLoop, defaultDagRunner, defaultTraceFixer, appendLoopDebugRecord, readLoopDebugRecords, resolveLoopDebugLogPath } from './loop-agent/driver';
/* @public */ export type {
  OnboardDriverOptions,
  OnboardRound,
  OnboardRunOutcome,
  OnboardLoopResult,
  LoopDebugRecord,
  FixFeedback,
} from './loop-agent/driver';
/* @public */ export { judgeRunResult, DEFAULT_TIMEOUT_MS } from './loop-agent/judge';
/* @public */ export type {
  JudgeState,
  JudgeOptions,
  JudgeVerdict,
} from './loop-agent/judge';

// v1.3.2 交付 1-4：Onboard L2-L5（语义判定 / 自动定位 / 自动修复 / 循环收敛）
/* @public */ export { compareWithOntology, compareWithOntologySync } from './loop-agent/ontology-comparator';
/* @public */ export type { OntologyExpectedOutput, OntologyFieldExpectation, ComparatorOptions } from './loop-agent/ontology-comparator';
/* @public */ export { extractStructuredOutput } from './loop-agent/output-extractor';
/* @public */ export type { ExtractionResult, LlmExtractOptions } from './loop-agent/output-extractor';
/* @public */ export { emptyDiffReport, isDiffPass, hasErrorMismatch, summarizeDiff } from './loop-agent/diff-report';
/* @public */ export type { DiffReport, DiffMismatch } from './loop-agent/diff-report';
/* @public */ export { localizeError } from './loop-agent/error-localizer';
/* @public */ export type { LocalizationResult, ErrorSource, LocalizationContext, LlmLocalizerDeps } from './loop-agent/error-localizer';
/* @public */ export { applyFix } from './loop-agent/fix-applier';
/* @public */ export type { FixProposal, FixApplyResult, LlmFixerDeps, AuditGateDeps, FileOpsDeps } from './loop-agent/fix-applier';
/* @public */ export { DEFAULT_L5_CONFIG } from './loop-agent/driver';
/* @public */ export type { ConvergenceState, L5ConvergenceConfig } from './loop-agent/driver';

// v1.3.3 交付 T04：Refine Agent（质量循环——复用 loop-agent 引擎，换 L2 质量判据）
/* @public */ export { runRefineLoop, createRefineOnConvergedCallback } from './refine-agent/refine-driver';
/* @public */ export type { RefineDriverOptions, RefineLoopResult, RefineTriggerConfig, OnboardConvergedContext } from './refine-agent/refine-driver';
/* @public */ export { judgeQuality, qualityFeedbackText, QUALITY_TARGET_FIELDS } from './refine-agent/quality-judge';
/* @public */ export type { QualityJudgeOptions } from './refine-agent/quality-judge';
/* @public */ export {
  loadQualityRuleSet,
  builtinQualityRules,
  parseFdeDeliveryReport,
  fdeFeedbacksToRules,
  teamFeedbacksToRules,
  matchQualityRules,
  evaluateRule,
  summarizeQualityResults,
} from './refine-agent/quality-rule-set';
/* @public */ export type {
  QualityRule,
  QualityRuleSet,
  QualityCheckType,
  QualitySeverity,
  QualityRuleParams,
  QualityCheckResult,
  FdeQualityFeedback,
  TeamFeedbackEntry,
  NodeOutputFields,
  LoadRuleSetOptions,
} from './refine-agent/quality-rule-set';

// v1.3.3 交付 T05：进化闭环（Benchmark 驱动 Dream Cycle）
/* @public */ export { runOptimizationLoop } from './refine-agent/optimization-loop';
/* @public */ export type {
  OptimizationLoopOptions,
  OptimizationIteration,
  OptimizationLoopResult,
} from './refine-agent/optimization-loop';
/* @public */ export {
  readAgentVersion,
  writeAgentVersion,
  takeSnapshot,
  rollbackToSnapshot,
  advanceVersion,
  verifyVersionMonotonic,
  EXPERIENCE_LAYER_PATTERNS,
} from './refine-agent/snapshot-manager';
/* @public */ export type {
  AgentVersion,
  AgentVersionEntry,
} from './refine-agent/snapshot-manager';
/* @public */ export {
  checkContamination,
  assertNoContamination,
} from './refine-agent/contamination-guard';
/* @public */ export type {
  ContaminationCheckInput,
  ContaminationResult,
  ContaminationType,
} from './refine-agent/contamination-guard';
/* @public */ export { ContaminationError } from './refine-agent/contamination-guard';

// v1.3.2 交付 5：agent-creation（一句话需求 → 自动建节点）
/* @public */ export { deriveAgentFromRequirement } from './onboard/agent-creator';
/* @public */ export type { AgentCreationResult, DerivedAgentConfig } from './onboard/agent-creator';
/* @public */ export { validateAgentCreation, checkNoModelPersistence } from './onboard/creation-validator';
/* @public */ export type { ValidationResult } from './onboard/creation-validator';

// v1.3.2 交付 6：企业专属 eval 套件
/* @public */ export {
  instantiateEvalSuite,
  freezeEvalBaseline,
  runEvalSuite,
  loadIndustryTemplate,
} from './loop-agent/eval-suite';
/* @public */ export type {
  EnterpriseEvalSuite,
  EvalCase,
  Industry,
  EvalSuiteRunResult,
} from './loop-agent/eval-suite';

// v1.3.2 交付 7右半 + 10：FDE 梳理辅助 + Ontology 咨询式生成
/* @public */ export {
  classifyAutomation,
  validateFiveElements,
  deriveOntologyDraft,
} from './fde/compose-interview';
/* @public */ export type {
  FiveElements,
  ThreeQuestions,
  NodeInterview,
  ComposeSession,
  OntologyDraftResult,
  AutomationTag,
} from './fde/compose-interview';
/* @public */ export { generateWorkflowDraft, validateDraftDag } from './fde/workflow-draft';
/* @public */ export type { WorkflowDraft } from './fde/workflow-draft';
/* @public */ export {
  generateOntologyDraft,
  saveOntologyDraft,
  validateOntologyDraft,
} from './fde/ontology-draft';
/* @public */ export type { OntologyDraftJson } from './fde/ontology-draft';

// v1.3.2 交付 9：Session 级隔离（Builder vs Optimizer 分离）
/* @public */ export {
  createSessionWorkspace,
  runInIsolatedSession,
  handoffSessionData,
} from './session-isolator';
/* @public */ export type {
  SessionType,
  SessionIsolatorConfig,
  SessionRunResult,
} from './session-isolator';

// v1.3.2 交付 11：LLM Trace 任务级轨迹视图
/* @public */ export {
  aggregateTrajectory,
  exportTrajectoryJson,
  exportTrajectoryForRL,
} from './trace/trajectory';
/* @public */ export type {
  TaskTrajectory,
  TrajectoryStep,
  TrajectoryOptions,
} from './trace/trajectory';

// v1.3.1 交付 9：Benchmark 评测体系（题库设计 / 隔离评测 / HMAC 链日志）
/* @public */ export {
  createBenchmark,
  addCase,
  calibrateCase,
  freezeBenchmark,
  writeBenchmarkLayout,
  readBenchmarkLayout,
  benchmarksRoot,
  serializeBenchmarkConfig,
  parseBenchmarkConfig,
} from './benchmark/benchmark-designer';
/* @public */ export type {
  BenchmarkDefinition,
  BenchmarkCase,
  CalibrationRecord,
  CreateBenchmarkOptions,
  Difficulty,
  ParsedBenchmarkConfig,
} from './benchmark/benchmark-designer';
/* @public */ export { evaluateCase, defaultScoringFn, DEFAULT_EVALUATE_TIMEOUT_MS } from './benchmark/case-evaluator';
/* @public */ export type {
  EvaluateCaseInput,
  AgentExecutionContext,
  CaseEvaluation,
  EvaluationFailureCode,
} from './benchmark/case-evaluator';
/* @public */ export {
  appendEvaluationRecord,
  readEvaluationLog,
  verifyEvaluationChain,
  getEvaluationLogPath,
} from './benchmark/evaluation-log';
/* @public */ export type {
  EvaluationLogInput,
  EvaluationLogRecord,
} from './benchmark/evaluation-log';

// Conflict Resolver（v1.2.3 · merge 文本冲突仲裁）
/* @public */ export {
  resolveWorktreeConflict,
  fileInScope,
  appendConflictRecord,
  readConflictRecords,
  resolveConflictsPath,
  WORKTREE_CONFLICTS_REL,
} from './conflict-resolver';
/* @public */ export type {
  ConflictParty,
  MergeConflictInput,
  ConflictResolution,
  ConflictRecord,
  ConflictFileVerdict,
  ConflictWinner,
  ConflictRule,
} from './conflict-resolver';

// Orchestrator Compare
/* @public */ export { scanLogFiles, extractMetrics, generateReport, promoteWorkflow } from './orchestrator-compare';
/* @public */ export type { Metric } from './orchestrator-compare';

// A/B History（真实任务指标 jsonl 持久化 · v1.1.8 新增）
/* @public */ export {
  appendMetrics,
  aggregateRecent,
  truncateToLastK,
  readAll,
  HISTORY_MAX_ENTRIES,
} from './ab-history';
/* @public */ export type { PlanMetrics, AggregateMetrics } from './ab-history';

// A/B Scheduler（daemon cron 探索-利用状态机 · v1.1.8 新增）
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
} from './ab-scheduler';
/* @public */ export type {
  ABSchedulerState,
  ABScheduleConfig,
  ABSchedulerDeps,
  ABPhase,
  RunOutcome,
} from './ab-scheduler';

// Activate（激活链 Phase 1 · v1.2.5 新增）
/* @public */ export { activateWorkflow, resolveTools, extractSkillBody, assembleSystemPrompt } from './activate';
/* @public */ export type { EnterpriseAgentConfig, ActivateResult, ActivateOptions } from './activate';

// ModelRouter（v1.2.2 · P1 混合模型路由层）
/* @public */ export { ModelRouter, createDefaultRouter, LOCAL_UNAVAILABLE_MSG } from './model-router';
/* @public */ export type { ModelRoute, TaskContext, TaskComplexity, Sensitivity, RouteTarget, RouteReason, ModelRouterDeps } from './model-router';
/* @public */ export { loadModelRouterConfig, resolveRouterConfigPath, DEFAULT_ROUTER_CONFIG, ModelRouterConfigError, ModelRouterConfigSchema, applyRegistryOverrides } from './model-router-config';
/* @public */ export type { ModelRouterConfig, FallbackPolicy } from './model-router-config';

// Model Registry（v1.3.6 交付 ④ · 评测→注册→灰度→晋升→退役闭环）
/* @public */ export {
  registerModel,
  switchModel,
  rollbackModel,
  retireModel,
  restoreModel,
  loadRegistry,
  saveRegistry,
  resolveModelRegistryPath,
  readActiveEndpoints,
  ModelRegistryError,
} from './model-registry';
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
} from './model-registry';

// Route Policy（v1.3.6 交付 ⑧ · 路由决策可解释性 Policy 构件）
/* @public */ export {
  loadRoutePolicy,
  isEndpointDenied,
  DEFAULT_ROUTE_POLICY,
} from './route-policy';
/* @public */ export type {
  RoutePolicy,
  RoutePreference,
  RoutePolicyResolution,
} from './route-policy';

// Loop State Extractor（checkpoint → ControlGraphState 翻译 · v1.1.8 新增）
/* @public */ export {
  extractControlGraphState,
  writeControlGraphState,
  splitWaves,
  mapNodeStates,
  buildEvidenceChain,
  CONTROL_GRAPH_SCHEMA_VERSION,
} from './loop-state-extractor';
/* @public */ export type {
  ControlGraphState,
  WaveState,
  NodeState,
  Evidence,
  WaveTrigger,
} from './loop-state-extractor';

// v1.3.4 交付 1+4：L3 组织能力公地（发布→发现 + SkillScan 安全门）
/* @public */ export { publishCapability, validateMetadata } from './commons/publisher';
/* @public */ export type { CapabilityKind, CapabilityMetadata, PublishResult } from './commons/publisher';
/* @public */ export {
  readCatalog,
  searchCatalog,
  searchByTag,
  searchByKind,
  getCapability,
} from './commons/catalog';
/* @public */ export type { CatalogEntry, CatalogSearchResult } from './commons/catalog';
/* @public */ export { scanForPublish, scanForInstall, mapSafetyResult } from './commons/skill-scan';
/* @public */ export type { ScanResult, ScanVerdict } from './commons/skill-scan';
// v1.3.4 交付 2：调用与评价
/* @public */ export { invokeCapability, readInvokeLog } from './commons/invoker';
/* @public */ export type { InvokeInput, InvokeResult, InvokeOutcome, CapabilityExecutor, InvokeLogEntry } from './commons/invoker';
/* @public */ export {
  addRating,
  readRatings,
  readRatingsForCapability,
  aggregateRating,
  computeRankScore,
  coldStartFactor,
  rankCapabilities,
  getTrustStub,
  getTrustForRating,
  readInvokeCounts,
  appendInvokeCount,
  COLD_START_THRESHOLD,
} from './commons/rating';
/* @public */ export type { RatingRecord, AggregatedRating } from './commons/rating';
// v1.3.4 交付 3：养护环（owner + 退役）
/* @public */ export {
  declareOwner,
  getTrust,
  getOwner,
  updateTrustOnRating,
  penalizeOnRetire,
  clampTrust,
  classifyTrust,
  readOwners,
  TRUST_INITIAL,
  TRUST_GOOD_THRESHOLD,
  TRUST_BAD_THRESHOLD,
  TRUST_UPVOTE_COUNT,
} from './commons/owner';
/* @public */ export type { OwnerRecord } from './commons/owner';
/* @public */ export {
  markRetired,
  restoreCapability,
  getCapabilityStatus,
  scanRetireCandidates,
  LOW_INVOKE_THRESHOLD,
  LOW_RATING_THRESHOLD,
} from './commons/retire';
/* @public */ export type { RetireReason, RetireCandidate } from './commons/retire';
// v1.3.4 交付 5：评估体系三步
/* @public */ export {
  harvestRules,
  collectLowScoreRatings,
  collectRepeatFailCases,
  harvestFromLowScore,
  harvestFromRepeatFail,
  harvestFromCaseTexts,
  LOW_SCORE_THRESHOLD,
  REPEAT_FAIL_THRESHOLD,
} from './commons/rule-harvest';
/* @public */ export type { HarvestInput, HarvestResult } from './commons/rule-harvest';
/* @public */ export {
  juryRules,
  benchmarkRule,
  requestBusinessApproval,
  SCORE_DELTA_THRESHOLD,
} from './commons/rule-jury';
/* @public */ export type { JuryInput, JuryResult, RuleBenchmarkResult } from './commons/rule-jury';
/* @public */ export {
  promoteRules,
  promoteRule,
  isAlreadyBuiltin,
} from './commons/rule-promote';
/* @public */ export type { PromoteInput, PromoteResult } from './commons/rule-promote';

// v1.3.4 增量：编排层与执行层分离
/* @public */ export {
  createExecutionBackend,
} from './execution-backend';
/* @public */ export type {
  ExecutionBackend,
  ExecutionTask,
  ExecutionResult,
} from './execution-backend';

// v1.3.5 交付 3：instinct→skill 自动进化（提取/评分/聚合/错题本）
/* @public */ export {
  extractInstincts,
  parseThinkSections,
  normalizePattern,
  patternId,
} from './instinct/extractor';
/* @public */ export type { InstinctItem, ExtractOptions } from './instinct/extractor';
/* @public */ export {
  scoreInstinct,
  scoreInstincts,
  selectForInjection,
  renderInjectionBlock,
  DEFAULT_CONFIDENCE_THRESHOLD,
  OCCURRENCE_SATURATION,
} from './instinct/scorer';
/* @public */ export type { ScoredInstinct } from './instinct/scorer';
/* @public */ export {
  evolveInstincts,
  resolveCustomSkillDir,
} from './instinct/evolver';
/* @public */ export type { EvolveOptions, EvolveResult, EvolvedSkill } from './instinct/evolver';
/* @public */ export {
  appendFailure,
  readFailureLog,
  aggregateFailurePatterns,
  failureLogPath,
} from './instinct/failure-log';
/* @public */ export type { FailureLogEntry } from './instinct/failure-log';

// v1.3.5 交付 5 #2：FDE 进场记忆工程化（session-stop 捕获 + session-start 恢复）
/* @public */ export {
  captureFDESession,
  restoreFDESession,
  listFDESessions,
  renderContextMd,
  parseContextMd,
  fdeSessionsDir,
  fdeSessionDir,
  fdeContextPath,
  fdeCurrentSessionPath,
} from './fde-session';
/* @public */ export type { FDESessionContext, FDESessionMeta } from './fde-session';

// v1.3.5 交付 5 #4：FDE 节点注册表（yaml schema 解析——daemon 消费方经本出口 import）
/* @public */ export {
  parseFDERegistry,
  loadFDERegistry,
  filterByCadence,
  highRiskNodes,
} from './fde-registry';
/* @public */ export type {
  FDECadence,
  FDERisk,
  FDERegistryNode,
  FDERegistryParseResult,
} from './fde-registry';

// v1.3.6 交付⑤：DSH 后端补全 + 调用点统一工厂 + Trajectory 采集 PoC
/* @public */ export { resolveAgentFactory, resetAgentFactoryCache } from './agent-factory';
/* @public */ export type { ResolvedAgentFactory, AgentFactory, InvocableAgent } from './agent-factory';
/* @public */ export {
  createDshBackend,
  convertTools,
  createBudgetGuard,
  createBudgetPlugin,
  ToolBudgetExhaustedError,
  DshCapabilityMissingError,
} from './execution-backends/dsh-backend';
/* @public */ export type {
  CordisPlugin,
  CordisRuntime,
  CordisModule,
  CordisToolDefinition,
  BudgetGuard,
  BudgetVerdict,
  RunCordisAgentOptions,
} from './execution-backends/dsh-backend';
/* @public */ export { createTrajectoryCollector } from './execution-backends/trajectory';
/* @public */ export type { TrajectoryRecord, TrajectoryCollector } from './execution-backends/trajectory';

// v1.3.6 交付⑥⑦：训练协议三约定 + 训练预算控制
/* @public */ export {
  TrainBudgetSchema,
  TrainJobSchema,
  validateTrainJob,
  buildTrainSpawnArgs,
  parseTrainEvent,
  parseTrainEventStream,
  createSignalController,
} from './train/train-protocol';
/* @public */ export type {
  TrainBudget,
  TrainJob,
  TrainJobValidation,
  TrainEvent,
  TrainEventParseResult,
  SignalAction,
  SignalController,
  SignalControllerOptions,
} from './train/train-protocol';
/* @public */ export {
  checkBudget,
  createTrainBudgetMonitor,
  buildBudgetReport,
  trainJobsPath,
  loadTrainJobs,
  saveTrainJobs,
  upsertTrainJob,
  findTrainJob,
  emitBudgetExceededAudit,
} from './train/train-budget';
/* @public */ export type {
  TrainUsage,
  BudgetViolation,
  BudgetCheckResult,
  BudgetPause,
  BudgetHumanDecision,
  TrainBudgetMonitor,
  TrainBudgetReport,
  TrainJobState,
} from './train/train-budget';

// ============================================================
// v1.3.6 交付⑨：验收条件定义与执行（机器可判定验收 · 软约束先行）
// ============================================================
/* @public */ export {
  AcceptanceCriterionSchema,
  validateAcceptanceDefinition,
  saveAcceptanceDefinition,
  loadAcceptanceDefinition,
  checkAcceptance,
} from './acceptance/acceptance';
/* @public */ export type {
  AcceptanceCriterion,
  AcceptanceDefinition,
  CriterionResult,
  AcceptanceCheckResult,
} from './acceptance/acceptance';

// ============================================================
// v1.3.8 交付一：代理网关硬边界（SubAgent 外部请求唯一出入口）
// ============================================================
/* @public */ export {
  createProxyGateway,
  classifyRequestRisk,
  sanitizeForAudit,
  GATEWAY_AUDIT_REL,
  GATEWAY_PENDING_DIR_REL,
} from './gateway/proxy-gateway';
/* @public */ export type {
  ProxyRequest,
  ProxyResult,
  ProxyDecision,
  ProxyAction,
  ProxyRisk,
  GatewayHITLDecision,
  GatewayPendingCheckpoint,
  GatewayWalHook,
  RateLimitConfig,
  ProxyGatewayOptions,
  ProxyGateway,
} from './gateway/proxy-gateway';
/* @public */ export {
  createPermissionCeiling,
  DEFAULT_VIOLATION_THRESHOLD,
} from './gateway/permission-ceiling';
/* @public */ export type {
  PermissionCeilingOptions,
  PermissionCeiling,
  CeilingCheckResult,
} from './gateway/permission-ceiling';

// ============================================================
// v1.3.9（二）：meta-harness 多 harness 统一编排
// ============================================================
/* @public */ export {
  MetaHarness,
  PolicyLayer,
  AuditAggregator,
  fileLockPolicy,
  concurrencyCapPolicy,
  profileAllowlistPolicy,
  sensitiveToolPolicy,
} from './meta-harness';
/* @public */ export type {
  HarnessDescriptor,
  MetaTask,
  MetaTaskResult,
  TaskExecutor,
  DeliveryListener,
  ProfileBundle,
  DescriptorRegistration,
  MetaAction,
  MetaPolicy,
  PolicyVerdict,
  MetaStateView,
  AggregateAuditEntry,
  AuditQuery,
  L2EventInput,
} from './meta-harness';

// ============================================================
// v1.3.9（三）：AI 工作明细数据层（worklog）
// ============================================================
/* @public */ export { WorklogAggregator, isoWeekKey } from './worklog';
/* @public */ export type {
  WorklogOptions,
  AgentWorklog,
  TaskWorklogEntry,
  WorkflowWorklog,
  WeekTrend,
  EvolutionTrends,
} from './worklog';
