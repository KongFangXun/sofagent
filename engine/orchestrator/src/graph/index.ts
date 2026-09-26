// ============================================================
// graph/index.ts · graph 模块 barrel export
// v1.5.3 重构：FORGE 相关代码已移至 FORGE/ 目录
// 本目录仅保留共享的 checkpoint 基础设施（被 daemon 和 FORGE 共用）
// v1.5.0 第三章：新增 Validation Engine（activate 前置门）
// ============================================================

// Checkpoint（共享基础设施）
export {
  FileCheckpointer,
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  type CheckpointRecord,
} from './checkpoint';

// Validation Engine（v1.5.0 第三章：DAG 无环 + schema 兼容 + fail-closed 前置门）
export {
  validateDag,
  validateSchemaCompat,
  validateForActivation,
  type NodeLike,
  type EntityLike,
  type ValidationIssue,
  type ValidationResult,
} from './validator';
