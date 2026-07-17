// ============================================================
// weekly-report.ts · 生成 lessons-missteps 周报
// v1.1.3 新增
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { getThinkPath } from '@sofagent/core';

const VERSION = '1.1.3';

/** 周报生成结果 */
export interface WeeklyReportResult {
  generated: boolean;
  target?: string;
  error?: string;
}

/**
 * 从 think.md 生成本周踩坑周报
 *
 * @param projectDir 项目根目录
 * @param opts.week 指定周（默认当前周）
 * @param opts.llm 是否启用 LLM 润色（暂未实现）
 * @returns 生成结果
 */
export function generateWeeklyReport(
  projectDir: string,
  opts?: { week?: Date; llm?: boolean },
): WeeklyReportResult {
  const thinkPath = getThinkPath(path.join(projectDir, '.sofagent'));
  if (!fs.existsSync(thinkPath)) {
    return { generated: false, error: 'think.md not found' };
  }

  const content = fs.readFileSync(thinkPath, 'utf-8');
  const now = opts?.week ?? new Date();
  const weekNum = getWeekNumber(now);
  const weekStr = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  const targetDir = path.join(projectDir, '.sofagent', 'knowledge', 'shared');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, `lessons-missteps-${weekStr}.md`);

  // 提取 ## 教训 段落
  const sections = content.split(/^## /m);
  const missteps: string[] = [];
  for (const section of sections) {
    if (
      section.startsWith('教训') ||
      section.toLowerCase().startsWith('lesson')
    ) {
      missteps.push(section.split('\n')[0]!);
    }
  }

  if (missteps.length === 0) {
    return { generated: false, error: 'no lessons found' };
  }

  const summary =
    `# Weekly Missteps — ${weekStr}\n\n` +
    `本周踩坑总结（${missteps.length} 条）：\n\n` +
    `${missteps.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n` +
    `\n> 由 sofagent daemon v${VERSION} 生成\n`;

  fs.writeFileSync(targetPath, summary, 'utf-8');
  return { generated: true, target: targetPath };
}

/**
 * 计算 ISO 周数
 */
function getWeekNumber(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(
    ((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7,
  );
}
