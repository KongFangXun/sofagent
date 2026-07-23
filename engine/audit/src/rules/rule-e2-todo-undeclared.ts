// ============================================================
// E2 不空标记（扩展层 · 能力拐杖）
// diff 新增代码含 TODO/FIXME 但 commit message 没提 → WARN
// evidenceMode: git-diff（纯 diff 判定，不依赖日志）
// ============================================================

import type { AuditContext, RuleCheck } from './types';

const TODO_PATTERN = /\b(TODO|FIXME)\b/;

export function checkRuleE2(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'E2 不空标记',
    number: 202,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '能力拐杖',
  };

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
    return rule;
  }

  // 检查 commit message 是否提到 todo/fixme（不区分大小写）
  const msg = (commitMsg || '').toLowerCase();
  const commitMentionsTodo = msg.includes('todo') || msg.includes('fixme');

  if (!commitMentionsTodo) {
    rule.status = 'WARN';
    rule.details.push(
      `diff 新增代码含 ${todoMatches.length} 处 TODO/FIXME，但 commit message 未提及: ${todoMatches.slice(0, 3).join('; ')}${todoMatches.length > 3 ? ` 等 ${todoMatches.length} 处` : ''}`
    );
  }

  return rule;
}
