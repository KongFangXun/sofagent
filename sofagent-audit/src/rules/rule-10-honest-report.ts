// ============================================================
// 铁律 #10 如实汇报
// commit message 是否为空 / 是否纯占位符（"fix"/"update"/"wip"）
// 违规 → exit code 1（警告）
// ============================================================

import { execSync } from 'child_process';
import type { RuleCheck } from '../reporter';

const PLACEHOLDER_PATTERNS = [
  /^(fix|update|wip|test|chore|doc|refactor)$/i,
  /^(fix|update|wip|test|chore|doc|refactor)\s*[:：]\s*$/i,
  /^\.$/,
  /^temp/i,
  /^tmp/i,
];

export function checkRule10(): RuleCheck {
  const rule: RuleCheck = {
    name: '铁律 #10 如实汇报',
    number: 10,
    status: 'PASS',
    details: [],
  };

  try {
    const message = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim();

    if (!message) {
      rule.status = 'FAIL';
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
  } catch (err) {
    rule.details.push('无法读取 commit message: ' + (err as Error).message);
  }

  return rule;
}
