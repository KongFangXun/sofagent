// ============================================================
// instinct/failure-log.ts · 错题本（v1.3.6 交付 3 / 交付 5 #3）
// ============================================================
//
// 审计 FAIL + Refine 修复失败 → 写入独立 failure-log（instinct 的负样本）。
//
// 🔴 铁律（dev-prompt 交付 3）：
//   - 错题本独立于 think.md——不把负样本混进正向经验（think.md 是
//     Ledger 层 append-only 反思；错题本是独立的负样本库）
//   - 提取时单独加权（extractor.ts 消费时 fail ×2）
//
// 存储：{dataDir}/instinct/failure-log.jsonl（append-only，与 ab-history 同范式）
// ============================================================

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

/** 错题本条目 */
export interface FailureLogEntry {
  /** 失败模式归一化文本 */
  pattern: string;
  /** 失败来源 */
  source: 'audit' | 'refine' | 'think';
  /** 具体上下文（任务/规则号等，供人类审读） */
  context: string;
  /** 发生时间（ISO） */
  timestamp: string;
}

/** 错题本持久化行（含归一化指纹，读取侧聚合用） */
interface FailureLogLine {
  id: string;
  pattern: string;
  source: FailureLogEntry['source'];
  context: string;
  timestamp: string;
}

/** 错题本文件路径（单一出口——读写都经此函数） */
export function failureLogPath(dataDir: string): string {
  return join(dataDir, 'instinct', 'failure-log.jsonl');
}

/**
 * 追加一条失败记录（append-only，永不覆写）。
 *
 * @param dataDir 数据目录
 * @param entry 失败条目
 */
export function appendFailure(dataDir: string, entry: FailureLogEntry): void {
  const filePath = failureLogPath(dataDir);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const line: FailureLogLine = {
    id: failureId(entry.pattern),
    pattern: entry.pattern,
    source: entry.source,
    context: entry.context,
    timestamp: entry.timestamp,
  };
  appendFileSync(filePath, JSON.stringify(line) + '\n', 'utf-8');
}

/**
 * 读取全量错题本（坏行跳过）。
 *
 * @param dataDir 数据目录
 * @returns 原始行列表（时间序）
 */
export function readFailureLog(dataDir: string): FailureLogLine[] {
  const filePath = failureLogPath(dataDir);
  if (!existsSync(filePath)) return [];
  let content = '';
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const lines: FailureLogLine[] = [];
  for (const raw of content.trim().split('\n')) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as FailureLogLine;
      if (typeof parsed.pattern === 'string' && parsed.pattern.length > 0) {
        lines.push(parsed);
      }
    } catch {
      // 坏行跳过
    }
  }
  return lines;
}

/**
 * 聚合错题本——同 pattern 的多条记录聚合为一个负样本（供 extractor 消费）。
 *
 * @param dataDir 数据目录
 * @returns 聚合后的负样本列表
 */
export function aggregateFailurePatterns(dataDir: string): Array<{
  id: string;
  pattern: string;
  occurrences: number;
  lastSeen: string;
  contexts: string[];
}> {
  const lines = readFailureLog(dataDir);
  const byId = new Map<string, { id: string; pattern: string; occurrences: number; lastSeen: string; contexts: string[] }>();
  for (const line of lines) {
    const id = failureId(line.pattern);
    const existing = byId.get(id);
    if (existing) {
      existing.occurrences += 1;
      if (line.timestamp > existing.lastSeen) existing.lastSeen = line.timestamp;
      if (line.context && existing.contexts.length < 5) {
        existing.contexts.push(line.context);
      }
    } else {
      byId.set(id, {
        id,
        pattern: line.pattern,
        occurrences: 1,
        lastSeen: line.timestamp,
        contexts: line.context ? [line.context] : [],
      });
    }
  }
  return Array.from(byId.values());
}

/** 失败模式指纹（与 extractor.patternId 同算法——保持独立定义避免循环 import） */
function failureId(pattern: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < pattern.length; i++) {
    hash ^= pattern.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fail-${hash.toString(16).padStart(8, '0')}`;
}
