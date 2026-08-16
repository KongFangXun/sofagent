// ============================================================
// public-api.ts · @sofagent/audit 公共 API（barrel export）
// v1.3.5: 供 @sofagent/mcp 等外部包使用的稳定接口
// ============================================================
// 注意：此文件只导出已经稳定且被外部消费的符号。
// 内部实现细节不要加到这里——避免泄露实现导致耦合。

export { parseDiff, isInGitRepo } from '@sofagent/core';
export type { DiffFile } from '@sofagent/core';
export { checkLogs } from '@sofagent/core';
export type { LogEntry } from '@sofagent/core';

export { runRules } from './reporter';
export type { AuditResult, RuleCheck } from './reporter';

// v1.3.0 (交付 4)：规则清单只读暴露（list_rules 用）——默认规则 + 扩展规则全量
export { defaultRules, extendedRules, rules as allDiffRules } from './rules';
export type { Rule, RuleClass, EvidenceMode } from './rules/types';

export { loadConfig } from '@sofagent/core';
export type { AuditConfig } from '@sofagent/core';

// clearHistory 已移出公共 exports——「用于测试」的破坏性 API 不应挂在包默认导出，
// 任何人调一行 clearHistory() 就能清空全部审计历史。内部测试仍可从模块路径导入。
export { loadHistory, appendHistory, checkHistoryChainIntegrity, isHmacKeyConfigured, validateHmacKey } from './audit-history';
export type { AuditHistoryEntry } from './audit-history';

export { VERSION } from '@sofagent/core';

// Snapshot / shadow-repo 函数（从 @sofagent/core 统一导出，避免重复实现）
export {
  commitSnapshot,
  revertToSnapshot,
  listSnapshots,
  createShadowRepo,
  hasShadowRepo,
} from '@sofagent/core';
export type { SnapshotEntry } from '@sofagent/core';

// ── Skill 安全审查（v1.1.3: 供 @sofagent/skillopt 等外部包使用） ──
export { findFiles, scanFile } from './rules/skill-safety-engine';
export { COMPILED_RULES, SCANNABLE_EXTENSIONS, VERSION as SKILL_SAFETY_VERSION } from './rules/skill-safety-rules';
export type { SafetyHit, SafetyRule, SafetyResult } from './rules/skill-safety-rules';
export {
  printFileResult,
  printTerminalSummary,
  printJsonOutput,
  printQuietOutput,
  printError,
  showHelp,
} from './rules/skill-safety-reporter';

// ── 数据主权审计追踪（v1.2.2 · P0） ──
export { DataSovereigntyLogger, resolveSovereigntyLogPath, resolveDateArg, sanitizeRecord } from './data-sovereignty';
export type { DataSovereigntyRecord, SovereigntyLogEntry } from './data-sovereignty';
export { generateDailyReport, generateWeeklyReport, generateMonthlyReport, generateReport, aggregateStats } from './report-generator';
export type { GeneratedReport, ReportKind } from './report-generator';
export { renderReport } from './report-template';
export type { ReportStats } from './report-template';

// ── v1.2.4 P2：矛盾检测 + 联邦蒸馏 CLI ──
export { runConflictCheckCli, parseConflictCheckArgs } from './cli/conflict-check';
export type { ConflictCheckArgs, ConflictCheckResult, ConflictCheckFn } from './cli/conflict-check';
export { runFederationDistillCli, parseFederationDistillArgs } from './cli/federation-distill';
export type { FederationDistillArgs, DistillResult, MergeFn } from './cli/federation-distill';

// ── webhook 推送（v1.2.4 P3 S5：供 @sofagent/mcp L4 双通道使用） ──
export { pushAuditResult } from './webhook';
export type { WebhookPayload, WebhookPlatform } from './webhook';

// ── 决策审计（v1.3.0 交付 6 T03）──
export { emitDecision } from './decision-log';
export type { DecisionLogEntry, EmitDecisionInput } from './decision-log';
export { checkDecisionChainDetailed } from './decision-chain';
export { sanitizeWhy } from './decision-schema';
export type { DecisionKind, LoopPhase, DecisionWhy } from './decision-schema';

// ── 决策审计查询（v1.3.0 交付 6 T04）──
export { queryByKind, getKindSummary, traceBack, traceFromBehavior, getHighFrequencyPatterns } from './decision-query';
export type { QueryOptions, KindSummary, TraceResult, HighFrequencyPattern } from './decision-query';
