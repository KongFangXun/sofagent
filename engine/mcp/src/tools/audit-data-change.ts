// ============================================================
// audit-data-change.ts · MCP tool：数据变更审计（v1.3.1 S4 新增）
// ============================================================
//
// 纯审计工具（不写入，只审计已有变更）
// 从 data/audit/data-change-log.jsonl 读取变更记录，跑 D1-D5 规则
// 返回带 [sofagent] 前缀的结构化报告
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runDataRules, type DataChange, type DataAuditResult } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

export interface AuditDataChangeArgs {
  /** 审计范围 */
  scope?: 'recent' | 'entity' | 'concept' | 'all';
  /** entity/concept 名称（scope 为 entity/concept 时必填） */
  name?: string;
  /** 最近 N 次变更（scope 为 recent 时），默认 10 */
  count?: number;
}

export interface AuditDataChangeResult {
  text: string;
  data: {
    verdict: 'PASS' | 'WARN' | 'FAIL';
    changesAudited: number;
    violations: DataAuditResult['violations'];
    isError: boolean;
  };
}

// ============================================================
// 辅助函数
// ============================================================

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

interface LogEntry {
  timestamp: string;
  type: string;
  name: string;
  action: string;
  auditVerdict: string;
  violations: Array<{ rule: string; detail: string }>;
}

/**
 * 从 data-change-log.jsonl 读取变更记录
 */
function readChangeLog(): LogEntry[] {
  const logPath = join(getSofagentDataDir(), 'audit', 'data-change-log.jsonl');
  if (!existsSync(logPath)) return [];

  try {
    const content = readFileSync(logPath, 'utf-8');
    return content
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LogEntry => e !== null);
  } catch {
    return [];
  }
}

/**
 * 将日志条目转换为 DataChange 格式
 */
function logEntryToDataChange(entry: LogEntry): DataChange {
  return {
    type: entry.type as DataChange['type'],
    name: entry.name,
    action: entry.action as DataChange['action'],
    timestamp: entry.timestamp,
    before: undefined,
    after: { _fromLog: true, name: entry.name, type: entry.type },
  };
}

// ============================================================
// 主函数
// ============================================================

export function auditDataChange(args: AuditDataChangeArgs): AuditDataChangeResult {
  const scope = args.scope ?? 'recent';
  const name = args.name;
  const count = args.count ?? 10;

  let logEntries = readChangeLog();

  // 按 scope 过滤
  switch (scope) {
    case 'recent':
      logEntries = logEntries.slice(-count);
      break;
    case 'entity':
      logEntries = logEntries.filter((e) => e.type === 'entity' && (!name || e.name === name));
      break;
    case 'concept':
      logEntries = logEntries.filter((e) => e.type === 'concept' && (!name || e.name === name));
      break;
    case 'all':
      // 不过滤
      break;
  }

  if (logEntries.length === 0) {
    return {
      text: '[sofagent] 数据变更审计：无符合条件的变更记录',
      data: {
        verdict: 'PASS',
        changesAudited: 0,
        violations: [],
        isError: false,
      },
    };
  }

  // 转换为 DataChange 并跑规则
  const changes = logEntries.map(logEntryToDataChange);
  const auditResult = runDataRules(changes);

  const verdict: 'PASS' | 'WARN' | 'FAIL' = auditResult.hasFail
    ? 'FAIL'
    : auditResult.hasWarn
      ? 'WARN'
      : 'PASS';

  // 合并日志中原始记录的违规
  const allViolations = [...auditResult.violations];
  for (const entry of logEntries) {
    for (const v of entry.violations) {
      // 检查是否已存在（避免重复）
      if (!allViolations.some((av) => av.rule === v.rule && av.detail === v.detail)) {
        allViolations.push({
          rule: v.rule,
          severity: v.detail.includes('FAIL') || v.rule === 'D1' || v.rule === 'D5' ? 'FAIL' : 'WARN',
          detail: v.detail,
        });
      }
    }
  }

  const lines: string[] = [];
  lines.push(`[sofagent] 数据变更审计 · 范围: ${scope}${name ? ` (${name})` : ''}`);
  lines.push(`审计变更数: ${logEntries.length}`);
  lines.push(`判定: ${verdict}`);

  if (allViolations.length > 0) {
    lines.push('');
    const fails = allViolations.filter((v) => v.severity === 'FAIL');
    const warns = allViolations.filter((v) => v.severity === 'WARN');
    if (fails.length > 0) {
      lines.push(`FAIL（${fails.length}）:`);
      for (const v of fails) {
        lines.push(`  ❌ ${v.rule}: ${v.detail}`);
      }
    }
    if (warns.length > 0) {
      lines.push(`WARN（${warns.length}）:`);
      for (const v of warns) {
        lines.push(`  ⚠️ ${v.rule}: ${v.detail}`);
      }
    }
  } else {
    lines.push('✅ 全部数据规则通过');
  }

  return {
    text: lines.join('\n'),
    data: {
      verdict,
      changesAudited: logEntries.length,
      violations: allViolations,
      isError: auditResult.hasFail,
    },
  };
}
