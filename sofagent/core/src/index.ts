/**
 * @sofagent/core — 基础设施层
 * v1.1.0 从 sofagent/audit/src/ 迁出
 *
 * 包含：常量、原子写入、git diff 解析、配置加载、模板、
 * 监控配置、模型客户端、日志读取、环境探测、成本基线、
 * 装后验证
 */

// ── 常量 ──
export { VERSION } from './shared/constants';

// ── 原子写入 ──
export { atomicWriteSync, atomicAppendSync } from './shared/atomic-write';

// ── Git Diff 解析 ──
export {
  isInGitRepo,
  parseDiff,
  parseStagedDiff,
  getAddedLines,
  getRemovedLines,
  parseNumstat,
  parseDiffWithIsomorphicGit,
} from './diff-parser';
export type { DiffFile, NumstatEntry } from './diff-parser';

// ── 配置加载 ──
export {
  loadConfig,
  loadEnvConfig,
  writeConfig,
  safeDefaults,
  DEFAULT_CONFIG,
  ENV_DEFAULTS,
  ConfigLoadError,
} from './config-loader';
export type { AuditConfig, SofaEnvConfig } from './config-loader';

// ── 配置模板 ──
export { CONFIG_TEMPLATE, HOOK_TEMPLATE } from './config-template';

// ── 监控配置 ──
export {
  loadWatchConfig,
  generateWatchTemplate,
  DEFAULT_WATCH_CONFIG,
} from './config/watch-config';
export type { WatchConfig, CronJob } from './config/watch-config';

// ── 模型客户端 ──
export { callModelAPI } from './model-client';
export type { ModelCallOptions, ModelMessage } from './model-client';

// ── 日志读取 ──
export {
  MarkdownLogReader,
  JSONLLogReader,
  pickLogReader,
} from './log-reader';
export type { LogReader } from './log-reader';

// ── 日志检查 ──
export {
  checkLogs,
  getReadAccessMap,
  hasTestOrBuildExecution,
} from './log-checker';
export type { LogEntry } from './log-checker';

// ── 环境探测 ──
export {
  probeEnvironment,
  detectRuntimeEnv,
  collectEnvVars,
  detectTools,
  collectPaths,
  getSystemInfo,
} from './run-envs';
export type { EnvReport } from './run-envs';

// ── 环境检查 ──
export { checkEnv } from './env-check';
export type { EnvResult } from './env-check';

// ── 成本基线 ──
export {
  calculateBaseline,
  isAnomaly,
  isColdStart,
} from './cost-baseline';
export type { Baseline, TaskLogEntry } from './cost-baseline';

// ── 审计结果类型 ──
export type { AuditResult, RuleCheck } from './reporter';

// ── 装后验证 ──
export { verifyEvidence } from './verify-evidence';
export { Verifier } from './verify/verifier';
export { runQuickChecks, runWorkBuddyChecks, runAllChecks } from './verify/checks';
export { HOME, resolveSofagentData } from './verify/utils';

// ── 验证模块类型 ──
export type {
  CheckStatus,
  CheckItem,
  VerifyResult,
  Args,
} from './verify/types';
