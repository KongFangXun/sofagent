// ============================================================
// graph/index.ts · graph 模块 barrel export
// v1.3.6 重构：FORGE 相关代码已移至 FORGE/ 目录
// 本目录仅保留共享的 checkpoint 基础设施（被 daemon 和 FORGE 共用）
// ============================================================

// Checkpoint（共享基础设施）
export {
  FileCheckpointer,
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  type CheckpointRecord,
} from './checkpoint';
