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
  ConfigParseError,
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

// ── 内存压缩 ──
export {
  archiveOldEntries,
  rotateBackups,
  extractSummary,
} from './compress-memory';

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
  FEDERATION_TOKEN_ENV,
  PAIRING_CODE_LENGTH,
  MIN_TOKEN_LENGTH,
} from './crypto/pairing';
export type { PairedPeer, PairingSession } from './crypto/pairing';

// ── 审计结果类型 ──
export type { AuditResult, RuleCheck } from './reporter';

// ── 健康检查（doctor） ──
export { runDoctor } from './doctor';
export type { DoctorReport } from './doctor';

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
