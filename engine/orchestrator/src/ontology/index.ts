// ============================================================
// ontology/index.ts · Ontology 运行时层目录入口（v1.3.7 交付 1）
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

// 标准注入管线（v1.3.6 交付 ②——外部 ontology 进约束层的唯一通道）
export {
  validateOntologyPayload,
  importOntology,
  RELATION_KEYS,
  ONTOLOGY_IMPORT_DSH_MAPPING,
} from './import-pipeline';
export type {
  EntityImport,
  ConceptImport,
  RelationImport,
  OntologyImportPayload,
  OntologyValidationResult,
  OntologyImportResult,
  OntologyImportOptions,
  RelationKey,
} from './import-pipeline';

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
