// ============================================================
// snapshot.ts · 快照与恢复（re-export from @sofagent/core）
// v1.4.1 迁移至 @sofagent/daemon → v1.2.0 核心函数已迁入 @sofagent/core
//
// 本文件保留向后兼容的 re-export。新代码请直接从 @sofagent/core 导入。
// ============================================================

export {
  createPostAuditSnapshot,
  listAllSnapshots,
  restoreSnapshot,
} from '@sofagent/core';
export type { SnapshotInfo } from '@sofagent/core';
