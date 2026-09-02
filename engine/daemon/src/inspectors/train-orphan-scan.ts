// ============================================================
// train-orphan-scan.ts · 训练孤儿任务巡检（v1.4.4 块七 · @daily）
// ============================================================
//
// 扫 data/train/ 下 state=running/checkpointing 的 job → 校验子进程
// pid 存活（process.kill(pid, 0) 探测）→ 死进程标记 + 告警返回。
//
// 依赖方向：daemon 侧不动态 require orchestrator（dist 禁构建期间可能
// 陈旧）——直接按磁盘契约读 state.json（train-job.ts 的持久化格式是
// 稳定契约：data/train/<enterpriseId>/<jobId>/state.json）。
// 与 crash-recovery.ts 的分工：那边是「引擎启动时」的主动恢复扫描
// （标 interrupted），这边是「每日巡检」的观测告警（只发现不动状态，
// 交给引擎下次启动的 crash-recovery 处置——观察者不动手）。
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';

/** 存活探测注入点（测试 mock process.kill 用） */
export type ProbeFn = (pid: number) => boolean;

/** state.json 的最小读取契约（只取巡检需要的字段） */
interface TrainStateSnapshot {
  jobId: string;
  enterpriseId: string;
  status: string;
  pid?: number;
}

/** 默认探测器：kill(pid, 0)——ESRCH = 不存在，EPERM = 存在但无权限 */
function defaultProbe(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

/** 读单个 state.json（坏数据降级 null） */
function readStateFile(statePath: string): TrainStateSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Partial<TrainStateSnapshot>;
    if (typeof rec.jobId !== 'string' || typeof rec.enterpriseId !== 'string') return null;
    return {
      jobId: rec.jobId,
      enterpriseId: rec.enterpriseId,
      status: typeof rec.status === 'string' ? rec.status : 'unknown',
      ...(typeof rec.pid === 'number' ? { pid: rec.pid } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * 训练孤儿任务巡检（@daily）：
 * 扫描 data/train/ 下 running/checkpointing 状态的 job，探测子进程存活。
 *
 * 触发条件（triggered=true）：发现死进程假活 job（state 说在跑、进程已死）。
 * severity：warn——观测告警不动手，处置归引擎启动时的 crash-recovery。
 *
 * @param _projectDir 项目根目录（数据走 SOFAGENT_DATA 路径 SSOT）
 * @param probe 存活探测注入（测试用）
 */
export function runTrainOrphanScan(_projectDir: string, probe: ProbeFn = defaultProbe): InspectorResult {
  const env = loadEnvConfig();
  const trainRoot = join(env.dataDir, 'train');

  const name = 'train-orphan-scan';

  if (!existsSync(trainRoot)) {
    return {
      name,
      triggered: false,
      message: 'data/train/ 不存在，无训练任务，孤儿扫描跳过',
      severity: 'info',
    };
  }

  const activeJobs: TrainStateSnapshot[] = [];
  const orphans: TrainStateSnapshot[] = [];

  // 企业分区 → job 目录 → state.json（磁盘契约直扫）
  for (const ent of readdirSync(trainRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const entDir = join(trainRoot, ent.name);
    for (const jobEntry of readdirSync(entDir, { withFileTypes: true })) {
      if (!jobEntry.isDirectory()) continue;
      const state = readStateFile(join(entDir, jobEntry.name, 'state.json'));
      if (!state) continue;
      if (state.status !== 'running' && state.status !== 'checkpointing') continue;
      if (typeof state.pid !== 'number') continue;
      activeJobs.push(state);
      if (!probe(state.pid)) {
        orphans.push(state); // 假活：state 在跑、进程已死
      }
    }
  }

  if (activeJobs.length === 0) {
    return {
      name,
      triggered: false,
      message: '无运行中训练任务，孤儿扫描无发现',
      severity: 'info',
    };
  }

  if (orphans.length === 0) {
    return {
      name,
      triggered: false,
      message: `运行中训练任务 ${activeJobs.length} 个，子进程全部存活`,
      severity: 'info',
    };
  }

  const lines = orphans.map(
    (o) => `${o.enterpriseId}/${o.jobId}（pid=${o.pid}，state=${o.status}，进程已死）`,
  );
  return {
    name,
    triggered: true,
    message: `发现 ${orphans.length} 个孤儿训练任务（假活——建议引擎重启触发 crash-recovery）：${lines.join('；')}`,
    severity: 'warning',
  };
}
