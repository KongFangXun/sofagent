// ============================================================
// log-checker.ts · 任务日志读取器
// ============================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

export interface LogEntry {
  timestamp: Date;
  operation: string;
  file?: string;
  raw: string;
}

/**
 * 读取 .sofagent/task/logs/ 目录中的任务记录
 * 检查哪些文件在任务中被 Read/Write 操作过
 */
export function checkLogs(logDir?: string): LogEntry[] {
  const entries: LogEntry[] = [];

  // 优先找项目根目录的 .sofagent/，其次是当前目录
  const searchDirs = [
    logDir,
    join(process.cwd(), '.sofagent', 'task', 'logs'),
    join(process.cwd(), '..', '.sofagent', 'task', 'logs'),
  ];

  for (const dir of searchDirs) {
    if (!dir || !existsSync(dir)) continue;

    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
      // 按修改时间排序，取最近的
      const sorted = files
        .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      for (const { name } of sorted.slice(0, 10)) {
        try {
          const content = readFileSync(join(dir, name), 'utf-8');
          entries.push({
            timestamp: statSync(join(dir, name)).mtime,
            operation: extractOperation(content),
            raw: content,
          });
          // 提取文件引用
          const fileRefs = extractFileReferences(content);
          for (const ref of fileRefs) {
            entries.push({
              timestamp: statSync(join(dir, name)).mtime,
              operation: 'file-access',
              file: ref,
              raw: content,
            });
          }
        } catch {
          // 跳过无法读取的文件
        }
      }
      break; // 找到第一个有效的日志目录就跳出
    } catch {
      continue;
    }
  }

  return entries;
}

/**
 * 从日志内容中提取操作类型
 */
function extractOperation(content: string): string {
  if (content.includes('Read') || content.includes('读取') || content.includes('read_file')) {
    return 'read';
  }
  if (content.includes('Write') || content.includes('写入') || content.includes('write_to_file')) {
    return 'write';
  }
  if (content.includes('Bash') || content.includes('执行') || content.includes('run_command')) {
    return 'execute';
  }
  return 'other';
}

/**
 * 从日志内容中提取被操作的文件路径
 */
function extractFileReferences(content: string): string[] {
  const refs: string[] = [];
  // 匹配常见的文件路径模式
  const patterns = [
    /[`"']?([a-zA-Z0-9_\-/.]+\.(?:ts|js|py|md|json|yaml|yml|sh|tsx|jsx|html|css))[`"']?/g,
    /(?:file|path|文件)[:：]\s*([^\s,\n]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const path = match[1];
      // 过滤明显不是文件路径的匹配
      if (path && !path.startsWith('http') && path.length > 2) {
        refs.push(path);
      }
    }
  }

  return [...new Set(refs)];
}

/**
 * 生成文件被读取的摘要报告
 */
export function getReadAccessMap(entries: LogEntry[]): Set<string> {
  const readFiles = new Set<string>();
  for (const entry of entries) {
    if (entry.operation === 'read' && entry.file) {
      readFiles.add(entry.file);
    }
  }
  return readFiles;
}

/**
 * 检查是否有测试/构建命令执行记录
 */
export function hasTestOrBuildExecution(entries: LogEntry[]): boolean {
  const testPatterns = [/npm test/, /npm run test/, /npm run build/, /yarn test/, /yarn build/, /pnpm test/, /pnpm build/, /make/, /gradle/];
  for (const entry of entries) {
    if (entry.operation === 'execute') {
      for (const pattern of testPatterns) {
        if (pattern.test(entry.raw)) return true;
      }
    }
  }
  return false;
}
