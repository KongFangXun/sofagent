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

// LOOP Runner (v1.1.2)
export { runLOOPIteration } from './loop-runner';
export type { LOOPResult, LOOPOptions } from './loop-runner';

// Orchestrator Compare
export { scanLogFiles, extractMetrics, generateReport, promoteWorkflow } from './orchestrator-compare';
export type { Metric } from './orchestrator-compare';
