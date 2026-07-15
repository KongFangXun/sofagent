// ============================================================
// lessons-extract.ts · 从 think.md 提取经验到 knowledge/shared/
// v1.1.1 新增
// ============================================================
//
// ⚠️ 记忆契约：本文件是 think.md（Ledger）→ knowledge/（Views）**唯一合法的派生写入方**
// （Dream Cycle）。派生方向严格单向：只允许从 think.md 读取教训、写入 knowledge/，
// 绝不可把 knowledge/ 的内容反向写回 think.md。think.md 的路径经 core 的 getThinkPath() 解析。

import * as fs from 'fs';
import * as path from 'path';
import { getThinkPath } from '@sofagent/core';

const VERSION = '1.1.1';

/**
 * 从 think.md 中提取「教训」章节，写入 knowledge/shared/lessons-{date}.md
 *
 * @param projectDir 项目根目录
 * @param opts.since 仅提取自此日期之后的教训（暂未实现过滤）
 * @returns 提取结果：条数与目标文件路径
 */
export function extractLessons(
  projectDir: string,
  opts?: { since?: Date },
): { extracted: number; target: string } {
  const thinkPath = getThinkPath(path.join(projectDir, '.sofagent'));
  if (!fs.existsSync(thinkPath)) return { extracted: 0, target: '' };

  const content = fs.readFileSync(thinkPath, 'utf-8');
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const targetDir = path.join(projectDir, '.sofagent', 'knowledge', 'shared');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, `lessons-${dateStr}.md`);

  // 提取 ## 教训 段落
  const lessons: string[] = [];
  const sections = content.split(/^## /m);
  for (const section of sections) {
    if (
      section.startsWith('教训') ||
      section.toLowerCase().startsWith('lesson')
    ) {
      lessons.push(section.trim());
    }
  }

  if (lessons.length === 0) return { extracted: 0, target: targetPath };

  fs.writeFileSync(
    targetPath,
    `# Shared Lessons — ${dateStr}\n\n${lessons.join('\n\n---\n\n')}\n\n> 由 sofagent daemon v${VERSION} 生成\n`,
    'utf-8',
  );
  return { extracted: lessons.length, target: targetPath };
}
