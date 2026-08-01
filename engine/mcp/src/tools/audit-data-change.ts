// ============================================================
// tools/audit-data-change.ts · audit_data_change MCP tool（v1.2.4 · P3 S4）
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig, runDataRules } from '@sofagent/core';
import type { DataChange } from '@sofagent/core';

export interface AuditDataChangeArgs {
  scope?: 'recent' | 'entity' | 'concept' | 'all';
  name?: string;
  count?: number;
}

export function auditDataChange(args: AuditDataChangeArgs): { text: string; data: unknown; isError?: boolean } {
  const scope = args.scope ?? 'recent';
  const env = loadEnvConfig();
  const logPath = join(env.dataDir, 'audit', 'data-change-log.jsonl');

  if (!existsSync(logPath)) {
    return {
      text: '[sofagent] 数据变更审计：无变更记录',
      data: { scope, changes: [], verdict: 'PASS' },
    };
  }

  let lines: string[];
  try {
    lines = readFileSync(logPath, 'utf-8').trim().split('\n');
  } catch {
    return {
      text: '[sofagent] 数据变更审计：读取日志失败',
      data: { scope, changes: [], verdict: 'PASS' },
    };
  }

  // 解析 JSONL
  const records: DataChange[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      records.push({
        type: entry.type,
        name: entry.name,
        action: entry.action,
        timestamp: entry.timestamp,
        after: { domain: entry.domain },
      });
    } catch { /* skip */ }
  }

  // 过滤
  let filtered = records;
  if (scope === 'recent') {
    filtered = records.slice(-Math.max(args.count ?? 10, 1));
  } else if (scope === 'entity') {
    filtered = records.filter((r) => r.type === 'entity' && (!args.name || r.name === args.name));
  } else if (scope === 'concept') {
    filtered = records.filter((r) => r.type === 'concept' && (!args.name || r.name === args.name));
  }

  // 跑规则
  const result = runDataRules(filtered);

  const outLines: string[] = ['[sofagent] 数据变更审计:', ''];
  outLines.push(`范围: ${scope} · 变更数: ${filtered.length}`);

  if (result.hasFail || result.hasWarn) {
    outLines.push(`审计: ${result.failCount} FAIL / ${result.warnCount} WARN`);
    for (const v of result.violations) {
      outLines.push(`  - [${v.severity}] ${v.rule}: ${v.detail}`);
    }
  } else {
    outLines.push('审计: ✅ 全部数据规则通过');
  }

  return {
    text: outLines.join('\n'),
    data: {
      scope,
      changes: filtered.length,
      failCount: result.failCount,
      warnCount: result.warnCount,
      violations: result.violations,
      verdict: result.hasFail ? 'FAIL' : result.hasWarn ? 'WARN' : 'PASS',
    },
    isError: result.hasFail,
  };
}
