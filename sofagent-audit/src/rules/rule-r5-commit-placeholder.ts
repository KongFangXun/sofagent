// ============================================================
// R5 占位 commit
// commit message 只有 "fix"/"update"/"wip" → WARN
// evidenceMode: git-diff（纯 diff 判定，只看 commitMsg 不看日志）
// ⚠️ 与 #10 功能重叠，但 #10 是 hybrid（有日志也跑），R5 是 git-diff（纯 diff）
// ============================================================

import type { AuditContext, RuleCheck } from './types';

const PLACEHOLDER_PATTERNS = [
  /^(fix|update|wip|test|chore|doc|refactor)$/i,
  /^(fix|update|wip|test|chore|doc|refactor)\s*[:：]\s*$/i,
  /^\.$/,
  /^temp/i,
  /^tmp/i,
];

export function checkRuleR5(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'R5 占位 commit',
    number: 105,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
  };

  const message = (ctx.commitMsg || '').trim();

  // commit message 为空 → WARN
  if (!message) {
    rule.status = 'WARN';
    rule.details.push('commit message 为空。');
    return rule;
  }

  const firstLine = message.split('\n')[0].trim();

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(firstLine)) {
      rule.status = 'WARN';
      rule.details.push(`commit message 疑似占位符: "${firstLine}"。建议改为描述具体改了什么。`);
      return rule;
    }
  }

  // 太短的 commit message
  if (firstLine.length < 5) {
    rule.status = 'WARN';
    rule.details.push(`commit message 太短 (${firstLine.length} 字符): "${firstLine}"。`);
  }

  return rule;
}
