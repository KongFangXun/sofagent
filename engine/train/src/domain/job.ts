// ============================================================
// domain/job.ts · 作业生命周期域（协议 / 预算 / 状态机 / 调度 / 执行器 / GPU 队列 / 进程守护 / 崩溃恢复）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/train/domain/job），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/job"。
// ============================================================
/* @public */ export {
  TrainBudgetSchema,
  TrainJobSchema,
  validateTrainJob,
  buildTrainSpawnArgs,
  parseTrainEvent,
  parseTrainEventStream,
  createSignalController,
} from '../train-protocol';
/* @public */ export type {
  TrainBudget,
  TrainJob,
  TrainJobValidation,
  TrainEvent,
  TrainEventParseResult,
  SignalAction,
  SignalController,
  SignalControllerOptions,
} from '../train-protocol';
/* @public */ export {
  checkBudget,
  createTrainBudgetMonitor,
  buildBudgetReport,
  trainJobsPath,
  loadTrainJobs,
  saveTrainJobs,
  upsertTrainJob,
  findTrainJob,
  emitBudgetExceededAudit,
} from '../train-budget';
/* @public */ export type {
  TrainUsage,
  BudgetViolation,
  BudgetCheckResult,
  BudgetPause,
  BudgetHumanDecision,
  TrainBudgetMonitor,
  TrainBudgetReport,
  TrainJobState,
} from '../train-budget';
/* @public */ export {
  TRAIN_JOB_STATUSES,
  TRAIN_JOB_TRANSITIONS,
  canTransition,
  isTerminalStatus,
  trainJobDir,
  trainJobFilePaths,
  generateTrainJobId,
  loadTrainJobRecord,
  saveTrainJobRecord,
  listTrainJobRecords,
  createTrainJob,
  applyTrainJobTransition,
  transitionTrainJob,
  appendTrainEventLine,
  readTrainEvents,
  // v1.4.3 第一章：受守卫查询（MCP train_status/train_list 消费——企业隔离面）
  getJobGuarded,
  readTrainEventsGuarded,
  listJobsGuarded,
} from '../train-job';
/* @public */ export type {
  TrainJobStatus,
  TrainJobCheckpoint,
  TrainJobRecord,
  CreateTrainJobInput,
  CreateTrainJobResult,
  TrainJobTransitionPatch,
} from '../train-job';
/* @public */ export {
  createTrainScheduler,
  getTrainJobRecord,
  getTrainProgress,
} from '../train-scheduler';
/* @public */ export type {
  RegisterHeartbeat,
  SpawnFn,
  TrainSchedulerOptions,
  SubmitTrainJobInput,
  SubmitTrainJobResult,
  TrainRunHandle,
  TrainMonitorSnapshot,
  CancelTrainJobResult,
  ResumeTrainJobResult,
  ResumeTrainJobOutcome,
} from '../train-scheduler';
/* @public */ export { createLocalSpawnExecutor } from '../train-executor';
/* @public */ export type {
  TrainExecutor,
  TrainExecutorHooks,
  SpawnFn as ExecutorSpawnFn,
  ChildProcess as TrainChildProcess,
} from '../train-executor';
/* @public */ export {
  createGpuQueue,
  estimateTrainVramMiB,
} from '../gpu-queue';
/* @public */ export type {
  GpuQueueEntry,
  GpuRunningEntry,
  GpuQueueSnapshot,
  GpuSlotRelease,
  GpuQueueOptions,
  GpuQueue,
} from '../gpu-queue';
/* @public */ export {
  createProcessGuard,
  snapshotGpuMemory,
  killProcessGroup,
  abnormalReclaim,
  cleanupTmpFiles,
  emitTrainAbnormalExit,
  detectTrainOrphans,
} from '../process-guard';
/* @public */ export type {
  ProcessGuard,
  ProcessGuardOptions,
  KillFn,
  ExecFn,
  NowFn,
  StalledProcess,
  GpuMemorySnapshot,
  ReclaimTarget,
  ReclaimStep,
  ReclaimResult,
  ReclaimOptions,
  ProcessInfo,
  OrphanProcess,
  OrphanDetectOptions,
} from '../process-guard';
/* @public */ export {
  runCrashRecoveryScan,
  appendEngineCrashLog,
  readEngineCrashLog,
  engineCrashLogPath,
  applyRecoveryDecision,
  TRAIN_RECOVERY_DECISIONS,
  checkpointManifestPath,
  loadCheckpointManifest,
  recordCheckpointEntry,
} from '../crash-recovery';
/* @public */ export type {
  ProbeFn,
  CrashRecoveryFinding,
  CrashRecoveryScanResult,
  TrainRecoveryDecision,
  RecoveryDecisionResult,
  EngineCrashLogEntry,
  CheckpointManifest,
  CheckpointManifestEntry,
} from '../crash-recovery';
