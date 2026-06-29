// ============================================================
// A10 不引毒源（安全层 · 业务底线）
// 检测依赖文件变更中是否新增非官方源依赖
// 检测文件：package.json / requirements.txt / Cargo.toml
// 非官方源：github raw URL / git+http / 个人服务器 URL
// evidenceMode: git-diff
// ============================================================

import { getAddedLines } from '../diff-parser';
import type { AuditContext, RuleCheck } from './types';

/** 需要扫描的依赖文件名 */
const DEPENDENCY_FILES = new Set([
  'package.json',
  'requirements.txt',
  'Cargo.toml',
  'pyproject.toml',
  'Pipfile',
  'Gemfile',
]);

/** 非官方源模式 */
const POISON_PATTERNS: { pattern: RegExp; name: string }[] = [
  // GitHub raw content URLs
  { pattern: /https?:\/\/raw\.githubusercontent\.com\//i, name: 'GitHub raw URL' },
  // Git+http（非 HTTPS 的 git 协议）
  { pattern: /git\+http:\/\//i, name: 'git+http 不安全协议' },
  // 非官方域名特征（个人服务器 / 内网地址）
  { pattern: /https?:\/\/(?!registry\.npmjs\.org|pypi\.org|files\.pythonhosted\.org|crates\.io|rubygems\.org|repo1\.maven\.org|repo\.maven\.apache\.org)[^/\s"']*\/([a-zA-Z0-9._-]+?)\.(whl|tar\.gz|tgz|gem)\b/i, name: '非官方源 .whl/.tar.gz/.tgz/.gem 包' },
  // 非标准 registry 域名（npm / pip）
  { pattern: /https?:\/\/(?!registry\.npmjs\.org|registry\.yarnpkg\.com)[^/\s"']+\/(?:npm|npm-registry)\//i, name: '非官方 npm registry' },
  { pattern: /https?:\/\/(?!pypi\.org|test\.pypi\.org)[^/\s"']+\/simple\//i, name: '非官方 PyPI 源' },
];

export function checkRuleA10(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A10 不引毒源',
    number: 10,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  const hits: { file: string; line: string; pattern: string }[] = [];

  for (const file of diffFiles) {
    const fileName = file.path.split('/').pop() || '';
    if (!DEPENDENCY_FILES.has(fileName)) continue;

    const addedLines = getAddedLines(file);
    for (const line of addedLines) {
      for (const { pattern, name } of POISON_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({ file: file.path, line: line.trim(), pattern: name });
          break;
        }
      }
    }
  }

  if (hits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${hits.length} 处非官方源依赖: ` +
      hits.map((h) => `${h.file}: "${h.line}" (${h.pattern})`).join('; ')
    );
  }

  return rule;
}
