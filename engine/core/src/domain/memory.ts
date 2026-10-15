// ============================================================
// domain/memory.ts · 记忆与快照域（记忆存储与契约 / 内存压缩 / 内存同步 / shadow 快照 / 数据变更）——域级 barrel（v1.6.0 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/core/domain/memory），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/memory"。
// ============================================================
/* @public */ export {
  archiveOldEntries,
  rotateBackups,
  extractSummary,
} from '../compress-memory';
/* @public */ export { createMemoryStore, resolveMemoryScope, MEMORY_DIR_FILE_WARN } from '../memory-store';
/* @public */ export type { MemoryFact } from '../memory-store';
/* @public */ export {
  THINK_MD_FILENAME,
  THINK_MD_LAYER,
  KNOWLEDGE_DIR_LAYER,
  getThinkPath,
  appendThinkEntry,
  DEFAULT_SENSITIVITY,
  resolveSensitivity,
  isSensitivityVisible,
  DEFAULT_TRUST,
  TRUST_ORDER,
  resolveTrust,
} from '../memory-contract';
/* @public */ export type { MemoryLayer, Sensitivity, Trust } from '../memory-contract';
/* @public */ export {
  type DataChange,
  type DataViolation,
  type DataAuditResult,
  diffDataChange,
  runDataRules,
} from '../data-diff';
/* @public */ export { getPersonaContent, syncPersona } from '../filesystem/memory-sync';
/* @public */ export {
  createShadowRepo,
  commitSnapshot,
  revertToSnapshot,
  listSnapshots,
  findSnapshotByLabel,
  hasShadowRepo,
} from '../filesystem/isomorphic-git';
/* @public */ export type { SnapshotEntry, IsoDiff } from '../filesystem/isomorphic-git';
/* @public */ export {
  createPostAuditSnapshot,
  listAllSnapshots,
  restoreSnapshot,
} from '../snapshot-helpers';
/* @public */ export type { SnapshotInfo } from '../snapshot-helpers';

// ── v1.5.9 章一·自进化写面审计覆盖（域＝记忆与快照域：写面留痕落在 memory 面）────
// 同 config.ts 的说明：根 barrel 新增后须同步分拣到本域，勿两面漂移。
/* @internal */ export {
  setWriteSurfaceTracer,
  getWriteSurfaceTracer,
  guardWriteSurface,
  emitWriteSurfaceTrace,
  WriteSurfaceUntracedError,
  diffLoadChainFields,
  captureLoadChainWrite,
} from '../loadchain-write-hook';
