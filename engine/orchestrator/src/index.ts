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
export type { WorkflowNode, ParsedWorkflow, SubAgentConfig } from './workflow-parser';

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
