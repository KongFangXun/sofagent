// ============================================================
// public-api.ts · @sofagent/audit 公共 API（barrel export）
// v1.2.0: 供 @sofagent/mcp 等外部包使用的稳定接口
// ============================================================
// 注意：此文件只导出已经稳定且被外部消费的符号。
// 内部实现细节不要加到这里——避免泄露实现导致耦合。

export { parseDiff, isInGitRepo } from '@sofagent/core';
export type { DiffFile } from '@sofagent/core';
export { checkLogs } from '@sofagent/core';
export type { LogEntry } from '@sofagent/core';

export { runRules } from './reporter';
export type { AuditResult, RuleCheck } from './reporter';

export { loadConfig } from '@sofagent/core';
export type { AuditConfig } from '@sofagent/core';

export { loadHistory, appendHistory, clearHistory, checkHistoryChainIntegrity, isHmacKeyConfigured, validateHmacKey } from './audit-history';
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
