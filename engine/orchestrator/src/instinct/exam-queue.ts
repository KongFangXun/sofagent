// exam-queue.ts · 考核队列落盘（v1.5.8 章四补强——「落考核队列」的持久化半件）
//
// examiner 产出题目/结果/拒收/待补四类动作——本件给它们 append-only 的
// 落盘载体（{SOFAGENT_DATA}/instinct/exam-queue.jsonl），人审门消费面。
// 全显式动作、零自动执行（入池/晋级/安装全经人审 gate）。

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExamQueueAction } from './examiner';

/** 考核队列文件路径 */
export function examQueuePath(dataDir: string): string {
  return join(dataDir, 'instinct', 'exam-queue.jsonl');
}

/** 队列动作落盘条目（动作 + 时间戳） */
export interface ExamQueueLogEntry {
  ts: string;
  action: ExamQueueAction;
}

/** 追加动作到考核队列（append-only） */
export function enqueueExamAction(dataDir: string, action: ExamQueueAction, now?: string): ExamQueueLogEntry {
  const dir = join(dataDir, 'instinct');
  mkdirSync(dir, { recursive: true });
  const entry: ExamQueueLogEntry = { ts: now ?? new Date().toISOString(), action };
  appendFileSync(examQueuePath(dataDir), JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

/** 队列读入（人审门消费面——按动作类型过滤） */
export function readExamQueue(
  dataDir: string,
  filter?: { type?: ExamQueueAction['type'] },
): { entries: ExamQueueLogEntry[]; corruptedLines: number } {
  const path = examQueuePath(dataDir);
  if (!existsSync(path)) return { entries: [], corruptedLines: 0 };
  const out: ExamQueueLogEntry[] = [];
  let corrupted = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t) as ExamQueueLogEntry;
      if (!filter || !filter.type || e.action.type === filter.type) out.push(e);
    } catch {
      corrupted += 1;
    }
  }
  return { entries: out, corruptedLines: corrupted };
}
