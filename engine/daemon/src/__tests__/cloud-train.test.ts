// cloud-train.test.ts · v1.4.7 批次 B · 云训练通道 daemon 接线行为锁
//
// 覆盖：
// - buildCloudSchedulerOptions：有 VM → executor+onEvent 注入 / 无 VM → 本地零变化
// - 全链：fake channel submit→事件→chainDualChannelEvent→audit.jsonl 落链
//   （断言 events.jsonl 尾行 + train-audit 链条目 + HMAC 链字段）
// - scheduler executor 注入口：注入 fake executor 与缺省 spawn 各归各
//
// 测试纪律：fake channel/exec 注入——零真实网络 / 零真实 ssh / 零真实进程。
// orchestrator 走真实 dist（对齐 continuous-training 装配形态——不 mock 包，
// createTrainScheduler 真 scheduler + 注入 executor）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildCloudSchedulerOptions,
  cloudRegistryPath,
  loadCloudVms,
  pickCloudVm,
} from '../tasks/cloud-train';
import type { TrainChannel, ChannelStatusResult } from '@sofagent/orchestrator';

// ── 测试基建 ──
let dataDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-cloud-train-'));
  // HMAC 密钥纪律（对齐 retention-policy.test.ts 惯例）：SOFAGENT_KEY_PATH 指向
  // 临时密钥——audit 链条目的 hmacSig 仅在 getHmacKey() 非空时写入，若不设则本测试
  // 依赖宿主环境的 ~/.sofagent-key（干净 CI 无密钥 → hmacSig undefined → 假失败）。
  // 绝不触碰真实 ~/.sofagent-key；A2 纪律：测试值全中性占位。
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'test-hmac-key');
  writeFileSync(process.env.SOFAGENT_KEY_PATH, 'test-cloud-train-key-0123456789abcdef');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** fake channel：脚本化状态序列（零真实网络） */
function makeFakeChannel(script: ChannelStatusResult['status'][]): TrainChannel & {
  submitted: Array<{ jobDir: string; jobId: string }>;
} {
  const submitted: Array<{ jobDir: string; jobId: string }> = [];
  let call = 0;
  return {
    name: 'fake-cloud',
    async submit(jobDirArg, spec) {
      submitted.push({ jobDir: jobDirArg, jobId: spec.jobId });
      return { remoteJobId: spec.jobId, accepted: true };
    },
    async status(): Promise<ChannelStatusResult> {
      const status = script[Math.min(call, script.length - 1)];
      call++;
      return {
        status,
        rawStatus: `fake:${status}`,
        recentEvents:
          status === 'running'
            ? [{ at: new Date().toISOString(), kind: 'progress', percent: 42 }]
            : status === 'failed'
              ? [{ at: new Date().toISOString(), kind: 'error', message: 'CUDA OOM' }]
              : status === 'succeeded'
                ? [{ at: new Date().toISOString(), kind: 'status', status: 'succeeded' }]
                : [],
      };
    },
    async artifacts() {
      return [{ name: 'adapter.safetensors', uri: 'fake://a', sha256: 'a'.repeat(64), sizeBytes: 1 }];
    },
    async cancel(_id, reason) {
      return { status: 'cancelled', rawStatus: `fake:cancelled(${reason})`, recentEvents: [] };
    },
  };
}

// ════════════════════════════════════════
// 注册表读取 + VM 选择
// ════════════════════════════════════════

describe('批次 B：注册表读取与 VM 选择', () => {
  it('registry.json 不存在 → 空表（云路径降级本地）', () => {
    expect(loadCloudVms(dataDir)).toEqual([]);
  });

  it('registry.json 有 VM → 读出（train_cloud 落盘形态兼容）', () => {
    const file = cloudRegistryPath(dataDir);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify([
        { name: 'vm-a', endpoint: 'u@1.2.3.4', status: 'reachable', registeredAt: '2025-01-01T00:00:00Z' },
        { name: 'vm-b', endpoint: 'u@5.6.7.8', status: 'unreachable', registeredAt: '2025-01-01T00:00:00Z' },
      ]),
      'utf-8',
    );
    const vms = loadCloudVms(dataDir);
    expect(vms).toHaveLength(2);
    const picked = pickCloudVm(vms);
    expect(picked?.name).toBe('vm-a'); // reachable 优先
  });

  it('坏 registry.json → 空表不 crash', () => {
    const file = cloudRegistryPath(dataDir);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{broken json', 'utf-8');
    expect(loadCloudVms(dataDir)).toEqual([]);
  });

  it('全 unreachable → 无 VM（维持本地）', () => {
    expect(pickCloudVm([{ name: 'x', endpoint: 'e', status: 'unreachable', registeredAt: 't' }])).toBeNull();
  });
});

// ════════════════════════════════════════
// 装配：有 VM 注入 / 无 VM 零变化
// ════════════════════════════════════════

describe('批次 B：buildCloudSchedulerOptions 装配', () => {
  it('无 VM → wired=false + schedulerOptions 无 executor（本地零变化）', () => {
    const r = buildCloudSchedulerOptions({ dataDir, enterpriseId: 'ent-1' });
    expect(r.wired).toBe(false);
    expect(r.reason).toContain('无可用云 VM');
    expect(r.schedulerOptions.executor).toBeUndefined();
    expect(r.schedulerOptions.onEvent).toBeUndefined();
    expect(r.schedulerOptions.dataDir).toBe(dataDir);
  });

  it('有 VM → wired=true + executor/onEvent 注入（vmName 在场）', () => {
    const r = buildCloudSchedulerOptions({
      dataDir,
      enterpriseId: 'ent-1',
      vms: [{ name: 'vm-a', endpoint: 'u@1.2.3.4', status: 'reachable', registeredAt: 't' }],
      channel: makeFakeChannel(['succeeded']),
    });
    expect(r.wired).toBe(true);
    expect(r.vmName).toBe('vm-a');
    expect(r.reason).toContain('u@1.2.3.4');
    expect(typeof r.schedulerOptions.executor?.start).toBe('function');
    expect(typeof r.schedulerOptions.executor?.stop).toBe('function');
    expect(typeof r.schedulerOptions.onEvent).toBe('function');
  });
});

// ════════════════════════════════════════
// 全链行为锁：fake channel → scheduler → events.jsonl + audit 链
// ════════════════════════════════════════

describe('批次 B：fake channel 全链（submit → 事件 → 挂链落账）', () => {
  it('云通道 job 全链：events.jsonl 尾行 + audit.jsonl 挂链 + HMAC 链字段', async () => {
    // succeeded 脚本：running(progress) → succeeded——终态 close(0)
    const channel = makeFakeChannel(['running', 'succeeded']);
    const wired = buildCloudSchedulerOptions({
      dataDir,
      enterpriseId: 'ent-1',
      vms: [{ name: 'vm-a', endpoint: 'u@1.2.3.4', status: 'reachable', registeredAt: 't' }],
      channel,
    });
    expect(wired.wired).toBe(true);

    // 真 scheduler + 注入 executor（对齐 continuous-training 装配形态）
    const { createTrainScheduler } = (await import('@sofagent/orchestrator')) as typeof import('@sofagent/orchestrator');
    const scheduler = createTrainScheduler({
      ...(wired.schedulerOptions as Parameters<typeof createTrainScheduler>[0]),
      crashRecoveryScan: false,
    });
    const submitted = scheduler.submitTrainJob({
      dataPath: join(dataDir, 'nonexistent.jsonl'),
      baseModel: 'Qwen3-8B',
      algorithm: 'sft',
    });
    const record = await submitted.handle!.done;

    // ① job 终态：close(0) 走 checkpointing 落点（桥协议：succeeded 映射
    // close(0)，scheduler 对未收尾的 0 退出按存档暂停收尾——行为锁锁定此语义）
    expect(['checkpointing', 'completed']).toContain(record.status);

    // ② events.jsonl 落盘且尾行是协议事件（append-only 回流）
    const eventsFile = join(dataDir, 'train', 'ent-1', record.jobId, 'events.jsonl');
    expect(existsSync(eventsFile)).toBe(true);
    const lines = readFileSync(eventsFile, 'utf-8').split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    const tail = JSON.parse(lines[lines.length - 1]!) as { type: string };
    expect(['progress', 'done', 'checkpoint', 'failed']).toContain(tail.type);

    // ③ audit.jsonl 挂链：提交+启动+终态事件在场 + HMAC 链字段
    const auditFile = join(dataDir, 'train', 'ent-1', record.jobId, 'audit.jsonl');
    expect(existsSync(auditFile)).toBe(true);
    const entries = readFileSync(auditFile, 'utf-8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const types = entries.map((e) => e.type);
    expect(types).toContain('train_job_submitted');
    expect(types).toContain('train_job_started');
    // HMAC 链字段（既有链——每条带 prevHash/hashVersion/hmacSig）
    for (const e of entries) {
      expect(e.prevHash).toBeDefined();
      expect(e.hashVersion).toBe(2);
      expect(e.hmacSig).toBeDefined();
    }

    // ④ 双通道挂链（接线②行为锁）：onEvent → chainDualChannelEvent 已把云通道
    // 终态事件写进同一条 audit 链（reason 带「云通道」标注——与 scheduler
    // 主链条目同链可查，「双通道同链可查」验收口径）
    const cloudChained = entries.filter((e) => typeof e.reason === 'string' && e.reason.includes('云通道'));
    expect(cloudChained.length).toBeGreaterThanOrEqual(1);
    expect(cloudChained[0]!.type).toBe('train_job_completed');
    const { checkTrainAuditChain } = (await import('@sofagent/orchestrator')) as typeof import('@sofagent/orchestrator');
    const chain = checkTrainAuditChain(dataDir, 'ent-1', record.jobId);
    expect(['ok', 'insufficient']).toContain(chain.status); // 链完整（ok）或历史不足（灰）
  });

  it('云通道 failed → job failed + train_job_failed 挂链', async () => {
    const channel = makeFakeChannel(['failed']);
    const wired = buildCloudSchedulerOptions({
      dataDir,
      enterpriseId: 'ent-2',
      vms: [{ name: 'vm-b', endpoint: 'u@5.6.7.8', status: 'reachable', registeredAt: 't' }],
      channel,
    });
    const { createTrainScheduler } = (await import('@sofagent/orchestrator')) as typeof import('@sofagent/orchestrator');
    const scheduler = createTrainScheduler({
      ...(wired.schedulerOptions as Parameters<typeof createTrainScheduler>[0]),
      crashRecoveryScan: false,
    });
    const submitted = scheduler.submitTrainJob({
      dataPath: join(dataDir, 'nope.jsonl'),
      baseModel: 'Qwen3-8B',
      algorithm: 'sft',
    });
    const record = await submitted.handle!.done;
    // close(1) → scheduler 失败分支（event:failed 来自桥的 error 事件映射）
    expect(record.status).toBe('failed');

    const auditFile = join(dataDir, 'train', 'ent-2', record.jobId, 'audit.jsonl');
    const types = readFileSync(auditFile, 'utf-8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => (JSON.parse(l) as Record<string, unknown>).type);
    expect(types).toContain('train_job_failed');
  });
});

// ════════════════════════════════════════
// executor 注入口：注入与缺省各归各
// ════════════════════════════════════════

describe('批次 B：scheduler executor 注入口行为锁', () => {
  it('注入 fake executor：start 被调、命令面透传、hooks 全回调', async () => {
    const calls: Array<{ jobId: string; command: string; args: string[] }> = [];
    const startedEvents: string[] = [];
    let closeHook: ((code: number | null) => void) | null = null;
    const { createTrainScheduler } = (await import('@sofagent/orchestrator')) as typeof import('@sofagent/orchestrator');
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-3',
      crashRecoveryScan: false,
      executor: {
        start: (jobId, command, args, options) => {
          calls.push({ jobId, command, args });
          // 异步驱动假执行（对齐桥形态——onStarted 同步、事件流/收尾后置）
          options.hooks.onStarted({ pid: 4242 } as never);
          startedEvents.push('started');
          closeHook = (code) => options.hooks.onClose({ code, child: { pid: 4242 } as never, stderrTail: '' });
          return { pid: 4242 } as never;
        },
        stop: async () => ({ action: 'noop' }),
      },
    });
    scheduler.submitTrainJob({ dataPath: '/d.jsonl', baseModel: 'Qwen3-8B', algorithm: 'sft' });
    // start 被调 + 命令面（python train.py --config job.json——约定①形态）
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('python');
    expect(calls[0]!.args[0]).toBe('train.py');
    expect(startedEvents).toEqual(['started']);
    // job.json 已落盘（launch 前置——与本地执行面同构）
    expect(existsSync(join(dataDir, 'train', 'ent-3', calls[0]!.jobId, 'job.json'))).toBe(true);
    // 收尾：close(0) → checkpointing 落点（存档暂停语义——与本地路径一致）
    closeHook!(0);
    const record = JSON.parse(
      readFileSync(join(dataDir, 'train', 'ent-3', calls[0]!.jobId, 'state.json'), 'utf-8'),
    ) as { status: string };
    expect(record.status).toBe('checkpointing');
  });

  it('缺省路径回归：无 executor 注入走本地 spawn（spawnFn 消费不变）', async () => {
    // spawnFn 直驱（对齐既有 train-monitor 测试形态——零真实进程）
    const { EventEmitter } = await import('events');
    const children: Array<{
      emitStdout: (s: string) => void;
      emitClose: (c: number | null) => void;
    }> = [];
    const spawnFn = (() => {
      const proc = new EventEmitter() as never as {
        stdout: EventEmitter;
        stderr: EventEmitter;
        pid: number;
        on: (ev: string, cb: (c: number | null) => void) => void;
        emit: (ev: string, c?: number | null) => boolean;
      };
      (proc as { stdout: EventEmitter }).stdout = new EventEmitter();
      (proc as { stderr: EventEmitter }).stderr = new EventEmitter();
      (proc as { pid: number }).pid = 1111;
      const augmented = proc as typeof proc & {
        emitStdout: (s: string) => void;
        emitClose: (c: number | null) => void;
      };
      augmented.emitStdout = (s: string) => proc.stdout.emit('data', s);
      augmented.emitClose = (c: number | null) => proc.emit('close', c);
      children.push(augmented);
      return proc;
    }) as unknown as () => ReturnType<typeof spawnFn>;
    const { createTrainScheduler } = (await import('@sofagent/orchestrator')) as typeof import('@sofagent/orchestrator') & {
      SpawnFn: unknown;
    };
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-4',
      crashRecoveryScan: false,
      spawnFn: spawnFn as import('@sofagent/orchestrator').SpawnFn,
    });
    const submitted = scheduler.submitTrainJob({ dataPath: '/d.jsonl', baseModel: 'Qwen3-8B', algorithm: 'sft' });
    expect(children).toHaveLength(1); // spawnFn 被本地执行器消费（缺省路径未变）
    children[0]!.emitStdout(JSON.stringify({ type: 'done' }) + '\n');
    children[0]!.emitClose(0);
    const record = await submitted.handle!.done;
    expect(record.status).toBe('completed'); // done 事件已收尾
  });
});
