// ============================================================
// A11 不滥资源（安全层 · 业务底线）
// 检测异常资源消耗模式：
//   新增文件数 > 50 → WARN
//   单文件新增行 > 10000 → WARN
//   删除文件 > 20 → FAIL
//   v1.3.4: 单文件删除 > 100 行且与 task 无关 → WARN（原 E3 并入）
// evidenceMode: git-diff
// ============================================================
import { getAddedLines } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './types';

/** 新增文件数阈值 */
const ADDED_FILES_THRESHOLD = 50;
/** 单文件新增行数阈值 */
const SINGLE_FILE_LINES_THRESHOLD = 10000;
/** 删除文件数阈值 */
const DELETED_FILES_THRESHOLD = 20;
/** 单文件删除行数阈值（v1.2.5: 原 E3 并入） */
const SINGLE_FILE_DELETION_THRESHOLD = 100;

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

  // ④ v1.2.5: 单文件删除 > 100 行且与 task 无关 → WARN（原 E3 并入）
  // 检测单文件大行数删除——可能是意外删除而非任务需要的清理
  if (ctx.task) {
    const taskKeywords = ctx.task
      .toLowerCase()
      .split(/[\s,，。、；;:：()（）]+/)
      .filter((w) => w.length > 1);

    const largeDeletionFiles: string[] = [];
    for (const file of diffFiles) {
      let deletionCount = 0;
      for (const line of file.lines) {
        if (line.startsWith('-') && !line.startsWith('---')) {
          deletionCount++;
        }
      }

      if (deletionCount > SINGLE_FILE_DELETION_THRESHOLD) {
        // 检查文件路径是否与 task 相关
        const filePathLower = file.path.toLowerCase();
        const isRelated = taskKeywords.some((kw) => filePathLower.includes(kw));
        if (!isRelated) {
          largeDeletionFiles.push(`${file.path} (删除 ${deletionCount} 行)`);
        }
      }
    }

    if (largeDeletionFiles.length > 0) {
      if (rule.status === 'PASS') rule.status = 'WARN';
      rule.details.push(
        `${largeDeletionFiles.length} 个文件删除超过 ${SINGLE_FILE_DELETION_THRESHOLD} 行且与任务 "${ctx.task}" 无关: ${largeDeletionFiles.join(', ')}`
      );
    }
  }

  return rule;
}
