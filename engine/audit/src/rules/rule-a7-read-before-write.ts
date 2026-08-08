// ============================================================
// A7 不存盲改（过程层 · 能力拐杖）
// 被修改的文件，修改前是否有 Read 操作记录（检查 data/task/logs/ 目录，v1.3.0 起）
// 违规 → exit code 2
// v0.94：新增 --silent 双路径——无日志 + silent 走 diff 启发式，只 WARN 不 FAIL
// v1.3.0：改用相对路径匹配——消除同名文件误判（src/foo.ts ≠ lib/foo.ts）
// ============================================================

import { getReadAccessMap } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './types';

export function checkRuleA7(ctx: AuditContext): RuleCheck {
  const { diffFiles, logEntries } = ctx;
  const rule: RuleCheck = {
    name: 'A7 不存盲改',
    number: 7,
    status: 'PASS',
    details: [],
    evidenceMode: 'hybrid',
    ruleClass: '能力拐杖',
  };

  const readFiles = getReadAccessMap(logEntries);
  const modifiedFiles = diffFiles
    .filter((f) => f.status === 'modified' || f.status === 'added')
    .map((f) => f.path);

  // 如果没有需要检查的修改文件（全是 deleted 或 renamed），跳过检查
  if (modifiedFiles.length === 0) {
    return rule;
  }

  // silent 模式：无 Agent 日志，不做盲改检查（CI 环境无需此日志依赖规则）
  if (ctx.silent && logEntries.length === 0) {
    rule.status = 'PASS';
    rule.details.push('⚠️ A7 silent: 无 Agent 日志，跳过「不存盲改」检查（CI/非交互环境预期行为）。');
    return rule;
  }

  // 如果没有日志记录（可能是新项目或日志被清空），发出提示但不判定违规
  if (logEntries.length === 0) {
    if (ctx.strict) {
      rule.status = 'FAIL';
      rule.details.push('--strict 模式：未找到任务日志，「不存盲改」检查失败。Agent 必须记录操作日志。');
    } else {
      rule.status = 'WARN';
      rule.details.push('未找到 data/task/logs/ 任务记录——可能是首次使用或日志目录为空。跳过「不存盲改」检查。');
    }
    return rule;
  }

  /**
   * 使用相对路径精确匹配——避免同名文件误判（src/foo.ts ≠ lib/foo.ts）。
   * readFiles 中的路径可能是相对路径（如 src/foo.ts）或绝对路径（如 /abs/path/src/foo.ts），
   * diffFiles[].path 恒为 git diff 输出的相对路径。匹配时同时检查相等和 endsWith 两种形式。
   */
  function isPathInReadSet(diffPath: string, readSet: Set<string>): boolean {
    for (const rf of readSet) {
      if (rf === diffPath || rf.endsWith('/' + diffPath)) {
        return true;
      }
    }
    return false;
  }

  const uncheckedFiles: string[] = [];
  for (const path of modifiedFiles) {
    let found = isPathInReadSet(path, readFiles);

    // 第二优先：仅匹配日志中 Read 操作条目（不匹配整篇日志的任意文件名引用）
    if (!found) {
      for (const entry of logEntries) {
        if (entry.operation !== 'read') continue;
        if (entry.file && (entry.file === path || entry.file.endsWith('/' + path))) {
          found = true;
          break;
        }
      }
    }
    if (!found) {
      uncheckedFiles.push(path);
    }
  }

  if (uncheckedFiles.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `${uncheckedFiles.length} 个文件被修改但无读取记录: ${uncheckedFiles.slice(0, 3).join(', ')}${uncheckedFiles.length > 3 ? ` 等 ${uncheckedFiles.length} 个` : ''}`
    );
  } else {
    rule.status = 'PASS';
  }

  return rule;
}
