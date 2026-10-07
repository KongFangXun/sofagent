// ============================================================
// domain/runtime.ts · 运行与可观测域（LLM trace / 日志 / 环境 / 成本 / 升级 / 模型客户端 / 报告 / diff / 斜杠命令）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/core/domain/runtime），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/runtime"。
// ============================================================
/* @public */ export {
  classifyError,
  isRetryableStopReason,
  backoffDelayMs,
  BACKOFF_SCHEDULE_MS,
  MAX_RETRY_COUNT,
} from '../stop-reason';
/* @public */ export type { StopReason } from '../stop-reason';
/* @public */ export {
  appendLlmCallRecord,
  readLlmCallTrace,
  verifyLlmCallChain,
  getLlmCallTracePath,
  getLegacyLlmCallTracePath,
  listLlmCallTraceFiles,
} from '../llm-call-trace';
/* @public */ export type { LlmCallTraceInput, LlmCallRecord, LlmCallTraceFilter } from '../llm-call-trace';
/* @public */ export {
  isDiffFileHeader,
  isInGitRepo,
  parseDiff,
  parseStagedDiff,
  getAddedLines,
  getRemovedLines,
  parseNumstat,
  parseDiffWithIsomorphicGit,
} from '../diff-parser';
/* @public */ export type { DiffFile, NumstatEntry } from '../diff-parser';
/* @public */ export { callModelAPI, convergeToolError, ModelCallError } from '../model-client';
/* @public */ export type { ModelCallOptions, ModelMessage, ConvergedToolError } from '../model-client';
/* @public */ export {
  MarkdownLogReader,
  JSONLLogReader,
  pickLogReader,
} from '../log-reader';
/* @public */ export type { LogReader } from '../log-reader';
/* @public */ export {
  checkLogs,
  getReadAccessMap,
  hasTestOrBuildExecution,
} from '../log-checker';
/* @public */ export type { LogEntry } from '../log-checker';
/* @public */ export {
  probeEnvironment,
  detectRuntimeEnv,
  collectEnvVars,
  detectTools,
  collectPaths,
  getSystemInfo,
} from '../run-envs';
/* @public */ export type { EnvReport } from '../run-envs';
/* @public */ export { checkEnv } from '../env-check';
/* @public */ export type { EnvResult } from '../env-check';
/* @public */ export {
  calculateBaseline,
  isAnomaly,
  isColdStart,
} from '../cost-baseline';
/* @public */ export type { Baseline, TaskLogEntry } from '../cost-baseline';
/* @public */ export { checkQuota, shouldRecordSpend } from '../cost/quota-gate';
/* @public */ export type { QuotaConfig, QuotaPeriod, QuotaUsage, QuotaVerdict } from '../cost/quota-gate';
/* @public */ export { classifyCommand } from '../escalation/classifier';
/* @public */ export type { ClassifiedCommand, ClassifierOverrides, EscalationLevel } from '../escalation/classifier';
/* @public */ export { routeEscalation } from '../escalation/policy';
/* @public */ export type { EscalationDecision, EscalationPolicyOptions, EscalationScenarioPolicy, EscalationVerdict } from '../escalation/policy';
/* @public */ export { validateScopedName, assertScopedName } from '../scope-names';
/* @public */ export type { ScopeKind, ScopedName, ScopeVerdict } from '../scope-names';
/* @public */ export type { AuditResult, RuleCheck } from '../reporter';
/* @public */ export { SlashCommandRegistry, globalSlashRegistry } from '../slash-registry';
/* @public */ export type { SlashCommand, SlashCommandContext } from '../slash-registry';
/* @public */ export { CompactCommand } from '../slash-commands/compact';
/* @public */ export {
  GoalCommand,
  loadSessionGoal,
  evaluateGoal,
  incrementContinuations,
} from '../slash-commands/goal';
/* @public */ export type { SessionGoal, LoopSpecGoalExtension } from '../slash-commands/goal';
