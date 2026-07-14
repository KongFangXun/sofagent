/**
 * @sofagent/daemon
 *
 * 守护进程 — 持续审计 / 文件监听 / 自动修复循环
 */

// Cron
export { startCron } from './cron';
export type { CronJob } from './cron';

// File Watcher
export { startWatching } from './fs-watch';
export type { ChangeCallback, FileWatcher } from './fs-watch';

// Filesystem Audit
export { runFilesystemAudit } from './run-fs-audit';

// Snapshot
export { createPostAuditSnapshot, listAllSnapshots, restoreSnapshot } from './snapshot';
export type { SnapshotInfo } from './snapshot';
