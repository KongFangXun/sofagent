// ============================================================
// domain/scheduler.ts · 调度域（cron / 定时任务 / 长任务自治 / 训练产物归档）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/scheduler），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/scheduler"。
// ============================================================
/* @public */ export { startCron, loadTrainArchiveCronConfig } from '../cron';
/* @public */ export type { CronJob } from '../cron';
/* @public */ export {
  DEFAULT_TRAIN_ARCHIVE_CONFIG,
  loadTrainArchiveConfig,
  runTrainArchiveTask,
} from '../tasks/train-archive';
/* @public */ export type { TrainArchiveConfig, TrainArchiveTaskResult } from '../tasks/train-archive';
/* @public */ export { createScheduler, nextCronTime, expandCronSugar } from '../scheduler';
/* @public */ export type { ScheduleType, ScheduledTask, TaskRun, CronSugar } from '../scheduler';
/* @public */ export {
  createLongTaskScheduler,
  expandScheduleMacro,
  isCronMacro,
  loadLongTaskRegistry,
  saveLongTaskRegistry,
  longTasksRegistryPath,
  readUnfinishedWalEntries,
  trackNoProgress,
  appendLongTaskWarning,
  DEFAULT_MAX_NO_CHANGE_RUNS,
} from '../long-tasks';
/* @public */ export type {
  CronMacro,
  LongTaskRunStatus,
  LongTaskRun,
  LongTaskSpec,
  LongTaskRegistry,
  CrashRecoveryEvent,
  LongTaskWarning,
  LongTaskRunner,
  CrashRecoveryCallback,
} from '../long-tasks';
