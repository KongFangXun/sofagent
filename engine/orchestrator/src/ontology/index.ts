// ============================================================
// ontology/index.ts · Ontology 运行时层目录入口（v1.3.1 交付 1）
//
// 统一导出 Action 注册表 / 执行前校验器 / Schema 校验 / 内核契约。
// 注意：本目录是 engine/orchestrator 内的「运行时层」，
// 与独立包 engine/ontology（merge-engine/ontology-view）职责不同、互不冲突——
// 本层复用 @sofagent/ontology 的 OntologyObject/OntologyAction 类型（不重定义）。
// ============================================================

export { ActionRegistry, globalActionRegistry } from './action-registry';
export type { ActionRegistration } from './action-registry';

export { validateToolCall, createOntologyValidator } from './validator';
export type { OntologyVerdict, OntologyVerdictStatus, OntologyValidatorOptions, OntologyValidator } from './validator';

export {
  ENTITY_SCHEMA,
  CONCEPT_SCHEMA,
  RELATIONS_SCHEMA,
  validateAgainstSchema,
} from './schema';
export type { JsonSchema, SchemaValidationResult } from './schema';

export {
  CORE_CONTRACTS,
  registerStateMachine,
  getStateMachine,
  clearStateMachineRegistry,
} from './contracts';
export type {
  CoreContract,
  ContractMeta,
  RelationDirection,
  RelationCardinality,
  StateMachineContract,
} from './contracts';
