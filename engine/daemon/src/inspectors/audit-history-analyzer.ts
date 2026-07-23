// ============================================================
// audit-history-analyzer.ts · 审计历史分析器
// 检查近 7 天是否有重复违规（≥3 次同一规则）
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

import type { InspectorResult } from './types';

export function analyzeAuditHistory(projectDir: string): InspectorResult {
  const historyPath = path.join(
    projectDir,
    '.sofagent',
    'audit',
    'history.jsonl',
  );
  if (!fs.existsSync(historyPath)) {
    return {
      name: 'audit-history',
      triggered: false,
      message: 'No audit history found',
      severity: 'info',
    };
  }

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const lines = fs
    .readFileSync(historyPath, 'utf-8')
    .split('\n')
    .filter(Boolean);

  const ruleCounts: Record<string, number> = {};
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.timestamp && new Date(entry.timestamp).getTime() > sevenDaysAgo) {
        const rule = entry.rule || 'unknown';
        ruleCounts[rule] = (ruleCounts[rule] || 0) + 1;
      }
    } catch {
      // 跳过损坏的 JSON 行
    }
  }

  const repeated = Object.entries(ruleCounts).filter(([, c]) => c >= 3);
  if (repeated.length > 0) {
    return {
      name: 'audit-history',
      triggered: true,
      message: `Repeated rule violations (≥3 in 7 days): ${repeated.map(([r, c]) => `${r}(${c})`).join(', ')}`,
      severity: 'warning',
    };
  }
  return {
    name: 'audit-history',
    triggered: false,
    message: 'No repeated violations',
    severity: 'info',
  };
}
