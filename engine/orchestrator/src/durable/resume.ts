// ============================================================
// durable/resume.ts · L1 graph 状态恢复（v1.3.2 交付 4）
// ============================================================
//
// daemon 重启后扫描 checkpoint → 有未完成 graph（finalStatus 仍为
// running / awaiting_human）→ 从中断节点恢复 StateGraph。
//
// 流程：
//   1. scanPendingCheckpoints：扫描 checkpoint 目录，列出全部「未完成」
//      checkpoint（审计可见性）
//   2. resumePendingLoops：取最近一个未完成 checkpoint → 调
//      resumeLoopGraph（loop/graph.ts 既有恢复入口——resolveResumeNode
//      计算中断节点，before 重跑本节点 / after 跳下一节点）
//   3. 同时清理过期 checkpoint（CheckpointManager.cleanupStale，默认 7 天）
//
// 容错铁律：恢复失败不阻断 daemon 启动（观测失败仅告警）——
// resumeFn 抛错时记录到 summary.skipped 而不是让 daemon 崩溃。
//
// 零新依赖——复用 loop/graph.ts + checkpoint-manager.ts。
// ============================================================

import { CheckpointManager } from './checkpoint-manager';
import type { CheckpointRecord } from '../graph/checkpoint';
import { resumeLoopGraph, resolveCheckpointDir, type LoopGraphOptions, type LoopGraphResult } from '../loop/graph';

/** 未完成 checkpoint 信息（扫描结果） */
export interface PendingCheckpointInfo {
  /** checkpoint 文件绝对路径 */
  filePath: string;
  /** checkpoint 记录 */
  record: CheckpointRecord;
  /** 中断节点 */
  node: string;
  /** 快照阶段（before = 节点未执行完 / after = 已执行完） */
  phase: 'before' | 'after';
  /** 保存时间（ISO 8601） */
  savedAt: string;
}

/** resumePendingLoops 选项 */
export interface ResumeLoopsOptions {
  /** checkpoint 目录（默认 {SOFAGENT_DATA}/checkpoint） */
  checkpointDir?: string;
  /** 数据目录（透传给 resumeLoopGraph） */
  dataDir?: string;
  /** 静默模式（透传给 resumeLoopGraph） */
  silent?: boolean;
  /** 恢复函数（可注入 mock——测试不跑真实图） */
  resumeFn?: (options: LoopGraphOptions) => Promise<LoopGraphResult | null>;
  /** 日志输出 */
  log?: (msg: string) => void;
}

/** resumePendingLoops 结果汇总 */
export interface ResumeLoopsSummary {
  /** 扫描到的 checkpoint 文件数 */
  scanned: number;
  /** 未完成（pending）checkpoint 列表 */
  pending: PendingCheckpointInfo[];
  /** 实际发起恢复的次数（最近一个 pending） */
  resumed: number;
  /** 因异常跳过/失败的 checkpointId 列表 */
  skipped: string[];
  /** 各恢复结果（checkpointId → 终态） */
  results: Array<{ checkpointId: string; finalStatus: string }>;
  /** 清理的过期 checkpoint 文件数 */
  cleaned: number;
}

/** 判定 checkpoint 是否未完成（可恢复） */
export function isPendingRecord(record: CheckpointRecord): boolean {
  const status = record.state?.finalStatus;
  return status === 'running' || status === 'awaiting_human';
}

/**
 * 扫描 checkpoint 目录，列出全部未完成（pending）checkpoint。
 *
 * @param checkpointDir checkpoint 目录
 * @returns 按保存时间升序的 pending 列表（最近的在最后）
 */
export function scanPendingCheckpoints(checkpointDir: string): PendingCheckpointInfo[] {
  const mgr = new CheckpointManager({ checkpointDir });
  const pending: PendingCheckpointInfo[] = [];
  for (const info of mgr.listFiles()) {
    const record = mgr.readFile(info.filePath);
    if (!record) continue; // 坏文件跳过
    if (!isPendingRecord(record)) continue;
    pending.push({
      filePath: info.filePath,
      record,
      node: record.node,
      phase: record.phase,
      savedAt: record.savedAt,
    });
  }
  // 🔴 修复：按 savedAt 时间排序（旧→新），确保 pending[length-1] 是最近的
  // CI 教训：readdir 顺序不保证时间序，导致 resume 选了较旧的而非最近的
  pending.sort((a, b) => {
    const ta = new Date(a.savedAt).getTime() || 0;
    const tb = new Date(b.savedAt).getTime() || 0;
    return ta - tb;
  });
  return pending;
}

/**
 * daemon 重启后的自动续跑入口——扫描 + 恢复最近一个未完成 graph + 清理过期。
 *
 * 恢复语义（与 resumeLoopGraph 一致）：最近一次 checkpoint 未完成
 * （running / awaiting_human）→ 从中断节点续跑；已完成 → 不恢复。
 *
 * @param options 选项（resumeFn 可注入 mock）
 * @returns ResumeLoopsSummary
 */
export async function resumePendingLoops(options: ResumeLoopsOptions = {}): Promise<ResumeLoopsSummary> {
  const log = options.log ?? (() => {});
  // checkpointDir 缺省时按 loop/graph.ts resolveCheckpointDir 同规则解析
  const checkpointDir = options.checkpointDir ?? resolveCheckpointDir();
  const mgr = new CheckpointManager({ checkpointDir });

  // 1. 扫描全部 pending
  const pending = scanPendingCheckpoints(checkpointDir);
  log(`♻️ resume: 扫描 ${mgr.listFiles().length} 个 checkpoint，${pending.length} 个未完成`);

  // 2. 清理过期（默认保留 7 天）
  const cleaned = mgr.cleanupStale();
  if (cleaned.length > 0) {
    log(`🧹 resume: 清理 ${cleaned.length} 个过期 checkpoint`);
  }

  // 3. 恢复最近一个 pending（未注入 resumeFn 时默认调 resumeLoopGraph）
  const resumed: string[] = [];
  const skipped: string[] = [];
  const results: ResumeLoopsSummary['results'] = [];

  if (pending.length > 0) {
    const latest = pending[pending.length - 1]!;
    const resumeFn = options.resumeFn ?? defaultResumeFn;
    try {
      const result = await resumeFn({
        checkpointDir,
        ...(options.dataDir ? { dataDir: options.dataDir } : {}),
        silent: options.silent ?? true,
      });
      if (result) {
        resumed.push(latest.record.checkpointId);
        results.push({ checkpointId: latest.record.checkpointId, finalStatus: result.finalStatus });
        log(`♻️ resume: ${latest.record.checkpointId} 续跑完成 → ${result.finalStatus}`);
      } else {
        skipped.push(latest.record.checkpointId);
        log(`ℹ️ resume: ${latest.record.checkpointId} 无可恢复路径（已收尾）`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push(latest.record.checkpointId);
      log(`⚠️ resume: ${latest.record.checkpointId} 恢复失败（不阻断 daemon 启动）：${msg}`);
    }
  }

  return {
    scanned: mgr.listFiles().length,
    pending,
    resumed: resumed.length,
    skipped,
    results,
    cleaned: cleaned.length,
  };
}

/** 默认恢复函数——loop/graph.ts 的 resumeLoopGraph（从最近 checkpoint 续跑） */
const defaultResumeFn = async (options: LoopGraphOptions): Promise<LoopGraphResult | null> => {
  return resumeLoopGraph(options);
};
