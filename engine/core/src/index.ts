/**
 * @sofagent/core — 基础设施层
 * v1.2.0 从 sofagent/audit/src/ 迁出
 *
 * 包含：常量、原子写入、git diff 解析、配置加载、模板、
 * 监控配置、模型客户端、日志读取、环境探测、成本基线、
 * 装后验证
 */

// ── 常量 ──
export { VERSION } from './shared/constants';

// ── 基线规则常量（单一事实源）──
export { BASELINE_RULE_KEYS, BASELINE_RULE_NUMBERS } from './shared/rule-constants';
export type { BaselineRuleKey } from './shared/rule-constants';

// ── 密钥检测正则单一事实源（A2 + ToolGate 共用）──
// v1.2.5: 扩展为全规则共享库——新增 REDACTION_PATTERNS / DOMAIN_WHITELIST / DANGEROUS_SCRIPT_CMDS
export { SECRET_PATTERNS, REDACTION_PATTERNS, DOMAIN_WHITELIST, DANGEROUS_SCRIPT_CMDS } from './shared/secret-patterns';

// ── v1.2.5 §3.1: Agent 身份码轻量版 → v1.3.1 交付 6 Ed25519 完整版 ──
export {
  generateAgentIdentity,
  computeFingerprint,
  computeShortCode,
  extractConstraintsFromPrompt,
  generateEd25519KeyPair,
  buildSignaturePayload,
  signIdentityPayload,
  verifyAgentIdentity,
} from './agent-identity';
export type { AgentIdentity, Ed25519KeyPair } from './agent-identity';

// ── v1.3.1 交付 6: Agent 身份注册表 ──
export {
  registerIdentity,
  getIdentity,
  listIdentities,
  revokeIdentity,
  getIdentityStorePath,
} from './identity-store';
export type { IdentityRecord, ListIdentitiesOptions } from './identity-store';

// ── v1.3.1 交付 12: stop_reason 六值分类 + 指数退避 ──
export {
  classifyError,
  isRetryableStopReason,
  backoffDelayMs,
  BACKOFF_SCHEDULE_MS,
  MAX_RETRY_COUNT,
} from './stop-reason';
export type { StopReason } from './stop-reason';

// ── v1.3.1 交付 11: LLM 调用级 Trace ──
export {
  appendLlmCallRecord,
  readLlmCallTrace,
  verifyLlmCallChain,
  getLlmCallTracePath,
} from './llm-call-trace';
export type { LlmCallTraceInput, LlmCallRecord, LlmCallTraceFilter } from './llm-call-trace';

// ── 环境变量统一读取（SOFAGENT_* 主名 + 旧名别名兜底）──
export { resolveEnvVar, resolveEnvBool, resolveEnvNumber } from './shared/env';

// ── 联邦/巡检共用实现（从 daemon 下沉，audit 静态 import）──
export {
  checkConflict,
  mergeFederationResults,
  pickWinner,
} from './federation';
export type {
  InspectorConfig,
  InspectorResult,
  KnowledgeQueryResult,
  FederationResult,
  MergedKnowledge,
} from './federation';

// ── 原子写入 ──
export { atomicWriteSync, atomicAppendSync, atomicWriteWithMergeSync, mergeAppendMissing } from './shared/atomic-write';

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
  ConfigParseError,
  signConfig,
} from './config-loader';
export type { AuditConfig, SofaEnvConfig, MemoryBackend } from './config-loader';

// ── 数据目录路径（v1.2.1 安装路径分离：SOFAGENT_HOME 优先） ──
export {
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
} from './data-paths';

// ── 配置模板 ──
export { CONFIG_TEMPLATE, HOOK_TEMPLATE } from './config-template';

// ── 监控配置 ──
export {
  loadWatchConfig,
  generateWatchTemplate,
  DEFAULT_WATCH_CONFIG,
} from './config/watch-config';
export type { WatchConfig, CronJob } from './config/watch-config';

// ── 模型客户端（v1.3.1：stop_reason 分类 + 退避重连 + 错误收敛） ──
export { callModelAPI, convergeToolError, ModelCallError } from './model-client';
export type { ModelCallOptions, ModelMessage, ConvergedToolError } from './model-client';

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

// ── 内存压缩 ──
export {
  archiveOldEntries,
  rotateBackups,
  extractSummary,
} from './compress-memory';

// ── 事实级记忆存储（v1.2.9 功能①）──
export { createMemoryStore } from './memory-store';
export type { MemoryFact } from './memory-store';

// ── 记忆契约（think.md · Ledger-Views-Policy）──
// think.md 路径 / 层级归属 / 只追加写入点的单一事实来源
export {
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
export type { MemoryLayer, Sensitivity, Trust } from './memory-contract';

// ── prompt 注入防线（层 1 包裹 + 层 4 脱敏 + 层 5 可信分级 · v1.1.8 新增）──
export {
  wrapUntrusted,
  needsUntrustedWrap,
  redactForPrompt,
  RESTRICTED_PLACEHOLDER,
  UNTRUSTED_PROMPT_DECLARATION,
} from './security/prompt-sanitizer';
export type { UntrustedSource, UntrustedMeta } from './security/prompt-sanitizer';
export {
  isTrustEntryUsable,
  sortByTrust,
  prepareForPrompt,
} from './security/trust-grading';
export type { TrustTagged } from './security/trust-grading';

// ── 联邦加密（AES-256-GCM / ECDH / 密钥轮换 / 配对 · v1.1.8 新增）──
export {
  encryptPayload,
  decryptPayload,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  AES_KEY_BYTES,
} from './crypto/aes-gcm';
export type { EncryptedPayload } from './crypto/aes-gcm';
export {
  generateKeyPair,
  deriveSharedKey,
  publicKeyFingerprint,
  ECDH_CURVE,
  DERIVED_KEY_BYTES,
} from './crypto/ecdh';
export type { EcdhKeyPair } from './crypto/ecdh';
export {
  createKeySlot,
  rotateKey,
  getEncryptionKey,
  getDecryptionKeys,
  isPreviousKeyUsable,
  shouldRotate,
  ROTATION_GRACE_MS,
} from './crypto/key-rotation';
export type { KeySlot } from './crypto/key-rotation';
export {
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
export type { PairedPeer, PairingSession } from './crypto/pairing';

// ── 审计结果类型 ──
export type { AuditResult, RuleCheck } from './reporter';

// ── 健康检查（doctor） ──
export { runDoctor } from './doctor';
export type { DoctorReport } from './doctor';

// ── 审计历史链校验（v1.2.0 从 @sofagent/audit 下沉，消除 core 反向依赖） ──
export { getHistoryFilePath, getDecisionLogPath, getEnvFingerprint, getHmacKey, checkHistoryChainIntegrity, checkHistoryChainDetailed, stableStringify, validateHmacKey } from './audit-history';

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

// ── 数据变更审计（D1-D5 规则引擎 · v1.2.4 S4 新增）──
export {
  type DataChange,
  type DataViolation,
  type DataAuditResult,
  diffDataChange,
  runDataRules,
} from './data-diff';

// ── 文件系统 / 记忆层 ──
export { getPersonaContent } from './filesystem/memory-sync';

// ── 文件系统 / Shadow Repo（同构 Git 快照） ──
export {
  createShadowRepo,
  commitSnapshot,
  revertToSnapshot,
  listSnapshots,
  hasShadowRepo,
} from './filesystem/isomorphic-git';
export type { SnapshotEntry, IsoDiff } from './filesystem/isomorphic-git';

// ── 快照辅助函数（人类可读封装 · v1.1.3 从 daemon 迁入） ──
export {
  createPostAuditSnapshot,
  listAllSnapshots,
  restoreSnapshot,
} from './snapshot-helpers';
export type { SnapshotInfo } from './snapshot-helpers';

// ── Slash 命令注册（v1.2.7 新增 · 功能 ①②）──
export { SlashCommandRegistry, globalSlashRegistry } from './slash-registry';
export type { SlashCommand, SlashCommandContext } from './slash-registry';
export { CompactCommand } from './slash-commands/compact';
export {
  GoalCommand,
  loadSessionGoal,
  evaluateGoal,
  incrementContinuations,
} from './slash-commands/goal';
export type { SessionGoal, LoopSpecGoalExtension } from './slash-commands/goal';
