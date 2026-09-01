// process-guard.ts · v1.4.3 块七 · 训练进程守卫（心跳监听 + 异常回收 + 孤儿检测）
//
// 定位：训练子进程的「看门狗」。spawn 之后 Python 训练进程归谁管？
// scheduler 管正常生命周期（事件回流 / SIGINT 存档），process-guard 管
// 异常面：心跳消失判卡死 → 异常回收四步（杀进程组 / GPU 显存通知 /
// 临时文件清理 / 审计留痕），以及无主孤儿训练进程的识别告警。
//
// 与块二的衔接：registerHeartbeat(pid, jobId) 签名与 train-scheduler.ts
// 预留的 RegisterHeartbeat 注入点完全一致——本波只实现本体，scheduler
// 挂钩（spawn 后自动注册 + 事件回流时刷新心跳）留下一波。
//
// 审计事件写入（方案 A：复用 train-audit.ts 的受控写入口）：开工时
// train-audit.ts 尚未落地，本文件先按方案 B 自持轻量写入器；实现期间
// train-audit.ts 合入且其 TrainAuditEventType union 已预留
// 'train_abnormal_exit' 扩展位——遂切换方案 A，emitTrainAbnormalExit 改为
// emitTrainAudit 的薄代理（steps 明细走 reason 摘要 + 全量 detail 落
// job 目录 reclaim-detail.jsonl，避免撑爆审计行）。HMAC 链由此完整。
//
// A2 纪律：全部副作用（kill/exec/unlink/时钟）可注入，测试零真实进程。

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { atomicAppendSync } from '@sofagent/core';
import { trainJobDir } from './train-job';
import { emitTrainAudit, computeDataSourceHash } from './train-audit';

// ════════════════════════════════════════
// 可注入依赖（测试零真实进程 · 零真实 shell）
// ════════════════════════════════════════

/** 进程信号发送（默认 process.kill——测试注入观察器） */
export type KillFn = (pid: number, signal: NodeJS.Signals | number) => void;

/** 同步执行外部命令（默认 execFileSync——测试注入） */
export type ExecFn = (cmd: string, args: string[]) => string;

/** 时钟注入（缺省 Date.now——测试冻结时间） */
export type NowFn = () => number;

/** 单次心跳登记（内部表结构） */
interface HeartbeatEntry {
  pid: number;
  jobId: string;
  /** 最近一次心跳时间戳（ms） */
  lastBeatMs: number;
  /** 注册时间戳（ms） */
  registeredAtMs: number;
}

/** 卡死进程检测结果（超过阈值无心跳） */
export interface StalledProcess {
  pid: number;
  jobId: string;
  /** 最近一次心跳时间戳（ms） */
  lastBeatMs: number;
  /** 距当前的无心跳时长（ms） */
  silentMs: number;
}

// ════════════════════════════════════════
// 心跳监听（registerHeartbeat 与块二注入点同签名）
// ════════════════════════════════════════

/** 心跳守卫选项 */
export interface ProcessGuardOptions {
  /** 无心跳判卡死阈值（ms，缺省 120_000 = 120s） */
  staleThresholdMs?: number;
  /** 时钟注入（测试冻结时间用） */
  now?: NowFn;
}

/** 心跳守卫实例（进程内单例视角——跨进程恢复走 crash-recovery） */
export interface ProcessGuard {
  /** 注册心跳（spawn 后调用——签名对齐块二 RegisterHeartbeat 注入点） */
  registerHeartbeat: (pid: number, jobId: string) => void;
  /** 刷新心跳（事件回流时调用——下一波 scheduler 挂钩点） */
  markHeartbeat: (pid: number) => boolean;
  /** 注销心跳（进程正常退出后调用——防表膨胀） */
  unregisterHeartbeat: (pid: number) => void;
  /** 检测卡死进程（超过阈值无心跳——触发异常回收的判据） */
  detectStalled: () => StalledProcess[];
  /** 当前注册表大小（诊断用） */
  size: () => number;
}

/**
 * 创建心跳守卫（进程内注册表）。
 *
 * registerHeartbeat(pid, jobId) 与 train-scheduler 的
 * RegisterHeartbeat = (pid: number, jobId: string) => void 完全同构，
 * 下一波直接 `createTrainScheduler({ registerHeartbeat: guard.registerHeartbeat })` 挂钩。
 */
export function createProcessGuard(opts: ProcessGuardOptions = {}): ProcessGuard {
  const staleThresholdMs = opts.staleThresholdMs ?? 120_000;
  const now = opts.now ?? Date.now;
  const table = new Map<number, HeartbeatEntry>();

  return {
    registerHeartbeat(pid: number, jobId: string): void {
      if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) {
        throw new Error(`[process-guard] 非法 pid：${pid}（job=${jobId}）`);
      }
      if (typeof jobId !== 'string' || jobId.trim() === '') {
        throw new Error(`[process-guard] 非法 jobId：${jobId}（pid=${pid}）`);
      }
      const t = now();
      table.set(pid, { pid, jobId, lastBeatMs: t, registeredAtMs: t });
    },

    markHeartbeat(pid: number): boolean {
      const entry = table.get(pid);
      if (!entry) return false;
      entry.lastBeatMs = now();
      return true;
    },

    unregisterHeartbeat(pid: number): void {
      table.delete(pid);
    },

    detectStalled(): StalledProcess[] {
      const t = now();
      const stalled: StalledProcess[] = [];
      for (const entry of table.values()) {
        const silentMs = t - entry.lastBeatMs;
        if (silentMs > staleThresholdMs) {
          stalled.push({
            pid: entry.pid,
            jobId: entry.jobId,
            lastBeatMs: entry.lastBeatMs,
            silentMs,
          });
        }
      }
      // 按 pid 排序稳定输出（测试断言与日志可读性）
      stalled.sort((a, b) => a.pid - b.pid);
      return stalled;
    },

    size(): number {
      return table.size;
    },
  };
}

// ════════════════════════════════════════
// GPU 显存快照（尽力而为——无 nvidia-smi 记 unsupported 不装假数据）
// ════════════════════════════════════════

/** GPU 显存快照（nvidia-smi 不可用时 supported=false） */
export interface GpuMemorySnapshot {
  /** 是否有可用的 nvidia-smi */
  supported: boolean;
  /** 各卡已用显存（MiB——supported=true 时存在） */
  perGpuUsedMiB?: number[];
  /** 汇总信息（unsupported 时给出原因） */
  note: string;
}

/** 抓取 GPU 显存快照（execFn 可注入——测试零 shell） */
export function snapshotGpuMemory(execFn: ExecFn = defaultExecFn): GpuMemorySnapshot {
  try {
    // csv,noheader,nounits → 每卡一行纯数字（MiB）
    const out = execFn('nvidia-smi', [
      '--query-gpu=memory.used',
      '--format=csv,noheader,nounits',
    ]);
    const perGpu = out
      .split('\n')
      .map((l) => parseInt(l.trim(), 10))
      .filter((n) => Number.isFinite(n));
    if (perGpu.length === 0) {
      return { supported: true, note: 'nvidia-smi 返回无有效数据行' };
    }
    return { supported: true, perGpuUsedMiB: perGpu, note: `${perGpu.length} 卡` };
  } catch (err) {
    // ENOENT（无 nvidia-smi）/ 超时等一律降级 unsupported——不装假数据
    return {
      supported: false,
      note: `nvidia-smi 不可用：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 默认执行器（execFileSync 包装——timeout 5s 防 CLI 挂死） */
function defaultExecFn(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5_000 });
}

// ════════════════════════════════════════
// 异常回收（四步：杀进程组 → GPU 通知 → 临时文件 → 审计事件）
// ════════════════════════════════════════

/** 异常回收目标（卡死的 job——由 detectStalled / crash-recovery 产出） */
export interface ReclaimTarget {
  enterpriseId: string;
  jobId: string;
  pid: number;
  /** 卡死/异常原因（进审计事件 reason） */
  reason: string;
  /** 训练数据路径（审计 dataSourceHash 指纹源——缺省 'unknown'） */
  dataPath?: string;
}

/** 单步执行结果 */
export interface ReclaimStep {
  name: 'kill' | 'gpu-notify' | 'tmp-cleanup' | 'audit';
  /** 本步是否成功（false = 降级/失败但有记录——不中断后续步骤） */
  ok: boolean;
  /** 人读摘要（进审计 detail.steps） */
  detail: string;
}

/** 异常回收结果（四步全记录——逐步降级不抛出） */
export interface ReclaimResult {
  target: ReclaimTarget;
  steps: ReclaimStep[];
  /** 四步全部 ok（gpu unsupported 不算失败——记 note） */
  allOk: boolean;
}

/** 异常回收选项（全部可注入） */
export interface ReclaimOptions {
  killFn?: KillFn;
  execFn?: ExecFn;
}

/**
 * 进程组级杀除：先 `kill(-pid, SIGKILL)`（进程组——spawn detached:true 时
 * 负 pid 命中整组），失败降级 `kill(pid, SIGKILL)` 单杀并记录。
 *
 * @returns kill 步骤结果（ok=true 表示组杀或降级单杀至少其一成功）
 */
export function killProcessGroup(
  pid: number,
  killFn: KillFn = (p, s) => process.kill(p, s),
): ReclaimStep {
  try {
    killFn(-pid, 'SIGKILL'); // 负 pid = 进程组（detached spawn 的组长）
    return { name: 'kill', ok: true, detail: `进程组 -${pid} SIGKILL 成功` };
  } catch (groupErr) {
    // 组杀失败（非 detached spawn / 组已空）→ 降级单杀
    try {
      killFn(pid, 'SIGKILL');
      return {
        name: 'kill',
        ok: true,
        detail: `进程组杀除失败（${errMsg(groupErr)}），降级单杀 ${pid} SIGKILL 成功`,
      };
    } catch (soloErr) {
      return {
        name: 'kill',
        ok: false,
        detail: `进程组与单杀均失败：组=${errMsg(groupErr)} 单=${errMsg(soloErr)}`,
      };
    }
  }
}

/**
 * 异常回收四步（对单个卡死 job 执行——逐步降级，异常不外抛）：
 *   ① 进程组级杀除（killProcessGroup）
 *   ② GPU 显存释放通知（释放前后各一次快照——尽力而为）
 *   ③ 临时文件清理（job 目录下 tmp 前缀文件）
 *   ④ train_abnormal_exit 审计事件（audit.jsonl append-only）
 *
 * @param dataDir 数据根（job 目录 = data/train/<enterpriseId>/<jobId>/）
 */
export function abnormalReclaim(
  dataDir: string,
  target: ReclaimTarget,
  opts: ReclaimOptions = {},
): ReclaimResult {
  const killFn = opts.killFn ?? ((p, s) => process.kill(p, s));
  const execFn = opts.execFn ?? defaultExecFn;
  const steps: ReclaimStep[] = [];

  // ① 进程组级杀除
  steps.push(killProcessGroup(target.pid, killFn));

  // ② GPU 显存释放通知（前后快照对比——unsupported 只记 note 不算失败）
  let gpuStep: ReclaimStep;
  try {
    const before = snapshotGpuMemory(execFn);
    if (!before.supported) {
      gpuStep = { name: 'gpu-notify', ok: true, detail: `unsupported：${before.note}` };
    } else {
      gpuStep = {
        name: 'gpu-notify',
        ok: true,
        detail: `释放前 ${before.perGpuUsedMiB?.join('/') ?? '?'} MiB（释放后快照由下次扫描复核）`,
      };
    }
  } catch (err) {
    gpuStep = { name: 'gpu-notify', ok: true, detail: `unsupported：${errMsg(err)}` };
  }
  steps.push(gpuStep);

  // ③ 临时文件清理（job 目录顶层 tmp 前缀文件——保守不递归）
  steps.push(cleanupTmpFiles(dataDir, target.enterpriseId, target.jobId));

  // ④ 审计事件（方案 A：train-audit 受控写入口）
  const auditStep = emitTrainAbnormalExit(dataDir, target, steps.slice(0, 3));
  steps.push(auditStep);

  return { target, steps, allOk: steps.every((s) => s.ok) };
}

/** 清理 job 目录下 tmp 前缀文件（顶层——readdirSync + unlinkSync） */
export function cleanupTmpFiles(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
): ReclaimStep {
  const jobDir = trainJobDir(dataDir, enterpriseId, jobId);
  if (!existsSync(jobDir)) {
    return { name: 'tmp-cleanup', ok: true, detail: `job 目录不存在，跳过清理（${jobDir}）` };
  }
  const removed: string[] = [];
  try {
    for (const entry of readdirSync(jobDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith('tmp')) continue;
      unlinkSync(join(jobDir, entry.name));
      removed.push(entry.name);
    }
    return {
      name: 'tmp-cleanup',
      ok: true,
      detail: removed.length > 0 ? `已清理 ${removed.length} 个：${removed.join(', ')}` : '无 tmp 前缀文件',
    };
  } catch (err) {
    return { name: 'tmp-cleanup', ok: false, detail: `清理失败：${errMsg(err)}` };
  }
}

// ════════════════════════════════════════
// 审计事件（方案 A：emitTrainAudit 薄代理——HMAC 链由此完整）
// ════════════════════════════════════════

/**
 * 写 train_abnormal_exit 审计事件（复用 train-audit.ts 受控写入口）：
 *   - 主事件走 emitTrainAudit（脱敏 + HMAC 链 + chmod 600——与其他训练
 *     生命周期事件同链）；steps 明细全量落 job 目录 reclaim-detail.jsonl
 *     （append-only 观测明细，不进审计行避免单行过大）
 *   - dataSourceHash 取 job.dataPath 内容指纹（无 dataPath 时 'unknown'）
 *
 * 返回 audit 步骤结果（写失败 ok=false 但不抛——审计失败不回滚已执行的杀除）。
 */
export function emitTrainAbnormalExit(
  dataDir: string,
  target: ReclaimTarget,
  steps: ReclaimStep[],
): ReclaimStep {
  try {
    emitTrainAudit(
      {
        type: 'train_abnormal_exit',
        trainJobId: target.jobId,
        enterpriseId: target.enterpriseId,
        dataSourceHash: computeDataSourceHash(target.dataPath ?? ''),
        reason: `异常回收：${target.reason}（${steps.map((s) => `${s.name}=${s.ok ? 'ok' : 'fail'}`).join(', ')}）`,
      },
      dataDir,
    );
    // 明细补写（reclaim-detail.jsonl——观测面，非审计面）
    const jobDir = trainJobDir(dataDir, target.enterpriseId, target.jobId);
    if (existsSync(jobDir)) {
      atomicAppendSync(
        join(jobDir, 'reclaim-detail.jsonl'),
        JSON.stringify({ pid: target.pid, reason: target.reason, steps, ts: new Date().toISOString() }),
      );
    }
    return { name: 'audit', ok: true, detail: 'train_abnormal_exit 已入审计链 + 明细落 reclaim-detail.jsonl' };
  } catch (err) {
    return { name: 'audit', ok: false, detail: `审计写入失败：${errMsg(err)}` };
  }
}

// ════════════════════════════════════════
// 孤儿检测（无 trainJobId 归属的训练进程——标记告警不自动杀）
// ════════════════════════════════════════

/** 运行中进程的最小描述（调用方给定——采集方式不限 ps/procfs） */
export interface ProcessInfo {
  pid: number;
  /** 完整命令行（孤儿特征判别输入） */
  command: string;
}

/** 孤儿检测结果（单条） */
export interface OrphanProcess {
  pid: number;
  command: string;
  /** 命中训练进程特征的依据（train.py / --config） */
  matchedBy: string[];
}

/** 孤儿检测选项 */
export interface OrphanDetectOptions {
  /** 是否顺带杀除孤儿（缺省 false——只标记告警，杀除是显式选项） */
  kill?: boolean;
  killFn?: KillFn;
}

/**
 * 识别无 trainJobId 归属的 Python 训练进程。
 *
 * 特征判别：command 含 python 且（train.py 或 --config 特征）→ 训练进程；
 * 再排除「命令行中出现任一已知 jobId」的进程（有归属）。剩下的即孤儿
 * （state 里查无对应 job——比如 job 目录被删 / 手工起进程 / 引擎重启丢表）。
 *
 * @param processes 运行中进程列表（调用方采集）
 * @param knownJobIds 已知 jobId 全集（data/train 下全部 state.json 的 jobId）
 */
export function detectTrainOrphans(
  processes: ProcessInfo[],
  knownJobIds: string[],
  opts: OrphanDetectOptions = {},
): { orphans: OrphanProcess[]; killed: number[] } {
  const killFn = opts.killFn ?? ((p, s) => process.kill(p, s));
  const jobIds = new Set(knownJobIds);
  const orphans: OrphanProcess[] = [];

  for (const proc of processes) {
    const matchedBy: string[] = [];
    const isPython = /python/i.test(proc.command);
    if (!isPython) continue;
    if (/train\.py/.test(proc.command)) matchedBy.push('train.py');
    if (proc.command.includes('--config')) matchedBy.push('--config');
    if (matchedBy.length === 0) continue; // 非训练特征进程不关心

    // 归属判别：命令行出现任一已知 jobId → 有主（粗粒度匹配——jobId 是
    // `job-<base36>-<hex>` 格式，正常不会撞命令行其他词）
    const owned = [...jobIds].some((id) => id !== '' && proc.command.includes(id));
    if (owned) continue;

    orphans.push({ pid: proc.pid, command: proc.command, matchedBy });
  }

  // 可选杀除（显式 opt-in——默认只标记告警）
  const killed: number[] = [];
  if (opts.kill) {
    for (const orphan of orphans) {
      try {
        killFn(orphan.pid, 'SIGKILL');
        killed.push(orphan.pid);
      } catch {
        // 杀失败保留在 orphans 告警列表（下一轮扫描再试）
      }
    }
  }

  return { orphans, killed };
}

/** 错误消息规整（unknown → String，Error → message） */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
