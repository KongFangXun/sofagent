/**
 * @sofagent/orchestrator
 *
 * 编排引擎 — 多 Agent 协作 / 工作流调度 / prompt 模板
 */

// Composer
export { composeWithDeepAgents, compose } from './composer';
export type { ComposeInput, ComposeResult, ComposeVariant } from './composer';

// DAG Runner（编排执行器 · v1.1.8 新增）
export { runDAG, detectFileConflicts, ORCHESTRATOR_PROMPT } from './dag-runner';
export type { DAGResult, DagRunnerDeps, CreateReactAgentFn } from './dag-runner';

// Workflow Parser（YAML → SubAgent 映射 · v1.1.8 新增）
export {
  parseWorkflowYaml,
  toSubAgentConfigs,
  parseWorkflowToSubAgents,
  mapAgentType,
  resolveAgent,
  WorkflowParseError,
} from './workflow-parser';
export type { WorkflowNode, ParsedWorkflow, SubAgentConfig, MergeCriterion, WorkflowApprover } from './workflow-parser';

// Workflow Container（外部提交通道 · v1.3.6 交付 ①）
export {
  submitWorkflow,
  WorkflowSubmitError,
  validateMergeCriteria,
  validateApprover,
  WORKFLOW_SCHEMA,
} from './workflow/container';
export type { WorkflowSubmitInput, WorkflowContainerHandle } from './workflow/container';
// DSH workflow seam 互转契约位（v1.3.6 交付 ①——真实互转待 DSH 正式版）
export { createDshSeamConverter, DSH_SEAM_FIELD_MAPPINGS } from './workflow/dsh-seam';
export type { DshSeamConverter, DshSeamFieldMapping } from './workflow/dsh-seam';

// Route（入口路由 · v1.3.3 新增）
export { routeRequest } from './route/route-request';
export type {
  RouteRequestInput,
  RouteResult,
  RouteWorkflowResult,
  RouteFallbackResult,
} from './route/route-request';

// Team（L2 团队协作协议 · v1.3.3 新增）
// team-state：CRDT 文档 + 同步通道抽象
export {
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
export type {
  TeamStateDoc,
  MemberState,
  TaskState,
  FileLockEntry,
  FeedbackEntry,
  TeamSyncChannel,
} from './team/team-state';
// intent-bus：意图总线
export { IntentBus, matchIntent } from './team/intent-bus';
export type { IntentEvent, Subscription, ConvergenceResult } from './team/intent-bus';
// protocol：冲突消解 + 反馈放大
export {
  resolveConflict,
  detectFileLockConflict,
  amplifyFeedback,
  getFeedback,
  getFeedbackByType,
} from './team/protocol';
export type {
  TeamConflictParty,
  ConflictResolutionResult,
  FeedbackType,
  AmplifyFeedbackInput,
} from './team/protocol';
// team-manager：团队生命周期 + 编排
export {
  TeamManager,
  createTeam,
  parseTeamYaml,
  getTeamStatePath,
  TeamYamlError,
} from './team/team-manager';
export type {
  TeamYaml,
  TeamYamlMember,
  TeamYamlBroadcastChannel,
  TeamManagerOptions,
  EnqueueSubAgentInput,
} from './team/team-manager';

// Registry & Definitions
export { loadDefinition, listAgents } from './registry';
export type { SubAgentDefinition } from './registry';

// Built-in Agents
export { BUILTIN_AGENTS, ENGINEER_AGENT, REVIEWER_AGENT } from './builtin-agents';

// Launcher
export { launch, shutdown, readRuntimeState, writeRuntimeState, spawnSubAgent } from './launcher';

// CLI args parsing (v1.1.5 审-8：--mode <deploy|sustain> 纯函数，可单测)
export { parseSubagentRunArgs } from './cli-args';
export type { SubagentRunArgs } from './cli-args';

// Audit Sub Agent
export { readAuditHistory, analyzeCostBaseline, generateAuditReport } from './audit-sub-agent';

// LOOP Runner (v1.1.3 — 串行路径)
export { runLOOPIteration } from './loop-runner';
export type { LOOPResult, LOOPOptions } from './loop-runner';

// Tools & ToolGate (v1.1.9 / v1.2.0)
export { ENGINEER_TOOLS, REVIEWER_TOOLS, checkDangerousCommand, createToolGate, toolGate, wrapToolsWithGate, convertToLangGraphTools } from './tools';
export type { ToolGateOptions, ExecutableTool } from './tools';

// Graph (v1.1.3 — LangGraph StateGraph 节点级流转)
export {
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
export type {
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
export {
  FileCheckpointer,
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  type CheckpointRecord,
} from './graph';

// HITL Channel（v1.2.2 P3b · Storage-backed 异步人工确认）
export {
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
export {
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
export type {
  WorktreeHandle,
  CreateWorktreeOptions,
  WorktreeRegistryEntry,
  SweepOptions,
  SweepResult,
} from './worktree-isolation';

// Worktree Merge Gate（v1.2.3 · 审计合并卡关）
export { runMergeGate } from './worktree-merge-gate';
export type { MergeGateOptions, MergeGateResult, MergeGateStatus } from './worktree-merge-gate';

// v1.3.1 交付 3：并行编排（ParallelScheduler / 波次卡关 / MergeQueue）
export { ParallelScheduler } from './loop/parallel-scheduler';
export type {
  ParallelTask,
  ParallelTaskResult,
  ParallelWaveResult,
  ParallelSchedulerOptions,
} from './loop/parallel-scheduler';
export { runWaveMergeGate, isMergeGatePass } from './loop/merge-gate';
export type {
  WaveWorktree,
  WaveGateDecision,
  WaveGateOptions,
} from './loop/merge-gate';
export { MergeQueue } from './loop/merge-queue';
export type {
  MergeQueueItem,
  DuplicatePushPolicy,
} from './loop/merge-queue';

// v1.3.1 交付 4：Durable Execution（L1 checkpoint 续跑 + L2 工具幂等性）
export { CheckpointManager, DEFAULT_CHECKPOINT_RETENTION_DAYS } from './durable/checkpoint-manager';
export type { CheckpointManagerOptions, CheckpointFileInfo } from './durable/checkpoint-manager';
export {
  SideEffectLedger,
  sideEffectId,
  resolveSideEffectLedgerPath,
  SIDE_EFFECT_LEDGER_REL,
} from './durable/side-effect-ledger';
export type { SideEffectEntry } from './durable/side-effect-ledger';
export { shouldExecute, markExecuted } from './durable/idempotency-check';
export type { IdempotencyDecision } from './durable/idempotency-check';
export { resumePendingLoops, scanPendingCheckpoints, isPendingRecord } from './durable/resume';
export type {
  PendingCheckpointInfo,
  ResumeLoopsOptions,
  ResumeLoopsSummary,
} from './durable/resume';

// v1.3.1 交付 8：Onboard Agent L1（循环驱动 + L1 判定器）
export { runOnboardLoop, defaultDagRunner, defaultTraceFixer, appendLoopDebugRecord, readLoopDebugRecords, resolveLoopDebugLogPath } from './loop-agent/driver';
export type {
  OnboardDriverOptions,
  OnboardRound,
  OnboardRunOutcome,
  OnboardLoopResult,
  LoopDebugRecord,
  FixFeedback,
} from './loop-agent/driver';
export { judgeRunResult, DEFAULT_TIMEOUT_MS } from './loop-agent/judge';
export type {
  JudgeState,
  JudgeOptions,
  JudgeVerdict,
} from './loop-agent/judge';

// v1.3.2 交付 1-4：Onboard L2-L5（语义判定 / 自动定位 / 自动修复 / 循环收敛）
export { compareWithOntology, compareWithOntologySync } from './loop-agent/ontology-comparator';
export type { OntologyExpectedOutput, OntologyFieldExpectation, ComparatorOptions } from './loop-agent/ontology-comparator';
export { extractStructuredOutput } from './loop-agent/output-extractor';
export type { ExtractionResult, LlmExtractOptions } from './loop-agent/output-extractor';
export { emptyDiffReport, isDiffPass, hasErrorMismatch, summarizeDiff } from './loop-agent/diff-report';
export type { DiffReport, DiffMismatch } from './loop-agent/diff-report';
export { localizeError } from './loop-agent/error-localizer';
export type { LocalizationResult, ErrorSource, LocalizationContext, LlmLocalizerDeps } from './loop-agent/error-localizer';
export { applyFix } from './loop-agent/fix-applier';
export type { FixProposal, FixApplyResult, LlmFixerDeps, AuditGateDeps, FileOpsDeps } from './loop-agent/fix-applier';
export { DEFAULT_L5_CONFIG } from './loop-agent/driver';
export type { ConvergenceState, L5ConvergenceConfig } from './loop-agent/driver';

// v1.3.3 交付 T04：Refine Agent（质量循环——复用 loop-agent 引擎，换 L2 质量判据）
export { runRefineLoop, createRefineOnConvergedCallback } from './refine-agent/refine-driver';
export type { RefineDriverOptions, RefineLoopResult, RefineTriggerConfig, OnboardConvergedContext } from './refine-agent/refine-driver';
export { judgeQuality, qualityFeedbackText, QUALITY_TARGET_FIELDS } from './refine-agent/quality-judge';
export type { QualityJudgeOptions } from './refine-agent/quality-judge';
export {
  loadQualityRuleSet,
  builtinQualityRules,
  parseFdeDeliveryReport,
  fdeFeedbacksToRules,
  teamFeedbacksToRules,
  matchQualityRules,
  evaluateRule,
  summarizeQualityResults,
} from './refine-agent/quality-rule-set';
export type {
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
export { runOptimizationLoop } from './refine-agent/optimization-loop';
export type {
  OptimizationLoopOptions,
  OptimizationIteration,
  OptimizationLoopResult,
} from './refine-agent/optimization-loop';
export {
  readAgentVersion,
  writeAgentVersion,
  takeSnapshot,
  rollbackToSnapshot,
  advanceVersion,
  verifyVersionMonotonic,
  EXPERIENCE_LAYER_PATTERNS,
} from './refine-agent/snapshot-manager';
export type {
  AgentVersion,
  AgentVersionEntry,
} from './refine-agent/snapshot-manager';
export {
  checkContamination,
  assertNoContamination,
} from './refine-agent/contamination-guard';
export type {
  ContaminationCheckInput,
  ContaminationResult,
  ContaminationType,
} from './refine-agent/contamination-guard';
export { ContaminationError } from './refine-agent/contamination-guard';

// v1.3.2 交付 5：agent-creation（一句话需求 → 自动建节点）
export { deriveAgentFromRequirement } from './onboard/agent-creator';
export type { AgentCreationResult, DerivedAgentConfig } from './onboard/agent-creator';
export { validateAgentCreation, checkNoModelPersistence } from './onboard/creation-validator';
export type { ValidationResult } from './onboard/creation-validator';

// v1.3.2 交付 6：企业专属 eval 套件
export {
  instantiateEvalSuite,
  freezeEvalBaseline,
  runEvalSuite,
  loadIndustryTemplate,
} from './loop-agent/eval-suite';
export type {
  EnterpriseEvalSuite,
  EvalCase,
  Industry,
  EvalSuiteRunResult,
} from './loop-agent/eval-suite';

// v1.3.2 交付 7右半 + 10：FDE 梳理辅助 + Ontology 咨询式生成
export {
  classifyAutomation,
  validateFiveElements,
  deriveOntologyDraft,
} from './fde/compose-interview';
export type {
  FiveElements,
  ThreeQuestions,
  NodeInterview,
  ComposeSession,
  OntologyDraftResult,
  AutomationTag,
} from './fde/compose-interview';
export { generateWorkflowDraft, validateDraftDag } from './fde/workflow-draft';
export type { WorkflowDraft } from './fde/workflow-draft';
export {
  generateOntologyDraft,
  saveOntologyDraft,
  validateOntologyDraft,
} from './fde/ontology-draft';
export type { OntologyDraftJson } from './fde/ontology-draft';

// v1.3.2 交付 9：Session 级隔离（Builder vs Optimizer 分离）
export {
  createSessionWorkspace,
  runInIsolatedSession,
  handoffSessionData,
} from './session-isolator';
export type {
  SessionType,
  SessionIsolatorConfig,
  SessionRunResult,
} from './session-isolator';

// v1.3.2 交付 11：LLM Trace 任务级轨迹视图
export {
  aggregateTrajectory,
  exportTrajectoryJson,
  exportTrajectoryForRL,
} from './trace/trajectory';
export type {
  TaskTrajectory,
  TrajectoryStep,
  TrajectoryOptions,
} from './trace/trajectory';

// v1.3.1 交付 9：Benchmark 评测体系（题库设计 / 隔离评测 / HMAC 链日志）
export {
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
export type {
  BenchmarkDefinition,
  BenchmarkCase,
  CalibrationRecord,
  CreateBenchmarkOptions,
  Difficulty,
  ParsedBenchmarkConfig,
} from './benchmark/benchmark-designer';
export { evaluateCase, defaultScoringFn, DEFAULT_EVALUATE_TIMEOUT_MS } from './benchmark/case-evaluator';
export type {
  EvaluateCaseInput,
  AgentExecutionContext,
  CaseEvaluation,
  EvaluationFailureCode,
} from './benchmark/case-evaluator';
export {
  appendEvaluationRecord,
  readEvaluationLog,
  verifyEvaluationChain,
  getEvaluationLogPath,
} from './benchmark/evaluation-log';
export type {
  EvaluationLogInput,
  EvaluationLogRecord,
} from './benchmark/evaluation-log';

// Conflict Resolver（v1.2.3 · merge 文本冲突仲裁）
export {
  resolveWorktreeConflict,
  fileInScope,
  appendConflictRecord,
  readConflictRecords,
  resolveConflictsPath,
  WORKTREE_CONFLICTS_REL,
} from './conflict-resolver';
export type {
  ConflictParty,
  MergeConflictInput,
  ConflictResolution,
  ConflictRecord,
  ConflictFileVerdict,
  ConflictWinner,
  ConflictRule,
} from './conflict-resolver';

// Orchestrator Compare
export { scanLogFiles, extractMetrics, generateReport, promoteWorkflow } from './orchestrator-compare';
export type { Metric } from './orchestrator-compare';

// A/B History（真实任务指标 jsonl 持久化 · v1.1.8 新增）
export {
  appendMetrics,
  aggregateRecent,
  truncateToLastK,
  readAll,
  HISTORY_MAX_ENTRIES,
} from './ab-history';
export type { PlanMetrics, AggregateMetrics } from './ab-history';

// A/B Scheduler（daemon cron 探索-利用状态机 · v1.1.8 新增）
export {
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
export type {
  ABSchedulerState,
  ABScheduleConfig,
  ABSchedulerDeps,
  ABPhase,
  RunOutcome,
} from './ab-scheduler';

// Activate（激活链 Phase 1 · v1.2.5 新增）
export { activateWorkflow, resolveTools, extractSkillBody, assembleSystemPrompt } from './activate';
export type { EnterpriseAgentConfig, ActivateResult, ActivateOptions } from './activate';

// ModelRouter（v1.2.2 · P1 混合模型路由层）
export { ModelRouter, createDefaultRouter, LOCAL_UNAVAILABLE_MSG } from './model-router';
export type { ModelRoute, TaskContext, TaskComplexity, Sensitivity, RouteTarget, RouteReason, ModelRouterDeps } from './model-router';
export { loadModelRouterConfig, resolveRouterConfigPath, DEFAULT_ROUTER_CONFIG, ModelRouterConfigError, ModelRouterConfigSchema } from './model-router-config';
export type { ModelRouterConfig, FallbackPolicy } from './model-router-config';

// Loop State Extractor（checkpoint → ControlGraphState 翻译 · v1.1.8 新增）
export {
  extractControlGraphState,
  writeControlGraphState,
  splitWaves,
  mapNodeStates,
  buildEvidenceChain,
  CONTROL_GRAPH_SCHEMA_VERSION,
} from './loop-state-extractor';
export type {
  ControlGraphState,
  WaveState,
  NodeState,
  Evidence,
  WaveTrigger,
} from './loop-state-extractor';

// v1.3.4 交付 1+4：L3 组织能力公地（发布→发现 + SkillScan 安全门）
export { publishCapability, validateMetadata, scanSkillSafetyStub } from './commons/publisher';
export type { CapabilityKind, CapabilityMetadata, PublishResult } from './commons/publisher';
export {
  readCatalog,
  searchCatalog,
  searchByTag,
  searchByKind,
  getCapability,
} from './commons/catalog';
export type { CatalogEntry, CatalogSearchResult } from './commons/catalog';
export { scanForPublish, scanForInstall, mapSafetyResult } from './commons/skill-scan';
export type { ScanResult, ScanVerdict } from './commons/skill-scan';
// v1.3.4 交付 2：调用与评价
export { invokeCapability, readInvokeLog } from './commons/invoker';
export type { InvokeInput, InvokeResult, InvokeOutcome, CapabilityExecutor, InvokeLogEntry } from './commons/invoker';
export {
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
export type { RatingRecord, AggregatedRating } from './commons/rating';
// v1.3.4 交付 3：养护环（owner + 退役）
export {
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
export type { OwnerRecord } from './commons/owner';
export {
  markRetired,
  restoreCapability,
  getCapabilityStatus,
  scanRetireCandidates,
  LOW_INVOKE_THRESHOLD,
  LOW_RATING_THRESHOLD,
} from './commons/retire';
export type { RetireReason, RetireCandidate } from './commons/retire';
// v1.3.4 交付 5：评估体系三步
export {
  harvestRules,
  collectLowScoreRatings,
  collectRepeatFailCases,
  harvestFromLowScore,
  harvestFromRepeatFail,
  harvestFromCaseTexts,
  LOW_SCORE_THRESHOLD,
  REPEAT_FAIL_THRESHOLD,
} from './commons/rule-harvest';
export type { HarvestInput, HarvestResult } from './commons/rule-harvest';
export {
  juryRules,
  benchmarkRule,
  requestBusinessApproval,
  SCORE_DELTA_THRESHOLD,
} from './commons/rule-jury';
export type { JuryInput, JuryResult, RuleBenchmarkResult } from './commons/rule-jury';
export {
  promoteRules,
  promoteRule,
  isAlreadyBuiltin,
} from './commons/rule-promote';
export type { PromoteInput, PromoteResult } from './commons/rule-promote';

// v1.3.4 增量：编排层与执行层分离
export {
  createExecutionBackend,
} from './execution-backend';
export type {
  ExecutionBackend,
  ExecutionTask,
  ExecutionResult,
} from './execution-backend';

// v1.3.5 交付 3：instinct→skill 自动进化（提取/评分/聚合/错题本）
export {
  extractInstincts,
  parseThinkSections,
  normalizePattern,
  patternId,
} from './instinct/extractor';
export type { InstinctItem, ExtractOptions } from './instinct/extractor';
export {
  scoreInstinct,
  scoreInstincts,
  selectForInjection,
  renderInjectionBlock,
  DEFAULT_CONFIDENCE_THRESHOLD,
  OCCURRENCE_SATURATION,
} from './instinct/scorer';
export type { ScoredInstinct } from './instinct/scorer';
export {
  evolveInstincts,
  resolveCustomSkillDir,
} from './instinct/evolver';
export type { EvolveOptions, EvolveResult, EvolvedSkill } from './instinct/evolver';
export {
  appendFailure,
  readFailureLog,
  aggregateFailurePatterns,
  failureLogPath,
} from './instinct/failure-log';
export type { FailureLogEntry } from './instinct/failure-log';

// v1.3.5 交付 5 #2：FDE 进场记忆工程化（session-stop 捕获 + session-start 恢复）
export {
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
export type { FDESessionContext, FDESessionMeta } from './fde-session';

// v1.3.5 交付 5 #4：FDE 节点注册表（yaml schema 解析——daemon 消费方经本出口 import）
export {
  parseFDERegistry,
  loadFDERegistry,
  filterByCadence,
  highRiskNodes,
} from './fde-registry';
export type {
  FDECadence,
  FDERisk,
  FDERegistryNode,
  FDERegistryParseResult,
} from './fde-registry';
