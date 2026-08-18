// ============================================================
// permission/index.ts · 场景驱动权限体系统一入口
// v1.3.7 交付② 新增
// ============================================================

export { createScenarioRouter, BUILTIN_SCENARIOS } from './scenario-router';
export type { Scenario, ScenarioMatchRequest, ScenarioMatchResult, TaskType, DataDomain, ActionType } from './scenario-router';
export { classifyRisk, riskToDefaultAction } from './risk-classifier';
export type { RiskLevel } from './risk-classifier';
export { createPolicyEngine } from './policy-engine';
export type { PermissionRequest, PolicyAction, DecisionLogEntry, ElevationGrant, TeamPolicy, CommonsPolicy } from './policy-engine';
