// ============================================================
// domain/watch.ts · 监听与快照域（文件监听 / 文件系统审计 / 工作区变更摘要 / 快照）——域级 barrel（v1.5.8 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/watch），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/watch"。
// ============================================================
/* @public */ export { startWatching } from '../fs-watch';
/* @public */ export type { ChangeCallback, FileWatcher } from '../fs-watch';
/* @public */ export { runFilesystemAudit } from '../run-fs-audit';
/* @public */ export { createPostAuditSnapshot, listAllSnapshots, restoreSnapshot } from '../snapshot';
/* @public */ export type { SnapshotInfo } from '../snapshot';
/* @public */ export {
  runWorkspaceSummary,
  collectWorkspaceChanges,
  appendWorkspaceChange,
  readWorkspaceChanges,
  readLatestCheckpointId,
  resolveWorkspaceChangesPath,
  WORKSPACE_CHANGES_MAX_ENTRIES,
} from '../workspace-summary';
/* @public */ export type { WorkspaceChangeRecord, WorkspaceSummaryOptions } from '../workspace-summary';
