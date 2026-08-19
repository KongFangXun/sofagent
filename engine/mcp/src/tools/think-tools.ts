// ============================================================
// think-tools.ts · MCP tools: get_think / write_think / read_think_md / read_lessons
// v1.3.8: 从 mcp-server.ts 提取
// ============================================================

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getThinkPath, appendThinkEntry } from '@sofagent/core';
import type { ToolResult } from './audit-tools';
// ============================================================
// 辅助
// ============================================================

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), '.sofagent');
}

// ============================================================
// Tool: get_think
// ============================================================

export function getThink(args: Record<string, unknown>): ToolResult {
  const count = (args.count as number) ?? 1;
  const dataDir = getSofagentDataDir();
  const thinkPath = getThinkPath(dataDir);

  if (!existsSync(thinkPath)) {
    return {
      text: '[sofagent] think.md 不存在。运行审计后会自动生成反思条目。',
      data: { entries: [] },
    };
  }

  const content = readFileSync(thinkPath, 'utf-8');
  const entries = content.split('\n## ').filter((s) => s.trim());

  // 取最近 count 条
  const recent = entries.slice(-count);

  // 补回 ## 前缀
  const formatted = recent.map((e) => (e.startsWith('## ') ? e : '## ' + e));

  return {
    text: `[sofagent] think.md 反思记录（最近 ${recent.length} 条）：\n\n${formatted.join('\n\n') || '(无反思条目)'}`,
    data: {
      totalEntries: entries.length,
      returned: recent.length,
    },
  };
}

// ============================================================
// Tool: write_think
// ============================================================

export function writeThink(args: Record<string, unknown>): ToolResult | { error: string } {
  if (typeof args.lesson !== 'string' || !args.lesson) {
    return { error: 'Missing or invalid required argument: lesson' };
  }
  // 清洗 lesson 内容——防止注入 think.md 结构（截断 ## 标题注入 + 长度上限）
  const MAX_LESSON_LENGTH = 10000;
  let lesson = args.lesson;
  if (lesson.length > MAX_LESSON_LENGTH) {
    lesson = lesson.slice(0, MAX_LESSON_LENGTH);
  }
  // 去除换行——防止 lesson 内容注入新的 ## 条目标题
  lesson = lesson.replace(/[\r\n]+/g, ' ').trim();

  const task = (args.task as string) || '(手动记录)';
  const dataDir = getSofagentDataDir();
  const thinkPath = getThinkPath(dataDir);

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const entry = `\n## ${timestamp} 任务: ${task}\n\n- #教训: ${lesson}\n\n`;

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  appendThinkEntry(thinkPath, entry);

  return {
    text: `[sofagent] 已追加反思到 think.md: "${lesson}"`,
    data: { timestamp, task, lesson },
  };
}

// ============================================================
// Tool: read_think_md
// ============================================================

export function readThinkMd(): ToolResult {
  const thinkPath = getThinkPath(getSofagentDataDir());
  if (!existsSync(thinkPath)) {
    return {
      text: '[sofagent] think.md 不存在',
      data: { found: false },
    };
  }
  const content = readFileSync(thinkPath, 'utf-8');
  return {
    text: `[sofagent] think.md:\n\n${content}`,
    data: { found: true, content },
  };
}

// ============================================================
// Tool: read_lessons
// ============================================================

export function readLessons(): ToolResult {
  const file = join(getSofagentDataDir(), 'knowledge', 'lessons-missteps.md');
  if (!existsSync(file)) {
    return {
      text: '[sofagent] lessons-missteps.md 不存在',
      data: { found: false },
    };
  }
  const content = readFileSync(file, 'utf-8');
  return {
    text: `[sofagent] lessons-missteps:\n\n${content}`,
    data: { found: true, content },
  };
}
