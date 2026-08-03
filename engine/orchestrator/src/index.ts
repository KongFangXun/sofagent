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
