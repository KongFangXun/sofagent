// ============================================================
// A6 不坏构建（入口层 · 能力拐杖）
// 检测构建配置文件被破坏性修改（删除行 > 5）
// 构建文件匹配：vite.config, webpack.config, rollup.config, tsconfig.json, package.json
// evidenceMode: git-diff
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleCheck } from './types';

/** 构建文件关键词——匹配 basename 中包含这些前缀的文件 */
const BUILD_CONFIG_KEYWORDS = [
  'vite.config',
  'webpack.config',
  'rollup.config',
  'tsconfig.json',
  'package.json',
];

/** 触发警告的删除行数阈值 */
const DELETION_THRESHOLD = 5;

/**
 * 检查文件是否为构建配置文件
 * 通过 basename 匹配关键词（startsWith 或精确匹配）
 */
function isBuildConfigFile(filePath: string): boolean {
  const name = basename(filePath);
  return BUILD_CONFIG_KEYWORDS.some((keyword) => {
    if (keyword.includes('.json')) {
      // 精确匹配 .json 文件
      return name === keyword;
    }
    // config 前缀匹配（vite.config.ts, vite.config.js, webpack.config.js 等）
    return name.startsWith(keyword);
  });
}

export function checkRuleA6(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A6 不坏构建',
    number: 6,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '能力拐杖',
  };

  const { diffFiles } = ctx;

  const flaggedFiles: string[] = [];

  for (const file of diffFiles) {
    if (!isBuildConfigFile(file.path)) continue;

    // 统计删除行数（以 - 开头且不是 ---）
    let deletionCount = 0;
    for (const line of file.lines) {
      if (line.startsWith('-') && !line.startsWith('---')) {
        deletionCount++;
      }
    }

    if (deletionCount > DELETION_THRESHOLD) {
      flaggedFiles.push(`${file.path} (删除 ${deletionCount} 行)`);
    }
  }

  if (flaggedFiles.length > 0) {
    rule.status = 'WARN';
    rule.details.push(
      `构建配置文件被破坏性修改: ${flaggedFiles.join(', ')}。删除行数超过 ${DELETION_THRESHOLD} 行，请确认不会导致构建失败。`
    );
  }

  return rule;
}
