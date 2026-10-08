// instinct/store.ts · instinct 池持久化 + 血缘字段承载（v1.5.8 章三前置件）
//
// 实测基线：extractor 的 InstinctItem 仅 7 字段、extractInstincts 每次从
// think.md + decision-log.jsonl 现场重算、池中条目从不落盘——「读 verified 态」
// 「按 enterpriseId 分区」「血缘字段随行」三项此前无落脚点。本文件补：
//   append-only JSONL 落 {SOFAGENT_DATA}/instinct/pool.jsonl
//   InstinctItem 扩 4 字段：verified / sourceTrace / enterpriseId / traceId
//
// 租户隔离纪律（数据主权铁律）：池按 enterpriseId 分区存储（单文件、字段级
// 分区——跨租户导出在 exporter 侧默认禁止，本文件只保证字段随行可判）。

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InstinctItem } from './extractor';

/** 考核态（本版第四章考核器产出） */
export type ExamStatus = 'unexamined' | 'verified' | 'failed';

/** 带考核态与血缘的池条目（store 的落盘形态） */
export interface StoredInstinct extends InstinctItem {
  /** 考核态：verified 才可导出训练（本版第三章闭环） */
  verified: ExamStatus;
  /** 来源轨迹哈希（审计链锚定的真实运行轨迹——无此标记按不可信 fail-closed） */
  sourceTrace?: string;
  /** 租户（企业）标识——按 enterpriseId 分区导出 */
  enterpriseId?: string;
  /** 关联决策/轨迹 ID（血缘锚点之一） */
  traceId?: string;
}

/** 池文件路径 */
export function instinctPoolPath(dataDir: string): string {
  return join(dataDir, 'instinct', 'pool.jsonl');
}

/** 追加条目到池（append-only——每行一个 JSON） */
export function appendToPool(dataDir: string, items: readonly StoredInstinct[]): number {
  const dir = join(dataDir, 'instinct');
  mkdirSync(dir, { recursive: true });
  const lines = items.map((i) => JSON.stringify(i)).join('\n') + '\n';
  appendFileSync(instinctPoolPath(dataDir), lines, 'utf8');
  return items.length;
}

/** 池读入（容忍损坏行——跳过并计数，不抛错中断） */
export function readPool(dataDir: string): { items: StoredInstinct[]; corruptedLines: number } {
  const path = instinctPoolPath(dataDir);
  if (!existsSync(path)) return { items: [], corruptedLines: 0 };
  const raw = readFileSync(path, 'utf8');
  let corrupted = 0;
  const items: StoredInstinct[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      items.push(JSON.parse(t) as StoredInstinct);
    } catch {
      corrupted += 1;
    }
  }
  return { items, corruptedLines: corrupted };
}

/**
 * 按 enterpriseId 过滤（租户分区读——缺省租户字段视为 'default'）。
 * 跨租户读取必须显式传 enterpriseId 并在 exporter 侧过租户门。
 */
export function filterByTenant(
  items: readonly StoredInstinct[],
  enterpriseId: string,
): StoredInstinct[] {
  return items.filter((i) => (i.enterpriseId ?? 'default') === enterpriseId);
}
