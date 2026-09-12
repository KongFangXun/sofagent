// ============================================================
// channel-executor-bridge.test.ts · 条目 3 第 0 步：签名契约测试
// ============================================================
// 证伪断言：channelAsExecutor 的返回值必须可直接作 schedulerOptions.executor
// （Pick<TrainExecutor, 'start' | 'stop'>）——无需调用方手工包装/类型断言。
// 当前形状（start(jobId, hooks) 两参）在调度面（start(jobId, command, args,
// { hooks }) 四参）下不匹配——本测试红即证明桥的形状确实不够用。
// ============================================================
import { describe, expect, it } from 'vitest';
import { channelAsExecutor, type TrainChannel, type ChannelEvent } from '../train-channel';
import type { TrainExecutor, TrainExecutorHooks } from '../train-scheduler';

function makeMockChannel(statuses: string[]): TrainChannel {
  let idx = 0;
  const events: ChannelEvent[] = [];
  return {
    name: 'mock',
    submit: async () => ({ remoteJobId: 'rj-1' }),
    status: async () => {
      const status = statuses[Math.min(idx++, statuses.length - 1)] ?? 'succeeded';
      return { status, recentEvents: events };
    },
    artifacts: async () => ({ files: [] }),
    cancel: async () => ({ status: 'cancelled' as const }),
  };
}

describe('条目 3 · channelAsExecutor 签名契约（第 0 步）', () => {
  it('返回值可直接赋给 Pick<TrainExecutor, "start" | "stop">——零手工包装', () => {
    const bridged = channelAsExecutor(makeMockChannel(['succeeded']), {
      pollIntervalMs: 10,
      jobDirOf: (jobId) => `/data/train/${jobId}`,
    });
    // 🔴 契约断言：直接结构Assignable（TS 层若不匹配编译红；运行层验四参可调）
    const executor: Pick<TrainExecutor, 'start' | 'stop'> = bridged;
    expect(typeof executor.start).toBe('function');
    expect(typeof executor.stop).toBe('function');
  });

  it('start 接受调度面四参形态（jobId, command, args, { hooks }）——桥内签名即四参', async () => {
    const bridged = channelAsExecutor(makeMockChannel(['succeeded']), {
      pollIntervalMs: 10,
      jobDirOf: (jobId) => `/data/train/${jobId}`,
    });
    const hooks: TrainExecutorHooks = {
      onStarted: () => undefined,
      onEvent: () => undefined,
      onClose: () => undefined,
      onError: () => undefined,
    };
    // 🔴 无类型断言直接四参调用——旧两参形态下 hooks 落在第二参（command 位），
    // onStarted 永不触发 → done 信号永不到 → 用例超时/断言红。第 0 步证伪锚。
    let started = false;
    const fourParamHooks: TrainExecutorHooks = {
      ...hooks,
      onStarted: () => { started = true; },
    };
    bridged.start('job-1', 'train', [], { hooks: fourParamHooks });
    await new Promise((r) => setTimeout(r, 50));
    expect(started).toBe(true); // 旧形状：hooks 在 command 位被忽略 → started=false 红
  });
});
