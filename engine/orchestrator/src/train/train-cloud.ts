// train-cloud.ts · v1.4.6 章二 · 云端 VM 执行面（注册 / 远程 spawn / 上传清理 / 失联止损 / 成本）
//
// 定位：租云 GPU VM 做多卡/分布式训练——「Node 控制面本地、Python 执行面云上」。
// 控制面构造 ssh 远程命令（spawn / 上传 / 清理 / 止损），执行面在云 VM 上跑
// verl/DeepSpeed（协议② stdout JSON 流走 ssh 通道回流）。
//
// 职责单一：本文件只做「命令构造 + 判定 + 成本核算」，不真实 ssh/网络——执行由
// daemon/scheduler 承担（对齐 gpu-queue「调度决策与进程编排分离」）。零真实
// 网络，全量可注入测试。
//
// 预算口径（全局验收）：云 VM 成本 = 时薪 × 时长 × 节点数，折算进 v1.4.1 预算
// 三字段中的 `max_cost`（max_minutes/max_steps 不适用于云上）。币种 = 美元
// （USD，云 GPU 计价的通用口径）；取整 = 向上取整到 0.01（美分）。

import type { TrainJob } from './train-protocol';
import type { CloudVmRecord } from './cloud-registry';

// ════════════════════════════════════════
// 远程命令构造（ssh 通道——控制面 → 云执行面）
// ════════════════════════════════════════

/** ssh 远程命令（execFile 数组——不 spawn shell，防注入） */
export interface CloudCommand {
  args: string[];
  /** 命令说明（审计可读） */
  purpose: string;
}

/** 构造 ssh 远程执行命令：ssh <endpoint> <remote...> */
function buildSshCommand(vm: CloudVmRecord, remote: string[]): CloudCommand {
  return {
    args: ['ssh', vm.endpoint, ...remote],
    purpose: `ssh ${vm.endpoint}`,
  };
}

/**
 * 构造远程 spawn 命令——`ssh <endpoint> <启动命令>`。
 * 启动命令复用章一 train-multi 的多卡入口（torchrun/verl），
 * 协议②事件流不变（stdout JSON 走 ssh 通道回流）。
 */
export function buildCloudSpawnCommand(
  vm: CloudVmRecord,
  job: TrainJob,
  jobJsonPath: string,
  opts: { masterAddr?: string; masterPort?: number } = {},
): CloudCommand {
  // 云 VM 上执行：job.json 已上传到远程，直接 spawn 启动命令
  const gpuCount = job.gpu?.count ?? 1;
  const nodes = job.nodes ?? 1;
  const launcher = job.hyperparams?.launcher === 'verl' ? 'verl' : 'torchrun';

  let remote: string[];
  if (launcher === 'verl') {
    remote = ['verl', '--config', jobJsonPath, '--nproc_per_node', String(gpuCount)];
  } else if (gpuCount > 1 || nodes > 1) {
    remote = [
      'torchrun',
      '--nproc_per_node', String(gpuCount),
      ...(nodes > 1 ? ['--nnodes', String(nodes)] : []),
      ...(nodes > 1 && opts.masterAddr ? ['--master_addr', opts.masterAddr] : []),
      ...(nodes > 1 && opts.masterPort !== undefined ? ['--master_port', String(opts.masterPort)] : []),
      'train.py', '--config', jobJsonPath,
    ];
  } else {
    remote = ['train.py', '--config', jobJsonPath];
  }
  return buildSshCommand(vm, remote);
}

/**
 * 构造数据上传命令——`scp <local> <endpoint>:<remote>`。
 * 加密传输 = ssh/scp 隧道加密（传输层加密），与 v1.3.8 静态加密
 * AES-256-GCM（落盘加密）区分——上传前还须过分拣闸（sorting-gate）。
 */
export function buildCloudUploadCommand(
  vm: CloudVmRecord,
  localPath: string,
  remotePath: string,
): CloudCommand {
  return {
    args: ['scp', '-r', localPath, `${vm.endpoint}:${remotePath}`],
    purpose: `上传 ${localPath} → ${vm.endpoint}:${remotePath}（scp 隧道加密）`,
  };
}

/** 构造训练后清理命令——远程删除训练数据与产物（不留敏感残留） */
export function buildCloudCleanupCommand(vm: CloudVmRecord, remotePath: string): CloudCommand {
  return buildSshCommand(vm, ['rm', '-rf', remotePath]);
}

/** 构造强制止损命令——远程强杀训练进程（失联止损的收尾动作） */
export function buildCloudStopCommand(vm: CloudVmRecord, remoteJobId: string): CloudCommand {
  return buildSshCommand(vm, ['pkill', '-9', '-f', `train_job_${remoteJobId}`]);
}

// ════════════════════════════════════════
// 失联止损判定（心跳超时 → 强制 stop + 清理）
// ════════════════════════════════════════

/** 心跳失联判定结果 */
export interface HeartbeatVerdict {
  /** 是否已失联（需止损） */
  stale: boolean;
  /** 距上次心跳的时长（ms） */
  elapsedMs: number;
}

/**
 * 判定云 VM 心跳是否失联（心跳超时 → 止损：强制 stop + 清理，避免 VM 按
 * 「时薪 × 时长」空烧）。默认超时 5 分钟——云训练心跳通常 30s 一报，5 分钟
 * 无心跳即判失联（对齐 v1.4.1 中断回收 + 崩溃恢复的止损节奏）。
 */
export function isHeartbeatStale(
  vm: CloudVmRecord,
  now: number,
  heartbeatTimeoutMs = 5 * 60_000,
): HeartbeatVerdict {
  if (!vm.lastHeartbeatAt) {
    // 从未心跳——刚注册未 spawn 不算失联（status=unknown 的 VM 不触发止损）
    return { stale: false, elapsedMs: 0 };
  }
  const elapsedMs = now - new Date(vm.lastHeartbeatAt).getTime();
  return { stale: elapsedMs > heartbeatTimeoutMs, elapsedMs };
}

// ════════════════════════════════════════
// 成本核算（VM 时薪 × 时长 × 节点数）
// ════════════════════════════════════════

/**
 * 估算云 VM 训练成本（美元）。
 *
 * 口径：hourlyRateUsd × (durationMinutes / 60) × nodes，向上取整到 0.01（美分）。
 * 折算进预算 `max_cost`（USD 计价）——max_minutes/max_steps 不适用于云上
 * （云上按「占用时长」计费，不按训练步数）。
 */
export function estimateCloudCostUsd(
  hourlyRateUsd: number,
  durationMinutes: number,
  nodes: number,
): number {
  const raw = hourlyRateUsd * (durationMinutes / 60) * nodes;
  return Math.ceil(raw * 100) / 100;
}

/**
 * 超预算判定——估算成本 > 预算上限即暂停（对齐 v1.4.1 预算控制「超预算 SIGINT
 * 暂停 + 人审」，云上同样生效）。
 */
export function isOverBudget(estimatedCostUsd: number, maxCostUsd: number): boolean {
  return estimatedCostUsd > maxCostUsd;
}
