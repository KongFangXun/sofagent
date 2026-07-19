// ============================================================
// public-api.ts · @sofagent/audit 公共 API（barrel export）
// v1.1.6: 供 @sofagent/mcp 等外部包使用的稳定接口
// ============================================================
// 注意：此文件只导出已经稳定且被外部消费的符号。
// 内部实现细节不要加到这里——避免泄露实现导致耦合。

export { parseDiff, isInGitRepo } from '@sofagent/core';
export type { DiffFile } from '@sofagent/core';
export { checkLogs } from '@sofagent/core';
export type { LogEntry } from '@sofagent/core';

export { runRules } from './reporter';
export type { AuditResult } from './reporter';

export { loadConfig } from '@sofagent/core';
export type { AuditConfig } from '@sofagent/core';

export { loadHistory, appendHistory, clearHistory } from './audit-history';
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
