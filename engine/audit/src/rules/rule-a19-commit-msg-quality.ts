// ============================================================
// A19 commit message 质量（安全层 · 业务底线）
// 检测 commit message 过短或命中黑名单无意义词
// evidenceMode: git-diff（实际只看 commitMsg，不读 diff）
// v1.3.7 新增 · v1.2.0 审查确认（黑名单优先于长度的顺序正确）
// ============================================================

import type { AuditContext, RuleCheck } from './types';

/**
 * commit message 黑名单——精确匹配（trim + toLowerCase 后）。
 * 这些词无信息量，无法追溯变更意图。
 */
const BLACKLIST = ['add', 'fix', 'test', 'update', 'change', 'wip', 'tmp', 'asdf'];

/**
 * 最小长度要求（有效字符——中文×2 加权）。
 * v1.4.5 T10: 8 → 6。CJK×2 加权下「改配置」「加注释」这类 3 字精准中文
 * subject 有效长度恰为 6——旧阈值 8 会把「中文说清了但字少」的正常提交
 * 误拦为 FAIL（可追溯性目标是「说得清」而非「字数够」）。6 档仍拦得住
 * 单汉字（2）与两字中文（4）的无信息量提交。
 */
const MIN_LENGTH = 6;

/**
 * 计算有效长度——中文字符计 2（中文 commit 天然字符数少，加权后避免误拦）。
 * "修复 bug" = 2 汉字 ×2 + " bug" 4 字符 = 8 ≥ MIN_LENGTH ✓
 * v1.4.5 T10: "改配置" = 3 汉字 ×2 = 6 ≥ 6（新阈值）✓——三字精准中文不再误拦
 */
function effectiveLength(msg: string): number {
  let len = 0;
  for (const ch of msg) {
    // CJK 统一汉字 + 常见 CJK 范围按 2 计
    if (/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]/.test(ch)) {
      len += 2;
    } else {
      len += 1;
    }
  }
  return len;
}

export function checkRuleA19(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A19 msg 质量',
    number: 19,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '工程规范',  // v1.3.4 对齐 index.ts（v1.2.5 起 SSOT=工程规范，impl 漏改）
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

  // 检查 2：长度不足（中文字符加权计算——有效长度 = 中文数×2 + 其他字符数）
  const effLen = effectiveLength(normalized);
  if (effLen < MIN_LENGTH) {
    rule.status = 'FAIL';
    rule.details.push(`commit message 有效长度不足（${effLen} 有效字符，需 ≥${MIN_LENGTH}）`);
    return rule;
  }

  return rule;
}
