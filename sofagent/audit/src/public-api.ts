// ============================================================
// public-api.ts · @sofagent/audit 公共 API（barrel export）
// v1.0.0: 供 @sofagent/mcp 等外部包使用的稳定接口
// ============================================================
// 注意：此文件只导出已经稳定且被外部消费的符号。
// 内部实现细节不要加到这里——避免泄露实现导致耦合。

export { parseDiff, isInGitRepo } from './diff-parser';
export type { DiffFile } from './diff-parser';
export { checkLogs } from './log-checker';
export type { LogEntry } from './log-checker';

export { runRules } from './reporter';
export type { AuditResult } from './reporter';

export { loadConfig } from './config-loader';
export type { AuditConfig } from './config-loader';

export { generateThinkEntry } from './think-generator';
export type { ThinkEntryOptions } from './think-generator';

export { loadHistory, appendHistory, clearHistory } from './audit-history';
export type { AuditHistoryEntry } from './audit-history';

export { VERSION } from './shared/constants';
