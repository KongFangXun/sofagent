// ============================================================
// A5 不瞒真相（追溯层 · 业务底线）
// 合并自旧 #10 如实汇报 + R5 占位 commit
// commit message 是否为空 / 是否纯占位符（"fix"/"update"/"wip"）
// v0.94：优先使用 ctx.commitMsg，为空时 fallback 到 git 读取（向后兼容）
// ============================================================

import { execFileSync } from 'child_process';
import type { AuditContext, RuleCheck } from './types';

const PLACEHOLDER_PATTERNS = [
  /^(fix|update|wip|test|chore|doc|refactor)$/i,
  /^(fix|update|wip|test|chore|doc|refactor)\s*[:：]\s*$/i,
  /^\.$/,
  /^temp/i,
  /^tmp/i,
];

export function checkRuleA5(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A5 不瞒真相',
    number: 5,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  // 优先使用 ctx.commitMsg——只有当 ctx.commitMsg 为 undefined（未传入）时才 fallback 到 git
  let message: string;
  if (ctx.commitMsg !== undefined) {
    message = ctx.commitMsg.trim();
  } else {
    // ctx.commitMsg 未传入，fallback 到 git 读取（向后兼容）
    try {
      message = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf-8' }).trim();
    } catch (err) {
      rule.status = 'FAIL';
      rule.details.push('无法读取 commit message: ' + (err as Error).message);
      return rule;
    }
  }

  if (!message) {
    rule.status = 'FAIL';
    rule.details.push('commit message 为空。');
    return rule;
  }

  const firstLine = (message.split('\n')[0] ?? '').trim();

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
