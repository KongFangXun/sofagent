// train-multi.ts · v1.4.7 章一 · 多卡/多机训练编排（分布式 spawn + rank 事件汇总）
//
// 定位：从单机单卡升级到多卡/多机。Node 控制面构造分布式启动命令
// （torchrun / verl 集群入口），Python 执行面按约定②打事件——每个 rank 的
// progress 事件在 Node 侧汇总成单一训练视图（协议②事件流本身不变）。
//
// 职责单一：只做「启动命令构造 + 事件汇总」，不 spawn——spawn 由
// train-scheduler 承担，对齐 gpu-queue 的「调度决策与进程编排分离」。
//
// 测试纪律：纯命令构造 + 纯事件归并，零真实进程/GPU——全量可注入测试。

import type { TrainJob } from './train-protocol';

// ════════════════════════════════════════
// 启动命令构造（约定①的分布式形态）
// ════════════════════════════════════════

/** 多卡启动命令结果（命令数组 + 入口说明——审计可读） */
export interface MultiGpuLaunch {
  /** 启动命令（execFile 数组参数——不 spawn shell） */
  args: string[];
  /** 集群入口（torchrun / verl） */
  launcher: 'torchrun' | 'verl';
  /** 拓扑摘要（人读，如 multi-8x2） */
  topology: string;
}

/**
 * 构造多卡/多机启动命令。
 *
 * 规则：
 *   - gpu.count=1 且 nodes=1 → 单卡单机，返回原单卡命令（不套 torchrun）
 *   - gpu.count>1 单机 → `torchrun --nproc_per_node=N train.py --config job.json`
 *   - nodes>1 多机 → torchrun 加 `--nnodes --node_rank --master_addr --master_port`
 *   - hyperparams.launcher === 'verl' → verl 集群入口（阶段 2 选型框架）
 */
export function buildMultiGpuLaunch(
  job: TrainJob,
  jobJsonPath: string,
  opts: {
    nodeRank?: number;
    masterAddr?: string;
    masterPort?: number;
    trainScript?: string;
  } = {},
): MultiGpuLaunch {
  const gpuCount = job.gpu?.count ?? 1;
  const nodes = job.nodes ?? 1;
  const trainScript = opts.trainScript ?? 'train.py';

  // 单卡单机：不套 torchrun（走原单卡 spawn 路径）
  if (gpuCount === 1 && nodes === 1) {
    return {
      args: [trainScript, '--config', jobJsonPath],
      launcher: 'torchrun',
      topology: 'single-1x1',
    };
  }

  const launcher: 'torchrun' | 'verl' = job.hyperparams?.launcher === 'verl' ? 'verl' : 'torchrun';
  const topology = `multi-${gpuCount}x${nodes}`;

  if (launcher === 'verl') {
    // verl 集群入口：verl 自带多机启动器，Node 只收敛参数
    return {
      args: [
        'verl',
        '--config',
        jobJsonPath,
        '--nproc_per_node',
        String(gpuCount),
        ...(nodes > 1 ? ['--nnodes', String(nodes)] : []),
      ],
      launcher: 'verl',
      topology,
    };
  }

  // torchrun（DeepSpeed / FSDP 通用入口）
  const args = [
    'torchrun',
    '--nproc_per_node',
    String(gpuCount),
    ...(nodes > 1 ? ['--nnodes', String(nodes)] : []),
    ...(nodes > 1 && opts.nodeRank !== undefined ? ['--node_rank', String(opts.nodeRank)] : []),
    ...(nodes > 1 && opts.masterAddr ? ['--master_addr', opts.masterAddr] : []),
    ...(nodes > 1 && opts.masterPort !== undefined ? ['--master_port', String(opts.masterPort)] : []),
    trainScript,
    '--config',
    jobJsonPath,
  ];
  return { args, launcher: 'torchrun', topology };
}

// ════════════════════════════════════════
// rank 事件汇总（约定②的分布式消费）
// ════════════════════════════════════════

/** rank 级进度（多卡时每个 rank 独立打 progress——事件流不变，仅附加 rank） */
export interface RankProgress {
  rank: number;
  step: number;
  loss?: number;
  reward?: number;
}

/** 多卡进度汇总（rank 级 → 单一训练视图） */
export interface MultiGpuProgressSummary {
  /** 全局最新 step（各 rank 最小——最慢 rank 决定整体进度，不取最大避免虚高） */
  latestStep: number;
  /** 各 rank 平均 loss（无 loss 的 rank 不参与） */
  meanLoss: number | null;
  /** 各 rank 平均 reward（无 reward 的 rank 不参与） */
  meanReward: number | null;
  /** 本汇总覆盖的 rank 数 */
  rankCount: number;
  /** 各 rank 最新进度明细（审计/诊断可追溯） */
  ranks: RankProgress[];
}

/**
 * 汇总多 rank 进度事件。
 *
 * 全局进度 = 各 rank 最小 step——最慢 rank 卡住整体（对齐「进度不虚高」原则）。
 * loss/reward 取各 rank 算术平均（粗粒度监控口径，精确指标看训练框架侧）。
 */
export function aggregateMultiGpuProgress(ranks: RankProgress[]): MultiGpuProgressSummary {
  if (ranks.length === 0) {
    return { latestStep: 0, meanLoss: null, meanReward: null, rankCount: 0, ranks: [] };
  }
  const latestStep = Math.min(...ranks.map((r) => r.step));
  const losses = ranks.filter((r) => r.loss !== undefined).map((r) => r.loss as number);
  const rewards = ranks.filter((r) => r.reward !== undefined).map((r) => r.reward as number);
  const meanLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : null;
  const meanReward = rewards.length > 0 ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null;
  return { latestStep, meanLoss, meanReward, rankCount: ranks.length, ranks };
}
