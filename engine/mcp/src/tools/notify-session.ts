// ============================================================
// tools/notify-session.ts · notify_session MCP tool（v1.2.4 · P3 S5）
// ============================================================
//
// 审计结果汇报——预格式化返回（L2 品牌可见化）。
// 返回可直接展示给用户的文本（首行 [sofagent]），减少 Agent 改写风险。
// think_ref=true 时自动查 think.md 相关历史教训并附上。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';

export interface NotifySessionArgs {
  audit_type: 'code' | 'data' | 'file';
  verdict: 'PASS' | 'WARN' | 'FAIL';
  summary: string;
  details?: string[];
  think_ref?: boolean;
}

export function notifySession(args: NotifySessionArgs): { text: string; data: unknown } {
  const icon = args.verdict === 'PASS' ? '✅' : args.verdict === 'WARN' ? '⚠️' : '❌';

  const lines: string[] = [];
  lines.push(`[sofagent] 审计完成 · 类型: ${args.audit_type} · 判定: ${icon} ${args.verdict}`);
  lines.push('');
  lines.push(`摘要: ${args.summary}`);

  if (args.details && args.details.length > 0) {
    lines.push('', '详情:');
    for (const d of args.details) {
      lines.push(`  - ${d}`);
    }
  }

  // think_ref：查相关历史教训
  if (args.think_ref !== false) {
    const thinkLessons = queryThinkLessons(args.summary);
    if (thinkLessons.length > 0) {
      lines.push('', '历史教训:');
      for (const lesson of thinkLessons.slice(0, 3)) {
        lines.push(`  - ${lesson}`);
      }
    }
  }

  lines.push('', '建议: 根据 [sofagent] 审计结果进行后续操作');

  return {
    text: lines.join('\n'),
    data: {
      audit_type: args.audit_type,
      verdict: args.verdict,
      summary: args.summary,
    },
  };
}

/** 从 think.md 查询相关历史教训（关键词匹配） */
function queryThinkLessons(keyword: string): string[] {
  try {
    const env = loadEnvConfig();
    const thinkPath = join(env.dataDir, 'think.md');
    if (!existsSync(thinkPath)) return [];

    const content = readFileSync(thinkPath, 'utf-8');
    const lessons: string[] = [];

    // 按 --- 分割条目
    const entries = content.split(/^---.*$/m);
    const keywords = keyword.toLowerCase().split(/\s+/).filter((k) => k.length > 2);

    for (const entry of entries) {
      const lowerEntry = entry.toLowerCase();
      if (keywords.some((k) => lowerEntry.includes(k))) {
        // 提取教训行
        const lessonMatch = entry.match(/教训[:：]\s*(.+)/);
        if (lessonMatch) {
          lessons.push(lessonMatch[1].trim());
        }
      }
    }

    return lessons;
  } catch {
    return [];
  }
}
