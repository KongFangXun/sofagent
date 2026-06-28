// ============================================================
// A2 不泄密钥（安全层 · 业务底线）
// 检测 diff 新增行内容是否含密钥字符串 → 命中任意一条 → FAIL
// evidenceMode: git-diff
// ============================================================

import type { AuditContext, RuleCheck } from './types';

/** 密钥泄漏检测正则模式 */
const SECRET_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /AKIA[A-Z0-9]{16}/, label: 'AWS Access Key' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'Private Key' },
  { pattern: /sk-[a-zA-Z0-9]{48}/, label: 'OpenAI API Key' },
  { pattern: /gh[ps]_[A-Za-z0-9]{36}/, label: 'GitHub Token' },
];

export function checkRuleA2(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A2 不泄密钥',
    number: 2,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  const detectedSecrets: string[] = [];

  for (const file of diffFiles) {
    for (const line of file.lines) {
      // 只检查新增行（以 + 开头且不是 +++）
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.substring(1);
        for (const { pattern, label } of SECRET_PATTERNS) {
          if (pattern.test(content)) {
            detectedSecrets.push(`${file.path}: 检测到 ${label}`);
          }
        }
      }
    }
  }

  if (detectedSecrets.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到疑似密钥/令牌泄漏: ${detectedSecrets.join('; ')}。密钥不应硬编码到源码中。`
    );
  }

  return rule;
}
