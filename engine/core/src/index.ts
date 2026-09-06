// ── API 分级契约（v1.4.5 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/core — 基础设施层
 * v1.2.0 从 sofagent/audit/src/ 迁出
 *
 * 包含：常量、原子写入、git diff 解析、配置加载、模板、
 * 监控配置、模型客户端、日志读取、环境探测、成本基线、
 * 装后验证
 */

// ── 常量 ──
/* @public */ export { VERSION } from './shared/constants';

// ── 基线规则常量（单一事实源）──
/* @public */ export { BASELINE_RULE_KEYS, BASELINE_RULE_NUMBERS } from './shared/rule-constants';
/* @public */ export type { BaselineRuleKey } from './shared/rule-constants';

// ── 密钥检测正则单一事实源（A2 + ToolGate 共用）──
// v1.2.5: 扩展为全规则共享库——新增 REDACTION_PATTERNS / DOMAIN_WHITELIST / DANGEROUS_SCRIPT_CMDS
/* @public */ export { SECRET_PATTERNS, REDACTION_PATTERNS, DOMAIN_WHITELIST, DANGEROUS_SCRIPT_CMDS, DATA_URI_PATTERN, stripDataUris } from './shared/secret-patterns';

// ── v1.2.5 §3.1: Agent 身份码轻量版 → v1.3.1 交付 6 Ed25519 完整版 ──
/* @public */ export {
  generateAgentIdentity,
  computeFingerprint,
  computeShortCode,
  extractConstraintsFromPrompt,
  generateEd25519KeyPair,
  buildSignaturePayload,
  signIdentityPayload,
  verifyAgentIdentity,
} from './agent-identity';
/* @public */ export type { AgentIdentity, Ed25519KeyPair } from './agent-identity';

// ── v1.3.1 交付 6: Agent 身份注册表 ──
/* @public */ export {
  registerIdentity,
  getIdentity,
  listIdentities,
  revokeIdentity,
  getIdentityStorePath,
} from './identity-store';
/* @public */ export type { IdentityRecord, ListIdentitiesOptions } from './identity-store';

// ── v1.3.1 交付 12: stop_reason 六值分类 + 指数退避 ──
/* @public */ export {
  classifyError,
  isRetryableStopReason,
  backoffDelayMs,
  BACKOFF_SCHEDULE_MS,
  MAX_RETRY_COUNT,
} from './stop-reason';
/* @public */ export type { StopReason } from './stop-reason';

// ── v1.3.1 交付 11: LLM 调用级 Trace ──
/* @public */ export {
  appendLlmCallRecord,
  readLlmCallTrace,
  verifyLlmCallChain,
  getLlmCallTracePath,
} from './llm-call-trace';
/* @public */ export type { LlmCallTraceInput, LlmCallRecord, LlmCallTraceFilter } from './llm-call-trace';

// ── 环境变量统一读取（SOFAGENT_* 主名 + 旧名别名兜底）──
/* @public */ export { resolveEnvVar, resolveEnvBool, resolveEnvNumber } from './shared/env';

// ── 联邦/巡检共用实现（从 daemon 下沉，audit 静态 import）──
/* @public */ export {
  checkConflict,
  mergeFederationResults,
  pickWinner,
} from './federation';
/* @public */ export type {
  InspectorConfig,
  InspectorResult,
  KnowledgeQueryResult,
  FederationResult,
  MergedKnowledge,
} from './federation';

// ── 原子写入 ──
/* @public */ export { atomicWriteSync, atomicAppendSync, atomicWriteWithMergeSync, mergeAppendMissing } from './shared/atomic-write';

// ── Git Diff 解析 ──
/* @public */ export {
  isInGitRepo,
  parseDiff,
  parseStagedDiff,
  getAddedLines,
  getRemovedLines,
  parseNumstat,
  parseDiffWithIsomorphicGit,
} from './diff-parser';
/* @public */ export type { DiffFile, NumstatEntry } from './diff-parser';

// ── 配置加载 ──
/* @public */ export {
  loadConfig,
  loadEnvConfig,
  writeConfig,
  safeDefaults,
  DEFAULT_CONFIG,
  ENV_DEFAULTS,
  ConfigLoadError,
  ConfigParseError,
  ConfigSignatureError,
  signConfig,
  warnUnknownConfigKeys,
} from './config-loader';
/* @public */ export type { AuditConfig, SofaEnvConfig, MemoryBackend } from './config-loader';

// ── 数据目录路径（v1.2.1 安装路径分离：SOFAGENT_HOME 优先） ──
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
  CONFIG_FILE,
  resolveHomeDir,
  resolveDataDir,
  resolveAuditDir,
  resolveKnowledgeDir,
  resolveDaemonLog,
  resolveDaemonJson,
  getConfigFile,
  getDataDir,
} from './data-paths';

// ── 配置模板 ──
/* @public */ export { CONFIG_TEMPLATE, HOOK_TEMPLATE } from './config-template';

// ── 监控配置 ──
/* @public */ export {
  loadWatchConfig,
  generateWatchTemplate,
  DEFAULT_WATCH_CONFIG,
} from './config/watch-config';
/* @public */ export type { WatchConfig, CronJob } from './config/watch-config';

// ── 模型客户端（v1.3.1：stop_reason 分类 + 退避重连 + 错误收敛） ──
/* @public */ export { callModelAPI, convergeToolError, ModelCallError } from './model-client';
/* @public */ export type { ModelCallOptions, ModelMessage, ConvergedToolError } from './model-client';

// ── 日志读取 ──
/* @public */ export {
  MarkdownLogReader,
  JSONLLogReader,
  pickLogReader,
} from './log-reader';
/* @public */ export type { LogReader } from './log-reader';

// ── 日志检查 ──
/* @public */ export {
  checkLogs,
  getReadAccessMap,
  hasTestOrBuildExecution,
} from './log-checker';
/* @public */ export type { LogEntry } from './log-checker';

// ── 环境探测 ──
/* @public */ export {
  probeEnvironment,
  detectRuntimeEnv,
  collectEnvVars,
  detectTools,
  collectPaths,
  getSystemInfo,
} from './run-envs';
/* @public */ export type { EnvReport } from './run-envs';

// ── 环境检查 ──
/* @public */ export { checkEnv } from './env-check';
/* @public */ export type { EnvResult } from './env-check';

// ── 成本基线 ──
/* @public */ export {
  calculateBaseline,
  isAnomaly,
  isColdStart,
} from './cost-baseline';
/* @public */ export type { Baseline, TaskLogEntry } from './cost-baseline';

// ── 内存压缩 ──
/* @public */ export {
  archiveOldEntries,
  rotateBackups,
  extractSummary,
} from './compress-memory';

// ── 事实级记忆存储（v1.2.9 功能①）──
/* @public */ export { createMemoryStore } from './memory-store';
/* @public */ export type { MemoryFact } from './memory-store';

// ── 记忆契约（think.md · Ledger-Views-Policy）──
// think.md 路径 / 层级归属 / 只追加写入点的单一事实来源
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
} from './memory-contract';
/* @public */ export type { MemoryLayer, Sensitivity, Trust } from './memory-contract';

// ── prompt 注入防线（层 1 包裹 + 层 4 脱敏 + 层 5 可信分级 · v1.1.8 新增）──
/* @public */ export {
  wrapUntrusted,
  needsUntrustedWrap,
  redactForPrompt,
  RESTRICTED_PLACEHOLDER,
  UNTRUSTED_PROMPT_DECLARATION,
} from './security/prompt-sanitizer';
/* @public */ export type { UntrustedSource, UntrustedMeta } from './security/prompt-sanitizer';
/* @public */ export {
  isTrustEntryUsable,
  sortByTrust,
  prepareForPrompt,
} from './security/trust-grading';
/* @public */ export type { TrustTagged } from './security/trust-grading';

// ── 联邦加密（AES-256-GCM / ECDH / 密钥轮换 / 配对 · v1.1.8 新增）──
/* @public */ export {
  encryptPayload,
  decryptPayload,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  AES_KEY_BYTES,
} from './crypto/aes-gcm';
/* @public */ export type { EncryptedPayload } from './crypto/aes-gcm';
/* @public */ export {
  generateKeyPair,
  deriveSharedKey,
  publicKeyFingerprint,
  ECDH_CURVE,
  DERIVED_KEY_BYTES,
} from './crypto/ecdh';
/* @public */ export type { EcdhKeyPair } from './crypto/ecdh';
/* @public */ export {
  createKeySlot,
  rotateKey,
  getEncryptionKey,
  getDecryptionKeys,
  isPreviousKeyUsable,
  shouldRotate,
  ROTATION_GRACE_MS,
} from './crypto/key-rotation';
/* @public */ export type { KeySlot } from './crypto/key-rotation';
/* @public */ export {
  generatePairingCode,
  createPairingSession,
  pairByCode,
  pairByToken,
  computeTokenTag,
  pairByFederationFile,
  FEDERATION_TOKEN_PATH,
  PAIRING_CODE_LENGTH,
  MIN_TOKEN_LENGTH,
} from './crypto/pairing';
/* @public */ export type { PairedPeer, PairingSession } from './crypto/pairing';

// v1.3.8 交付二：数据静态加密（age 纯 TS 实现 + 密钥管理）
/* @public */ export {
  encryptWithAge,
  decryptWithAge,
  isAgePayload,
  AGE_MAGIC_PREFIX,
} from './crypto/age-wrapper';
/* @public */ export {
  generateDataKey,
  loadDataKey,
  rotateDataKey,
  keyFingerprint,
  writeInitializedMarker,
  isInitialized,
  keysDirPath,
  dataKeyPath,
  initializedMarkerPath,
  listArchivedKeys,
  DATA_KEY_BYTES,
  DATA_KEY_RECOVERY_HINT,
} from './crypto/key-manager';
/* @public */ export type { KeyOperationResult, KeyOperationOptions } from './crypto/key-manager';

// ── 审计结果类型 ──
/* @public */ export type { AuditResult, RuleCheck } from './reporter';

// ── 健康检查（doctor） ──
/* @public */ export { runDoctor } from './doctor';
/* @public */ export type { DoctorReport } from './doctor';

// ── 审计历史链校验（v1.2.0 从 @sofagent/audit 下沉，消除 core 反向依赖） ──
/* @public */ export { getHistoryFilePath, getHistoryAnchorFilePath, getDecisionLogPath, getEnvFingerprint, getHmacKey, checkHistoryChainIntegrity, checkHistoryChainDetailed, stableStringify, validateHmacKey } from './audit-history';

// ── 装后验证 ──
/* @public */ export { verifyEvidence } from './verify-evidence';
/* @public */ export { Verifier } from './verify/verifier';
/* @public */ export { runQuickChecks, runWorkBuddyChecks, runAllChecks } from './verify/checks';
/* @public */ export { HOME, resolveSofagentData } from './verify/utils';

// ── 验证模块类型 ──
/* @public */ export type {
  CheckStatus,
  CheckItem,
  VerifyResult,
  Args,
} from './verify/types';

// ── 数据变更审计（D1-D5 规则引擎 · v1.2.4 S4 新增）──
/* @public */ export {
  type DataChange,
  type DataViolation,
  type DataAuditResult,
  diffDataChange,
  runDataRules,
} from './data-diff';

// ── 文件系统 / 记忆层 ──
/* @public */ export { getPersonaContent } from './filesystem/memory-sync';

// ── 文件系统 / Shadow Repo（同构 Git 快照） ──
/* @public */ export {
  createShadowRepo,
  commitSnapshot,
  revertToSnapshot,
  listSnapshots,
  hasShadowRepo,
} from './filesystem/isomorphic-git';
/* @public */ export type { SnapshotEntry, IsoDiff } from './filesystem/isomorphic-git';

// ── 快照辅助函数（人类可读封装 · v1.1.3 从 daemon 迁入） ──
/* @public */ export {
  createPostAuditSnapshot,
  listAllSnapshots,
  restoreSnapshot,
} from './snapshot-helpers';
/* @public */ export type { SnapshotInfo } from './snapshot-helpers';

// ── Slash 命令注册（v1.2.7 新增 · 功能 ①②）──
/* @public */ export { SlashCommandRegistry, globalSlashRegistry } from './slash-registry';
/* @public */ export type { SlashCommand, SlashCommandContext } from './slash-registry';
/* @public */ export { CompactCommand } from './slash-commands/compact';
/* @public */ export {
  GoalCommand,
  loadSessionGoal,
  evaluateGoal,
  incrementContinuations,
} from './slash-commands/goal';
/* @public */ export type { SessionGoal, LoopSpecGoalExtension } from './slash-commands/goal';

// ── 训练语料导出三件套（方法论 + 脱敏 + 样本聚合）──
/* @public */ export {
  METHODOLOGY_KEYS,
  parseMethodologySections,
  exportMethodology,
} from './export/methodology';
/* @public */ export type {
  MethodologyKey,
  MethodologySection,
  MethodologyCorpus,
} from './export/methodology';
/* @public */ export { redact, verifyNoLeak, loadRedactRules } from './export/redactor';
/* @public */ export type { RedactRulesConfig, RedactResult } from './export/redactor';
/* @public */ export { aggregateSamples } from './export/sample-aggregator';
/* @public */ export type {
  SampleSource,
  AggregatedSample,
  AggregationResult,
} from './export/sample-aggregator';
