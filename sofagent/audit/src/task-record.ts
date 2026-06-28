// ============================================================
// task-record.ts · JSONL 结构化任务日志记录器
// v0.94 新增：与 MD 并行写入，v0.95 切换为仅 JSONL
// ============================================================

import { appendFileSync } from 'fs';

/**
 * 单条任务记录——JSONL 格式
 */
export interface TaskRecord {
  /** ISO 8601 时间戳 */
  ts: string;
  /** 操作类型 */
  op: 'read' | 'write' | 'execute';
  /** 被操作的文件路径 */
  file?: string;
  /** 操作上下文/说明 */
  context?: string;
}

/**
 * 创建一条任务记录
 * @param op 操作类型（read/write/execute）
 * @param file 被操作的文件路径（可选）
 * @param context 操作上下文/说明（可选）
 */
export function createTaskRecord(
  op: TaskRecord['op'],
  file?: string,
  context?: string
): TaskRecord {
  return {
    ts: new Date().toISOString(),
    op,
    file,
    context,
  };
}

/**
 * 将单条任务记录序列化为 JSONL 行
 */
export function serializeTaskRecord(record: TaskRecord): string {
  return JSON.stringify(record);
}

/**
 * 将多条记录序列化为 JSONL 文本（每行一条）
 */
export function serializeTaskRecords(records: TaskRecord[]): string {
  return records.map(serializeTaskRecord).join('\n');
}

/**
 * 从 JSONL 文本解析回记录数组
 * 非法 JSON 行会被跳过
 */
export function parseTaskRecords(jsonl: string): TaskRecord[] {
  const records: TaskRecord[] = [];
  const lines = jsonl.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as TaskRecord);
    } catch {
      // 跳过非法 JSON 行
    }
  }
  return records;
}

/**
 * 追加一条记录到 JSONL 文件
 * 用法：appendTaskRecord('.sofagent/task/logs/task.jsonl', createTaskRecord('read', 'src/index.ts'))
 * @param filePath JSONL 文件路径
 * @param record 任务记录
 */
export function appendTaskRecord(filePath: string, record: TaskRecord): void {
  const line = serializeTaskRecord(record) + '\n';
  appendFileSync(filePath, line, { encoding: 'utf-8' });
}
