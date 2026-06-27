// ============================================================
// 铁律 #7 谨慎修改
// diff 中是否有不在 --task 描述关键词范围内的文件
// 违规 → exit code 1（警告）
// ============================================================
// v0.93 改进：
//   ① 中文文件名精确匹配——从任务描述中提取文件名做 basename 比对
//   ② 路径模式匹配——任务描述中明确提到的路径模式（src/**/*.tsx 等）做正则匹配
//   ③ 阈值统一为 20%（注释和代码一致）
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleCheck } from './types';

// 这些文件类型的变更通常与具体任务无关（配置文件、锁文件等）
const LOW_RISK_PATTERNS = [
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /\.gitignore$/i,
  /\.eslintrc/i,
  /\.prettierrc/i,
  /tsconfig.*\.json$/i,
  /readme(\.\w+)?\.md$/i,
  /changelog\.md$/i,
  /license$/i,
  /code_of_conduct\.md$/i,
  /contributing\.md$/i,
  /security\.md$/i,
];

/**
 * 从任务描述中提取文件名（中英文均支持）
 * 匹配模式：filename.ext / path/to/file.ext / 无扩展名文件（Makefile 等）
 */
function extractFileNamesFromTask(task: string): string[] {
  const names: string[] = [];
  // 带扩展名的文件名（含路径）
  const extPattern = /[\w./-]+\.\w+/g;
  let match: RegExpExecArray | null;
  while ((match = extPattern.exec(task)) !== null) {
    names.push(match[0].toLowerCase());
  }
  // 无扩展名的常见文件
  const noExtPattern = /\b(Makefile|Dockerfile|Jenkinsfile|Vagrantfile|LICENSE|CHANGELOG)\b/gi;
  while ((match = noExtPattern.exec(task)) !== null) {
    names.push(match[0].toLowerCase());
  }
  return [...new Set(names)];
}

/**
 * 从任务描述中提取路径模式（如 src/components, glob 模式等）
 */
function extractPathPatternsFromTask(task: string): string[] {
  const patterns: string[] = [];
  // 路径模式：包含 / 的路径片段，或 glob 模式
  const pathPattern = /[\w.-]+\/[\w./-]*/g;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(task)) !== null) {
    patterns.push(match[0].toLowerCase());
  }
  return [...new Set(patterns)];
}

/**
 * 检查文件是否与任务描述相关
 * 优先级：精确 basename 匹配 > 路径模式匹配 > 关键词子串匹配
 */
function isFileRelatedToTask(
  filePath: string,
  taskFileNames: string[],
  taskPathPatterns: string[],
  taskKeywords: string[]
): boolean {
  const fileName = basename(filePath).toLowerCase();
  const filePathLower = filePath.toLowerCase();

  // ① 精确 basename 匹配——任务描述中提到的文件名
  for (const taskName of taskFileNames) {
    const taskBasename = basename(taskName);
    if (taskBasename === fileName) return true;
  }

  // ② 路径模式匹配——任务描述中明确提到的路径片段
  for (const pattern of taskPathPatterns) {
    if (filePathLower.includes(pattern)) return true;
  }

  // ③ 关键词子串匹配（兜底——英文关键词匹配英文文件名）
  for (const kw of taskKeywords) {
    if (filePathLower.includes(kw)) return true;
  }

  return false;
}

export function checkRule07(ctx: AuditContext): RuleCheck {
  const { diffFiles, task } = ctx;
  const rule: RuleCheck = {
    name: '铁律 #7 谨慎修改',
    number: 7,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
  };

  if (!task) {
    // 没有提供任务描述，跳过此检查
    rule.details.push('未提供 --task 参数，跳过「谨慎修改」检查。建议在 CI 中传入 PR 标题。');
    return rule;
  }

  // 提取任务描述中的文件名、路径模式、关键词
  const taskFileNames = extractFileNamesFromTask(task);
  const taskPathPatterns = extractPathPatternsFromTask(task);
  const taskKeywords = task
    .toLowerCase()
    .split(/[\s,，。、；;:：()（）]+/)
    .filter((w) => w.length > 1);

  const unexpectedFiles: string[] = [];

  for (const file of diffFiles) {
    const filePath = file.path.toLowerCase();

    // 跳过低风险文件
    let isLowRisk = false;
    for (const pattern of LOW_RISK_PATTERNS) {
      if (pattern.test(filePath)) {
        isLowRisk = true;
        break;
      }
    }
    if (isLowRisk) continue;

    // 检查文件是否与任务描述相关
    const isRelated = isFileRelatedToTask(
      file.path,
      taskFileNames,
      taskPathPatterns,
      taskKeywords
    );
    if (!isRelated) {
      unexpectedFiles.push(file.path);
    }
  }

  // 如果超过 20% 的文件修改与任务无关，发出警告
  const totalFiles = diffFiles.filter((f) => {
    const name = f.path.toLowerCase();
    return !LOW_RISK_PATTERNS.some((p) => p.test(name));
  }).length;

  if (totalFiles > 0 && unexpectedFiles.length > totalFiles * 0.2) {
    rule.status = 'WARN';
    rule.details.push(
      `${unexpectedFiles.length}/${totalFiles} 个文件不在任务描述 ("${task}") 范围内: ${unexpectedFiles.slice(0, 3).join(', ')}${unexpectedFiles.length > 3 ? ` 等` : ''}`
    );
  }

  return rule;
}
