// ============================================================
// A9 不纳注入（安全层 · 业务底线）
// 检测 git diff 新增行中是否含 prompt injection 模式
// evidenceMode: git-diff（纯正则检测，--silent 可跑）
// ============================================================

import { getAddedLines } from '../diff-parser';
import type { AuditContext, RuleCheck } from './types';

/** 注入模式列表（纯正则） */
const INJECTION_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /ignore (all )?previous (instructions|prompts)/i, name: 'ignore previous instructions/prompts' },
  { pattern: /(you are now|你现在是|你的新角色是) (DAN|jailbreak)/i, name: 'DAN/jailbreak 角色切换' },
  { pattern: /do not follow (the |your )?(rules|guidelines|instructions)/i, name: 'do not follow rules/guidelines/instructions' },
  { pattern: /(ignore|forget) (everything|all) (above|before)/i, name: 'ignore/forget everything/all above/before' },
  { pattern: /<\|im_start\|>/i, name: 'im_start 标记注入' },
];

export function checkRuleA9(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A9 不纳注入',
    number: 9,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  const hits: { file: string; line: string; pattern: string }[] = [];

  for (const file of diffFiles) {
    const addedLines = getAddedLines(file);
    for (const line of addedLines) {
      for (const { pattern, name } of INJECTION_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({ file: file.path, line: line.trim(), pattern: name });
          break; // 一行只报告一次
        }
      }
    }
  }

  if (hits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${hits.length} 处 prompt injection 模式: ` +
      hits.map((h) => `${h.file}: "${h.line}" (${h.pattern})`).join('; ')
    );
  }

  return rule;
}
