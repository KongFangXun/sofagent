// ============================================================
// A22 不越权限（安全层 · 业务底线）v1.3.4 新增
// 检测 git diff 新增行中是否含权限提升操作
// evidenceMode: git-diff
// ============================================================

import { getAddedLines } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './types';

/** 权限提升模式（不用 g 标志——避免 lastIndex 状态问题） */
const PRIVILEGE_PATTERNS: { pattern: RegExp; name: string }[] = [
  // chmod 777（全权限）
  { pattern: /chmod\s+777\b/i, name: 'chmod 777 全权限' },
  // 修改 sudoers
  { pattern: />>?\s*\/etc\/sudoers/i, name: '写入 /etc/sudoers' },
  { pattern: /NOPASSWD\s*:/i, name: 'sudoers NOPASSWD' },
  { pattern: /ALL\s*=\s*\(ALL\)/i, name: 'sudoers ALL=(ALL)' },

  // setuid/setgid
  { pattern: /chmod\s+[ug]\s*\+\s*s\b/i, name: 'chmod setuid/setgid' },
  { pattern: /chmod\s+4[0-7]{3}\b/i, name: 'chmod setuid (4xxx)' },
  { pattern: /chmod\s+2[0-7]{3}\b/i, name: 'chmod setgid (2xxx)' },
  { pattern: /chmod\s+6[0-7]{3}\b/i, name: 'chmod setuid+setgid (6xxx)' },

  // chown root
  { pattern: /chown\s+root\b/i, name: 'chown root' },
];

/** 允许的安全 chmod 模式（不告警） */
const SAFE_CHMOD_PATTERNS: RegExp[] = [
  /chmod\s+755\b/i,
  /chmod\s+644\b/i,
  /chmod\s+\+x\b/i,
  /chmod\s+[ug]\s*\+\s*x\b/i,
  /chmod\s+[ug]\s*\+\s*r\b/i,
  /chmod\s+[ug]\s*\+\s*w\b/i,
];

export function checkRuleA22(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A22 不越权限',
    number: 22,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  interface Hit { file: string; line: string; pattern: string }
  const hits: Hit[] = [];

  for (const file of diffFiles) {
    // 跳过文档和测试文件
    if (file.path.startsWith('docs/')) continue;
    if (file.path.includes('.test.') || file.path.includes('__tests__/')) continue;

    const addedLines = getAddedLines(file);
    for (const line of addedLines) {
      // 先检查是否有权限提升模式
      let escalationHit: string | null = null;
      for (const { pattern, name } of PRIVILEGE_PATTERNS) {
        if (pattern.test(line)) {
          escalationHit = name;
          break;
        }
      }

      if (escalationHit) {
        // 排除安全 chmod 模式（先检查安全模式是否完全匹配该行）
        // 注意：PRIVILEGE_PATTERNS 已排除 755/644 等，这里做二次过滤
        // 如果同时匹配安全模式，跳过
        const isSafe = SAFE_CHMOD_PATTERNS.some(p => p.test(line) && !/777|4[0-7]{3}|2[0-7]{3}|6[0-7]{3}/i.test(line));
        if (!isSafe) {
          hits.push({
            file: file.path,
            line: line.trim().slice(0, 100),
            pattern: escalationHit,
          });
        }
      }
    }
  }

  if (hits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${hits.length} 处权限提升操作: ` +
      hits.map(h => `${h.file}: "${h.line}" (${h.pattern})`).join('; ')
    );
  }

  return rule;
}
