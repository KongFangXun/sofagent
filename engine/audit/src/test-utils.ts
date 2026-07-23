// ============================================================
// test-utils.ts · 测试辅助函数
// 重新导出 core 提供的类型，补充本地测试工厂函数
// ============================================================

import type { DiffFile, LogEntry } from '@sofagent/core';
import type { AuditContext } from './rules/types';

/**
 * 创建模拟 DiffFile，用于测试规则
 */
export function makeDiffFile(path: string, lines?: string[], status?: DiffFile['status']): DiffFile {
  return {
    path,
    status: status ?? 'modified',
    lines: lines ?? [`mock line for ${path}`],
  };
}

/**
 * 创建模拟 AuditContext，用于测试规则
 * 自动识别第二个参数：数组→logEntries，对象→overrides
 */
export function makeCtx(
  diffFiles: DiffFile[],
  logEntriesOrOverrides?: LogEntry[] | Partial<Omit<AuditContext, 'diffFiles' | 'logEntries'>>,
  explicitLogEntries?: LogEntry[]
): AuditContext {
  const isLogArray = Array.isArray(logEntriesOrOverrides);
  const logEntries = isLogArray ? (logEntriesOrOverrides as LogEntry[]) : (explicitLogEntries ?? []);
  const overrides = isLogArray ? {} : (logEntriesOrOverrides as Record<string, unknown> ?? {});
  return {
    diffFiles,
    logEntries,
    ...overrides,
  };
}
