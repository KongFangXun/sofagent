/**
 * @sofagent/orchestrator
 *
 * 编排引擎 — 多 Agent 协作 / 工作流调度 / prompt 模板
 */

// Composer
export { composeWithDeepAgents } from './composer';

// Registry & Definitions
export { loadDefinition, listAgents } from './registry';
export type { SubAgentDefinition } from './registry';

// Built-in Agents
export { BUILTIN_AGENTS, ENGINEER_AGENT, REVIEWER_AGENT } from './builtin-agents';

// Launcher
export { launch, shutdown, readRuntimeState, writeRuntimeState, spawnSubAgent } from './launcher';

// Audit Sub Agent
export { readAuditHistory, analyzeCostBaseline, generateAuditReport } from './audit-sub-agent';

// LOOP Runner (v1.1.3 — DeepAgents 串行路径)
export { runLOOPIteration } from './loop-runner';
export type { LOOPResult, LOOPOptions } from './loop-runner';

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
  FileCheckpointer,
  defaultDeps,
  makeEngineerNode,
  makeAuditNode,
  makeReviewerNode,
  makeHumanConfirmNode,
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  DEFAULT_MAX_RETRIES,
} from './graph';
export type {
  LoopGraphState,
  LoopArtifacts,
  LoopNodeName,
  LoopFinalStatus,
  AuditVerdict,
  CheckpointRecord,
  LoopGraphDeps,
  AuditOutcome,
  HumanDecision,
  LoopGraphResult,
  LoopGraphOptions,
} from './graph';

// Orchestrator Compare
export { scanLogFiles, extractMetrics, generateReport, promoteWorkflow } from './orchestrator-compare';
export type { Metric } from './orchestrator-compare';

// LOOP Workflow（v1.1.4）——消费外部编排平台产出的 YAML
export { loadWorkflow, runLoopWorkflow } from './LOOP';
export type {
  Workflow,
  WorkflowNode,
  WorkflowOptions,
  WorkflowStrategy,
  WorkflowResult,
} from './LOOP';
