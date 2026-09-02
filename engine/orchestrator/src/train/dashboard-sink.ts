// dashboard-sink.ts · v1.4.4 第一章 · 训练状态落盘（train-status.json + train-health.json）
//
// 定位：训练状态查询侧的数据出口——落盘 data/dashboard/train-status.json
// （供 Dashboard「训练任务」区块读取，对齐 worklog.json 落盘模式）+
// train-health.json（训练引擎健康度聚合：成功率/平均耗时/失败 top 原因/
// GPU 利用率——供 Dashboard 聚合 + 外部监控系统消费）。
//
// 只读聚合：数据源是 train-job 的 state.json / events.jsonl（既有落盘），
// 本文件不写任何 job 目录——落盘目标只有 data/dashboard/ 下两个 JSON。
//
// 测试纪律：dataDir 全注入（tmpdir 生命周期），零真实训练。

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import { listTrainJobRecords, type TrainJobRecord } from './train-job';
import { snapshotGpuMemory } from './process-guard';
import type { GpuQueueSnapshot } from './gpu-queue';

// ════════════════════════════════════════
// 落盘路径
// ════════════════════════════════════════

/** 训练状态落盘路径：data/dashboard/train-status.json（对齐 worklog.json 模式） */
export function trainStatusSinkPath(dataDir: string): string {
  return join(dataDir, 'dashboard', 'train-status.json');
}

/** 训练健康度落盘路径：data/dashboard/train-health.json */
export function trainHealthSinkPath(dataDir: string): string {
  return join(dataDir, 'dashboard', 'train-health.json');
}

// ════════════════════════════════════════
// train-status.json（当前在跑/最近完成/失败一览）
// ════════════════════════════════════════

/** 单任务一览条目（Dashboard 区块行级数据） */
export interface TrainStatusEntry {
  jobId: string;
  enterpriseId: string;
  status: TrainJobRecord['status'];
  baseModel: string;
  algorithm: string;
  /** 最近步数（events 流 progress 事件最大 step——未跑为 null） */
  lastStep: number | null;
  /** 最近 loss（最近一条带 loss 的 progress——无则 null） */
  lastLoss: number | null;
  createdAt: string;
  updatedAt: string;
  /** 失败/取消原因（终态才有） */
  reason?: string;
}

/** train-status.json 结构（当前在跑 + 最近完成 + 最近失败三组） */
export interface TrainStatusBoard {
  schemaVersion: 'v1';
  generatedAt: string;
  /** 当前在跑（running/checkpointing） */
  running: TrainStatusEntry[];
  /** 最近完成（completed 按 updatedAt 降序，最多 20） */
  recentCompleted: TrainStatusEntry[];
  /** 最近失败（failed/cancelled 按 updatedAt 降序，最多 20） */
  recentFailed: TrainStatusEntry[];
  /** 全企业任务总数（健康度口径同源） */
  totalJobs: number;
}

/**
 * 构建训练状态看板数据（全企业扫描——Dashboard 是运维视角不分企业）。
 *
 * step/loss 从 events.jsonl 尾部提取（不整读——最近 50 行滑窗）。
 */
export function buildTrainStatusBoard(
  dataDir: string,
  options: { now?: () => number; maxRows?: number } = {},
): TrainStatusBoard {
  const now = options.now ?? Date.now;
  const maxRows = options.maxRows ?? 20;
  const { existsSync: fsExists, readFileSync: fsRead, readdirSync: fsReaddir } = require('fs') as typeof import('fs');

  const records: TrainJobRecord[] = [];
  const trainRoot = join(dataDir, 'train');
  if (fsExists(trainRoot)) {
    for (const ent of fsReaddir(trainRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      records.push(...listTrainJobRecords(dataDir, ent.name));
    }
  }

  /** 从 events.jsonl 尾部提取 step/loss（滑窗——零全量解析） */
  const tailProgress = (enterpriseId: string, jobId: string): { step: number | null; loss: number | null } => {
    const eventsFile = join(dataDir, 'train', enterpriseId, jobId, 'events.jsonl');
    if (!fsExists(eventsFile)) return { step: null, loss: null };
    try {
      const lines = fsRead(eventsFile, 'utf-8').split('\n').filter((l) => l.trim() !== '');
      const window = lines.slice(-50);
      let step: number | null = null;
      let loss: number | null = null;
      for (const line of window) {
        try {
          const ev = JSON.parse(line) as { type?: string; step?: number; loss?: number };
          if (ev.type === 'progress') {
            if (typeof ev.step === 'number') step = ev.step;
            if (typeof ev.loss === 'number') loss = ev.loss;
          }
        } catch {
          /* 坏行容忍 */
        }
      }
      return { step, loss };
    } catch {
      return { step: null, loss: null };
    }
  };

  const toEntry = (rec: TrainJobRecord): TrainStatusEntry => {
    const progress = tailProgress(rec.enterpriseId, rec.jobId);
    return {
      jobId: rec.jobId,
      enterpriseId: rec.enterpriseId,
      status: rec.status,
      baseModel: rec.job.baseModel,
      algorithm: rec.job.algorithm,
      lastStep: progress.step,
      lastLoss: progress.loss,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      ...(rec.reason !== undefined ? { reason: rec.reason } : {}),
    };
  };

  const byUpdatedDesc = (a: TrainStatusEntry, b: TrainStatusEntry): number =>
    b.updatedAt.localeCompare(a.updatedAt);

  return {
    schemaVersion: 'v1',
    generatedAt: new Date(now()).toISOString(),
    running: records
      .filter((r) => r.status === 'running' || r.status === 'checkpointing')
      .map(toEntry)
      .sort(byUpdatedDesc),
    recentCompleted: records
      .filter((r) => r.status === 'completed')
      .map(toEntry)
      .sort(byUpdatedDesc)
      .slice(0, maxRows),
    recentFailed: records
      .filter((r) => r.status === 'failed' || r.status === 'cancelled' || r.status === 'interrupted')
      .map(toEntry)
      .sort(byUpdatedDesc)
      .slice(0, maxRows),
    totalJobs: records.length,
  };
}

// ════════════════════════════════════════
// train-health.json（训练引擎健康度聚合）
// ════════════════════════════════════════

/** 失败原因 Top 条目 */
export interface FailureReasonEntry {
  /** 归一化原因（失败 reason 的首段——OOM/数据格式/超参等分类前缀） */
  reason: string;
  count: number;
}

/** train-health.json 结构（成功率/平均耗时/失败 top 原因/GPU 利用率） */
export interface TrainHealthReport {
  schemaVersion: 'v1';
  generatedAt: string;
  /** 已收尾任务数（completed+failed+cancelled——在跑不计入） */
  finishedJobs: number;
  /** 成功率（completed / finishedJobs——0 任务时 null） */
  successRate: number | null;
  /** 平均耗时分钟（completed 任务 startedAtMs→finishedAt——无时间对时 null） */
  avgDurationMinutes: number | null;
  /** 失败 top 原因（归一化计数降序，最多 5） */
  failureTopReasons: FailureReasonEntry[];
  /** GPU 利用率快照（无 nvidia-smi 时 null——snapshotGpuMemory unsupported） */
  gpu: {
    supported: boolean;
    note: string;
    perGpuUsedMiB: number[] | null;
  } | null;
  /** 队列快照（scheduler 注入时携带——未注入 null） */
  queue: GpuQueueSnapshot | null;
}

/**
 * 构建训练健康度报告（聚合口径——外部监控系统消费同源）。
 *
 * GPU 利用率经注入（gpuSnapshot 可替换——测试零真实 nvidia-smi）；
 * queue 快照由调度器接线时传入（未接线的独立调用为 null）。
 */
export function buildTrainHealthReport(
  dataDir: string,
  options: {
    now?: () => number;
    queue?: GpuQueueSnapshot | null;
    gpuSnapshot?: () => ReturnType<typeof snapshotGpuMemory>;
  } = {},
): TrainHealthReport {
  const now = options.now ?? Date.now;
  const { existsSync: fsExists, readdirSync: fsReaddir } = require('fs') as typeof import('fs');

  const records: TrainJobRecord[] = [];
  const trainRoot = join(dataDir, 'train');
  if (fsExists(trainRoot)) {
    for (const ent of fsReaddir(trainRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      records.push(...listTrainJobRecords(dataDir, ent.name));
    }
  }

  const finished = records.filter(
    (r) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled',
  );
  const completed = finished.filter((r) => r.status === 'completed');

  // 平均耗时（startedAtMs + finishedAt 齐全才算数——口径宁缺毋滥）
  const durationsMin: number[] = [];
  for (const r of completed) {
    if (typeof r.startedAtMs === 'number' && r.finishedAt !== undefined) {
      const endMs = Date.parse(r.finishedAt);
      if (!Number.isNaN(endMs) && endMs > r.startedAtMs) {
        durationsMin.push((endMs - r.startedAtMs) / 60_000);
      }
    }
  }
  const avgDurationMinutes =
    durationsMin.length > 0
      ? Math.round((durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length) * 10) / 10
      : null;

  // 失败 top 原因（归一化：reason 首段截断——诊断分类前缀保留）
  const reasonCounts = new Map<string, number>();
  for (const r of finished) {
    if (r.status === 'completed' || r.reason === undefined) continue;
    const normalized = r.reason.split('：')[0]!.slice(0, 80);
    reasonCounts.set(normalized, (reasonCounts.get(normalized) ?? 0) + 1);
  }
  const failureTopReasons: FailureReasonEntry[] = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  // GPU 利用率（注入优先——生产缺省 snapshotGpuMemory）
  let gpu: TrainHealthReport['gpu'] = null;
  try {
    const snap = (options.gpuSnapshot ?? snapshotGpuMemory)();
    gpu = {
      supported: snap.supported,
      note: snap.note,
      perGpuUsedMiB: snap.perGpuUsedMiB ?? null,
    };
  } catch {
    gpu = null; // nvidia-smi 不可用——降级 null（如实报告）
  }

  return {
    schemaVersion: 'v1',
    generatedAt: new Date(now()).toISOString(),
    finishedJobs: finished.length,
    successRate: finished.length > 0 ? Math.round((completed.length / finished.length) * 1000) / 1000 : null,
    avgDurationMinutes,
    failureTopReasons,
    gpu,
    queue: options.queue ?? null,
  };
}

// ════════════════════════════════════════
// 落盘出口（scheduler 终态回调 / CLI 定时驱动）
// ════════════════════════════════════════

/**
 * 落盘训练状态看板 + 健康度报告（原子写——一次调用两文件同步刷新）。
 *
 * 驱动时机：① 训练终态事件（scheduler onEvent 接线）② CLI/MCP 手动刷新。
 * 落盘失败抛错由调用方决定（CLI 降级告警；scheduler 事件链路捕获不阻断）。
 */
export function flushTrainDashboard(
  dataDir: string,
  options: {
    now?: () => number;
    queue?: GpuQueueSnapshot | null;
    gpuSnapshot?: () => ReturnType<typeof snapshotGpuMemory>;
  } = {},
): { statusFile: string; healthFile: string } {
  const statusFile = trainStatusSinkPath(dataDir);
  const healthFile = trainHealthSinkPath(dataDir);
  const dashboardDir = join(statusFile, '..');
  if (!existsSync(dashboardDir)) mkdirSync(dashboardDir, { recursive: true });

  const board = buildTrainStatusBoard(dataDir, options);
  const health = buildTrainHealthReport(dataDir, options);
  atomicWriteSync(statusFile, JSON.stringify(board, null, 2));
  atomicWriteSync(healthFile, JSON.stringify(health, null, 2));
  return { statusFile, healthFile };
}
