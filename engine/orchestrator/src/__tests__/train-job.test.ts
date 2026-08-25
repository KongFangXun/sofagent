// train-job.test.ts · v1.4.1 块二 测试
//
// 验收标准逐条覆盖：
// - 状态机全迁移路径（queued → running → checkpointing → completed/failed/cancelled
//   + 非法迁移拒绝抛错 + 终态无出边）
// - 幂等（同 jobId 重复提交返回既有 / 重复取消安全 / 重复续跑复用既有新 job）
// - checkpoint 续跑（resumeFrom {checkpointPath, step} 透传到 spawn 参数——
//   协议①单 JSON config 文件 + v1.3.1 Durable checkpoint 语义衔接）
// - enterpriseId 缺失拒绝创建（块四企业隔离依赖）
// - 事件回流（stdout JSON 行 → events.jsonl append-only，进度曲线可查）
//
// 测试纪律：spawn/信号全注入（零真实进程——对齐 SignalController 注入模式）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  TRAIN_JOB_TRANSITIONS,
  canTransition,
  isTerminalStatus,
  trainJobDir,
  trainJobFilePaths,
  generateTrainJobId,
  createTrainJob,
  loadTrainJobRecord,
  applyTrainJobTransition,
  transitionTrainJob,
  appendTrainEventLine,
  readTrainEvents,
  listTrainJobRecords,
} from '../train/train-job';
import { createTrainScheduler, type SpawnFn } from '../train/train-scheduler';

// ── 测试基建：tmpdir 生命周期 ──
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-job-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 生成合法创建输入（测试基线——字段对齐 TrainJobSchema） */
function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dataDir,
    enterpriseId: 'ent-alpha',
    dataPath: '/data/train.jsonl',
    baseModel: 'qwen3-8b',
    algorithm: 'sft',
    hyperparams: { lr: 0.0002 },
    ...overrides,
  };
}

/** 假子进程工厂（EventEmitter 模拟——零真实进程） */
function fakeChild(): ChildProcess & { emitStdout(line: string): void; emitClose(code: number | null): void } {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as { stdout: EventEmitter }).stdout = new EventEmitter();
  (proc as { stderr: EventEmitter }).stderr = new EventEmitter();
  (proc as { pid: number }).pid = 424242;
  const augmented = proc as ChildProcess & {
    emitStdout(line: string): void;
    emitClose(code: number | null): void;
  };
  augmented.emitStdout = (line: string) => {
    (proc.stdout as EventEmitter).emit('data', Buffer.from(line + '\n'));
  };
  augmented.emitClose = (code: number | null) => {
    proc.emit('close', code);
  };
  return augmented;
}

/** 捕获型假 spawn（记录调用参数——断言 resumeFrom 透传） */
function recordingSpawn(calls: Array<{ command: string; args: string[] }>): SpawnFn {
  return (command, args) => {
    calls.push({ command, args });
    return fakeChild();
  };
}

// ════════════════════════════════════════
// 一、状态机全迁移路径
// ════════════════════════════════════════

describe('状态机迁移路径', () => {
  it('test_canTransition_合法迁移全路径_通过', () => {
    // 全部合法边（对齐 TRAIN_JOB_TRANSITIONS 白名单）
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('queued', 'cancelled')).toBe(true);
    expect(canTransition('running', 'checkpointing')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('running', 'cancelled')).toBe(true);
    expect(canTransition('checkpointing', 'running')).toBe(true);
    expect(canTransition('checkpointing', 'completed')).toBe(true);
    expect(canTransition('checkpointing', 'failed')).toBe(true);
    expect(canTransition('checkpointing', 'cancelled')).toBe(true);
  });

  it('test_canTransition_非法迁移_拒绝', () => {
    // 跳态（queued 直达终态成功面）与逆行（终态复活）均非法
    expect(canTransition('queued', 'completed')).toBe(false);
    expect(canTransition('queued', 'failed')).toBe(false);
    expect(canTransition('queued', 'checkpointing')).toBe(false);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('failed', 'running')).toBe(false);
    expect(canTransition('cancelled', 'queued')).toBe(false);
  });

  it('test_TRAIN_JOB_TRANSITIONS_终态无出边_为空数组', () => {
    for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
      expect(TRAIN_JOB_TRANSITIONS[terminal]).toEqual([]);
      expect(isTerminalStatus(terminal)).toBe(true);
    }
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('checkpointing')).toBe(false);
  });

  it('test_applyTrainJobTransition_非法迁移_抛错', () => {
    const { record } = createTrainJob(baseInput() as Parameters<typeof createTrainJob>[0]);
    // queued → completed 跳态：必须拒绝并抛错
    expect(() => applyTrainJobTransition(record, 'completed')).toThrow(/非法状态迁移/);
  });

  it('test_applyTrainJobTransition_合法迁移_补终态时间戳', () => {
    const { record } = createTrainJob(baseInput() as Parameters<typeof createTrainJob>[0]);
    const running = applyTrainJobTransition(record, 'running', { pid: 111 });
    expect(running.status).toBe('running');
    expect(running.pid).toBe(111);
    expect(running.finishedAt).toBeUndefined(); // 非终态不补 finishedAt

    const completed = applyTrainJobTransition(running, 'completed');
    expect(completed.status).toBe('completed');
    expect(completed.finishedAt).toBeDefined();
  });

  it('test_transitionTrainJob_落盘迁移_状态持久化', () => {
    const { record } = createTrainJob(baseInput() as Parameters<typeof createTrainJob>[0]);
    transitionTrainJob(dataDir, 'ent-alpha', record.jobId, 'running');
    transitionTrainJob(dataDir, 'ent-alpha', record.jobId, 'completed', { reason: 'done' });

    const persisted = loadTrainJobRecord(dataDir, 'ent-alpha', record.jobId);
    expect(persisted?.status).toBe('completed');
    expect(persisted?.reason).toBe('done');
  });

  it('test_transitionTrainJob_落盘非法迁移_抛错且不落盘', () => {
    const { record } = createTrainJob(baseInput() as Parameters<typeof createTrainJob>[0]);
    expect(() =>
      transitionTrainJob(dataDir, 'ent-alpha', record.jobId, 'failed'),
    ).toThrow(/非法状态迁移/);
    // 状态未被破坏（仍 queued）
    expect(loadTrainJobRecord(dataDir, 'ent-alpha', record.jobId)?.status).toBe('queued');
  });

  it('test_transitionTrainJob_任务不存在_抛错', () => {
    expect(() =>
      transitionTrainJob(dataDir, 'ent-alpha', 'job-not-exist', 'running'),
    ).toThrow(/不存在/);
  });
});

// ════════════════════════════════════════
// 二、enterpriseId 必填（块四隔离依赖）
// ════════════════════════════════════════

describe('enterpriseId 必填校验', () => {
  it('test_createTrainJob_enterpriseId缺失_拒绝创建并抛错', () => {
    expect(() => createTrainJob(baseInput({ enterpriseId: undefined }) as Parameters<typeof createTrainJob>[0])).toThrow(
      /enterpriseId 必填/,
    );
    expect(() => createTrainJob(baseInput({ enterpriseId: '' }) as Parameters<typeof createTrainJob>[0])).toThrow(
      /enterpriseId 必填/,
    );
    expect(() => createTrainJob(baseInput({ enterpriseId: '   ' }) as Parameters<typeof createTrainJob>[0])).toThrow(
      /enterpriseId 必填/,
    );
  });

  it('test_createTrainJob_enterpriseId存在_目录按企业分区', () => {
    const { record } = createTrainJob(baseInput({ enterpriseId: 'ent-beta' }) as Parameters<typeof createTrainJob>[0]);
    // 目录分区规范：data/train/<enterpriseId>/<jobId>/
    const jobDir = trainJobDir(dataDir, 'ent-beta', record.jobId);
    expect(existsSync(jobDir)).toBe(true);
    expect(existsSync(join(jobDir, 'job.json'))).toBe(true);
    expect(existsSync(join(jobDir, 'state.json'))).toBe(true);
  });

  it('test_createTrainJob_不同企业_目录隔离', () => {
    const a = createTrainJob(baseInput({ enterpriseId: 'ent-a' }) as Parameters<typeof createTrainJob>[0]);
    const b = createTrainJob(baseInput({ enterpriseId: 'ent-b' }) as Parameters<typeof createTrainJob>[0]);
    expect(a.record.jobId).not.toBe(b.record.jobId);
    expect(listTrainJobRecords(dataDir, 'ent-a')).toHaveLength(1);
    expect(listTrainJobRecords(dataDir, 'ent-b')).toHaveLength(1);
    // 交叉读不到（隔离——loadTrainJobRecord 按企业分区路径取）
    expect(loadTrainJobRecord(dataDir, 'ent-b', a.record.jobId)).toBeNull();
  });
});

// ════════════════════════════════════════
// 三、幂等
// ════════════════════════════════════════

describe('幂等（重复提交 / 重复取消 / 重复续跑）', () => {
  it('test_createTrainJob_同jobId重复提交_返回既有任务不新建', () => {
    const first = createTrainJob(baseInput({ jobId: 'job-idem-001' }) as Parameters<typeof createTrainJob>[0]);
    expect(first.created).toBe(true);
    expect(first.record.status).toBe('queued');

    // 重复提交：返回既有（created=false），不覆盖不新建
    const second = createTrainJob(baseInput({ jobId: 'job-idem-001' }) as Parameters<typeof createTrainJob>[0]);
    expect(second.created).toBe(false);
    expect(second.record.jobId).toBe('job-idem-001');
    expect(second.record.createdAt).toBe(first.record.createdAt); // 原记录未被改写
    expect(listTrainJobRecords(dataDir, 'ent-alpha')).toHaveLength(1);
  });

  it('test_cancelTrainJob_重复取消_安全返回幂等标记', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-alpha',
      spawnFn: recordingSpawn(calls),
    });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });

    // 第一次取消：running → checkpointing → cancelled
    const first = await scheduler.cancelTrainJob(result.record.jobId);
    expect(first.alreadyInTerminalState).toBe(false);
    expect(first.status).toBe('cancelled');

    // 重复取消：幂等命中（不抛错 + alreadyInTerminalState=true）
    const second = await scheduler.cancelTrainJob(result.record.jobId);
    expect(second.alreadyInTerminalState).toBe(true);
    expect(second.status).toBe('cancelled');
    expect(second.signal.action).toBe('noop');
  });

  it('test_cancelTrainJob_queued任务_直接取消', () => {
    // 纯创建（未 submit 未 launch）→ queued 态取消：无进程 → noop 信号 + 直接收尾
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha' });
    const { record } = createTrainJob(baseInput() as Parameters<typeof createTrainJob>[0]);
    expect(record.status).toBe('queued');

    const r = scheduler.cancelTrainJob(record.jobId).then((cancel) => cancel);
    return r.then((cancel) => {
      expect(cancel.status).toBe('cancelled');
      expect(cancel.signal.action).toBe('noop'); // 无子进程——状态机直接收尾
      expect(loadTrainJobRecord(dataDir, 'ent-alpha', record.jobId)?.status).toBe('cancelled');
    });
  });

  it('test_resumeTrainJob_重复续跑_复用既有新job不重复消费', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-alpha',
      spawnFn: recordingSpawn(calls),
    });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'grpo',
    });
    const jobId = result.record.jobId;

    // 制造断点：SIGINT 存档语义——已 running（submit 推进）→ checkpointing + 断点
    appendTrainEventLine(dataDir, 'ent-alpha', jobId, {
      type: 'checkpoint',
      path: '/ckpt/step-500',
      step: 500,
    });
    transitionTrainJob(dataDir, 'ent-alpha', jobId, 'checkpointing', {
      lastCheckpoint: { checkpointPath: '/ckpt/step-500', step: 500 },
    });
    const rec = loadTrainJobRecord(dataDir, 'ent-alpha', jobId);
    expect(rec?.lastCheckpoint).toEqual({ checkpointPath: '/ckpt/step-500', step: 500 });

    // 第一次续跑：新 job 血缘链
    const first = scheduler.resumeTrainJob(jobId);
    expect(first.resume.reused).toBe(false);
    expect(first.resume.newJobId).not.toBe(jobId);
    expect(first.resume.resumeFrom).toEqual({ checkpointPath: '/ckpt/step-500', step: 500 });

    // 第二次续跑（重复操作）：复用既有新 job（幂等——不重复消费断点）
    const second = scheduler.resumeTrainJob(jobId);
    expect(second.resume.reused).toBe(true);
    expect(second.resume.newJobId).toBe(first.resume.newJobId);
  });
});

// ════════════════════════════════════════
// 四、checkpoint 续跑（resumeFrom 透传 spawn 参数）
// ════════════════════════════════════════

describe('checkpoint 续跑（协议③ Durable 衔接）', () => {
  it('test_resumeTrainJob_resumeFrom透传_spawn参数携带断点', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-alpha',
      spawnFn: recordingSpawn(calls),
    });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    const jobId = result.record.jobId;

    // SIGINT 存档语义：running → checkpointing + lastCheckpoint 落盘（首跑零事件流）
    const { eventsFile, jobFile } = trainJobFilePaths(dataDir, 'ent-alpha', jobId);
    writeFileSync(eventsFile, '', 'utf-8'); // 清空首跑事件流（模拟首跑零事件）
    transitionTrainJob(dataDir, 'ent-alpha', jobId, 'checkpointing', {
      lastCheckpoint: { checkpointPath: '/ckpt/sigint-step-120', step: 120 },
    });

    // 续跑：显式 resumeFrom（断点透传）
    const { resume, handle } = scheduler.resumeTrainJob(jobId);
    expect(handle).not.toBeNull();

    // 断言①：spawn 用 buildTrainSpawnArgs 协议（train.py --config <job.json>）
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.command).toBe('python');
    expect(lastCall.args[0]).toBe('train.py');
    expect(lastCall.args[1]).toBe('--config');

    // 断言②：--config 指向新 job 的 job.json（<dataDir>/train/<企业>/<jobId>/）
    const configPath = lastCall.args[2]!;
    expect(configPath).toContain(join('train', 'ent-alpha'));
    expect(configPath).toBe(trainJobFilePaths(dataDir, 'ent-alpha', resume.newJobId).jobFile);

    // 断言③：job.json 内 resumeFrom 断点透传（v1.3.1 checkpoint 语义衔接）
    const spawnedJob = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      resumeFrom?: { checkpointPath: string; step: number };
      resumedFromJobId?: string;
    };
    expect(spawnedJob.resumeFrom).toEqual(resume.resumeFrom);
    expect(spawnedJob.resumedFromJobId).toBeUndefined(); // 血缘在编排层 state，不进协议

    // 编排层状态记录血缘 + 断点
    const newRec = loadTrainJobRecord(dataDir, 'ent-alpha', resume.newJobId);
    expect(newRec?.resumedFromJobId).toBe(jobId);
    expect(newRec?.job.resumeFrom).toEqual(resume.resumeFrom);
    expect(jobFile).toBeTruthy();
  });

  it('test_resumeTrainJob_无checkpoint_抛错拒绝续跑', () => {
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha' });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    // 无 resumeFrom 也无 lastCheckpoint（无 checkpoint 事件）→ 拒绝
    expect(() => scheduler.resumeTrainJob(result.record.jobId)).toThrow(/无 checkpoint/);
  });

  it('test_resumeTrainJob_用量继承_预算口径连续', () => {
    // 父任务已消耗 800 步（预算 1000）→ 续跑新 job 初始 usage=800（再跑 250 超限拒绝创建）
    const { record: parent } = createTrainJob(
      baseInput({ budget: { maxSteps: 1000 }, initialUsage: { elapsedMinutes: 5, steps: 800, cost: 0 } }) as Parameters<typeof createTrainJob>[0],
    );
    // createTrainJob 出生态 queued → running → checkpointing（SIGINT 存档语义）
    transitionTrainJob(dataDir, 'ent-alpha', parent.jobId, 'running');
    transitionTrainJob(dataDir, 'ent-alpha', parent.jobId, 'checkpointing', {
      lastCheckpoint: { checkpointPath: '/ckpt/step-800', step: 800 },
    });
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn: recordingSpawn([]) });
    const { resume } = scheduler.resumeTrainJob(parent.jobId);
    const child = loadTrainJobRecord(dataDir, 'ent-alpha', resume.newJobId);
    expect(child?.usage.steps).toBe(800); // 用量继承
    expect(child?.job.resumeFrom?.step).toBe(800);
  });
});

// ════════════════════════════════════════
// 五、事件回流（stdout JSON → events.jsonl）
// ════════════════════════════════════════

describe('事件回流（协议②）', () => {
  it('test_consumeStdout_progress事件流_events追加且状态推进', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnFn: SpawnFn = (command, args) => {
      calls.push({ command, args });
      const c = fakeChild();
      children.push(c);
      return c;
    };
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });

    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    const jobId = result.record.jobId;

    // 状态推进验证：submit 已 queued → running
    expect(loadTrainJobRecord(dataDir, 'ent-alpha', jobId)?.status).toBe('running');

    // 回流事件：progress（step/loss/reward）+ checkpoint + done
    children[0]!.emitStdout('{"type":"progress","step":10,"loss":0.5,"reward":1.2}');
    children[0]!.emitStdout('{"type":"progress","step":20,"loss":0.4}');
    children[0]!.emitStdout('{"type":"checkpoint","path":"/ckpt/step-20","step":20}');
    children[0]!.emitStdout('{"type":"done"}');
    children[0]!.emitClose(0);

    const final = await children.length > 0 ? scheduler.monitorTrainJob(jobId) : null;
    expect(final?.status).toBe('completed');
    expect(final?.eventCount).toBe(4);
    expect(final?.lastCheckpoint).toEqual({ checkpointPath: '/ckpt/step-20', step: 20 });

    // events.jsonl append-only 落盘（进度曲线查询源）+ ts 信封
    const { eventsFile } = trainJobFilePaths(dataDir, 'ent-alpha', jobId);
    const lines = readFileSync(eventsFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(4);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first.type).toBe('progress');
    expect(first.step).toBe(10);
    expect(typeof first.ts).toBe('string');
    // readTrainEvents 回读（协议解析）
    const { events } = readTrainEvents(dataDir, 'ent-alpha', jobId);
    expect(events.map((e) => e.type)).toEqual(['progress', 'progress', 'checkpoint', 'done']);
  });

  it('test_consumeStdout_非JSON行_坏行容忍不崩溃', () => {
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnFn: SpawnFn = () => {
      const c = fakeChild();
      children.push(c);
      return c;
    };
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });

    // 坏行（训练库 warn 输出）——静默容忍，好行照常处理
    children[0]!.emitStdout('[ WARN ] cuda memory fragmented');
    children[0]!.emitStdout('{"type":"progress","step":5}');
    const snapshot = scheduler.monitorTrainJob(result.record.jobId);
    expect(snapshot.eventCount).toBe(1);
    expect(snapshot.status).toBe('running');
  });

  it('test_consumeStdout_failed事件_状态推进failed', async () => {
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnFn: SpawnFn = () => {
      const c = fakeChild();
      children.push(c);
      return c;
    };
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    children[0]!.emitStdout('{"type":"failed","reason":"OOM"}');
    children[0]!.emitClose(1);

    // done promise 收尾为 failed（reason 透传）
    await new Promise((r) => setTimeout(r, 10));
    const rec = loadTrainJobRecord(dataDir, 'ent-alpha', result.record.jobId);
    expect(rec?.status).toBe('failed');
    expect(rec?.reason).toBe('OOM');
  });

  it('test_consumeStdout_退出码0未收尾_视为checkpointing存档暂停', async () => {
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnFn: SpawnFn = () => {
      const c = fakeChild();
      children.push(c);
      return c;
    };
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    // SIGINT 优雅退出（退出码 0、无 done 事件）→ 协议③存档暂停
    children[0]!.emitClose(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(loadTrainJobRecord(dataDir, 'ent-alpha', result.record.jobId)?.status).toBe('checkpointing');
  });
});

// ════════════════════════════════════════
// 六、协议与预算校验（创建即校验）
// ════════════════════════════════════════

describe('创建校验（协议 SSOT）', () => {
  it('test_createTrainJob_非法algorithm_拒绝创建', () => {
    expect(() =>
      createTrainJob(baseInput({ algorithm: 'rlhf-magic' }) as Parameters<typeof createTrainJob>[0]),
    ).toThrow(/校验失败/);
  });

  it('test_createTrainJob_初始用量超预算_拒绝创建', () => {
    // 续跑继承用量场景：预算 1000 步、已耗 1200 步 → 生而超限拒绝
    expect(() =>
      createTrainJob(
        baseInput({ budget: { maxSteps: 1000 }, initialUsage: { elapsedMinutes: 0, steps: 1200, cost: 0 } }) as Parameters<typeof createTrainJob>[0],
      ),
    ).toThrow(/预算校验失败/);
  });

  it('test_createTrainJob_缺省路径_job目录下收敛', () => {
    const { record } = createTrainJob(baseInput() as Parameters<typeof createTrainJob>[0]);
    expect(record.job.checkpointPath).toContain(record.jobId);
    expect(record.job.outputDir).toContain(record.jobId);
    expect(record.job.hyperparams).toEqual({ lr: 0.0002 });
  });

  it('test_generateTrainJobId_前缀与唯一性', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(generateTrainJobId());
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.startsWith('job-')).toBe(true);
  });
});

// ════════════════════════════════════════
// 七、心跳注册钩子（块七接线验证——不实装）
// ════════════════════════════════════════

describe('心跳注册钩子（块七 process-guard 预留）', () => {
  it('test_launch_spawn后_心跳钩子收到pid与jobId', () => {
    const beats: Array<{ pid: number; jobId: string }> = [];
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-alpha',
      spawnFn: recordingSpawn([]),
      registerHeartbeat: (pid, jobId) => beats.push({ pid, jobId }),
    });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    expect(beats).toEqual([{ pid: 424242, jobId: result.record.jobId }]);
  });

  it('test_launch_未注册心跳_不报错（可选注入点）', () => {
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-alpha',
      spawnFn: recordingSpawn([]),
    });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    expect(result.created).toBe(true); // 无心跳钩子时正常提交
  });
});

// ════════════════════════════════════════
// 八、坏数据降级
// ════════════════════════════════════════

describe('坏数据降级', () => {
  it('test_loadTrainJobRecord_state损坏_降级null', () => {
    const { record } = createTrainJob(baseInput() as Parameters<typeof createTrainJob>[0]);
    const { stateFile } = trainJobFilePaths(dataDir, 'ent-alpha', record.jobId);
    writeFileSync(stateFile, '{not-json', 'utf-8');
    expect(loadTrainJobRecord(dataDir, 'ent-alpha', record.jobId)).toBeNull();
  });

  it('test_readTrainEvents_文件不存在_空结果', () => {
    const { events, errors } = readTrainEvents(dataDir, 'ent-alpha', 'job-none');
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('test_listTrainJobRecords_企业目录不存在_空数组', () => {
    expect(listTrainJobRecords(dataDir, 'ent-ghost')).toEqual([]);
    expect(mkdirSync(join(dataDir, 'train', 'ent-ghost2'), { recursive: true })).toBeTruthy();
    expect(listTrainJobRecords(dataDir, 'ent-ghost2')).toEqual([]);
  });
});
