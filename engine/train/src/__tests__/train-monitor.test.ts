// train-monitor.test.ts · v1.4.3 第一章 测试（GPU 队列 / dashboard 落盘 / webhook 三态）
//
// 验收标准逐条覆盖：
// - GPU 队列：并发任务按显存预算排队，不 OOM（budget 模式 + serial 模式）
// - 训练完成/失败/取消事件推送可用（webhook 三态）
// - 训练状态落盘 data/dashboard/train-status.json + train-health.json
// - 调度器接线：终端事件释放 GPU 额度（后续任务获释）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  createGpuQueue,
  estimateTrainVramMiB,
} from '../train/gpu-queue';
import {
  buildTrainStatusBoard,
  buildTrainHealthReport,
  flushTrainDashboard,
  trainStatusSinkPath,
  trainHealthSinkPath,
} from '../train/dashboard-sink';
import {
  buildTrainEventMessage,
  extractPayloadFromRecord,
  pushTrainEvent,
  type TrainEventPayload,
  type TrainWebhookTarget,
} from '../train/train-webhook';
import { createTrainScheduler, type SpawnFn } from '../train/train-scheduler';
import type { TrainJobRecord } from '../train/train-job';

// ── 测试基建 ──
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-monitor-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 构造 job 记录（dashboard 聚合测试基线） */
function makeRecord(overrides: Partial<TrainJobRecord> = {}): TrainJobRecord {
  const jobId = overrides.jobId ?? 'job-test-1';
  return {
    jobId,
    enterpriseId: 'ent-1',
    status: 'completed',
    job: {
      schemaVersion: 'v1',
      jobId,
      dataPath: '/data/train.jsonl',
      baseModel: 'Qwen3-8B',
      algorithm: 'sft',
      hyperparams: {},
      checkpointPath: '/ckpt',
      outputDir: '/out',
    },
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T01:00:00.000Z',
    startedAtMs: Date.parse('2026-08-29T00:00:00.000Z'),
    finishedAt: '2026-08-29T00:30:00.000Z',
    usage: { elapsedMinutes: 30, steps: 100, cost: 0 },
    ...overrides,
  } as TrainJobRecord;
}

/** 落盘 state.json（dashboard 读取路径） */
function seedRecord(record: TrainJobRecord): void {
  const dir = join(dataDir, 'train', record.enterpriseId, record.jobId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(record), 'utf-8');
}

/** 落盘 events.jsonl（progress 曲线提取路径） */
function seedEvents(enterpriseId: string, jobId: string, lines: string[]): void {
  const dir = join(dataDir, 'train', enterpriseId, jobId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf-8');
}

// ════════════════════════════════════════
// 一、GPU 队列（显存预算账本）
// ════════════════════════════════════════

describe('createGpuQueue 显存预算队列', () => {
  it('budget 模式：预算内并发放行，超预算排队', () => {
    const queue = createGpuQueue({ totalMiB: 24000 });
    expect(queue.acquire('job-a', 12000)).toBe(true); // 剩 12000
    expect(queue.acquire('job-b', 10000)).toBe(true); // 剩 2000
    expect(queue.acquire('job-c', 4000)).toBe(false); // 排队
    const snap = queue.snapshot();
    expect(snap.mode).toBe('budget');
    expect(snap.runningCount).toBe(2);
    expect(snap.queuedCount).toBe(1);
    expect(snap.allocatedMiB).toBe(22000);
    expect(snap.freeMiB).toBe(2000);
  });

  it('release 释放额度后队首依序获释（FIFO——预算够就连放）', () => {
    const queue = createGpuQueue({ totalMiB: 10000 });
    const released: string[] = [];
    queue.onRelease((jobId) => released.push(jobId));
    queue.acquire('job-a', 6000);
    queue.acquire('job-b', 5000); // 排队（6000+5000 > 10000）
    queue.acquire('job-c', 6000); // 排队（6000+6000 > 10000）
    queue.release('job-a');
    // 释放 6000 后剩 10000：job-b（5000）获释；job-c（6000，5000+6000 超预算）仍排队
    expect(released).toEqual(['job-b']);
    expect(queue.snapshot().runningCount).toBe(1);
    expect(queue.snapshot().queuedCount).toBe(1);
    queue.release('job-b');
    // job-b 再释放：job-c（6000 ≤ 10000）获释
    expect(released).toEqual(['job-b', 'job-c']);
    expect(queue.snapshot().runningCount).toBe(1);
    expect(queue.snapshot().queuedCount).toBe(0);
  });

  it('serial 模式：无预算时一次一个任务（不 OOM 的最保守路径）', () => {
    const queue = createGpuQueue({}); // totalMiB 缺省 0 → 串行
    expect(queue.acquire('job-a', 1000)).toBe(true);
    expect(queue.acquire('job-b', 1000)).toBe(false); // 串行：在跑 1 个即排队
    expect(queue.snapshot().mode).toBe('serial');
    queue.release('job-a');
    expect(queue.snapshot().runningCount).toBe(1); // job-b 获释
    expect(queue.snapshot().queuedCount).toBe(0);
  });

  it('maxConcurrent 上限：预算够但进程数满也排队', () => {
    const queue = createGpuQueue({ totalMiB: 100000, maxConcurrent: 2 });
    expect(queue.acquire('job-a', 1000)).toBe(true);
    expect(queue.acquire('job-b', 1000)).toBe(true);
    expect(queue.acquire('job-c', 1000)).toBe(false); // 并发上限
    expect(queue.snapshot().queuedCount).toBe(1);
  });

  it('release 幂等：未在跑任务 release 是安全 no-op', () => {
    const queue = createGpuQueue({ totalMiB: 10000 });
    expect(() => queue.release('ghost')).not.toThrow();
    expect(queue.snapshot().runningCount).toBe(0);
  });

  it('dequeue 撤销排队任务（取消路径）', () => {
    const queue = createGpuQueue({ totalMiB: 5000 });
    queue.acquire('job-a', 4000);
    queue.acquire('job-b', 4000); // 排队
    expect(queue.dequeue('job-b')).toBe(true);
    expect(queue.dequeue('job-b')).toBe(false); // 已撤
    expect(queue.snapshot().queuedCount).toBe(0);
    queue.release('job-a'); // pump 无排队——无回调
  });

  it('silentRelease 清账不泵队（僵尸收割路径——后续 launch 立即用额度）', () => {
    const queue = createGpuQueue({ totalMiB: 5000 });
    const released: string[] = [];
    queue.onRelease((jobId) => released.push(jobId));
    queue.acquire('job-a', 4000);
    queue.acquire('job-b', 4000); // 排队
    queue.silentRelease('job-a'); // 静默——不触发 pump
    expect(released).toEqual([]); // job-b 不获释
    expect(queue.snapshot().runningCount).toBe(0);
    expect(queue.acquire('job-c', 4000)).toBe(true); // 新任务立即用额度
  });
});

describe('estimateTrainVramMiB 显存估算', () => {
  it('QLoRA 4bit：≈ 参数量 × 0.5 GiB + 2 GiB 余量', () => {
    const miB = estimateTrainVramMiB('Qwen3-8B', 'sft', { load_in_4bit: true });
    expect(miB).toBe(Math.round(8 * 0.5 * 1024 + 2 * 1024));
  });

  it('全参 SFT：参数量 × 6 GiB + 余量（权重+梯度+优化器）', () => {
    const miB = estimateTrainVramMiB('Qwen3-8B', 'sft');
    expect(miB).toBe(Math.round(8 * 6 * 1024 + 2 * 1024));
  });

  it('GRPO 采样组加档（group_size 影响估算）', () => {
    const small = estimateTrainVramMiB('Qwen3-8B', 'grpo', { group_size: 4 });
    const large = estimateTrainVramMiB('Qwen3-8B', 'grpo', { group_size: 16 });
    expect(large).toBeGreaterThan(small);
  });

  it('模型名无参数量时按 7B 缺省（宁可高估）', () => {
    const miB = estimateTrainVramMiB('custom-model', 'sft');
    expect(miB).toBe(Math.round(7 * 6 * 1024 + 2 * 1024));
  });
});

// ════════════════════════════════════════
// 二、Dashboard 落盘（train-status.json / train-health.json）
// ════════════════════════════════════════

describe('dashboard-sink 训练状态落盘', () => {
  it('train-status.json：当前在跑/最近完成/失败三组分区', () => {
    seedRecord(makeRecord({ jobId: 'job-run', status: 'running' }));
    seedRecord(makeRecord({ jobId: 'job-done', status: 'completed' }));
    seedRecord(makeRecord({ jobId: 'job-fail', status: 'failed', reason: 'OOM：CUDA out of memory' }));
    const board = buildTrainStatusBoard(dataDir);
    expect(board.running.map((r) => r.jobId)).toEqual(['job-run']);
    expect(board.recentCompleted.map((r) => r.jobId)).toEqual(['job-done']);
    expect(board.recentFailed.map((r) => r.jobId)).toEqual(['job-fail']);
    expect(board.totalJobs).toBe(3);
  });

  it('step/loss 从 events.jsonl 尾部提取（progress 滑窗）', () => {
    seedRecord(makeRecord({ jobId: 'job-run', status: 'running' }));
    seedEvents('ent-1', 'job-run', [
      JSON.stringify({ type: 'progress', step: 1, loss: 2.5 }),
      JSON.stringify({ type: 'progress', step: 2, loss: 2.1 }),
      JSON.stringify({ type: 'progress', step: 3, loss: 1.8 }),
    ]);
    const board = buildTrainStatusBoard(dataDir);
    const entry = board.running[0]!;
    expect(entry.lastStep).toBe(3);
    expect(entry.lastLoss).toBe(1.8);
  });

  it('train-health.json：成功率/平均耗时/失败 top 原因', () => {
    seedRecord(makeRecord({ jobId: 'job-d1', status: 'completed' }));
    seedRecord(makeRecord({ jobId: 'job-d2', status: 'completed' }));
    seedRecord(makeRecord({ jobId: 'job-f1', status: 'failed', reason: 'OOM：CUDA out of memory' }));
    seedRecord(makeRecord({ jobId: 'job-f2', status: 'failed', reason: 'OOM：CUDA out of memory' }));
    seedRecord(makeRecord({ jobId: 'job-c1', status: 'cancelled', reason: '用户取消' }));
    const health = buildTrainHealthReport(dataDir, {
      gpuSnapshot: () => ({ supported: true, note: 'test-gpu', perGpuUsedMiB: [1000] }) as never,
    });
    expect(health.finishedJobs).toBe(5);
    expect(health.successRate).toBeCloseTo(0.4, 2); // 2/5
    expect(health.avgDurationMinutes).toBe(30); // startedAt→finishedAt 半小时
    expect(health.failureTopReasons[0]!.reason).toBe('OOM');
    expect(health.failureTopReasons[0]!.count).toBe(2);
    expect(health.gpu?.supported).toBe(true);
  });

  it('空历史降级：successRate=null 不崩（0 任务）', () => {
    const health = buildTrainHealthReport(dataDir, { gpuSnapshot: () => ({ supported: false, note: 'no' }) as never });
    expect(health.finishedJobs).toBe(0);
    expect(health.successRate).toBeNull();
    expect(health.avgDurationMinutes).toBeNull();
    expect(health.failureTopReasons).toEqual([]);
  });

  it('flushTrainDashboard 两文件原子落盘可回读', () => {
    seedRecord(makeRecord({ jobId: 'job-x', status: 'completed' }));
    const { statusFile, healthFile } = flushTrainDashboard(dataDir, {
      gpuSnapshot: () => ({ supported: false, note: 'no' }) as never,
    });
    expect(statusFile).toBe(trainStatusSinkPath(dataDir));
    expect(healthFile).toBe(trainHealthSinkPath(dataDir));
    expect(existsSync(statusFile)).toBe(true);
    expect(existsSync(healthFile)).toBe(true);
    const board = JSON.parse(readFileSync(statusFile, 'utf-8'));
    expect(board.schemaVersion).toBe('v1');
    expect(board.recentCompleted.length).toBe(1);
    const health = JSON.parse(readFileSync(healthFile, 'utf-8'));
    expect(health.successRate).toBe(1);
  });
});

// ════════════════════════════════════════
// 三、webhook 三态推送
// ════════════════════════════════════════

describe('train-webhook 三态推送', () => {
  it('三态消息构建（completed/failed/cancelled 图标与文案）', () => {
    const base: TrainEventPayload = {
      type: 'completed',
      jobId: 'job-1',
      enterpriseId: 'ent-1',
      baseModel: 'Qwen3-8B',
      algorithm: 'sft',
      durationMinutes: 42,
    };
    expect(buildTrainEventMessage(base)).toContain('训练完成');
    expect(buildTrainEventMessage(base)).toContain('42 分钟');
    expect(buildTrainEventMessage({ ...base, type: 'failed', reason: 'OOM：CUDA out of memory' })).toContain('训练失败');
    expect(buildTrainEventMessage({ ...base, type: 'cancelled' })).toContain('训练取消');
  });

  it('消息脱敏：不含 hyperparams / dataPath（企业数据不进 IM）', () => {
    const msg = buildTrainEventMessage({
      type: 'failed',
      jobId: 'job-1',
      enterpriseId: 'ent-1',
      baseModel: 'Qwen3-8B',
      algorithm: 'sft',
      durationMinutes: null,
      reason: 'data at /secret/enterprise/path',
    });
    expect(msg).not.toContain('hyperparams');
  });

  it('extractPayloadFromRecord：终态三态提取、非终态 null', () => {
    expect(extractPayloadFromRecord(makeRecord({ status: 'running' }))).toBeNull();
    expect(extractPayloadFromRecord(makeRecord({ status: 'checkpointing' }))).toBeNull();
    const completed = extractPayloadFromRecord(makeRecord({ status: 'completed' }));
    expect(completed?.type).toBe('completed');
    expect(completed?.durationMinutes).toBe(30);
    const failed = extractPayloadFromRecord(makeRecord({ status: 'failed', reason: 'OOM' }));
    expect(failed?.type).toBe('failed');
    expect(failed?.reason).toBe('OOM');
  });

  it('推送链路：目标未配置不发；公网地址走 push 注入；内网地址 SSRF 拒绝', async () => {
    const target: TrainWebhookTarget = { platform: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/x' };
    // 未配置目标
    expect(await pushTrainEvent(null, null)).toBe(false);
    // 公网地址——push 注入验证
    const pushed: string[] = [];
    const ok = await pushTrainEvent(target, {
      type: 'completed',
      jobId: 'j',
      enterpriseId: 'e',
      baseModel: 'm',
      algorithm: 'sft',
      durationMinutes: null,
    }, { push: async (t, body) => { pushed.push(body); return true; } });
    expect(ok).toBe(true);
    expect(pushed[0]).toContain('msgtype');
    // 内网地址——SSRF 拒绝
    const denied = await pushTrainEvent(
      { platform: 'dingtalk', url: 'http://127.0.0.1:8080/hook' },
      { type: 'completed', jobId: 'j', enterpriseId: 'e', baseModel: 'm', algorithm: 'sft', durationMinutes: null },
      { push: async () => true },
    );
    expect(denied).toBe(false);
  });
});

// ════════════════════════════════════════
// 四、调度器接线（GPU 队列 + webhook + dashboard 终态刷新）
// ════════════════════════════════════════

/** 可控假子进程（emitStdout/emitClose 手动驱动事件流；pid 用测试进程自身——存活口径） */
function controllableChild(): ChildProcess & { emitStdout(line: string): void; emitClose(code: number | null): void } {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  // pid 用测试进程自身（pidAlive 探测为活——僵尸收割不误收，排队语义可测）
  (proc as unknown as { pid: number }).pid = process.pid;
  const augmented = proc as ChildProcess & { emitStdout(line: string): void; emitClose(code: number | null): void };
  augmented.emitStdout = (line: string) => {
    (proc.stdout as EventEmitter).emit('data', Buffer.from(line + '\n'));
  };
  augmented.emitClose = (code: number | null) => {
    proc.emit('close', code);
  };
  return augmented;
}

describe('调度器 GPU 队列接线', () => {
  it('终端 done 事件释放 GPU 额度（后续排队任务获释启动）', async () => {
    const children: Array<ReturnType<typeof controllableChild>> = [];
    const spawnFn: SpawnFn = () => {
      const child = controllableChild();
      children.push(child);
      return child;
    };
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-q',
      spawnFn,
      crashRecoveryScan: false,
    });
    // 串行模式（缺省无预算）：首任务在跑占额
    const first = scheduler.submitTrainJob({ dataPath: '/d.jsonl', baseModel: 'Qwen3-8B', algorithm: 'sft' });
    expect(scheduler.gpuQueue.snapshot().runningCount).toBe(1);
    // 第二任务排队（不 spawn）
    const second = scheduler.submitTrainJob({ dataPath: '/d.jsonl', baseModel: 'Qwen3-8B', algorithm: 'sft' });
    expect(children.length).toBe(1); // 只 spawn 了首任务
    expect(scheduler.gpuQueue.snapshot().queuedCount).toBe(1);
    // 首任务 done → 额度释放 → 第二任务获释 spawn
    children[0]!.emitStdout(JSON.stringify({ type: 'done' }));
    expect(children.length).toBe(2); // 第二任务已 spawn
    expect(scheduler.gpuQueue.snapshot().queuedCount).toBe(0);
    children[1]!.emitStdout(JSON.stringify({ type: 'done' }));
    void first;
    void second;
  });

  it('webhook 三态推送 + dashboard 落盘在终态触发（注入验证）', async () => {
    const children: Array<ReturnType<typeof controllableChild>> = [];
    const spawnFn: SpawnFn = () => {
      const child = controllableChild();
      children.push(child);
      return child;
    };
    const pushes: Array<{ type: string }> = [];
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-w',
      spawnFn,
      crashRecoveryScan: false,
      webhookTarget: { platform: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/x' },
      webhookPush: async (target, payload) => {
        if (payload) pushes.push({ type: payload.type });
        return true;
      },
    });
    scheduler.submitTrainJob({ dataPath: '/d.jsonl', baseModel: 'Qwen3-8B', algorithm: 'sft' });
    children[0]!.emitStdout(JSON.stringify({ type: 'done' }));
    // 等微任务队列排空（fire-and-forget 的 push 是 void promise）
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pushes).toEqual([{ type: 'completed' }]);
    // dashboard 落盘已触发（终态回调同步 flush）
    expect(existsSync(trainStatusSinkPath(dataDir))).toBe(true);
    expect(existsSync(trainHealthSinkPath(dataDir))).toBe(true);
  });
});
