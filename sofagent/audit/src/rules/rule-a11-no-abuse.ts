// ============================================================
// A11 不滥资源（安全层 · 业务底线）
// 检测异常资源消耗模式：
//   新增文件数 > 50 → WARN
//   单文件新增行 > 10000 → WARN
//   删除文件 > 20 → FAIL
// evidenceMode: git-diff
// ============================================================

import { getAddedLines } from '../diff-parser';
import type { AuditContext, RuleCheck } from './types';

/** 新增文件数阈值 */
const ADDED_FILES_THRESHOLD = 50;
/** 单文件新增行数阈值 */
const SINGLE_FILE_LINES_THRESHOLD = 10000;
/** 删除文件数阈值 */
const DELETED_FILES_THRESHOLD = 20;

export function checkRuleA11(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A11 不滥资源',
    number: 11,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  // 统计新增文件数
  const addedFiles = diffFiles.filter((f) => f.status === 'added');
  const addedFileCount = addedFiles.length;

  // 统计删除文件数
  const deletedFiles = diffFiles.filter((f) => f.status === 'deleted');
  const deletedFileCount = deletedFiles.length;

  // 统计单文件新增行数
  const largeAddedFiles: { path: string; lines: number }[] = [];
  for (const file of diffFiles) {
    const addedLines = getAddedLines(file);
    if (addedLines.length > SINGLE_FILE_LINES_THRESHOLD) {
      largeAddedFiles.push({ path: file.path, lines: addedLines.length });
    }
  }

  // ① 新增文件数 > 50 → WARN
  if (addedFileCount > ADDED_FILES_THRESHOLD) {
    rule.status = 'WARN';
    rule.details.push(
      `新增文件数 ${addedFileCount}，超过 ${ADDED_FILES_THRESHOLD} 个阈值。请确认是否为预期行为。`
    );
  }

  // ② 单文件新增行 > 10000 → WARN
  if (largeAddedFiles.length > 0) {
    if (rule.status === 'PASS') rule.status = 'WARN';
    rule.details.push(
      `${largeAddedFiles.length} 个文件新增行数超过 ${SINGLE_FILE_LINES_THRESHOLD} 行: ` +
      largeAddedFiles.map((f) => `${f.path} (${f.lines} 行)`).join(', ')
    );
  }

  // ③ 删除文件 > 20 → FAIL
  if (deletedFileCount > DELETED_FILES_THRESHOLD) {
    rule.status = 'FAIL';
    rule.details.push(
      `删除文件数 ${deletedFileCount}，超过 ${DELETED_FILES_THRESHOLD} 个阈值。大量文件删除可能为破坏性操作。`
    );
  }

  return rule;
}
