// ============================================================
// 铁律 #1 先读再用
// 被修改的文件，修改前是否有 Read 操作记录（检查 .sofagent/task/logs/ 目录）
// 违规 → exit code 2
// ============================================================

import type { DiffFile } from '../diff-parser';
import type { LogEntry } from '../log-checker';
import { getReadAccessMap } from '../log-checker';
import type { RuleCheck } from '../reporter';

export function checkRule01(diffFiles: DiffFile[], logEntries: LogEntry[]): RuleCheck {
  const rule: RuleCheck = {
    name: '铁律 #1 先读再用',
    number: 1,
    status: 'PASS',
    details: [],
  };

  const readFiles = getReadAccessMap(logEntries);
  const modifiedFiles = diffFiles
    .filter((f) => f.status === 'modified' || f.status === 'added')
    .map((f) => f.path);

  // 如果没有日志记录（可能是新项目或日志被清空），发出提示但不判定违规
  if (logEntries.length === 0) {
    rule.status = 'WARN';
    rule.details.push('未找到 .sofagent/task/logs/ 任务记录——可能是首次使用或日志目录为空。跳过「先读再用」检查。');
    return rule;
  }

  const uncheckedFiles: string[] = [];
  for (const path of modifiedFiles) {
    // 检查文件名或路径片段是否出现在日志中
    const fileName = path.split('/').pop() || path;
    let found = false;
    for (const readFile of readFiles) {
      if (readFile.includes(fileName) || fileName.includes(readFile)) {
        found = true;
        break;
      }
    }
    // 也检查日志原始内容中是否包含文件路径
    if (!found) {
      for (const entry of logEntries) {
        if (entry.raw.includes(fileName) || entry.raw.includes(path)) {
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
