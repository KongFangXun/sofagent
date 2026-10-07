// ============================================================
// domain/runtime.ts · 运行环境与防护域（环境探测 / 隔离 / 清理 / 安全基线 / 沙箱 / 环境管理 / 多卡启动）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/train/domain/runtime），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/runtime"。
// ============================================================
/* @public */ export {
  parseCudaVersion,
  parseGpuQueryCsv,
  parseMetalInfo,
  detectCudaGpu,
  detectMetalGpu,
  defaultMlxInstallDir,
  prepareTrainEnv,
  DEFAULT_CUDA_FRAMEWORK,
  DEFAULT_MLX_FRAMEWORK,
} from '../train-env';
/* @public */ export type {
  ExecResult,
  ExecFn as TrainEnvExecFn,
  TrainEnvDeps,
  GpuInfo,
  TrainEnvReport,
} from '../train-env';
/* @public */ export {
  checkEnterpriseAccess,
  assertEnterpriseAccess,
  isSafePathSegment,
  assertSafePathSegment,
  isPathInside,
  resolveEnterpriseDir,
  EnterpriseAccessDeniedError,
} from '../isolation-guard';
/* @public */ export type {
  EnterpriseAccessErrorCode,
  EnterpriseAccessError,
  EnterpriseAccessDecision,
  GuardedRead,
} from '../isolation-guard';
/* @public */ export {
  wipeFile,
  wipeDirectoryContents,
  cleanupEnterpriseTrainData,
} from '../cleanup';
/* @public */ export type {
  FileCleanupResult,
  SkippedItem,
  DirObfuscation,
  CleanupReport,
  CleanupOptions,
} from '../cleanup';
/* @public */ export {
  validateTrainPath,
  TrainPathSchema,
  containsShellMetachars,
  sanitizeHyperparamsForSpawn,
  isCredentialKey,
  maskCredentials,
  runSandboxSelfCheck,
} from '../security-baseline';
/* @public */ export type {
  TrainPathRejectionCode,
  TrainPathValidation,
  SanitizedValue,
  HyperparamsSanitizeResult,
} from '../security-baseline';
/* @public */ export {
  makeDefaultExecFn,
} from '../train-env';
/* @public */ export {
  TRAIN_ENV_MANIFEST_FILE,
  trainEnvManifestPath,
  trainDoctor,
  DEFAULT_BASE_MODEL_CANDIDATES,
} from '../env-manager';
/* @public */ export type {
  TrainEnvManifest,
  EnvCheckStep,
  EnvManagerDeps,
  TrainDoctorReport,
  ModelCacheEntry,
} from '../env-manager';
/* @public */ export {
  // v1.4.3 第八章：训练环境反作弊基线（reward hacking 四形态双防线）
  DEFAULT_NETWORK_ALLOWLIST,
  DEFAULT_ANTICHEAT_CONFIG,
  loadAnticheatConfig,
  stripDatasetGitOnMount,
  buildGitDisabledEnv,
  createTrainNetworkGate,
  checkAnticheatBaseline,
} from '../env-manager';
/* @public */ export type {
  AnticheatConfig,
  DatasetMountSource,
  AnticheatCheckResult,
} from '../env-manager';
/* @public */ export {
  createTrainSandbox,
  createTrainPathGuard,
  trainSandboxOutputDir,
} from '../train-sandbox';
/* @public */ export type {
  TrainSandboxOptions,
  TrainPathGuard,
  PathAccess,
  TrainSandbox,
  TrainSandboxProfile,
} from '../train-sandbox';
/* @public */ export {
  buildMultiGpuLaunch,
  aggregateMultiGpuProgress,
} from '../train-multi';
/* @public */ export type {
  MultiGpuLaunch,
  RankProgress,
  MultiGpuProgressSummary,
} from '../train-multi';
