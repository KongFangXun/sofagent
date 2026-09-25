// ============================================================
// test-utils.ts · 测试辅助函数
// 重新导出 core 提供的类型，补充本地测试工厂函数
// ============================================================

import type { DiffFile, LogEntry } from '@sofagent/core';
import type { AuditContext } from './rules/types';
import { createAuditScope } from './scope';

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
 *
 * v1.5.3 第七章：规则输入面恒经 `AuditScope`——测试边界同样附 scope（未显式提供时
 * 由唯一构造工厂 `createAuditScope` 补齐，与生产路径 `runner`/`assembleCheck` 一致）。
 * 惰性求值：只有真正的输入消费者（A18 的 HEAD 基线 / A5 的 commitMsg）才触达 git。
 */
export function makeCtx(
  diffFiles: DiffFile[],
  logEntriesOrOverrides?: LogEntry[] | Partial<Omit<AuditContext, 'diffFiles' | 'logEntries'>>,
  explicitLogEntries?: LogEntry[]
): AuditContext {
  const isLogArray = Array.isArray(logEntriesOrOverrides);
  const logEntries = isLogArray ? (logEntriesOrOverrides as LogEntry[]) : (explicitLogEntries ?? []);
  const overrides = isLogArray ? {} : (logEntriesOrOverrides as Record<string, unknown> ?? {});
  const ctx: AuditContext = {
    diffFiles,
    logEntries,
    ...overrides,
  };
  if (!ctx.scope) {
    ctx.scope = createAuditScope({ commitMsg: ctx.commitMsg, task: ctx.task });
  }
  return ctx;
}
