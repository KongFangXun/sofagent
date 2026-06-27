// ============================================================
// R1 无关文件
// diff 文件数 > 10 且与 --task 匹配率 < 50% → WARN
// evidenceMode: git-diff（纯 diff 判定，不依赖日志）
// ============================================================

import type { AuditContext, RuleCheck } from './types';

/**
 * 检查文件路径是否与任务描述相关
 * 匹配规则：文件路径含 task 关键词，或 task 含文件名片段
 */
function isFileRelatedToTask(filePath: string, taskKeywords: string[]): boolean {
  const filePathLower = filePath.toLowerCase();
  for (const kw of taskKeywords) {
    if (filePathLower.includes(kw)) return true;
  }
  return false;
}

export function checkRuleR1(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'R1 无关文件',
    number: 101,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
  };

  const { diffFiles, task } = ctx;

  // 无 --task 时跳过
  if (!task) {
    return rule;
  }

  // 文件数 ≤ 10 → 不触发
  if (diffFiles.length <= 10) {
    return rule;
  }

  // 从 task 提取关键词（按空格/标点分词，长度 > 1）
  const taskKeywords = task
    .toLowerCase()
    .split(/[\s,，。、；;:：()（）]+/)
    .filter((w) => w.length > 1);

  // 统计匹配文件数
  let matchedCount = 0;
  const unmatchedFiles: string[] = [];

  for (const file of diffFiles) {
    if (isFileRelatedToTask(file.path, taskKeywords)) {
      matchedCount++;
    } else {
      unmatchedFiles.push(file.path);
    }
  }

  const matchRate = matchedCount / diffFiles.length;

  if (matchRate < 0.5) {
    rule.status = 'WARN';
    rule.details.push(
      `${diffFiles.length} 个文件变更，仅 ${matchedCount} 个 (${(matchRate * 100).toFixed(0)}%) 与任务 "${task}" 相关。不相关文件: ${unmatchedFiles.slice(0, 5).join(', ')}${unmatchedFiles.length > 5 ? ` 等 ${unmatchedFiles.length} 个` : ''}`
    );
  }

  return rule;
}
