// train-multi.test.ts · v1.4.6 章一 测试
//
// 验收标准逐条覆盖：
// - job.json schema v2（gpu/nodes/cloud）校验通过；v1 存量 job.json 仍可读（红线 6 向后兼容）
// - GPU 队列多卡拓扑感知（8 卡任务不跟 1 卡任务抢卡；单卡任务可插空）
// - 多卡/多机启动命令构造（torchrun / verl 集群入口）
// - rank 进度事件汇总（全局进度 = 最慢 rank）
// - 分布式通信失败诊断（NCCL 错误分类）

import { describe, it, expect } from 'vitest';
import { validateTrainJob } from '../train/train-protocol';
import { createGpuQueue } from '../train/gpu-queue';
import { buildMultiGpuLaunch, aggregateMultiGpuProgress } from '../train/train-multi';
import { classifyTrainFailure } from '../train/train-diagnose';

// ────────────────────────────────────────────────────────────
// 一、job.json schema v2（红线 6：v1 向后兼容）
// ────────────────────────────────────────────────────────────

describe('job.json schema v2（gpu/nodes/cloud）', () => {
  it('v2 job.json 带 gpu/nodes/cloud 校验通过', () => {
    const job = {
      schemaVersion: 'v2',
      jobId: 'job-multi-001',
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-14b',
      algorithm: 'grpo',
      hyperparams: {},
      checkpointPath: '/ckpt/multi-001',
      outputDir: '/out/multi-001',
      gpu: { count: 8, type: 'A100' },
      nodes: 2,
      cloud: 'training-1',
    };
    const result = validateTrainJob(job);
    expect(result.valid).toBe(true);
    expect(result.job?.gpu?.count).toBe(8);
    expect(result.job?.nodes).toBe(2);
    expect(result.job?.cloud).toBe('training-1');
  });

  it('v1 存量 job.json（无 gpu/nodes）仍可读——向后兼容', () => {
    const v1Job = {
      schemaVersion: 'v1',
      jobId: 'job-v1-001',
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
      hyperparams: { lr: 0.00002 },
      checkpointPath: '/ckpt/v1-001',
      outputDir: '/out/v1-001',
    };
    const result = validateTrainJob(v1Job);
    expect(result.valid).toBe(true);
    // v1 无 gpu/nodes 字段 → 读入后 undefined（单卡单机，行为与 v1.4.5 一致）
    expect(result.job?.gpu).toBeUndefined();
    expect(result.job?.nodes).toBeUndefined();
  });

  it('v2 gpu.count 非法（0/负数/非整数）→ 校验失败', () => {
    const bad = {
      schemaVersion: 'v2',
      jobId: 'job-bad-gpu',
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
      checkpointPath: '/ckpt/bad',
      outputDir: '/out/bad',
      gpu: { count: 0 },
    };
    const result = validateTrainJob(bad);
    expect(result.valid).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 二、GPU 队列多卡拓扑感知（双轴：显存 + 卡数）
// ────────────────────────────────────────────────────────────

describe('GPU 队列多卡拓扑感知', () => {
  it('8 卡任务不跟 1 卡任务抢卡（卡数维度独立于显存）', () => {
    // 8 卡机器，显存充足（8×80GiB）
    const q = createGpuQueue({ totalMiB: 8 * 80 * 1024, totalGpuCount: 8 });
    // 8 卡任务占满全部卡
    expect(q.acquire('job-8gpu', 640 * 1024, 8)).toBe(true);
    // 1 卡任务：显存够但卡数不够 → 排队
    expect(q.acquire('job-1gpu', 40 * 1024, 1)).toBe(false);
    expect(q.snapshot().queuedCount).toBe(1);
    // 8 卡任务释放 → 1 卡任务获释（卡数维度放行）
    let released = '';
    q.onRelease((jobId) => { released = jobId; });
    q.release('job-8gpu');
    expect(released).toBe('job-1gpu');
  });

  it('单卡任务在多卡空闲时立即插空', () => {
    const q = createGpuQueue({ totalMiB: 8 * 80 * 1024, totalGpuCount: 8 });
    // 两个 1 卡任务可并行插空（卡数够）
    expect(q.acquire('job-a', 40 * 1024, 1)).toBe(true);
    expect(q.acquire('job-b', 40 * 1024, 1)).toBe(true);
    expect(q.snapshot().allocatedGpuCount).toBe(2);
    // 第三个 1 卡任务也可插空（还有 6 卡空闲）
    expect(q.acquire('job-c', 40 * 1024, 1)).toBe(true);
    expect(q.snapshot().allocatedGpuCount).toBe(3);
  });

  it('8 卡任务在 1 卡任务占卡时排队（整机未空出）', () => {
    const q = createGpuQueue({ totalMiB: 8 * 80 * 1024, totalGpuCount: 8 });
    expect(q.acquire('job-1gpu', 40 * 1024, 1)).toBe(true);
    // 8 卡任务：需 8 卡，但已有 1 卡被占 → 排队（尽管显存够）
    expect(q.acquire('job-8gpu', 640 * 1024, 8)).toBe(false);
    expect(q.snapshot().queuedCount).toBe(1);
  });

  it('缺省 totalGpuCount=0 保持单卡显存语义（向后兼容旧调用，不启用卡数维度）', () => {
    const q = createGpuQueue({ totalMiB: 80 * 1024 });
    expect(q.acquire('job-a', 40 * 1024)).toBe(true);
    expect(q.acquire('job-b', 40 * 1024)).toBe(true);
    // 单卡：显存 40+40=80 占满，第三个排队
    expect(q.acquire('job-c', 1 * 1024)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 三、多卡/多机启动命令构造
// ────────────────────────────────────────────────────────────

const MULTI_JOB_BASE = {
  schemaVersion: 'v2',
  jobId: 'job-multi',
  dataPath: '/data/train.jsonl',
  baseModel: 'qwen3-14b',
  algorithm: 'grpo',
  hyperparams: {},
  checkpointPath: '/ckpt/multi',
  outputDir: '/out/multi',
};

describe('多卡/多机启动命令构造', () => {
  it('单卡单机 → 原单卡命令（不套 torchrun）', () => {
    const job = { ...MULTI_JOB_BASE, gpu: { count: 1 }, nodes: 1 };
    const launch = buildMultiGpuLaunch(job as never, '/tmp/job.json');
    expect(launch.args).toEqual(['train.py', '--config', '/tmp/job.json']);
    expect(launch.topology).toBe('single-1x1');
  });

  it('单机 8 卡 → torchrun --nproc_per_node=8', () => {
    const job = { ...MULTI_JOB_BASE, gpu: { count: 8, type: 'A100' }, nodes: 1 };
    const launch = buildMultiGpuLaunch(job as never, '/tmp/job.json');
    expect(launch.launcher).toBe('torchrun');
    expect(launch.args.slice(0, 4)).toEqual(['torchrun', '--nproc_per_node', '8', 'train.py']);
    expect(launch.topology).toBe('multi-8x1');
  });

  it('多机 8 卡×2 节点 → torchrun --nnodes --node_rank --master_addr --master_port', () => {
    const job = { ...MULTI_JOB_BASE, gpu: { count: 8, type: 'A100' }, nodes: 2 };
    const launch = buildMultiGpuLaunch(job as never, '/tmp/job.json', {
      nodeRank: 1,
      masterAddr: '10.0.0.1',
      masterPort: 29500,
    });
    expect(launch.args).toContain('--nnodes');
    expect(launch.args).toContain('2');
    expect(launch.args).toContain('--node_rank');
    expect(launch.args).toContain('1');
    expect(launch.args).toContain('--master_addr');
    expect(launch.args).toContain('10.0.0.1');
    expect(launch.args).toContain('--master_port');
    expect(launch.args).toContain('29500');
  });

  it('hyperparams.launcher=verl → verl 集群入口', () => {
    const job = { ...MULTI_JOB_BASE, gpu: { count: 8 }, nodes: 2, hyperparams: { launcher: 'verl' } };
    const launch = buildMultiGpuLaunch(job as never, '/tmp/job.json');
    expect(launch.launcher).toBe('verl');
    expect(launch.args[0]).toBe('verl');
  });
});

// ────────────────────────────────────────────────────────────
// 四、rank 进度事件汇总
// ────────────────────────────────────────────────────────────

describe('rank 进度事件汇总', () => {
  it('全局进度 = 最慢 rank（最小 step，不取最大避免虚高）', () => {
    const summary = aggregateMultiGpuProgress([
      { rank: 0, step: 100, loss: 1.0 },
      { rank: 1, step: 95, loss: 1.2 },
      { rank: 2, step: 98, loss: 0.9 },
    ]);
    expect(summary.latestStep).toBe(95);
    expect(summary.rankCount).toBe(3);
    expect(summary.meanLoss).toBeCloseTo(1.033, 2);
  });

  it('空 rank 列表 → 零值汇总（不抛错）', () => {
    const summary = aggregateMultiGpuProgress([]);
    expect(summary.latestStep).toBe(0);
    expect(summary.rankCount).toBe(0);
    expect(summary.meanLoss).toBeNull();
  });

  it('无 loss 的 rank 不参与 meanLoss（GRPO 纯 reward 场景）', () => {
    const summary = aggregateMultiGpuProgress([
      { rank: 0, step: 10, reward: 0.8 },
      { rank: 1, step: 10, reward: 1.0 },
    ]);
    expect(summary.meanLoss).toBeNull();
    expect(summary.meanReward).toBeCloseTo(0.9, 5);
  });
});

// ────────────────────────────────────────────────────────────
// 五、分布式通信失败诊断（NCCL 第八类）
// ────────────────────────────────────────────────────────────

describe('分布式通信失败诊断（NCCL）', () => {
  it('NCCL 错误 → distributed_comm 分类', () => {
    const r = classifyTrainFailure('RuntimeError: NCCL error in: /nccl/src/init.cc, unhandled cuda error');
    expect(r.category).toBe('distributed_comm');
  });

  it('torchrun rendezvous 失败 → distributed_comm 分类', () => {
    const r = classifyTrainFailure('torch.distributed: rendezvous failed, connection refused');
    expect(r.category).toBe('distributed_comm');
  });

  it('watchdog timeout → distributed_comm 分类', () => {
    const r = classifyTrainFailure('[rank1]: watchdog timeout, process group timed out');
    expect(r.category).toBe('distributed_comm');
  });
});
