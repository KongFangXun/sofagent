// ============================================================
// domain/shared.ts · 共享基础件域（常量 / 规则 SSOT / 密钥模式 / 环境变量 / 原子写入 / 数据目录路径）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/core/domain/shared），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/shared"。
// ============================================================
/* @public */ export { VERSION } from '../shared/constants';
/* @public */ export { BASELINE_RULE_KEYS, BASELINE_RULE_NUMBERS, CURRENT_RULE_KEYS, CURRENT_RULE_COUNT } from '../shared/rule-constants';
/* @public */ export type { BaselineRuleKey, CurrentRuleKey } from '../shared/rule-constants';
/* @public */ export { SECRET_PATTERNS, REDACTION_PATTERNS, DOMAIN_WHITELIST, DANGEROUS_SCRIPT_CMDS, DATA_URI_PATTERN, stripDataUris } from '../shared/secret-patterns';
/* @internal */ export type { RuleType } from '../shared/rule-types';
/* @internal */ export { RULE_DEFINITIONS, ruleDefinition } from '../shared/rule-definitions';
/* @internal */ export type { RuleDefinition } from '../shared/rule-definitions';
/* @internal */ export { SENSITIVE_FILE_PATH_PATTERNS, TOOL_INJECTION_PATTERNS } from '../shared/rule-patterns';
/* @internal */ export { sanitizeThinkText, MAX_THINK_LESSON_LENGTH } from '../shared/think-sanitize';
/* @internal */ export type { ThinkSanitizeOptions } from '../shared/think-sanitize';
/* @internal */ export { EXIT_ENGINE_CRASH } from '../shared/constants';
/* @public */ export { resolveEnvVar, resolveEnvBool, resolveEnvNumber } from '../shared/env';
/* @public */ export { atomicWriteSync, atomicAppendSync, atomicWriteWithMergeSync, mergeAppendMissing } from '../shared/atomic-write';
/* @internal */ export { sleepSync } from '../shared/atomic-write';
/* @public */ export {
  HOME_DIR,
  DATA_DIR,
  AUDIT_DIR,
  AUDIT_HISTORY,
  AUDIT_SESSION_REPORT,
  SOVEREIGNTY_DIR,
  TASK_DIR,
  TASK_LOGS_DIR,
  TASK_PLANS_DIR,
  KNOWLEDGE_DIR,
  THINK_MD,
  ORCHESTRATOR_DIR,
  DASHBOARD_DIR,
  IM_OUTBOX_DIR,
  DAEMON_JSON,
  DAEMON_LOG,
  FORGE_RUNS_DIR,
  EVAL_DIR,
  EVAL_HISTORY,
  EVAL_LATEST,
  AB_TEST_DIR,
  AB_TEST_HISTORY,
  AB_TEST_LATEST,
  INTERNAL_DIR,
  SOFAGENT_INTERNAL,
  CHECKPOINT_DIR,
  SHADOW_GIT_DIR,
  // v1.5.2 A-13：项目级 shadow git 目录派生函数（isomorphic-git 快照链单源）
  getProjectShadowGitDir,
  CONFIG_FILE,
  resolveHomeDir,
  resolveDataDir,
  resolveAuditDir,
  resolveKnowledgeDir,
  resolveDaemonLog,
  resolveDaemonJson,
  getConfigFile,
  getDataDir,
  // G7 多租户 v0：路径命名空间 + 租户校验（fail-loud）
  validateTenantId,
  resolveTenantDataDir,
  TENANT_PATTERN,
  DEFAULT_TENANT,
} from '../data-paths';
/* @internal */ export {
  isTestEnvironment,
  isUnderRealUserDataDir,
  assertTestEnvNotWritingRealData,
} from '../data-paths';
