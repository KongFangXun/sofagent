// ============================================================
// fatigue.ts · Agent 疲劳度检测（v1.3.7 交付⑬ · 运维闭环增强）
//
// 定位：Agent 跑长循环时上下文窗口会被污染、决策质量会衰减——
// 「疲劳」不是 metaphor，是可观测的信号。本模块给运维闭环补一个
// 健康指标：
//   信号 1：同一工具连续失败次数（重复撞墙 = 卡死循环）
//   信号 2：上下文窗口占用率（窗口快满 = 即将溢出/被截断）
//   信号 3：输出与历史相似度（查重——复读机 = 不再产生新信息）
//
// 疲劳度评分 0-100（加权）→ 写 daemon-health.json（@hourly 采集）
// → 超阈值触发 /compact 建议，超高位阈值建议重启。
//
// ⚠️ 铁律：疲劳检测是观察层——评分失败绝不抛错阻塞 daemon 主循环。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '@sofagent/core';

// ── 阈值与权重（单一事实源）──

/** 连续失败几次算满信号（5 次连续失败 = 信号 1 拉满） */
export const FAILURE_SATURATION = 5;
/** 疲劳分权重：连续失败 40 / 窗口占用 30 / 输出相似度 30 */
export const WEIGHT_FAILURES = 40;
export const WEIGHT_WINDOW = 30;
export const WEIGHT_SIMILARITY = 30;
/** 建议 /compact 的疲劳分阈值（含） */
export const COMPACT_THRESHOLD = 60;
/** 建议重启的疲劳分阈值（含） */
export const RESTART_THRESHOLD = 85;
/** 相似度计算的最小 token 数（太短的输出不算查重——避免空串误报） */
const MIN_TOKENS_FOR_SIMILARITY = 5;
/** 输出历史环形缓冲容量（只对最近 N 条做查重） */
const OUTPUT_HISTORY_CAP = 20;

/** 三个疲劳信号的原始采集值 */
export interface FatigueSignals {
  /** 信号 1：同一工具连续失败的最大次数（跨工具取最严重） */
  toolConsecutiveFailures: number;
  /** 信号 2：上下文窗口占用率（0-1，1 = 满） */
  windowOccupancy: number;
  /** 信号 3：最新输出与历史输出的最大相似度（0-1，Jaccard token 集） */
  outputSimilarity: number;
}

/** 疲劳度评分结果 */
export interface FatigueReport {
  /** 综合疲劳分（0-100） */
  score: number;
  /** 原始三信号（取证用） */
  signals: FatigueSignals;
  /** 建议动作 */
  action: FatigueAction;
  /** 评分时间（ISO 8601） */
  ts: string;
  /** 人读摘要（如「连续失败拉满 + 窗口 92%，建议重启」） */
  summary: string;
}

/** 疲劳度建议动作（三级） */
export type FatigueAction = 'none' | 'compact' | 'restart';

/**
 * 从三信号计算综合疲劳分（0-100，加权）。
 *   连续失败：min(failures / FAILURE_SATURATION, 1) × 40
 *   窗口占用：occupancy（截断 0-1）× 30
 *   输出相似：similarity（截断 0-1）× 30
 */
export function computeFatigueScore(signals: FatigueSignals): number {
  const failures = Math.max(0, signals.toolConsecutiveFailures);
  const window = clamp01(signals.windowOccupancy);
  const similarity = clamp01(signals.outputSimilarity);
  const score =
    WEIGHT_FAILURES * Math.min(failures / FAILURE_SATURATION, 1) +
    WEIGHT_WINDOW * window +
    WEIGHT_SIMILARITY * similarity;
  return Math.round(score);
}

/** 从疲劳分映射建议动作 */
export function recommendAction(score: number): FatigueAction {
  if (score >= RESTART_THRESHOLD) return 'restart';
  if (score >= COMPACT_THRESHOLD) return 'compact';
  return 'none';
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * 输出相似度——token 集 Jaccard（|A∩B| / |A∪B|）。
 * 太短的输出（token < MIN_TOKENS_FOR_SIMILARITY）不参与，返回 0。
 */
export function outputSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size < MIN_TOKENS_FOR_SIMILARITY || tb.size < MIN_TOKENS_FOR_SIMILARITY) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

/** 分词——按非字母数字非 CJK 切分，小写化，去空 */
function tokenize(text: string): Set<string> {
  const tokens = String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  return new Set(tokens);
}

/**
 * 疲劳度追踪器——运行时增量采集三信号。
 *
 * 用法（daemon 主循环 / @hourly cron）：
 *   const tracker = new FatigueTracker();
 *   tracker.recordToolCall('run_bash', false);  // 工具失败
 *   tracker.setWindowOccupancy(0.92);           // 窗口占用
 *   tracker.recordOutput(agentReply);           // Agent 输出
 *   const report = tracker.assess();            // 评分 + 建议
 *   writeFatigueReport(report);                 // 落 daemon-health.json
 */
export class FatigueTracker {
  /** 每工具连续失败计数（成功后归零） */
  private readonly failures = new Map<string, number>();
  /** 最近一次窗口占用率 */
  private windowOccupancy = 0;
  /** 输出历史环形缓冲（查重用） */
  private readonly outputs: string[] = [];

  /**
   * 记录一次工具调用结果。
   * 失败 → 该工具连续失败计数 +1；成功 → 归零。
   * @returns 该工具当前连续失败次数
   */
  recordToolCall(toolName: string, success: boolean): number {
    if (success) {
      this.failures.set(toolName, 0);
      return 0;
    }
    const next = (this.failures.get(toolName) ?? 0) + 1;
    this.failures.set(toolName, next);
    return next;
  }

  /** 获取某工具当前连续失败次数（未记录过 = 0） */
  getConsecutiveFailures(toolName: string): number {
    return this.failures.get(toolName) ?? 0;
  }

  /** 设置上下文窗口占用率（自动截断 0-1） */
  setWindowOccupancy(ratio: number): void {
    this.windowOccupancy = clamp01(ratio);
  }

  /** 记录一条 Agent 输出（环形缓冲，超过容量丢最旧） */
  recordOutput(text: string): void {
    this.outputs.push(String(text ?? ''));
    if (this.outputs.length > OUTPUT_HISTORY_CAP) {
      this.outputs.shift();
    }
  }

  /**
   * 采集当前三信号快照。
   * 信号 1 取跨工具最大连续失败数（最严重的撞墙）。
   * 信号 3 取最新输出与历史输出的最大相似度（无历史 = 0）。
   */
  collectSignals(): FatigueSignals {
    let maxFailures = 0;
    for (const count of this.failures.values()) {
      if (count > maxFailures) maxFailures = count;
    }

    let similarity = 0;
    if (this.outputs.length >= 2) {
      const latest = this.outputs[this.outputs.length - 1]!;
      for (let i = 0; i < this.outputs.length - 1; i++) {
        const s = outputSimilarity(latest, this.outputs[i]!);
        if (s > similarity) similarity = s;
      }
    }

    return {
      toolConsecutiveFailures: maxFailures,
      windowOccupancy: this.windowOccupancy,
      outputSimilarity: similarity,
    };
  }

  /** 评估疲劳度——采集信号 + 评分 + 建议动作 + 摘要 */
  assess(): FatigueReport {
    const signals = this.collectSignals();
    const score = computeFatigueScore(signals);
    const action = recommendAction(score);
    return {
      score,
      signals,
      action,
      ts: new Date().toISOString(),
      summary: buildSummary(signals, score, action),
    };
  }

  /** 重置全部信号（compact / 重启后调用） */
  reset(): void {
    this.failures.clear();
    this.windowOccupancy = 0;
    this.outputs.length = 0;
  }
}

/** 生成人读摘要 */
function buildSummary(signals: FatigueSignals, score: number, action: FatigueAction): string {
  const parts: string[] = [];
  if (signals.toolConsecutiveFailures > 0) {
    parts.push(`同一工具连续失败 ${signals.toolConsecutiveFailures} 次`);
  }
  if (signals.windowOccupancy > 0) {
    parts.push(`窗口占用 ${Math.round(signals.windowOccupancy * 100)}%`);
  }
  if (signals.outputSimilarity > 0) {
    parts.push(`输出查重 ${Math.round(signals.outputSimilarity * 100)}%`);
  }
  const signalText = parts.length > 0 ? parts.join(' + ') : '无疲劳信号';
  const actionText =
    action === 'restart' ? '建议重启' : action === 'compact' ? '建议 /compact 压缩上下文' : '状态正常';
  return `${signalText} → 疲劳分 ${score}，${actionText}`;
}

/** daemon-health.json 路径解析（与 daemon-health.ts 同口径） */
function resolveHealthPath(dataDir?: string): string {
  const dir = dataDir ?? process.env.SOFAGENT_DATA ?? DATA_DIR;
  return path.join(dir, 'daemon-health.json');
}

/**
 * 把疲劳度报告合并写入 daemon-health.json（@hourly 采集落点）。
 *
 * 合并语义：读取现有 health 文件 → 只增改 fatigue 字段 → 写回；
 * 文件不存在时创建只含 fatigue 的最小文件（daemon 主循环的
 * writeHealthFile 重写时会保留 fatigue——见 daemon-health.ts）。
 * 写失败返回 false，绝不抛错（观察层不阻塞主循环）。
 *
 * @param report 疲劳度报告
 * @param dataDir 数据目录覆盖（测试隔离用）
 */
export function writeFatigueReport(report: FatigueReport, dataDir?: string): boolean {
  const healthPath = resolveHealthPath(dataDir);
  try {
    let health: Record<string, unknown> = {};
    if (fs.existsSync(healthPath)) {
      try {
        health = JSON.parse(fs.readFileSync(healthPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        health = {}; // 文件损坏——重建
      }
    }
    health.fatigue = report;
    const dir = path.dirname(healthPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(healthPath, JSON.stringify(health, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 daemon-health.json 读取疲劳度报告。
 * @returns 疲劳报告；未采集过或文件损坏返回 null
 */
export function readFatigueReport(dataDir?: string): FatigueReport | null {
  const healthPath = resolveHealthPath(dataDir);
  if (!fs.existsSync(healthPath)) return null;
  try {
    const health = JSON.parse(fs.readFileSync(healthPath, 'utf-8')) as { fatigue?: FatigueReport };
    return health.fatigue ?? null;
  } catch {
    return null;
  }
}
