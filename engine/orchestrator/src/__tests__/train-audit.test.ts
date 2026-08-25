// train-audit.test.ts · v1.4.1 块三 测试
//
// 验收标准逐条覆盖：
// - 状态迁移全记事件（六种生命周期事件各至少一条断言）
// - 数据源 hash 入库可溯源（computeDataSourceHash + 事件携带）
// - HMAC 链篡改检测（改一行历史 → 校验失败 tampered）
// - 失败回滚可用（半成品挪走 + rollbackTo 记录 + train_job_rollback 审计）
// - enterpriseId 缺失拒绝写入
//
// HMAC 密钥纪律：SOFAGENT_KEY_PATH 指向临时密钥——绝不触碰真实 ~/.sofagent-key
// （对齐 decision-log.test.ts 模式）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  STATUS_TO_EVENT,
  computeDataSourceHash,
  trainAuditPath,
  emitTrainAudit,
  readTrainAudit,
  checkTrainAuditChain,
  rollbackFailedTrainJob,
  failTrainJobWithRollback,
  TrainAuditSchemaError,
  type EmitTrainAuditInput,
} from '../train/train-audit';
import { createTrainScheduler, type SpawnFn } from '../train/train-scheduler';
import { createTrainJob, loadTrainJobRecord, trainJobFilePaths } from '../train/train-job';

// ── 测试基建 ──
let dataDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-audit-'));
  // 临时 HMAC 密钥（隔离真实密钥——decision-log.test 同款纪律）
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'test-hmac-key');
  writeFileSync(process.env.SOFAGENT_KEY_PATH, 'test-train-audit-key-0123456789abcdef');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** 基线审计输入（缺省合法） */
function auditInput(overrides: Partial<EmitTrainAuditInput> = {}): EmitTrainAuditInput {
  return {
    type: 'train_job_submitted',
    trainJobId: 'job-audit-001',
    enterpriseId: 'ent-alpha',
    dataSourceHash: 'a'.repeat(64),
    hyperparams: { lr: 0.0002 },
    ...overrides,
  };
}

/** 假子进程（零真实进程——EventEmitter 模拟） */
function fakeChild(): ChildProcess & { emitStdout(line: string): void; emitClose(code: number | null): void } {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as { stdout: EventEmitter }).stdout = new EventEmitter();
  (proc as { stderr: EventEmitter }).stderr = new EventEmitter();
  (proc as { pid: number }).pid = 424243;
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

/** 假 spawn（捕获调用 + 返回可控假子进程） */
function makeFakeSpawn(): { spawnFn: SpawnFn; children: ReturnType<typeof fakeChild>[] } {
  const children: ReturnType<typeof fakeChild>[] = [];
  return {
    spawnFn: () => {
      const c = fakeChild();
      children.push(c);
      return c;
    },
    children,
  };
}

// ════════════════════════════════════════
// 一、状态迁移全记事件（六种生命周期）
// ════════════════════════════════════════

describe('生命周期事件覆盖（每次状态迁移记一条）', () => {
  it('test_emitTrainAudit_六种生命周期类型_全部合法写入', () => {
    // 六种类型逐个写入——校验合法且落盘正确
    const types = [
      'train_job_submitted',
      'train_job_started',
      'train_job_checkpoint',
      'train_job_completed',
      'train_job_failed',
      'train_job_cancelled',
    ] as const;
    for (const type of types) {
      const entry = emitTrainAudit(auditInput({ type }), dataDir);
      expect(entry.type).toBe(type);
    }
    // 落盘 6 条（同一 job 的 audit.jsonl）
    const entries = readTrainAudit(dataDir, 'ent-alpha', 'job-audit-001');
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.type)).toEqual([...types]);
  });

  it('test_STATUS_TO_EVENT_状态映射_六状态全覆盖', () => {
    expect(STATUS_TO_EVENT.queued).toBe('train_job_submitted');
    expect(STATUS_TO_EVENT.running).toBe('train_job_started');
    expect(STATUS_TO_EVENT.checkpointing).toBe('train_job_checkpoint');
    expect(STATUS_TO_EVENT.completed).toBe('train_job_completed');
    expect(STATUS_TO_EVENT.failed).toBe('train_job_failed');
    expect(STATUS_TO_EVENT.cancelled).toBe('train_job_cancelled');
  });

  it('test_scheduler_submit_提交记submitted事件_含数据源hash', () => {
    // 准备训练数据文件（数据源指纹可计算）
    const dataFile = join(dataDir, 'trainset.jsonl');
    writeFileSync(dataFile, JSON.stringify({ q: '问题', a: '回答' }) + '\n', 'utf-8');
    const expectedHash = computeDataSourceHash(dataFile);

    const { spawnFn } = makeFakeSpawn();
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });
    const { result } = scheduler.submitTrainJob({
      dataPath: dataFile,
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });

    // 审计：submitted + started 两事件（提交 → 启动）
    const entries = readTrainAudit(dataDir, 'ent-alpha', result.record.jobId);
    const types = entries.map((e) => e.type);
    expect(types).toContain('train_job_submitted');
    expect(types).toContain('train_job_started');
    // 数据源 hash 入库（可溯源——与文件内容指纹一致）
    const submitted = entries.find((e) => e.type === 'train_job_submitted')!;
    expect(submitted.dataSourceHash).toBe(expectedHash);
    expect(submitted.dataSourceHash).toHaveLength(64); // sha256 hex
    // 超参与产出路径入库
    expect(submitted.hyperparams).toEqual({});
    expect(submitted.outputDir).toBe(result.record.job.outputDir);
  });

  it('test_scheduler_done_完成记completed事件', () => {
    const { spawnFn, children } = makeFakeSpawn();
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    children[0]!.emitStdout('{"type":"done"}');
    children[0]!.emitClose(0);

    const entries = readTrainAudit(dataDir, 'ent-alpha', result.record.jobId);
    const completed = entries.find((e) => e.type === 'train_job_completed');
    expect(completed).toBeDefined();
    expect(completed?.fromStatus).toBe('running');
    expect(completed?.toStatus).toBe('completed');
  });

  it('test_scheduler_sigint退出_存档记checkpoint事件', () => {
    const { spawnFn, children } = makeFakeSpawn();
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    // 退出码 0 无 done → checkpointing（SIGINT 存档）
    children[0]!.emitClose(0);

    const entries = readTrainAudit(dataDir, 'ent-alpha', result.record.jobId);
    const checkpoint = entries.find((e) => e.type === 'train_job_checkpoint');
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.toStatus).toBe('checkpointing');
  });

  it('test_scheduler_cancel_取消记cancelled事件', async () => {
    const { spawnFn } = makeFakeSpawn();
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    await scheduler.cancelTrainJob(result.record.jobId);

    const entries = readTrainAudit(dataDir, 'ent-alpha', result.record.jobId);
    const cancelled = entries.find((e) => e.type === 'train_job_cancelled');
    expect(cancelled).toBeDefined();
    expect(cancelled?.toStatus).toBe('cancelled');
    expect(cancelled?.reason).toContain('取消');
  });
});

// ════════════════════════════════════════
// 二、数据源 hash 可溯源
// ════════════════════════════════════════

describe('数据源指纹（可溯源）', () => {
  it('test_computeDataSourceHash_同内容同hash_异内容异hash', () => {
    const fileA = join(dataDir, 'a.jsonl');
    const fileA2 = join(dataDir, 'a-copy.jsonl');
    const fileB = join(dataDir, 'b.jsonl');
    writeFileSync(fileA, '训练数据行', 'utf-8');
    writeFileSync(fileA2, '训练数据行', 'utf-8');
    writeFileSync(fileB, '另一批训练数据', 'utf-8');

    expect(computeDataSourceHash(fileA)).toBe(computeDataSourceHash(fileA2)); // 同内容同 hash
    expect(computeDataSourceHash(fileA)).not.toBe(computeDataSourceHash(fileB)); // 异内容异 hash
    expect(computeDataSourceHash(fileA)).toHaveLength(64); // sha256 hex 长度
  });

  it('test_computeDataSourceHash_文件不存在_unknown占位', () => {
    expect(computeDataSourceHash(join(dataDir, 'not-exist.jsonl'))).toBe('unknown');
  });

  it('test_emitTrainAudit_hash缺省拒绝_保溯源口径', () => {
    expect(() =>
      emitTrainAudit(auditInput({ dataSourceHash: '' }), dataDir),
    ).toThrow(TrainAuditSchemaError);
  });
});

// ════════════════════════════════════════
// 三、HMAC 链（与 decision-log 同模式）
// ════════════════════════════════════════

describe('HMAC 链完整性', () => {
  it('test_emitTrainAudit_连续写入_构成可验证链', () => {
    for (const type of [
      'train_job_submitted',
      'train_job_started',
      'train_job_completed',
    ] as const) {
      emitTrainAudit(auditInput({ type }), dataDir);
    }
    const result = checkTrainAuditChain(dataDir, 'ent-alpha', 'job-audit-001');
    expect(result.status).toBe('ok');

    // 链字段结构（与 decision-log 同构）
    const entries = readTrainAudit(dataDir, 'ent-alpha', 'job-audit-001');
    expect(entries[0]!.prevHash).toBe('genesis');
    expect(entries[1]!.prevHash).not.toBe('genesis'); // 后续条目链上前条
    expect(entries.every((e) => e.hashVersion === 2)).toBe(true);
    expect(entries.every((e) => typeof e.hmacSig === 'string' && e.hmacSig!.length === 32)).toBe(true);
    expect(entries.every((e) => e.hmacAlgo === 'stable')).toBe(true);
  });

  it('test_emitTrainAudit_改一行历史_链校验tampered', () => {
    emitTrainAudit(auditInput({ type: 'train_job_submitted' }), dataDir);
    emitTrainAudit(auditInput({ type: 'train_job_started' }), dataDir);
    emitTrainAudit(auditInput({ type: 'train_job_completed' }), dataDir);
    expect(checkTrainAuditChain(dataDir, 'ent-alpha', 'job-audit-001').status).toBe('ok');

    // 篡改中间行（改 hyperparams 内容——HMAC 必然失配）
    const filePath = trainAuditPath(dataDir, 'ent-alpha', 'job-audit-001');
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const tampered = JSON.parse(lines[1]!) as Record<string, unknown>;
    tampered.hyperparams = { lr: 999 }; // 恶意改超参
    lines[1] = JSON.stringify(tampered);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = checkTrainAuditChain(dataDir, 'ent-alpha', 'job-audit-001');
    expect(result.status).toBe('tampered'); // 篡改检测命中
  });

  it('test_emitTrainAudit_单条记录_insufficient判定', () => {
    emitTrainAudit(auditInput(), dataDir);
    const result = checkTrainAuditChain(dataDir, 'ent-alpha', 'job-audit-001');
    expect(result.status).toBe('insufficient');
  });

  it('test_emitTrainAudit_文件权限_0o600', () => {
    emitTrainAudit(auditInput(), dataDir);
    const filePath = trainAuditPath(dataDir, 'ent-alpha', 'job-audit-001');
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
    // 追加后权限保持
    emitTrainAudit(auditInput({ type: 'train_job_started' }), dataDir);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('test_emitTrainAudit_先脱敏再签名_密钥文本落盘前已脱敏', () => {
    // 构造含密钥形态的超参值（测试专用中性假串——非真实密钥）
    const marker = 'sk-fakekeyabcdefghijklmnopqrstuvwx';
    emitTrainAudit(
      auditInput({ hyperparams: { apiHint: `端点密钥 ${marker} 已轮换` }, reason: `失败原因含 ${marker}` }),
      dataDir,
    );
    emitTrainAudit(auditInput({ type: 'train_job_started' }), dataDir);

    const raw = readFileSync(trainAuditPath(dataDir, 'ent-alpha', 'job-audit-001'), 'utf-8');
    expect(raw).not.toContain(marker); // 密钥形态不落盘
    expect(raw).toContain('REDACTED'); // 脱敏占位可见
    // 脱敏后内容签名——链校验仍通过（证明 HMAC 基于脱敏后内容）
    expect(checkTrainAuditChain(dataDir, 'ent-alpha', 'job-audit-001').status).toBe('ok');
  });
});

// ════════════════════════════════════════
// 四、enterpriseId 强制（缺失拒绝写入）
// ════════════════════════════════════════

describe('enterpriseId 强制', () => {
  it('test_emitTrainAudit_enterpriseId缺失_拒绝写入抛错', () => {
    expect(() =>
      emitTrainAudit(auditInput({ enterpriseId: undefined as unknown as string }), dataDir),
    ).toThrow(TrainAuditSchemaError);
    expect(() => emitTrainAudit(auditInput({ enterpriseId: '' }), dataDir)).toThrow(
      TrainAuditSchemaError,
    );
    expect(() => emitTrainAudit(auditInput({ enterpriseId: '   ' }), dataDir)).toThrow(
      TrainAuditSchemaError,
    );
    // 拒绝写入 = 无文件产生（校验失败不写文件）
    expect(existsSync(trainAuditPath(dataDir, 'ent-alpha', 'job-audit-001'))).toBe(false);
  });

  it('test_emitTrainAudit_其余schema错误_同样拒绝', () => {
    expect(() => emitTrainAudit(auditInput({ type: 'bogus' as never }), dataDir)).toThrow(
      TrainAuditSchemaError,
    );
    expect(() =>
      emitTrainAudit(auditInput({ trainJobId: '' }), dataDir),
    ).toThrow(TrainAuditSchemaError);
  });
});

// ════════════════════════════════════════
// 五、失败回滚（半成品隔离 + rollbackTo + 审计）
// ════════════════════════════════════════

describe('失败回滚', () => {
  /** 造一个带半成品的失败现场：job 目录 + output/checkpoints 半成品文件 */
  function makeFailedScene(jobId: string, withCheckpoint: boolean): {
    outputDir: string;
    checkpointPath: string;
    lastCheckpoint: { checkpointPath: string; step: number } | null;
    hyperparams: Record<string, unknown>;
  } {
    const { record } = createTrainJob({
      dataDir,
      enterpriseId: 'ent-alpha',
      jobId,
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
      hyperparams: { lr: 0.0003 },
    });
    const outputDir = record.job.outputDir;
    const checkpointPath = record.job.checkpointPath;
    // 半成品：output 里的 adapter + checkpoints 里的 step 文件
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(checkpointPath, { recursive: true });
    writeFileSync(join(outputDir, 'adapter-half.bin'), '半成品权重', 'utf-8');
    writeFileSync(join(checkpointPath, 'step-120.safetensors'), '半成品断点', 'utf-8');
    return {
      outputDir,
      checkpointPath,
      lastCheckpoint: withCheckpoint
        ? { checkpointPath: join(checkpointPath, 'step-120.safetensors'), step: 120 }
        : null,
      hyperparams: record.job.hyperparams,
    };
  }

  it('test_rollbackFailedTrainJob_有checkpoint_rollbackTo指向断点', () => {
    const scene = makeFailedScene('job-rb-001', true);
    const rollback = rollbackFailedTrainJob(
      dataDir,
      {
        trainJobId: 'job-rb-001',
        enterpriseId: 'ent-alpha',
        lastCheckpoint: scene.lastCheckpoint,
        outputDir: scene.outputDir,
        checkpointPath: scene.checkpointPath,
        hyperparams: scene.hyperparams,
      },
      'f'.repeat(64),
    );

    // rollbackTo = 上一 checkpoint 路径（续跑起点）
    expect(rollback.rollbackTo).toBe(scene.lastCheckpoint!.checkpointPath);
    // 半成品挪到 failed-artifacts/（现场封存）
    expect(rollback.quarantined).toContain('output');
    expect(rollback.quarantined).toContain('checkpoints');
    expect(existsSync(join(rollback.quarantineDir, 'output', 'adapter-half.bin'))).toBe(true);
    expect(existsSync(join(rollback.quarantineDir, 'checkpoints', 'step-120.safetensors'))).toBe(true);
    // 原位置已清空（job 目录可写状态续跑不受半成品污染）
    expect(existsSync(scene.outputDir)).toBe(false);
    expect(existsSync(scene.checkpointPath)).toBe(false);
    // rollback 审计事件（进链）
    const entries = readTrainAudit(dataDir, 'ent-alpha', 'job-rb-001');
    const rbEvent = entries.find((e) => e.type === 'train_job_rollback');
    expect(rbEvent).toBeDefined();
    expect(rbEvent?.rollback?.rollbackTo).toBe(scene.lastCheckpoint!.checkpointPath);
    expect(rbEvent?.rollback?.quarantined).toEqual(['output', 'checkpoints']);
  });

  it('test_rollbackFailedTrainJob_无checkpoint_现场封存rollbackTo为null', () => {
    const scene = makeFailedScene('job-rb-002', false);
    const rollback = rollbackFailedTrainJob(
      dataDir,
      {
        trainJobId: 'job-rb-002',
        enterpriseId: 'ent-alpha',
        lastCheckpoint: null,
        outputDir: scene.outputDir,
        checkpointPath: scene.checkpointPath,
        hyperparams: scene.hyperparams,
      },
      'e'.repeat(64),
    );

    // 无断点可回 → rollbackTo=null + 失败现场完整封存（git snapshot 等价实现）
    expect(rollback.rollbackTo).toBeNull();
    expect(existsSync(join(rollback.quarantineDir, 'output', 'adapter-half.bin'))).toBe(true);
    // 审计事件留痕
    const rbEvent = readTrainAudit(dataDir, 'ent-alpha', 'job-rb-002').find(
      (e) => e.type === 'train_job_rollback',
    );
    expect(rbEvent?.rollback?.rollbackTo).toBeNull();
    expect(rbEvent?.reason).toContain('封存');
  });

  it('test_failTrainJobWithRollback_一体封装_failed事件加rollback事件', () => {
    const scene = makeFailedScene('job-rb-003', true);
    const { rollback, auditEntry } = failTrainJobWithRollback(
      dataDir,
      {
        trainJobId: 'job-rb-003',
        enterpriseId: 'ent-alpha',
        lastCheckpoint: scene.lastCheckpoint,
        outputDir: scene.outputDir,
        checkpointPath: scene.checkpointPath,
        hyperparams: scene.hyperparams,
        fromStatus: 'running',
        reason: 'CUDA OOM',
      },
      'd'.repeat(64),
    );

    // 先 failed 终态事件、后 rollback 动作事件（顺序——审计可追溯）
    const entries = readTrainAudit(dataDir, 'ent-alpha', 'job-rb-003');
    expect(entries.map((e) => e.type)).toEqual(['train_job_failed', 'train_job_rollback']);
    expect(auditEntry.type).toBe('train_job_failed');
    expect(auditEntry.reason).toBe('CUDA OOM');
    expect(rollback.rollbackTo).toBe(scene.lastCheckpoint!.checkpointPath);
    // 链完整（两事件入链）
    expect(checkTrainAuditChain(dataDir, 'ent-alpha', 'job-rb-003').status).toBe('ok');
  });

  it('test_scheduler_failed事件流_自动触发回滚', () => {
    const { spawnFn, children } = makeFakeSpawn();
    const scheduler = createTrainScheduler({ dataDir, enterpriseId: 'ent-alpha', spawnFn });
    const { result } = scheduler.submitTrainJob({
      dataPath: '/data/train.jsonl',
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });
    // 半成品预置（模拟训练中途产出）
    const rec = loadTrainJobRecord(dataDir, 'ent-alpha', result.record.jobId)!;
    const { jobDir } = trainJobFilePaths(dataDir, 'ent-alpha', result.record.jobId);
    mkdirSync(join(jobDir, 'output'), { recursive: true });
    writeFileSync(join(jobDir, 'output', 'half.bin'), '半成品', 'utf-8');
    expect(rec.status).toBe('running');

    // failed 事件 → 状态迁移 + 自动回滚
    children[0]!.emitStdout('{"type":"failed","reason":"loss 爆炸"}');
    children[0]!.emitClose(1);

    expect(loadTrainJobRecord(dataDir, 'ent-alpha', result.record.jobId)?.status).toBe('failed');
    const entries = readTrainAudit(dataDir, 'ent-alpha', result.record.jobId);
    const types = entries.map((e) => e.type);
    expect(types).toContain('train_job_failed');
    expect(types).toContain('train_job_rollback');
    // 半成品已挪走
    expect(existsSync(join(jobDir, 'output'))).toBe(false);
    expect(existsSync(join(jobDir, 'failed-artifacts', 'output', 'half.bin'))).toBe(true);
  });
});

// ════════════════════════════════════════
// 六、扩展位（后续块事件类型预留）
// ════════════════════════════════════════

describe('扩展位（union 开放扩展）', () => {
  it('test_emitTrainAudit_预留事件类型_可写入', () => {
    for (const type of [
      'train_abnormal_exit',
      'artifact_tampered',
      'train_engine_crash_recover',
    ] as const) {
      const entry = emitTrainAudit(auditInput({ type }), dataDir);
      expect(entry.type).toBe(type);
    }
    // 三条扩展事件入链校验通过
    expect(checkTrainAuditChain(dataDir, 'ent-alpha', 'job-audit-001').status).toBe('ok');
  });
});
