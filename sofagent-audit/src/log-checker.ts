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
          const op = extractOperation(content);
          entries.push({
            timestamp: statSync(join(dir, name)).mtime,
            operation: op,
            raw: content,
          });
          // 提取文件引用——继承父日志操作类型，让 getReadAccessMap 能正确关联文件与操作
          const fileRefs = extractFileReferences(content);
          for (const ref of fileRefs) {
            entries.push({
              timestamp: statSync(join(dir, name)).mtime,
              operation: op,
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
 * 结构化操作上下文检查（逐行匹配）+ 否定语义过滤
 * 不再使用 content.includes() 子串匹配——避免整篇日志中任意出现的关键词被误判为操作
 */
function extractOperation(content: string): string {
  const lines = content.split('\n');

  // 否定语义模式：「未读取」「跳过读取」「没有读取」等不算 Read 操作
  const negateRead = /(未|没有|没|跳过|不|did\s+not|skip(ped)?)\s*(read|读取)/i;

  // 按优先级逐行检查操作上下文：read > write > execute
  // 注意：\b 词边界只对英文 [a-zA-Z0-9_] 有效，中文关键词需单独匹配
  for (const line of lines) {
    const trimmed = line.trim();
    if (negateRead.test(trimmed)) continue; // 否定语义过滤
    if (/\b(read|read_file)\b/i.test(trimmed) || /读取/.test(trimmed)) return 'read';
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (/\b(write|write_to_file)\b/i.test(trimmed) || /写入/.test(trimmed)) return 'write';
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (/\b(bash|run_command)\b/i.test(trimmed) || /执行/.test(trimmed)) return 'execute';
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
    // 带扩展名的文件路径
    /[`"']?([a-zA-Z0-9_\-/.]+\.(?:ts|js|py|md|json|yaml|yml|sh|tsx|jsx|html|css))[`"']?/g,
    // 无扩展名的常见文件（Makefile、Dockerfile、.env 等）
    /[`"']?(Makefile|Dockerfile|docker-compose\.ya?ml|\.env(?:\.\w+)?|\.gitignore|\.editorconfig|Jenkinsfile|Vagrantfile|LICENSE|CHANGELOG)[`"']?/gi,
    // file/path/文件 标签后的路径
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
