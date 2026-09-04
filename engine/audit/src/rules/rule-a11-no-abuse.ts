// ============================================================
// A11 不滥资源（安全层 · 业务底线）
// 检测异常资源消耗模式：
//   新增文件数 > 50 → WARN
//   单文件新增行 > 10000 → WARN
//   删除文件 > 20 → FAIL
//   v1.4.4: 单文件删除 > 100 行且与 task 无关 → WARN（原 E3 并入）
//   v1.4.5 T15: 单行长度维度——minified/打包产物常只有 1-3 行超长行，
//   纯行数阈值完全探测不到（1 行 5MB 的 bundle 照样 PASS）。超长单行
//   按 200 字符折 1 行计入「有效行数」，与行数阈值同一口径告警。
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
/** v1.4.5 T15: 单行折算字符数——超过此长度的单行按比例折成多行计入有效行数 */
const LINE_FOLD_CHARS = 200;

/**
 * 有效行数——行数 + 超长单行折算（v1.4.5 T15）。
 * 每行按 ceil(max(len - FOLD, 0) / FOLD) 折算增量：普通行（≤200 字符）计 1，
 * 超长行每多 200 字符多计 1 行（500 字符 = 1 + 3 = 4；minified 一整行
 * 100 万字符 ≈ 5001 行）。这样 minified/bundle 产物不再以「只有 1 行」
 * 逃过 10000 行阈值。
 */
function effectiveLineCount(addedLines: string[]): number {
  let count = 0;
  for (const line of addedLines) {
    count += 1 + Math.ceil(Math.max(line.length - LINE_FOLD_CHARS, 0) / LINE_FOLD_CHARS);
  }
  return count;
}

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

  // 统计单文件新增行数（v1.4.5 T15: 行数 + 超长单行折算——minified 单行产物纳入口径）
  const largeAddedFiles: { path: string; lines: number; rawLines: number }[] = [];
  for (const file of diffFiles) {
    const addedLines = getAddedLines(file);
    const effLines = effectiveLineCount(addedLines);
    if (effLines > SINGLE_FILE_LINES_THRESHOLD) {
      largeAddedFiles.push({ path: file.path, lines: effLines, rawLines: addedLines.length });
    }
  }

  // ① 新增文件数 > 50 → WARN
  if (addedFileCount > ADDED_FILES_THRESHOLD) {
    rule.status = 'WARN';
    rule.details.push(
      `新增文件数 ${addedFileCount}，超过 ${ADDED_FILES_THRESHOLD} 个阈值。请确认是否为预期行为。`
    );
  }

  // ② 单文件新增行 > 10000 → WARN（v1.4.5 T15: 阈值按有效行数判定——
  //    超长单行折算后计入；rawLines < lines 说明是少量超长行触发，明细里带出）
  if (largeAddedFiles.length > 0) {
    if (rule.status === 'PASS') rule.status = 'WARN';
    const detailList = largeAddedFiles
      .map((f) => `${f.path} (有效 ${f.lines} 行${f.rawLines < f.lines ? `，实际仅 ${f.rawLines} 行——超长单行折算` : ''})`)
      .join(', ');
    rule.details.push(
      `${largeAddedFiles.length} 个文件新增行数超过 ${SINGLE_FILE_LINES_THRESHOLD} 行: ${detailList}`
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
