// ============================================================
// domain/loop-agent.ts · 执行 Agent 域（loop/loop-agent/durable/execution-*/tools/harness-sdk/meta-harness/worktree 隔离）——域级 barrel（v1.5.7 F32）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/orchestrator/domain/loop-agent），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/loop-agent"。
// ============================================================
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
} from '../harness-sdk';
/* @public */ export type {
  GraphBuilder,
  ApprovalMode,
  HarnessWrapOptions,
  HarnessToolCallEvent,
  HarnessApprovalEvent,
  WrappableAgent,
  WrappedAgent,
  SandboxHandle,
} from '../harness-sdk';
/* @public */ export { loadDefinition, listAgents } from '../registry';
/* @public */ export type { SubAgentDefinition } from '../registry';
/* @public */ export { readAuditHistory, analyzeCostBaseline, generateAuditReport } from '../audit-sub-agent';
/* @public */ export { ENGINEER_TOOLS, REVIEWER_TOOLS, checkDangerousCommand, createToolGate, toolGate, wrapToolsWithGate, convertToLangGraphTools } from '../tools';
/* @public */ export type { ToolGateOptions, ExecutableTool } from '../tools';
/* @public */ export { loadLoopGraphRuntime } from '../loop';
/* @public */ export {
  getSchema,
  listNodeKinds,
  initialState as initialNodeState,
  applyPatch,
  step as executionStep,
  resolveExecutionMode,
  shouldAutoDegrade,
  estimateTokens,
  digestToAuditLine,
  setAuditSink as setExecutionAuditSink,
  emitAuditDigest,
  fileSink as statefulMetricsFileSink,
  // v1.5.5 阶段三 F23：LangGraph 动态加载统一入口对根导出面开放（ab-runner 等
  // 包内消费方经 '@sofagent/orchestrator' 根导入——包 exports 无深子路径，深路径
  // import 会被 exports map 拦 ERR_PACKAGE_PATH_NOT_EXPORTED）
  dynamicLangGraph,
  LANGGRAPH_MISSING_GUIDE,
  isModuleMissing,
} from '../execution-state';
/* @public */ export type {
  NodeKind,
  FieldSpec,
  NodeStateSchema,
  StatePatch,
  StepOutput,
  PatchResult,
  AuditDigest,
  StatefulMetricRecord,
  MetricsSink,
  AuditLine,
} from '../execution-state';
/* @public */ export {
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
} from '../loop';
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
} from '../loop';
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
} from '../worktree-isolation';
/* @public */ export type {
  WorktreeHandle,
  CreateWorktreeOptions,
  WorktreeRegistryEntry,
  SweepOptions,
  SweepResult,
} from '../worktree-isolation';
/* @public */ export { runMergeGate } from '../worktree-merge-gate';
/* @public */ export type { MergeGateOptions, MergeGateResult, MergeGateStatus } from '../worktree-merge-gate';
/* @public */ export { ParallelScheduler } from '../loop/parallel-scheduler';
/* @public */ export type {
  ParallelTask,
  ParallelTaskResult,
  ParallelWaveResult,
  ParallelSchedulerOptions,
} from '../loop/parallel-scheduler';
/* @public */ export { runWaveMergeGate, isMergeGatePass } from '../loop/merge-gate';
/* @public */ export type {
  WaveWorktree,
  WaveGateDecision,
  WaveGateOptions,
} from '../loop/merge-gate';
/* @public */ export { MergeQueue } from '../loop/merge-queue';
/* @public */ export type {
  MergeQueueItem,
  DuplicatePushPolicy,
} from '../loop/merge-queue';
/* @public */ export { CheckpointManager, DEFAULT_CHECKPOINT_RETENTION_DAYS } from '../durable/checkpoint-manager';
/* @public */ export type { CheckpointManagerOptions, CheckpointFileInfo } from '../durable/checkpoint-manager';
/* @public */ export {
  SideEffectLedger,
  sideEffectId,
  resolveSideEffectLedgerPath,
  SIDE_EFFECT_LEDGER_REL,
} from '../durable/side-effect-ledger';
/* @public */ export type { SideEffectEntry } from '../durable/side-effect-ledger';
/* @public */ export { shouldExecute, markExecuted } from '../durable/idempotency-check';
/* @public */ export type { IdempotencyDecision } from '../durable/idempotency-check';
/* @public */ export { resumePendingLoops, scanPendingCheckpoints, isPendingRecord } from '../durable/resume';
/* @public */ export type {
  PendingCheckpointInfo,
  ResumeLoopsOptions,
  ResumeLoopsSummary,
} from '../durable/resume';
/* @public */ export { WalWriter, newTaskId, WAL_REL_PATH } from '../durable/wal-writer';
/* @public */ export type { WalRecord, WalRecordType, SideEffectSpec } from '../durable/wal-writer';
/* @public */ export {
  UndoRegistry,
  createUndoRegistry,
  gitRestore,
  deleteWrittenFile,
} from '../durable/undo-registry';
/* @public */ export type { UndoTier, UndoResult, UndoFn, WarnHook } from '../durable/undo-registry';
/* @public */ export { scanWAL, recoverWAL } from '../durable/wal-recovery';
/* @public */ export type {
  WalTrx,
  WalTrxState,
  WalScanResult,
  WalRecoveryResult,
  ReExecuteFn,
  RecoverWarnFn,
} from '../durable/wal-recovery';
/* @public */ export { runOnboardLoop, defaultDagRunner, defaultTraceFixer, appendLoopDebugRecord, readLoopDebugRecords, resolveLoopDebugLogPath } from '../loop-agent/driver';
/* @public */ export type {
  OnboardDriverOptions,
  OnboardRound,
  OnboardRunOutcome,
  OnboardLoopResult,
  LoopDebugRecord,
  FixFeedback,
} from '../loop-agent/driver';
/* @public */ export { judgeRunResult, DEFAULT_TIMEOUT_MS } from '../loop-agent/judge';
/* @public */ export type {
  JudgeState,
  JudgeOptions,
  JudgeVerdict,
} from '../loop-agent/judge';
/* @public */ export { compareWithOntology, compareWithOntologySync } from '../loop-agent/ontology-comparator';
/* @public */ export type { OntologyExpectedOutput, OntologyFieldExpectation, ComparatorOptions } from '../loop-agent/ontology-comparator';
/* @public */ export { extractStructuredOutput } from '../loop-agent/output-extractor';
/* @public */ export type { ExtractionResult, LlmExtractOptions } from '../loop-agent/output-extractor';
/* @public */ export { emptyDiffReport, isDiffPass, hasErrorMismatch, summarizeDiff } from '../loop-agent/diff-report';
/* @public */ export type { DiffReport, DiffMismatch } from '../loop-agent/diff-report';
/* @public */ export { localizeError } from '../loop-agent/error-localizer';
/* @public */ export type { LocalizationResult, ErrorSource, LocalizationContext, LlmLocalizerDeps, LocalizerDegradeInfo } from '../loop-agent/error-localizer';
/* @public */ export { applyFix } from '../loop-agent/fix-applier';
/* @public */ export type { FixProposal, FixApplyResult, LlmFixerDeps, AuditGateDeps, FileOpsDeps } from '../loop-agent/fix-applier';
/* @public */ export { DEFAULT_L5_CONFIG } from '../loop-agent/driver';
/* @public */ export type { ConvergenceState, L5ConvergenceConfig } from '../loop-agent/driver';
/* @public */ export {
  instantiateEvalSuite,
  freezeEvalBaseline,
  runEvalSuite,
  loadIndustryTemplate,
} from '../loop-agent/eval-suite';
/* @public */ export type {
  EnterpriseEvalSuite,
  EvalCase,
  Industry,
  EvalSuiteRunResult,
} from '../loop-agent/eval-suite';
/* @public */ export {
  createSessionWorkspace,
  runInIsolatedSession,
  handoffSessionData,
} from '../session-isolator';
/* @public */ export type {
  SessionType,
  SessionIsolatorConfig,
  SessionRunResult,
} from '../session-isolator';
/* @public */ export {
  createDshBackend,
  convertTools,
  createBudgetGuard,
  createBudgetPlugin,
  ToolBudgetExhaustedError,
  DshCapabilityMissingError,
} from '../execution-backends/dsh-backend';
/* @public */ export type {
  CordisPlugin,
  CordisRuntime,
  CordisModule,
  CordisToolDefinition,
  BudgetGuard,
  BudgetVerdict,
  RunCordisAgentOptions,
} from '../execution-backends/dsh-backend';
/* @public */ export { createTrajectoryCollector } from '../execution-backends/trajectory';
/* @public */ export type { TrajectoryRecord, TrajectoryCollector } from '../execution-backends/trajectory';
/* @public */ export {
  MetaHarness,
  PolicyLayer,
  AuditAggregator,
  fileLockPolicy,
  concurrencyCapPolicy,
  profileAllowlistPolicy,
  sensitiveToolPolicy,
} from '../meta-harness';
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
} from '../meta-harness';
