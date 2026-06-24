// ============================================================
// 铁律 #7 谨慎修改
// diff 中是否有不在 --task 描述关键词范围内的文件
// 违规 → exit code 1（警告）
// ============================================================

import type { DiffFile } from '../diff-parser';
import type { RuleCheck } from '../reporter';

// 这些文件类型的变更通常与具体任务无关（配置文件、锁文件等）
const LOW_RISK_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.gitignore$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /tsconfig.*\.json$/,
];

export function checkRule07(diffFiles: DiffFile[], task?: string): RuleCheck {
  const rule: RuleCheck = {
    name: '铁律 #7 谨慎修改',
    number: 7,
    status: 'PASS',
    details: [],
  };

  if (!task) {
    // 没有提供任务描述，跳过此检查
    rule.details.push('未提供 --task 参数，跳过「谨慎修改」检查。建议在 CI 中传入 PR 标题。');
    return rule;
  }

  const taskKeywords = task.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const unexpectedFiles: string[] = [];

  for (const file of diffFiles) {
    const fileName = file.path.toLowerCase();

    // 跳过低风险文件
    let isLowRisk = false;
    for (const pattern of LOW_RISK_PATTERNS) {
      if (pattern.test(fileName)) {
        isLowRisk = true;
        break;
      }
    }
    if (isLowRisk) continue;

    // 检查文件名是否与任务关键词相关
    const isRelated = taskKeywords.some((kw) => fileName.includes(kw));
    if (!isRelated) {
      unexpectedFiles.push(file.path);
    }
  }

  // 如果超过 20% 的文件修改与任务无关，发出警告
  const totalFiles = diffFiles.filter((f) => {
    const name = f.path.toLowerCase();
    return !LOW_RISK_PATTERNS.some((p) => p.test(name));
  }).length;

  if (totalFiles > 0 && unexpectedFiles.length > totalFiles * 0.3) {
    rule.status = 'WARN';
    rule.details.push(
      `${unexpectedFiles.length}/${totalFiles} 个文件不在任务描述 ("${task}") 范围内: ${unexpectedFiles.slice(0, 3).join(', ')}${unexpectedFiles.length > 3 ? ` 等` : ''}`
    );
  }

  return rule;
}
