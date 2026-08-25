// train-fingerprint.test.ts · v1.4.1 块五 测试
//
// 验收标准逐条覆盖：
// - 指纹生成（全字段冻结 + 不可变纪律 + 权限 0600）
// - 篡改检测（改任一字段 → tampered；改 hmac 本身 → tampered/unverifiable）
// - 复现差异报告（改数据/改超参/改种子 → 各自报告对应字段，其余不误报）
// - 续跑版本锁定（一致放行；不一致 locked=false + reason 含两版本值）
// - 确定性（同数据两次生成 datasetHash 相同；文件顺序打乱后 hash 仍相同）
//
// HMAC 密钥纪律：SOFAGENT_KEY_PATH 指向临时密钥——绝不触碰真实 ~/.sofagent-key。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync, renameSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeDatasetHash,
  resolveDatasetVersion,
  trainFingerprintPath,
  freezeTrainFingerprint,
  loadTrainFingerprint,
  verifyTrainFingerprint,
  reproduceCheck,
  assertDatasetVersionLocked,
  buildDatasetLockEntry,
  TrainFingerprintError,
  type EnvSnapshot,
  type TrainFingerprint,
} from '../train/train-fingerprint';

// ── 测试基建 ──
let dataDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-fp-'));
  // 临时 HMAC 密钥（隔离真实密钥——train-audit.test 同款纪律）
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'test-hmac-key');
  writeFileSync(process.env.SOFAGENT_KEY_PATH, 'test-train-fp-key-0123456789abcdef');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** 基线环境快照（块一 train-env 报告字段引用） */
function baseEnvSnapshot(overrides: Partial<EnvSnapshot> = {}): EnvSnapshot {
  return {
    branch: 'cuda-ready',
    gpuName: 'NVIDIA A100',
    frameworkName: 'verl',
    frameworkVersion: '0.4.1',
    checkedAt: '2026-08-15T10:00:00.000Z',
    ...overrides,
  };
}

/** 造一个数据集目录（多文件——目录级 hash 输入） */
function makeDataset(files: Record<string, string>): string {
  const dir = join(dataDir, 'dataset-v1');
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, name);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  }
  return dir;
}

/** 基线冻结输入 */
function freezeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dataDir,
    enterpriseId: 'ent-alpha',
    trainJobId: 'job-fp-001',
    datasetDir: join(dataDir, 'dataset-v1'),
    envSnapshot: baseEnvSnapshot(),
    hyperparams: { lr: 0.0002, epochs: 3 },
    randomSeed: 42,
    timestamp: '2026-08-15T10:30:00.000Z',
    ...overrides,
  };
}

/** 冻结并返回指纹（测试快捷方式） */
function freeze(overrides: Record<string, unknown> = {}): TrainFingerprint {
  return freezeTrainFingerprint(freezeInput(overrides) as Parameters<typeof freezeTrainFingerprint>[0]);
}

// ════════════════════════════════════════
// 一、指纹生成（全字段冻结 + 不可变 + 权限）
// ════════════════════════════════════════

describe('指纹生成', () => {
  it('test_freezeTrainFingerprint_全字段冻结_落盘job目录', () => {
    makeDataset({ 'part-1.jsonl': '数据行A', 'part-2.jsonl': '数据行B' });
    const fp = freeze();

    // 全字段冻结（结构逐项断言）
    expect(fp.schemaVersion).toBe('v1');
    expect(fp.trainJobId).toBe('job-fp-001');
    expect(fp.datasetHash).toHaveLength(64); // sha256 hex
    expect(fp.datasetVersion).toBe('dataset-v1'); // 目录名兜底
    expect(fp.envSnapshot.branch).toBe('cuda-ready');
    expect(fp.hyperparams).toEqual({ lr: 0.0002, epochs: 3 });
    expect(fp.randomSeed).toBe(42);
    expect(fp.timestamp).toBe('2026-08-15T10:30:00.000Z');
    expect(fp.hmac).toHaveLength(32); // HMAC slice(0,32)
    expect(fp.hmacAlgo).toBe('stable');
    expect(typeof fp.envFingerprint).toBe('string');

    // 落盘位置：job 目录 train-fingerprint.json
    const file = trainFingerprintPath(dataDir, 'ent-alpha', 'job-fp-001');
    expect(existsSync(file)).toBe(true);
    const persisted = JSON.parse(readFileSync(file, 'utf-8')) as TrainFingerprint;
    expect(persisted.hmac).toBe(fp.hmac);
    // loadTrainFingerprint 回读等价
    expect(loadTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001')?.datasetHash).toBe(fp.datasetHash);
  });

  it('test_freezeTrainFingerprint_权限_0600', () => {
    makeDataset({ 'a.jsonl': '数据' });
    freeze();
    const mode = statSync(trainFingerprintPath(dataDir, 'ent-alpha', 'job-fp-001')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('test_freezeTrainFingerprint_重复冻结_拒绝抛错（不可变纪律）', () => {
    makeDataset({ 'a.jsonl': '数据' });
    freeze();
    // 第二次冻结（即使输入完全相同）→ 拒绝（指纹不可变）
    expect(() => freeze()).toThrow(TrainFingerprintError);
    expect(() => freeze()).toThrow(/不可变/);
    // 原文件未被覆盖（hmac 不变）
    const persisted = loadTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001');
    expect(persisted?.timestamp).toBe('2026-08-15T10:30:00.000Z');
  });

  it('test_freezeTrainFingerprint_非法输入_schema拒绝', () => {
    makeDataset({ 'a.jsonl': '数据' });
    // 负数种子 → schema 拒绝
    expect(() => freeze({ randomSeed: -1 })).toThrow(TrainFingerprintError);
    // 分支枚举外 → 拒绝
    expect(() =>
      freeze({ envSnapshot: baseEnvSnapshot({ branch: 'tpu-ready' as never }) }),
    ).toThrow(TrainFingerprintError);
  });

  it('test_freezeTrainFingerprint_签名即校验通过_valid', () => {
    makeDataset({ 'a.jsonl': '数据' });
    freeze();
    expect(verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001').status).toBe('valid');
  });
});

// ════════════════════════════════════════
// 二、确定性（datasetHash 稳定性）
// ════════════════════════════════════════

describe('数据集指纹确定性', () => {
  it('test_computeDatasetHash_同数据两次计算_hash相同', () => {
    makeDataset({ 'part-1.jsonl': '数据行A', 'part-2.jsonl': '数据行B', 'sub/nested.jsonl': '嵌套数据' });
    const h1 = computeDatasetHash(join(dataDir, 'dataset-v1'));
    const h2 = computeDatasetHash(join(dataDir, 'dataset-v1'));
    expect(h1).toBe(h2);
  });

  it('test_computeDatasetHash_文件顺序打乱_hash不变（排序消除）', () => {
    // 两个目录内容相同、创建顺序不同（目录项列举序可能不同）
    makeDataset({ 'a.jsonl': '内容A', 'b.jsonl': '内容B', 'c.jsonl': '内容C' });
    const dir2 = join(dataDir, 'dataset-copy');
    mkdirSync(dir2, { recursive: true });
    // 反序创建（c→b→a）
    for (const name of ['c.jsonl', 'b.jsonl', 'a.jsonl']) {
      const src = join(dataDir, 'dataset-v1', name);
      cpSync(src, join(dir2, name));
    }
    expect(computeDatasetHash(join(dataDir, 'dataset-v1'))).toBe(computeDatasetHash(dir2));
  });

  it('test_computeDatasetHash_内容变化_hash变化', () => {
    makeDataset({ 'a.jsonl': '旧内容' });
    const before = computeDatasetHash(join(dataDir, 'dataset-v1'));
    writeFileSync(join(dataDir, 'dataset-v1', 'a.jsonl'), '新内容', 'utf-8');
    const after = computeDatasetHash(join(dataDir, 'dataset-v1'));
    expect(before).not.toBe(after);
  });

  it('test_computeDatasetHash_文件增删_hash变化', () => {
    makeDataset({ 'a.jsonl': 'A' });
    const before = computeDatasetHash(join(dataDir, 'dataset-v1'));
    writeFileSync(join(dataDir, 'dataset-v1', 'b.jsonl'), 'B', 'utf-8'); // 增
    const added = computeDatasetHash(join(dataDir, 'dataset-v1'));
    expect(added).not.toBe(before);
    rmSync(join(dataDir, 'dataset-v1', 'b.jsonl')); // 删回
    expect(computeDatasetHash(join(dataDir, 'dataset-v1'))).toBe(before); // 恢复原值
  });

  it('test_computeDatasetHash_目录不存在_unknown占位', () => {
    expect(computeDatasetHash(join(dataDir, 'ghost'))).toBe('unknown');
  });

  it('test_resolveDatasetVersion_优先级_显式>目录名>hash前8位', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const dir = join(dataDir, 'dataset-v1');
    const hash = computeDatasetHash(dir);
    // 显式版本最优先
    expect(resolveDatasetVersion(dir, hash, 'v2.1.0')).toBe('v2.1.0');
    // 目录名兜底
    expect(resolveDatasetVersion(dir, hash)).toBe('dataset-v1');
    // 根路径无目录名 → hash 前 8 位
    expect(resolveDatasetVersion('/', hash)).toBe(hash.slice(0, 8));
  });
});

// ════════════════════════════════════════
// 三、篡改检测（三态校验）
// ════════════════════════════════════════

describe('篡改检测', () => {
  /** 冻结后篡改文件里的一个字段（重写文件） */
  function tamperField(field: string, value: unknown): void {
    const file = trainFingerprintPath(dataDir, 'ent-alpha', 'job-fp-001');
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    parsed[field] = value;
    writeFileSync(file, JSON.stringify(parsed, null, 2), 'utf-8');
    chmodSync(file, 0o600); // 保持权限（测试环境 umask 可能改）
  }

  beforeEach(() => {
    makeDataset({ 'a.jsonl': '数据' });
    freeze();
  });

  it('test_verifyTrainFingerprint_改datasetHash_tampered', () => {
    tamperField('datasetHash', 'f'.repeat(64));
    const r = verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001');
    expect(r.status).toBe('tampered');
  });

  it('test_verifyTrainFingerprint_改hyperparams_tampered', () => {
    tamperField('hyperparams', { lr: 999 });
    expect(verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001').status).toBe('tampered');
  });

  it('test_verifyTrainFingerprint_改randomSeed_tampered', () => {
    tamperField('randomSeed', 777);
    expect(verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001').status).toBe('tampered');
  });

  it('test_verifyTrainFingerprint_改datasetVersion_tampered', () => {
    tamperField('datasetVersion', 'v-tampered');
    expect(verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001').status).toBe('tampered');
  });

  it('test_verifyTrainFingerprint_改hmac本身_tampered', () => {
    // hmac 被伪造（环境指纹未动——篡改判定而非漂移）
    tamperField('hmac', '0'.repeat(32));
    const r = verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001');
    expect(r.status).toBe('tampered');
    expect(r.detail).toContain('篡改');
  });

  it('test_verifyTrainFingerprint_环境指纹漂移_unverifiable', () => {
    // 模拟换机器：文件里记录的 envFingerprint ≠ 当前环境指纹
    tamperField('envFingerprint', 'deadbeef');
    const r = verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001');
    expect(r.status).toBe('unverifiable');
    expect(r.detail).toContain('漂移');
  });

  it('test_verifyTrainFingerprint_文件不存在_unreadable', () => {
    const r = verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-not-exist');
    expect(r.status).toBe('unreadable');
  });

  it('test_verifyTrainFingerprint_文件损坏_unreadable', () => {
    const file = trainFingerprintPath(dataDir, 'ent-alpha', 'job-fp-001');
    writeFileSync(file, '{not-json', 'utf-8');
    expect(verifyTrainFingerprint(dataDir, 'ent-alpha', 'job-fp-001').status).toBe('unreadable');
  });
});

// ════════════════════════════════════════
// 四、复现差异报告（结构化 · 只报变的字段）
// ════════════════════════════════════════

describe('复现差异报告', () => {
  it('test_reproduceCheck_全一致_reproducible无差异', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const fp = freeze();
    const r = reproduceCheck(fp, {
      datasetDir: join(dataDir, 'dataset-v1'),
      envSnapshot: baseEnvSnapshot(),
      hyperparams: { lr: 0.0002, epochs: 3 },
      randomSeed: 42,
    });
    expect(r.reproducible).toBe(true);
    expect(r.diffs).toEqual([]);
  });

  it('test_reproduceCheck_改数据_只报datasetHash字段', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const fp = freeze();
    writeFileSync(join(dataDir, 'dataset-v1', 'a.jsonl'), '数据被换了', 'utf-8');
    const r = reproduceCheck(fp, {
      datasetDir: join(dataDir, 'dataset-v1'),
      envSnapshot: baseEnvSnapshot(),
      hyperparams: { lr: 0.0002, epochs: 3 },
      randomSeed: 42,
    });
    expect(r.reproducible).toBe(false);
    expect(r.diffs).toHaveLength(1); // 只报一个字段（不误报）
    expect(r.diffs[0]!.field).toBe('datasetHash');
    expect(r.diffs[0]!.before).toBe(fp.datasetHash);
    expect(typeof r.diffs[0]!.after).toBe('string');
    expect(r.diffs[0]!.after).not.toBe(fp.datasetHash);
  });

  it('test_reproduceCheck_改超参_只报hyperparams字段', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const fp = freeze();
    const r = reproduceCheck(fp, {
      datasetDir: join(dataDir, 'dataset-v1'),
      envSnapshot: baseEnvSnapshot(),
      hyperparams: { lr: 0.001, epochs: 3 }, // lr 变了
      randomSeed: 42,
    });
    expect(r.reproducible).toBe(false);
    expect(r.diffs).toHaveLength(1);
    expect(r.diffs[0]!.field).toBe('hyperparams');
  });

  it('test_reproduceCheck_超参键序不同_不误报（语义等价）', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const fp = freeze();
    const r = reproduceCheck(fp, {
      datasetDir: join(dataDir, 'dataset-v1'),
      envSnapshot: baseEnvSnapshot(),
      hyperparams: { epochs: 3, lr: 0.0002 }, // 键序颠倒——语义等价
      randomSeed: 42,
    });
    expect(r.reproducible).toBe(true); // stableStringify 键序不敏感
    expect(r.diffs).toEqual([]);
  });

  it('test_reproduceCheck_改种子_只报randomSeed字段', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const fp = freeze();
    const r = reproduceCheck(fp, {
      datasetDir: join(dataDir, 'dataset-v1'),
      envSnapshot: baseEnvSnapshot(),
      hyperparams: { lr: 0.0002, epochs: 3 },
      randomSeed: 2026,
    });
    expect(r.reproducible).toBe(false);
    expect(r.diffs).toHaveLength(1);
    expect(r.diffs[0]!.field).toBe('randomSeed');
    expect(r.diffs[0]!.before).toBe(42);
    expect(r.diffs[0]!.after).toBe(2026);
  });

  it('test_reproduceCheck_改环境_只报envSnapshot字段', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const fp = freeze();
    const r = reproduceCheck(fp, {
      datasetDir: join(dataDir, 'dataset-v1'),
      envSnapshot: baseEnvSnapshot({ branch: 'metal-degraded', gpuName: 'Apple M3 Pro' }),
      hyperparams: { lr: 0.0002, epochs: 3 },
      randomSeed: 42,
    });
    expect(r.reproducible).toBe(false);
    expect(r.diffs).toHaveLength(1);
    expect(r.diffs[0]!.field).toBe('envSnapshot');
    expect((r.diffs[0]!.before as EnvSnapshot).branch).toBe('cuda-ready');
    expect((r.diffs[0]!.after as EnvSnapshot).branch).toBe('metal-degraded');
  });

  it('test_reproduceCheck_多字段同变_全部报告', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const fp = freeze();
    writeFileSync(join(dataDir, 'dataset-v1', 'a.jsonl'), '换了', 'utf-8');
    const r = reproduceCheck(fp, {
      datasetDir: join(dataDir, 'dataset-v1'),
      envSnapshot: baseEnvSnapshot({ frameworkVersion: '0.5.0' }),
      hyperparams: { lr: 0.001, epochs: 3 },
      randomSeed: 999,
    });
    expect(r.reproducible).toBe(false);
    // 四字段全变（数据 + 环境 + 超参 + 种子）——各自一条差异
    expect(r.diffs.map((d) => d.field).sort()).toEqual([
      'datasetHash',
      'envSnapshot',
      'hyperparams',
      'randomSeed',
    ]);
  });
});

// ════════════════════════════════════════
// 五、checkpoint 续跑版本锁定（纯函数）
// ════════════════════════════════════════

describe('续跑版本锁定', () => {
  it('test_assertDatasetVersionLocked_版本一致_放行', () => {
    const r = assertDatasetVersionLocked('dataset-v1', 'dataset-v1');
    expect(r.locked).toBe(true);
    expect(r.reason).toContain('dataset-v1');
  });

  it('test_assertDatasetVersionLocked_版本漂移_拒绝且含两版本值', () => {
    const r = assertDatasetVersionLocked('dataset-v2', 'dataset-v1');
    expect(r.locked).toBe(false);
    // reason 必须含两个版本值（人审材料完整）
    expect(r.reason).toContain('dataset-v1');
    expect(r.reason).toContain('dataset-v2');
    expect(r.reason).toContain('人审'); // 明确人审路径（不自动切换）
  });

  it('test_assertDatasetVersionLocked_hash兜底版本_同样可锁定', () => {
    const hashV1 = 'abcd1234';
    const hashV2 = 'ffff0000';
    expect(assertDatasetVersionLocked(hashV1, hashV1).locked).toBe(true);
    const r = assertDatasetVersionLocked(hashV2, hashV1);
    expect(r.locked).toBe(false);
    expect(r.reason).toContain('abcd1234');
    expect(r.reason).toContain('ffff0000');
  });

  it('test_buildDatasetLockEntry_锁定条目_供manifest接线', () => {
    makeDataset({ 'a.jsonl': '数据' });
    const fp = freeze();
    const lock = buildDatasetLockEntry(fp);
    // 锁定条目字段完整（块七 manifest 工具消费）
    expect(lock.datasetVersion).toBe(fp.datasetVersion);
    expect(lock.datasetHash).toBe(fp.datasetHash);
    expect(lock.lockedAt).toBe(fp.timestamp);
    expect(lock.source).toBe('train-fingerprint');
  });
});

// ════════════════════════════════════════
// 六、调度器集成（完成时自动冻结——done 事件旁挂载）
// ════════════════════════════════════════

describe('调度器完成时冻结指纹', () => {
  it('test_scheduler_done_有环境快照与种子_自动冻结指纹', async () => {
    const datasetDir = makeDataset({ 'a.jsonl': '训练数据' });
    // 假子进程（零真实进程）
    const { EventEmitter } = await import('events');
    const child = new EventEmitter() as unknown as import('child_process').ChildProcess;
    (child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
    (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
    (child as unknown as { pid: number }).pid = 424244;
    const children = [child] as Array<
      import('child_process').ChildProcess & {
        emitStdout(line: string): void;
        emitClose(code: number | null): void;
      }
    >;
    children[0]!.emitStdout = (line: string) => {
      (child.stdout as EventEmitter).emit('data', Buffer.from(line + '\n'));
    };
    children[0]!.emitClose = (code: number | null) => {
      child.emit('close', code);
    };

    const { createTrainScheduler } = await import('../train/train-scheduler');
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-alpha',
      spawnFn: () => child,
      envSnapshotProvider: () => baseEnvSnapshot(),
      randomSeed: 42,
    });
    const { result } = scheduler.submitTrainJob({
      dataPath: datasetDir,
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
      hyperparams: { lr: 0.0002 },
    });

    // done 事件 → 完成 + 指纹冻结
    children[0]!.emitStdout('{"type":"done"}');
    children[0]!.emitClose(0);

    const fpFile = trainFingerprintPath(dataDir, 'ent-alpha', result.record.jobId);
    expect(existsSync(fpFile)).toBe(true);
    const fp = loadTrainFingerprint(dataDir, 'ent-alpha', result.record.jobId);
    expect(fp?.randomSeed).toBe(42);
    expect(fp?.hyperparams).toEqual({ lr: 0.0002 });
    expect(fp?.datasetHash).toHaveLength(64);
    // 冻结即校验通过
    expect(verifyTrainFingerprint(dataDir, 'ent-alpha', result.record.jobId).status).toBe('valid');
  });

  it('test_scheduler_done_无环境快照_跳过冻结不阻断完成', async () => {
    const datasetDir = makeDataset({ 'a.jsonl': '数据' });
    const { EventEmitter } = await import('events');
    const child = new EventEmitter() as unknown as import('child_process').ChildProcess;
    (child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
    (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
    (child as unknown as { pid: number }).pid = 424245;
    const emitStdout = (line: string) => {
      (child.stdout as EventEmitter).emit('data', Buffer.from(line + '\n'));
    };

    const { createTrainScheduler } = await import('../train/train-scheduler');
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-alpha',
      spawnFn: () => child,
      // envSnapshotProvider 缺省 → 无环境快照 → 跳过冻结
    });
    const { result } = scheduler.submitTrainJob({
      dataPath: datasetDir,
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
    });

    emitStdout('{"type":"done"}');
    child.emit('close', 0);

    // 无指纹文件（跳过），但任务正常完成（不阻断）
    expect(existsSync(trainFingerprintPath(dataDir, 'ent-alpha', result.record.jobId))).toBe(false);
    const { loadTrainJobRecord } = await import('../train/train-job');
    expect(loadTrainJobRecord(dataDir, 'ent-alpha', result.record.jobId)?.status).toBe('completed');
  });

  it('test_scheduler_done_种子从hyperparams读取_seed字段', async () => {
    const datasetDir = makeDataset({ 'a.jsonl': '数据' });
    const { EventEmitter } = await import('events');
    const child = new EventEmitter() as unknown as import('child_process').ChildProcess;
    (child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
    (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
    (child as unknown as { pid: number }).pid = 424246;
    const emitStdout = (line: string) => {
      (child.stdout as EventEmitter).emit('data', Buffer.from(line + '\n'));
    };

    const { createTrainScheduler } = await import('../train/train-scheduler');
    const scheduler = createTrainScheduler({
      dataDir,
      enterpriseId: 'ent-alpha',
      spawnFn: () => child,
      envSnapshotProvider: () => baseEnvSnapshot(),
      // randomSeed 缺省 → 从 hyperparams.seed 读
    });
    const { result } = scheduler.submitTrainJob({
      dataPath: datasetDir,
      baseModel: 'qwen3-8b',
      algorithm: 'sft',
      hyperparams: { lr: 0.0002, seed: 2026 },
    });

    emitStdout('{"type":"done"}');
    child.emit('close', 0);

    const fp = loadTrainFingerprint(dataDir, 'ent-alpha', result.record.jobId);
    expect(fp?.randomSeed).toBe(2026); // 种子透传自 hyperparams.seed
  });
});
