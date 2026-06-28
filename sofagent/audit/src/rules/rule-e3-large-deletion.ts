// ============================================================
// E3 不滥删除（扩展层 · 能力拐杖）
// 单文件删除 > 100 行且与 --task 无关 → WARN
// evidenceMode: git-diff（纯 diff 判定，不依赖日志）
// ============================================================

import type { AuditContext, RuleCheck } from './types';

const DELETION_THRESHOLD = 100;

export function checkRuleE3(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'E3 不滥删除',
    number: 203,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '能力拐杖',
  };

  const { diffFiles, task } = ctx;

  // 无 --task 时跳过
  if (!task) {
    return rule;
  }

  // 从 task 提取关键词
  const taskKeywords = task
    .toLowerCase()
    .split(/[\s,，。、；;:：()（）]+/)
    .filter((w) => w.length > 1);

  const flaggedFiles: string[] = [];

  for (const file of diffFiles) {
    // 统计以 - 开头（非 ---）的行数
    let deletionCount = 0;
    for (const line of file.lines) {
      if (line.startsWith('-') && !line.startsWith('---')) {
        deletionCount++;
      }
    }

    if (deletionCount > DELETION_THRESHOLD) {
      // 检查文件路径是否与 task 相关
      const filePathLower = file.path.toLowerCase();
      const isRelated = taskKeywords.some((kw) => filePathLower.includes(kw));

      if (!isRelated) {
        flaggedFiles.push(`${file.path} (删除 ${deletionCount} 行)`);
      }
    }
  }

  if (flaggedFiles.length > 0) {
    rule.status = 'WARN';
    rule.details.push(
      `${flaggedFiles.length} 个文件删除超过 ${DELETION_THRESHOLD} 行且与任务 "${task}" 无关: ${flaggedFiles.join(', ')}`
    );
  }

  return rule;
}
