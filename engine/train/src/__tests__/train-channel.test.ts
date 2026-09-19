// train-channel.test.ts · 章十二 TrainChannel 接口 + 通道注册表 + 执行者互换测试
import { describe, it, expect } from 'vitest';
import {
  channelAsExecutor,
  type TrainChannel,
  type ChannelStatusResult,
} from '../train-channel';
import { createLocalSpawnExecutor } from '../train-executor';
import type { TrainExecutorHooks } from '../train-executor';
import type { ChildProcess } from 'child_process';

/**
 * 轮询等待条件成立（上限 timeoutMs，超时即返回）。
 * 用途：替代固定 `setTimeout` 消除**真实子进程**的事件竞态——超时不抛错，
 * 由后续断言给出可读失败信息（不吞错、不放宽断言）。
 */
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** mock 云通道（内存状态机——零真实网络） */
function makeMockChannel(script: ChannelStatusResult['status'][]): TrainChannel {
  let call = 0;
  return {
    name: 'mock-cloud',
    async submit() {
      return { remoteJobId: 'mock-1', accepted: true };
    },
    async status(): Promise<ChannelStatusResult> {
      const status = script[Math.min(call, script.length - 1)];
      call++;
      return {
        status,
        rawStatus: `mock:${status}`,
        recentEvents: status === 'running' ? [{ at: new Date().toISOString(), kind: 'progress', percent: 42 }] : [],
      };
    },
    async artifacts() {
      return [{ name: 'adapter.safetensors', uri: 'mock://adapter', sha256: 'a'.repeat(64), sizeBytes: 1 }];
    },
    async cancel(_id, reason) {
      return {
        status: 'cancelled',
        rawStatus: `mock:cancelled(${reason})`,
        recentEvents: [],
      };
    },
  };
}

describe('章十二：TrainChannel 接口 + 通道注册表', () => {

  it('mock 通道四动作契约（submit/status/artifacts/cancel）', async () => {
    const ch = makeMockChannel(['pending', 'succeeded']);
    const sub = await ch.submit('/tmp/job', { jobId: 'j1', jobJsonSha256: 'a'.repeat(64) });
    expect(sub.accepted).toBe(true);
    expect((await ch.status(sub.remoteJobId)).status).toBe('pending');
    expect((await ch.status(sub.remoteJobId)).status).toBe('succeeded');
    const arts = await ch.artifacts(sub.remoteJobId);
    expect(arts[0].sha256).toHaveLength(64);
    const cancel = await ch.cancel(sub.remoteJobId, '测试');
    expect(cancel.status).toBe('cancelled');
  });
});

describe('章十二：执行者互换测试（同一 job 双执行面）', () => {
  /** 收集 hooks 事件的公共测试驱动 */
  function makeCollector() {
    const events: string[] = [];
    let closed = false;
    let closeCode: number | null = null;
    const hooks: TrainExecutorHooks = {
      onStarted: () => events.push('started'),
      onEvent: (ev) => events.push(`event:${ev.type}`),
      onClose: (info) => {
        closed = true;
        closeCode = info.code;
      },
      onError: (info) => events.push(`error:${info.err.message}`),
    };
    return { hooks, events, isClosed: () => closed, closeCode: () => closeCode };
  }

  it('mock 云通道跑 job：started → progress 事件 → close(0)', async () => {
    const ch = makeMockChannel(['running', 'succeeded']);
    const exec = channelAsExecutor(ch, { pollIntervalMs: 10 });
    const col = makeCollector();
    exec.start('job-x', 'train', [], { hooks: col.hooks });
    await new Promise((r) => setTimeout(r, 120));
    expect(col.events).toContain('started');
    expect(col.isClosed()).toBe(true);
    expect(col.closeCode()).toBe(0); // succeeded → code 0
    await exec.stop('job-x');
  });

  it('LocalSpawnExecutor 与 mock 云通道事件面同构（互换语义）', async () => {
    // 本地执行器：node -e 输出协议② JSON 行（done）——与云通道相同的事件流形态
    const local = createLocalSpawnExecutor({});
    const colLocal = makeCollector();
    local.start(
      'job-local',
      process.execPath,
      ['-e', 'console.log(JSON.stringify({type:"progress",step:1})); console.log(JSON.stringify({type:"done"}))'],
      { hooks: colLocal.hooks },
    );
    // 云通道：mock 脚本 pending → succeeded
    const cloud = channelAsExecutor(makeMockChannel(['running', 'succeeded']), { pollIntervalMs: 10 });
    const colCloud = makeCollector();
    cloud.start('job-cloud', 'train', [], { hooks: colCloud.hooks });

    // 双面等收敛——**轮询到条件成立**（上限 5s），不用固定 sleep：
    // local 面是真实子进程（node -e 输出两行 JSON），固定 200ms 在高负载下
    // 不够——8GB 机器实测约 1/3 概率只收到 started 就断言 = 假失败。
    // 云面同理必须等：mock 通道是 in-process 定时器轮询，local 子进程收敛时
    // 事件循环可能还没跑完云面首次 status 轮询——只等 local 就断言云面 =
    // 同款竞态在云侧复发（实测 test-count 全量跑时 ~1/16 概率假失败）。
    // 断言强度**不变**：progress / done / close(0) / 云面 started+close(0) 一个都不能少。
    await waitFor(() => colLocal.events.includes('event:done'), 5000);
    // 🔴 等待条件必须覆盖断言条件：此前只等 done 事件就断言 isClosed()，
    //   而 onClose 回调在 done 之后（子进程 exit 事件）——CI 高负载下 close
    //   晚于 done 到达 ⇒ 「等待 done 却断言已关闭」的错配竞态（CI 实测复现）。
    await waitFor(() => colLocal.isClosed(), 5000);
    await waitFor(() => colCloud.isClosed(), 5000);
    // 两面都收到事件流且以 close(0) 收尾——「执行者互换跑同一 job 均通」
    expect(colLocal.events).toContain('event:progress');
    expect(colLocal.events).toContain('event:done');
    expect(colLocal.isClosed()).toBe(true);
    expect(colLocal.closeCode()).toBe(0);
    expect(colCloud.events).toContain('started');
    expect(colCloud.isClosed()).toBe(true);
    expect(colCloud.closeCode()).toBe(0);
    await cloud.stop('job-cloud');
  });

  it('云通道 failed → close(1)（失败码传递）', async () => {
    const ch = makeMockChannel(['failed']);
    // failed 时 recentEvents 期望带 error 事件——mock 直接给 failed 状态
    const exec = channelAsExecutor(ch, { pollIntervalMs: 10 });
    const col = makeCollector();
    exec.start('job-f', 'train', [], { hooks: col.hooks });
    await new Promise((r) => setTimeout(r, 80));
    expect(col.isClosed()).toBe(true);
    expect(col.closeCode()).toBe(1);
    await exec.stop('job-f');
  });
});
