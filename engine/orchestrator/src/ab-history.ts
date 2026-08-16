// ============================================================
// ab-history.ts · A/B 调度历史指标持久化（jsonl 累积模式）
// v1.3.6 新增
// ============================================================
//
// 交付二（daemon A/B 自动调度器）的数据层：
//   - 每次真实任务跑完（利用/探索阶段），指标追加写入
//     {SOFAGENT_DATA}/ab-history.jsonl（每行一个 JSON PlanMetrics）
//   - 判定阶段对比「最近 N 次聚合指标」（非单次，降低偶然性）
//   - 截断保留最近 K=100 轮，旧数据归档截断防 jsonl 无限膨胀
//   - 重启 daemon 后状态可恢复（jsonl 即唯一持久化，无内存态）
//
// 与 v1.1.8 orchestrator-compare.ts extractMetrics() 的关系：
//   extractMetrics 从「单次运行的 .md 日志目录」提取瞬时指标；
//   本模块把瞬时指标按 plan 累积成时间序列并聚合——互补不替代。
//
// qualityScore 定义（U4 决策）：暂用 firstPassRate 填充
// （语义对齐「首次通过率」），v1.2.x 如需更细粒度质量分再扩展。
// ============================================================

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

/** 单条运行指标（jsonl 每行一个） */
export interface PlanMetrics {
  /** 方案 ID（如 "A-step-by-step" / "B-domain"） */
  plan: string;
  /** 任务描述（真实业务任务，非测试任务） */
  task: string;
  /** ISO 时间戳 */
  timestamp: string;
  /** 通过数（本次运行内 PASS 计数） */
  passed: number;
  /** 失败数（本次运行内 FAIL 计数） */
  failed: number;
  /** 耗时（毫秒） */
  duration: number;
  /** 质量分（0-100；U4 决策：暂用 firstPassRate 填充） */
  qualityScore: number;
  /** 失败模式标签（可选，用于 failureClusters 聚类——如 "audit-FAIL" / "timeout"） */
  failureTag?: string;
}

/** 最近 N 次聚合指标（判定阶段对比单位） */
export interface AggregateMetrics {
  /** 方案 ID */
  plan: string;
  /** 聚合样本量（实际条数，可能 < n 当历史不足） */
  sampleSize: number;
  /** 平均通过率（0-100；passed/(passed+failed) 的平均） */
  avgPassRate: number;
  /** 平均耗时（毫秒） */
  avgDuration: number;
  /** 失败模式聚类（failureTag → 出现次数） */
  failureClusters: Record<string, number>;
}

/** 截断保留轮次上限（K=100，超出后归档截断） */
export const HISTORY_MAX_ENTRIES = 100;

/**
 * 追加一条指标到 historyPath（jsonl）。
 * 目录不存在时自动创建；写入后超过 K 条自动截断。
 */
export function appendMetrics(historyPath: string, metrics: PlanMetrics): void {
  const dir = dirname(historyPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(metrics) + '\n';
  // 小文件场景直接 append（jsonl 单行原子性由 OS 保证 < PIPE_BUF）
  writeFileSync(historyPath, line, { flag: 'a', encoding: 'utf-8' });
  // 超 K 条截断（保留最近 K 条）
  truncateToLastK(historyPath, HISTORY_MAX_ENTRIES);
}

/**
 * 读取全部历史指标（损坏行跳过，不阻塞）。
 * 文件不存在返回空数组（首次运行场景）。
 */
export function readAll(historyPath: string): PlanMetrics[] {
  if (!existsSync(historyPath)) return [];
  const content = readFileSync(historyPath, 'utf-8');
  const metrics: PlanMetrics[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as PlanMetrics;
      // 最小字段校验——缺关键字段的行视为损坏跳过
      if (typeof parsed.plan !== 'string' || typeof parsed.timestamp !== 'string') continue;
      metrics.push(parsed);
    } catch {
      // 损坏行跳过（best-effort）
    }
  }
  return metrics;
}

/**
 * 聚合某方案最近 n 次运行的指标。
 *
 * @param historyPath jsonl 路径
 * @param plan        方案 ID
 * @param n           聚合窗口（默认 = threshold，如 10）
 * @returns AggregateMetrics（样本不足 n 时按实际条数聚合，sampleSize 如实标注）
 */
export function aggregateRecent(historyPath: string, plan: string, n: number): AggregateMetrics {
  const all = readAll(historyPath).filter((m) => m.plan === plan);
  const recent = all.slice(-Math.max(1, n));
  const sampleSize = recent.length;

  if (sampleSize === 0) {
    return { plan, sampleSize: 0, avgPassRate: 0, avgDuration: 0, failureClusters: {} };
  }

  let passRateSum = 0;
  let durationSum = 0;
  const failureClusters: Record<string, number> = {};

  for (const m of recent) {
    const total = m.passed + m.failed;
    passRateSum += total > 0 ? (m.passed / total) * 100 : 0;
    durationSum += m.duration;
    if (m.failed > 0 && m.failureTag) {
      failureClusters[m.failureTag] = (failureClusters[m.failureTag] ?? 0) + 1;
    }
  }

  return {
    plan,
    sampleSize,
    avgPassRate: Math.round((passRateSum / sampleSize) * 10) / 10,
    avgDuration: Math.round(durationSum / sampleSize),
    failureClusters,
  };
}

/**
 * 截断 jsonl 只保留最近 k 条（原子写：tmp + rename，EXDEV 降级 copy+unlink）。
 * 不足 k 条时不做任何事（避免无谓 IO）。
 */
export function truncateToLastK(historyPath: string, k: number = HISTORY_MAX_ENTRIES): void {
  if (!existsSync(historyPath)) return;
  const all = readAll(historyPath);
  if (all.length <= k) return;
  const kept = all.slice(-k);
  const tmp = `${historyPath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, kept.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf-8');
  try {
    renameSync(tmp, historyPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      copyFileSync(tmp, historyPath);
      try { unlinkSync(tmp); } catch { /* 清理失败可忽略 */ }
    } else {
      throw err;
    }
  }
}
