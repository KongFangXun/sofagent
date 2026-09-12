// ============================================================
// E2 TODO 未声明（扩展层 · 能力拐杖）
// diff 新增代码含 TODO/FIXME 但 commit message 没提 → WARN
// evidenceMode: git-diff（纯 diff 判定，不依赖日志）
// ============================================================

import type { AuditContext, RuleScan, RuleStatus } from './types';

const TODO_PATTERN = /\b(TODO|FIXME)\b/;

export function scanE2(ctx: AuditContext): RuleScan {
  let status: RuleStatus = 'PASS';
  const details: string[] = [];

  const { diffFiles, commitMsg } = ctx;

  // 扫描 diff 中以 + 开头的行（新增代码），匹配 TODO/FIXME
  const todoMatches: string[] = [];
  for (const file of diffFiles) {
    for (const line of file.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        if (TODO_PATTERN.test(line)) {
          todoMatches.push(`${file.path}: ${line.substring(1).trim()}`);
        }
      }
    }
  }

  // diff 不含 TODO/FIXME → PASS
  if (todoMatches.length === 0) {
    return { status, details };
  }

  // 检查 commit message 是否提到 todo/fixme（不区分大小写）
  const msg = (commitMsg || '').toLowerCase();
  const commitMentionsTodo = msg.includes('todo') || msg.includes('fixme');

  if (!commitMentionsTodo) {
    status = 'WARN';
    details.push(
      `diff 新增代码含 ${todoMatches.length} 处 TODO/FIXME，但 commit message 未提及: ${todoMatches.slice(0, 3).join('; ')}${todoMatches.length > 3 ? ` 等 ${todoMatches.length} 处` : ''}`
    );
  }

  return { status, details };
}
