// ============================================================
// resources.ts · MCP resources handlers (list + read)
// v1.3.7: 从 mcp-server.ts 提取
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getThinkPath } from '@sofagent/core';
import { loadHistory } from '@sofagent/audit';
// ============================================================
// 辅助
// ============================================================

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), '.sofagent');
}

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

// ============================================================
// resources/list
// ============================================================

export function listResources() {
  return {
    resources: [
      {
        uri: 'think://latest',
        name: '最新反思',
        description: 'think.md 最后一条反思条目',
        mimeType: 'text/markdown',
      },
      {
        uri: 'logs://today',
        name: '今日日志',
        description: '今日任务日志文件列表',
        mimeType: 'text/plain',
      },
      {
        uri: 'audit://last-report',
        name: '最近审计报告',
        description: '.sofagent/ 下最近一次审计历史记录',
        mimeType: 'application/json',
      },
      {
        uri: 'orchestrator://latest-comparison',
        name: 'Latest A/B Comparison',
        description: '最近一次编排 A/B 对比报告',
        mimeType: 'text/markdown',
      },
    ],
  };
}

// ============================================================
// resources/read
// ============================================================

export function readResource(uri: string): ResourceContent | { error: string } {
  switch (uri) {
    case 'think://latest':
      return readThinkLatest();
    case 'logs://today':
      return readLogsToday();
    case 'audit://last-report':
      return readAuditHistory();
    case 'orchestrator://latest-comparison':
      return readLatestComparison();
    default:
      return { error: `Unknown resource URI: ${uri}` };
  }
}

function readThinkLatest(): ResourceContent {
  const thinkPath = getThinkPath(getSofagentDataDir());
  if (!existsSync(thinkPath)) {
    return {
      uri: 'think://latest',
      mimeType: 'text/markdown',
      text: '[sofagent] think.md 不存在。运行审计后会自动生成反思条目。',
    };
  }
  const content = readFileSync(thinkPath, 'utf-8');
  const entries = content.split('\n## ').filter((s) => s.trim());
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  return {
    uri: 'think://latest',
    mimeType: 'text/markdown',
    text: lastEntry ? (lastEntry.startsWith('## ') ? lastEntry : '## ' + lastEntry) : '[sofagent] (无反思条目)',
  };
}

function readLogsToday(): ResourceContent {
  const logsDir = join(getSofagentDataDir(), 'task', 'logs');
  if (!existsSync(logsDir)) {
    return { uri: 'logs://today', mimeType: 'text/plain', text: '[sofagent] (日志目录不存在)' };
  }
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let files: string[];
  try {
    files = readdirSync(logsDir).filter((f) => {
      if (!f.endsWith('.md') && !f.endsWith('.jsonl')) return false;
      try {
        const stat = statSync(join(logsDir, f));
        const fileDate = `${stat.mtime.getFullYear()}-${String(stat.mtime.getMonth() + 1).padStart(2, '0')}-${String(stat.mtime.getDate()).padStart(2, '0')}`;
        return fileDate === todayStr;
      } catch {
        return false;
      }
    });
  } catch {
    files = [];
  }
  if (files.length === 0) {
    return { uri: 'logs://today', mimeType: 'text/plain', text: `[sofagent] (今日 ${todayStr} 无任务日志)` };
  }
  const parts: string[] = [`=== 今日任务日志 (${todayStr}) ===\n`];
  for (const file of files) {
    try {
      const content = readFileSync(join(logsDir, file), 'utf-8');
      parts.push(`--- ${file} ---\n${content}\n`);
    } catch {
      // 跳过
    }
  }
  return { uri: 'logs://today', mimeType: 'text/plain', text: parts.join('\n') };
}

function readAuditHistory(): ResourceContent {
  const entries = loadHistory(1);
  if (entries.length === 0) {
    return {
      uri: 'audit://last-report',
      mimeType: 'application/json',
      text: JSON.stringify({ message: '[sofagent] 无审计历史记录。运行审计后会自动生成。' }),
    };
  }
  return {
    uri: 'audit://last-report',
    mimeType: 'application/json',
    text: JSON.stringify(entries[0], null, 2),
  };
}

function readLatestComparison(): ResourceContent {
  const compDir = join(getSofagentDataDir(), 'orchestrator', 'comparisons');
  const empty: ResourceContent = { uri: 'orchestrator://latest-comparison', mimeType: 'text/markdown', text: 'No comparison data yet.' };
  if (!existsSync(compDir)) return empty;
  let files: string[];
  try { files = readdirSync(compDir).filter((f) => f.endsWith('.md')).sort(); } catch { return empty; }
  if (files.length === 0) return empty;
  const content = readFileSync(join(compDir, files[files.length - 1]!), 'utf-8');
  return { uri: 'orchestrator://latest-comparison', mimeType: 'text/markdown', text: content };
}
