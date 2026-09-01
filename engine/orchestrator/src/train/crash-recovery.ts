// crash-recovery.ts · v1.4.3 块七 · 引擎崩溃恢复（启动扫描 + 三选项决策 + 崩溃日志）
//
// 定位：引擎进程重启后的第一件事——「上一世」state=running 但子进程已死
// 的 job 怎么办。块二 scheduler 的 runs 注册表是进程内视角，引擎崩溃后
// 内存表丢失，磁盘 state.json 里却是 running——假活。本模块扫描假活、
// 标记 interrupted（区分 failed：中断是可恢复的），并给三选项决策接口。
//
// 三选项（不自动操作——铁律：恢复决策必须由调用方/人审选择）：
//   ① checkpoint 续跑（resumeTrainJob 建新 job 血缘链）
//   ② 标记失败终止（interrupted → failed）
//   ③ 人审决定（保持 interrupted 挂起，等人工介入）
//
// 崩溃前状态落 data/train/engine-crash-log.jsonl（append-only，
// @sofagent/core atomicAppendSync）——每次引擎启动扫描发现假活即记一条。
//
// checkpoint 清单（manifest.json）：job 目录 checkpoints/ 子目录 +
// 版本清单（版本号/路径/step/创建时间），本文件实现读写工具并导出
// （cli train doctor 与下一波 reproduce 复用）。
//
// 挂钩点：本波不动 train-scheduler.ts（禁碰）——导出独立
// runCrashRecoveryScan(dataRoot) 供下一波在 scheduler 启动时挂钩。

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { atomicAppendSync, atomicWriteSync } from '@sofagent/core';
import {
  loadTrainJobRecord,
  saveTrainJobRecord,
  trainJobDir,
  type TrainJobRecord,
} from './train-job';

// ════════════════════════════════════════
// 可注入依赖
// ════════════════════════════════════════

/** 进程存活探测（默认 process.kill(pid, 0)——0 信号只探测不真发） */
export type ProbeFn = (pid: number) => boolean;

/** 默认探测器：kill(pid, 0)——ESRCH 抛错 = 进程不存在 */
function defaultProbe(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM = 进程存在但无权限发信号——仍视为存活
    return code === 'EPERM';
  }
}

// ════════════════════════════════════════
// 假活扫描（state=running 但子进程已死）
// ════════════════════════════════════════

/** 崩溃恢复扫描的单个发现（假活 job） */
export interface CrashRecoveryFinding {
  enterpriseId: string;
  jobId: string;
  /** state.json 记录的 pid（探测已死） */
  pid: number;
  /** 记录的 status（running / checkpointing——均按假活处理） */
  status: string;
  /** 是否有可用 checkpoint（三选项①的前置条件） */
  hasCheckpoint: boolean;
}

/** 扫描结果 */
export interface CrashRecoveryScanResult {
  /** 发现的假活 job（已标 interrupted + 已写崩溃日志） */
  findings: CrashRecoveryFinding[];
  /** 扫描的 state.json 总数 */
  scannedJobs: number;
  /** 扫描时间 ISO */
  scannedAt: string;
}

/**
 * 引擎启动崩溃扫描：data/train 下全部 state=running/checkpointing 的 job
 * → 探测 pid 存活 → 死进程标 **interrupted**（可恢复中断——区分 failed）
 * + 写 train_engine_crash_recover 审计事件到 engine-crash-log.jsonl。
 *
 * 不做任何恢复动作（三选项由调用方决策）——只把假活显性化。
 *
 * @param dataRoot 数据根（data 目录——扫描 dataRoot/train/<ent>/<job>/state.json）
 * @param probe 进程存活探测注入（测试 mock）
 */
export function runCrashRecoveryScan(dataRoot: string, probe: ProbeFn = defaultProbe): CrashRecoveryScanResult {
  const findings: CrashRecoveryFinding[] = [];
  const scannedAt = new Date().toISOString();
  const trainRoot = join(dataRoot, 'train');

  // 企业分区 → job 目录 → state.json（磁盘契约直扫——不依赖任何内存注册表）
  if (existsSync(trainRoot)) {
    for (const ent of readdirSync(trainRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const entDir = join(trainRoot, ent.name);
      for (const jobEntry of readdirSync(entDir, { withFileTypes: true })) {
        if (!jobEntry.isDirectory()) continue;
        const record = loadTrainJobRecord(dataRoot, ent.name, jobEntry.name);
        if (!record) continue;
        if (record.status !== 'running' && record.status !== 'checkpointing') continue;
        if (typeof record.pid !== 'number') continue;

        if (probe(record.pid)) continue; // 活着——引擎重启后子进程仍在跑（正常）

        // 假活：state 说 running，进程已死 → 标 interrupted + 记崩溃日志
        const hasCheckpoint = Boolean(record.lastCheckpoint ?? record.job.resumeFrom);
        const finding: CrashRecoveryFinding = {
          enterpriseId: record.enterpriseId,
          jobId: record.jobId,
          pid: record.pid,
          status: record.status,
          hasCheckpoint,
        };
        markInterrupted(dataRoot, record, '引擎崩溃恢复：子进程已死（pid 不存活）');
        appendEngineCrashLog(dataRoot, {
          type: 'train_engine_crash_recover',
          enterpriseId: record.enterpriseId,
          jobId: record.jobId,
          pid: record.pid,
          fromStatus: record.status,
          toStatus: 'interrupted',
          hasCheckpoint,
          ts: scannedAt,
        });
        findings.push(finding);
      }
    }
  }

  return { findings, scannedJobs: countStateFiles(trainRoot), scannedAt };
}

/** 状态机外置补丁：running/checkpointing → interrupted（直接写 state——见文头注记） */
function markInterrupted(dataRoot: string, record: TrainJobRecord, reason: string): void {
  const next: TrainJobRecord = {
    ...record,
    status: 'interrupted',
    updatedAt: new Date().toISOString(),
    reason,
  };
  saveTrainJobRecord(dataRoot, next);
}

/** 统计 train 根下 state.json 数量（扫描面记录） */
function countStateFiles(trainRoot: string): number {
  if (!existsSync(trainRoot)) return 0;
  let n = 0;
  for (const ent of readdirSync(trainRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    for (const jobEntry of readdirSync(join(trainRoot, ent.name), { withFileTypes: true })) {
      if (jobEntry.isDirectory() && existsSync(join(trainRoot, ent.name, jobEntry.name, 'state.json'))) {
        n += 1;
      }
    }
  }
  return n;
}

// ════════════════════════════════════════
// 崩溃日志（engine-crash-log.jsonl · append-only）
// ════════════════════════════════════════

/** 崩溃恢复日志条目（type-first——与协议事件流惯例对齐） */
export interface EngineCrashLogEntry {
  type: 'train_engine_crash_recover';
  enterpriseId: string;
  jobId: string;
  pid: number;
  fromStatus: string;
  toStatus: string;
  hasCheckpoint: boolean;
  ts: string;
}

/** 崩溃日志路径：data/train/engine-crash-log.jsonl */
export function engineCrashLogPath(dataRoot: string): string {
  return join(dataRoot, 'train', 'engine-crash-log.jsonl');
}

/** 追加一条崩溃日志（append-only——atomicAppendSync 互斥保护） */
export function appendEngineCrashLog(dataRoot: string, entry: EngineCrashLogEntry): void {
  const logPath = engineCrashLogPath(dataRoot);
  const dir = join(dataRoot, 'train');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicAppendSync(logPath, JSON.stringify(entry));
}

/** 读崩溃日志（坏行容忍——解析失败行丢弃，返回条数供告警） */
export function readEngineCrashLog(dataRoot: string): { entries: EngineCrashLogEntry[]; badLines: number } {
  const logPath = engineCrashLogPath(dataRoot);
  if (!existsSync(logPath)) return { entries: [], badLines: 0 };
  const entries: EngineCrashLogEntry[] = [];
  let badLines = 0;
  for (const line of readFileSync(logPath, 'utf-8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const obj = JSON.parse(line) as EngineCrashLogEntry;
      if (obj && obj.type === 'train_engine_crash_recover' && typeof obj.jobId === 'string') {
        entries.push(obj);
      } else {
        badLines += 1;
      }
    } catch {
      badLines += 1;
    }
  }
  return { entries, badLines };
}

// ════════════════════════════════════════
// 三选项恢复决策（枚举接口——不自动操作）
// ════════════════════════════════════════

/** 恢复决策枚举（块七三选项——由调用方显式选择） */
export const TRAIN_RECOVERY_DECISIONS = ['resume-checkpoint', 'mark-failed', 'human-review'] as const;
export type TrainRecoveryDecision = (typeof TRAIN_RECOVERY_DECISIONS)[number];

/** 决策结果 */
export interface RecoveryDecisionResult {
  decision: TrainRecoveryDecision;
  jobId: string;
  enterpriseId: string;
  /** 决策执行结果摘要（resume 场景 = 待调度器续跑的说明；其余 = 状态变更说明） */
  detail: string;
}

/**
 * 应用恢复决策（三选项——不自动操作，本函数只按调用方显式选择执行）：
 *   resume-checkpoint → 要求有 checkpoint，返回续跑前置条件说明（实际
 *     spawn 走 resumeTrainJob——需要调度器实例，本函数不做 spawn）
 *   mark-failed → interrupted → failed（直接写 state——状态机补丁同上）
 *   human-review → 保持 interrupted（决策本身即「挂起等人」）
 */
export function applyRecoveryDecision(
  dataRoot: string,
  enterpriseId: string,
  jobId: string,
  decision: TrainRecoveryDecision,
): RecoveryDecisionResult {
  const record = loadTrainJobRecord(dataRoot, enterpriseId, jobId);
  if (!record) {
    throw new Error(`[crash-recovery] 训练任务不存在：${jobId}（enterprise=${enterpriseId}）`);
  }

  switch (decision) {
    case 'resume-checkpoint': {
      const checkpoint = record.lastCheckpoint ?? record.job.resumeFrom;
      if (!checkpoint) {
        throw new Error(
          `[crash-recovery] 续跑失败：任务 ${jobId} 无 checkpoint（lastCheckpoint / resumeFrom 均缺）`,
        );
      }
      return {
        decision,
        jobId,
        enterpriseId,
        detail: `断点就绪（step=${checkpoint.step}），交由 resumeTrainJob 建新 job 血缘链续跑`,
      };
    }
    case 'mark-failed': {
      const next: TrainJobRecord = {
        ...record,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        reason: record.reason ?? '崩溃恢复决策：标记失败终止',
      };
      saveTrainJobRecord(dataRoot, next);
      return { decision, jobId, enterpriseId, detail: '已标 failed（终态——审计可追溯）' };
    }
    case 'human-review':
      return {
        decision,
        jobId,
        enterpriseId,
        detail: '保持 interrupted 挂起，等待人工介入',
      };
    default: {
      // 穷尽性保护（TS 层面已覆盖——运行时防御未知值）
      const exhaustive: never = decision;
      throw new Error(`[crash-recovery] 未知决策：${String(exhaustive)}`);
    }
  }
}

// ════════════════════════════════════════
// checkpoint 目录规范 + 版本清单（manifest.json 读写工具）
// ════════════════════════════════════════

/** checkpoint 版本清单条目 */
export interface CheckpointManifestEntry {
  /** 版本号（从 1 递增） */
  version: number;
  /** checkpoint 目录/文件路径 */
  checkpointPath: string;
  /** 断点步数 */
  step: number;
  /** 创建时间 ISO */
  createdAt: string;
}

/** checkpoint 版本清单（job 目录 checkpoints/manifest.json） */
export interface CheckpointManifest {
  /** 清单 schema 版本 */
  schemaVersion: 'v1';
  /** 所属 job */
  jobId: string;
  /** 版本列表（按 version 升序） */
  entries: CheckpointManifestEntry[];
}

/** manifest 路径：job 目录 checkpoints/manifest.json */
export function checkpointManifestPath(dataDir: string, enterpriseId: string, jobId: string): string {
  return join(trainJobDir(dataDir, enterpriseId, jobId), 'checkpoints', 'manifest.json');
}

/** 读 checkpoint 清单（不存在/坏数据降级空清单——调用方判空） */
export function loadCheckpointManifest(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
): CheckpointManifest {
  const manifestPath = checkpointManifestPath(dataDir, enterpriseId, jobId);
  if (!existsSync(manifestPath)) {
    return { schemaVersion: 'v1', jobId, entries: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as CheckpointManifest;
    if (parsed && Array.isArray(parsed.entries) && parsed.jobId === jobId) {
      return { schemaVersion: 'v1', jobId, entries: parsed.entries };
    }
    return { schemaVersion: 'v1', jobId, entries: [] };
  } catch {
    return { schemaVersion: 'v1', jobId, entries: [] };
  }
}

/**
 * 登记 checkpoint 版本（append 语义——version 自动递增）。
 *
 * 同 step 幂等：已存在同 step 条目时返回既有（不重复登记——与 job 幂等
 * 创建同一纪律）。checkpointPath 缺省按版本号生成约定名。
 */
export function recordCheckpointEntry(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
  step: number,
  checkpointPath?: string,
): { manifest: CheckpointManifest; entry: CheckpointManifestEntry; created: boolean } {
  const manifest = loadCheckpointManifest(dataDir, enterpriseId, jobId);
  const existing = manifest.entries.find((e) => e.step === step);
  if (existing) {
    return { manifest, entry: existing, created: false };
  }
  const version = manifest.entries.reduce((m, e) => Math.max(m, e.version), 0) + 1;
  const entry: CheckpointManifestEntry = {
    version,
    checkpointPath: checkpointPath ?? `checkpoints/ckpt-step-${step}`,
    step,
    createdAt: new Date().toISOString(),
  };
  const next: CheckpointManifest = {
    ...manifest,
    entries: [...manifest.entries, entry].sort((a, b) => a.version - b.version),
  };
  const manifestPath = checkpointManifestPath(dataDir, enterpriseId, jobId);
  const dir = join(manifestPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(manifestPath, JSON.stringify(next, null, 2));
  return { manifest: next, entry, created: true };
}
