// ============================================================
// notify-session.ts · MCP tool：审计结果汇报（v1.2.9 S5 新增）
// ============================================================
//
// 向当前 Agent session 推送审计结果摘要，确保"结果可见"。
// 首行必须 [sofagent] 前缀（品牌铁律）
// think_ref=true 时自动查 think.md 相关历史教训附上
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============================================================
// 类型定义
// ============================================================

export interface NotifySessionArgs {
  /** 审计类型 */
  audit_type: 'code' | 'data' | 'file';
  /** 审计判定 */
  verdict: 'PASS' | 'WARN' | 'FAIL';
  /** 审计摘要（1-2 句话） */
  summary: string;
  /** 违规/警告详情列表 */
  details?: string[];
  /** 是否附带相关历史反思（默认 true） */
  think_ref?: boolean;
}

export interface NotifySessionResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    auditType: string;
    verdict: string;
    summary: string;
    details: string[];
    thinkRefAttached: boolean;
    relatedLessons: string[];
  };
}

// ============================================================
// 辅助函数
// ============================================================

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

/**
 * 从 think.md 查找相关历史教训
 *
 * 基于关键词匹配——搜索 think.md 中与 audit_type / verdict 相关的条目
 */
function searchRelatedLessons(auditType: string, verdict: string, summary: string): string[] {
  const thinkPath = join(getSofagentDataDir(), 'think.md');
  if (!existsSync(thinkPath)) return [];

  let content: string;
  try {
    content = readFileSync(thinkPath, 'utf-8');
  } catch {
    return [];
  }

  // 提取教训行（# 教训: ...）
  const lessonPattern = /#教训:\s*(.+)$/gm;
  const allLessons: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = lessonPattern.exec(content)) !== null) {
    if (match[1]) {
      allLessons.push(match[1].trim());
    }
  }

  // 也提取 eval 失败的教训
  const evalPattern = /eval 失败.*?#教训:\s*(.+)$/gm;
  while ((match = evalPattern.exec(content)) !== null) {
    if (match[1] && !allLessons.includes(match[1].trim())) {
      allLessons.push(match[1].trim());
    }
  }

  // 从 summary 中提取关键词用于匹配
  const keywords: string[] = [];
  // 提取规则编号
  const ruleMatches = summary.match(/[ADE]\d+/g);
  if (ruleMatches) keywords.push(...ruleMatches);
  // 提取审计类型
  keywords.push(auditType);

  // 按关键词匹配排序
  const scored = allLessons.map((lesson) => {
    let score = 0;
    for (const kw of keywords) {
      if (lesson.toLowerCase().includes(kw.toLowerCase())) {
        score++;
      }
    }
    return { lesson, score };
  });

  // 取评分 > 0 的前 3 条，或如果没有匹配的取最近 2 条
  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  if (matched.length > 0) {
    return matched.map((s) => s.lesson);
  }

  // 没有关键词匹配——返回最近的 2 条（作为通用参考）
  return allLessons.slice(-2);
}

// ============================================================
// 主函数
// ============================================================

export function notifySession(args: NotifySessionArgs): NotifySessionResult {
  const { audit_type, verdict, summary, details = [], think_ref = true } = args;

  const verdictIcon = verdict === 'PASS' ? '✅' : verdict === 'WARN' ? '⚠️' : '❌';

  const lines: string[] = [];
  lines.push(`[sofagent] 审计完成 · 类型: ${audit_type} · 判定: ${verdictIcon} ${verdict}`);
  lines.push('');
  lines.push(`摘要: ${summary}`);

  if (details.length > 0) {
    lines.push('');
    lines.push('详情:');
    for (const d of details) {
      lines.push(`  - ${d}`);
    }
  }

  let thinkRefAttached = false;
  let relatedLessons: string[] = [];

  if (think_ref) {
    relatedLessons = searchRelatedLessons(audit_type, verdict, summary);
    if (relatedLessons.length > 0) {
      thinkRefAttached = true;
      lines.push('');
      lines.push('历史教训:');
      for (const lesson of relatedLessons) {
        lines.push(`  - ${lesson}`);
      }
    }
  }

  // 建议行
  if (verdict === 'FAIL') {
    lines.push('');
    lines.push('建议: 请根据以上违规项修复后重新执行审计');
  } else if (verdict === 'WARN') {
    lines.push('');
    lines.push('建议: 关注以上警告项，可根据情况修复或忽略');
  }

  return {
    text: lines.join('\n'),
    data: {
      auditType: audit_type,
      verdict,
      summary,
      details,
      thinkRefAttached,
      relatedLessons,
    },
  };
}
