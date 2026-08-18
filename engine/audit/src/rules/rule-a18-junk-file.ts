// ============================================================
// A18 垃圾文件（安全层 · 能力拐杖）
// 检测临时文件名模式的垃圾文件——如 a.txt / test1.js / new-name.txt
// evidenceMode: git-diff
// v1.3.7 新增 · v1.2.0 审查修正（不区分 status，modified 也告警）
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleCheck } from './types';
/**
 * 垃圾文件名模式（basename 级匹配）：
 * - 单字母文件名：a.txt / b.md / c.js
 * - 临时测试文件前缀：test/tmp/temp/foo/bar/aaa + 可选数字
 * - 可疑命名：new-name / old-name 前缀
 */
const JUNK_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /^[a-z]\.(txt|md|js|ts)$/i, label: '单字母文件名' },
  { regex: /^(test|tmp|temp|foo|bar|aaa)[0-9]*\./i, label: '临时测试文件' },
  { regex: /^(new|old)-name\./i, label: '可疑命名(new/old-name)' },
];

/**
 * 豁免规则——以下路径/文件名跳过检测：
 * - 正规测试目录：test/、tests/、__tests__/ 开头
 * - 正规测试文件：*.test.ts、*.spec.ts、*.test.js 结尾
 */
function isExempt(filePath: string): boolean {
  // 测试目录豁免
  if (/^(test|tests|__tests__)\//i.test(filePath)) return true;
  // 正规测试文件豁免
  if (/\.(test|spec)\.(ts|js|tsx|jsx)$/i.test(filePath)) return true;
  return false;
}

export function checkRuleA18(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A18 垃圾文件',
    number: 18,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '能力拐杖',
  };

  const hits: string[] = [];

  for (const file of ctx.diffFiles) {
    // 豁免规则：正规测试文件/目录跳过
    if (isExempt(file.path)) continue;

    const name = basename(file.path);
    for (const { regex, label } of JUNK_PATTERNS) {
      if (regex.test(name)) {
        hits.push(`${file.path}（命中模式：${label}）`);
        break; // 同一文件只记录一次
      }
    }
  }

  if (hits.length > 0) {
    rule.status = 'WARN';
    rule.details.push(`检测到 ${hits.length} 个疑似垃圾文件：${hits.join('；')}`);
  }

  return rule;
}
