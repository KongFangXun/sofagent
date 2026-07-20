// ============================================================
// A19 commit message 质量（安全层 · 业务底线）
// 检测 commit message 过短或命中黑名单无意义词
// evidenceMode: git-diff（实际只看 commitMsg，不读 diff）
// v1.1.7 新增 · v1.1.7 审查确认（黑名单优先于长度的顺序正确）
// ============================================================

import type { AuditContext, RuleCheck } from './types';

/**
 * commit message 黑名单——精确匹配（trim + toLowerCase 后）。
 * 这些词无信息量，无法追溯变更意图。
 */
const BLACKLIST = ['add', 'fix', 'test', 'update', 'change', 'wip', 'tmp', 'asdf'];

/** 最小长度要求（字符） */
const MIN_LENGTH = 8;

export function checkRuleA19(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A19 msg 质量',
    number: 19,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const commitMsg = ctx.commitMsg;

  // 无 message → 降级 PASS（不检测，避免误伤无 commit 上下文的调用）
  if (!commitMsg || !commitMsg.trim()) {
    return rule;
  }

  const normalized = commitMsg.trim();
  const lowered = normalized.toLowerCase();

  // 检查 1：黑名单精确匹配（优先——更具体的违规原因）
  if (BLACKLIST.includes(lowered)) {
    rule.status = 'FAIL';
    rule.details.push(`commit message 命中黑名单词：'${lowered}'`);
    return rule;
  }

  // 检查 2：长度不足
  if (normalized.length < MIN_LENGTH) {
    rule.status = 'FAIL';
    rule.details.push(`commit message 长度不足（${normalized.length} 字符，需 ≥${MIN_LENGTH}）`);
    return rule;
  }

  return rule;
}
