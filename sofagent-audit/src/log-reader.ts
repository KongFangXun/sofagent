// ============================================================
// log-reader.ts · 日志格式可插拔接口
// v0.94 新增：支持 Markdown 和 JSONL 两种日志格式
// 通过 pickLogReader 根据文件扩展名自动选择
// ============================================================

/**
 * 日志读取器统一接口
 * 不同格式（Markdown / JSONL）实现此接口，实现格式无关的日志解析
 */
export interface LogReader {
  /** 从日志内容中提取操作类型（read/write/execute/other） */
  extractOperation(content: string): string;
  /** 从日志内容中提取被操作的文件路径列表 */
  extractFileReferences(content: string): string[];
}

/**
 * Markdown 日志读取器
 * 迁移自 log-checker.ts 原有的 extractOperation / extractFileReferences
 */
export class MarkdownLogReader implements LogReader {
  /**
   * 从 Markdown 日志内容中提取操作类型
   * 结构化操作上下文检查（逐行匹配）+ 否定语义过滤
   */
  extractOperation(content: string): string {
    const lines = content.split('\n');

    // 否定语义模式：「未读取」「跳过读取」「没有读取」等不算 Read 操作
    const negateRead = /(未|没有|没|跳过|不|did\s+not|skip(ped)?)\s*(read|读取)/i;

    // 按优先级逐行检查操作上下文：read > write > execute
    for (const line of lines) {
      const trimmed = line.trim();
      if (negateRead.test(trimmed)) continue;
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
   * 从 Markdown 日志内容中提取被操作的文件路径
   */
  extractFileReferences(content: string): string[] {
    const refs: string[] = [];
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
}

/**
 * JSONL 日志读取器
 * 解析 { ts, op, file, context } 格式的结构化日志
 */
export class JSONLLogReader implements LogReader {
  /**
   * 解析 JSONL 提取操作类型
   * 统计 op 出现频率，按优先级返回（read > write > execute > other）
   */
  extractOperation(content: string): string {
    const lines = content.split('\n').filter(Boolean);
    const opCounts: Record<string, number> = {};
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.op) opCounts[record.op] = (opCounts[record.op] || 0) + 1;
      } catch {
        // 跳过非法 JSON 行
      }
    }
    // 按优先级 read > write > execute > other
    if ((opCounts.read || 0) > 0) return 'read';
    if ((opCounts.write || 0) > 0) return 'write';
    if ((opCounts.execute || 0) > 0) return 'execute';
    return 'other';
  }

  /**
   * 解析 JSONL 提取文件引用列表
   */
  extractFileReferences(content: string): string[] {
    const refs: string[] = [];
    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.file) refs.push(record.file);
      } catch {
        // 跳过非法 JSON 行
      }
    }
    return [...new Set(refs)];
  }
}

/**
 * 根据文件扩展名选择日志读取器
 * .jsonl → JSONLLogReader，其他 → MarkdownLogReader
 */
export function pickLogReader(filePath: string): LogReader {
  return filePath.endsWith('.jsonl') ? new JSONLLogReader() : new MarkdownLogReader();
}
