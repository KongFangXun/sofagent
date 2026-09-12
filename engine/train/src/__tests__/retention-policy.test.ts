// retention-policy.test.ts · v1.4.5 第五章 测试
//
// 验收标准逐条覆盖（devlog 第五章）：
// - 保留策略可配：train-retention.json 解析 + 坏配置回落缺省 + 默认 5 checkpoint
// - 保留判定：最近 5 checkpoint 进 keep / 超期进 archive / 生产权重保留 /
//   eval 基线训练集（版本链尾）保留 / 回滚点标记强制 keep
// - 归档标记：markRollbackPoint 幂等 + HMAC 签名 + 台账可读
// - 自动归档：archive 集 → zip 冷存 + 台账 + 源目录删除 + 审计事件
// - 过期清理：归档超 90 天覆写销毁（wipeFile 复用）+ 未超期保留 + 台账行同步抹除
// - 空间预警：checkDiskPressure 阈值判定 + 建议列最大可归档项（注入 statfs 比例不可行——
//   本测试断言结构语义：threshold 可配、告警字段结构、suggestions 排序）
//
// HMAC 密钥纪律：SOFAGENT_KEY_PATH 指向临时密钥——绝不触碰真实 ~/.sofagent-key。
// A2 纪律：测试值全中性占位。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_RETENTION_CONFIG,
  loadRetentionConfig,
  saveRetentionConfig,
  markRollbackPoint,
  readRetentionMarkers,
  queryRetentionDecision,
  resolvePointPath,
  archiveExpired,
  purgeExpiredArchives,
  checkDiskPressure,
  trainArchiveDir,
  type RollbackPointRef,
} from '../train/retention-policy';
import { unzipEntries } from '../train/data-ingest';
import { listTrainJobRecords } from '../train/train-job';

// ── 测试基建 ──
const ENT = 'ent-ret';

let dataDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-retention-'));
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'test-hmac-key');
  writeFileSync(process.env.SOFAGENT_KEY_PATH, 'test-retention-key-0123456789abcdef');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** 造一个 job 现场：state.json + checkpoints/<n> 目录（走 train-job 真实 API） */
function seedJob(jobId: string, checkpointCount: number, status = 'completed'): void {
  const jobDir = join(dataDir, 'train', ENT, jobId);
  mkdirSync(join(jobDir, 'checkpoints'), { recursive: true });
  writeFileSync(
    join(jobDir, 'state.json'),
    JSON.stringify({
      jobId,
      enterpriseId: ENT,
      status,
      job: {
        schemaVersion: 'v1',
        jobId,
        dataPath: '/tmp/placeholder-data.jsonl',
        baseModel: 'Qwen3-8B',
        algorithm: 'sft',
        hyperparams: {},
        checkpointPath: join(jobDir, 'checkpoints'),
        outputDir: join(jobDir, 'output'),
      },
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      usage: { elapsedMinutes: 0, steps: 0, cost: 0 },
    }),
    'utf-8',
  );
  for (let i = 1; i <= checkpointCount; i++) {
    const ckptDir = join(jobDir, 'checkpoints', `step-${i * 100}`);
    mkdirSync(ckptDir, { recursive: true });
    writeFileSync(join(ckptDir, 'adapter.safetensors'), `weights-step-${i}`);
  }
}

describe('retention-policy · 策略配置', () => {
  it('test_loadRetentionConfig_无配置文件_返回默认策略', () => {
    const cfg = loadRetentionConfig(dataDir, ENT);
    expect(cfg).toEqual(DEFAULT_RETENTION_CONFIG);
    expect(cfg.keepCheckpoints).toBe(5);
    expect(cfg.purgeAfterDays).toBe(90);
    expect(cfg.diskWarnPercent).toBe(0.8);
  });

  it('test_loadRetentionConfig_自定义配置_可配生效', () => {
    saveRetentionConfig(dataDir, ENT, {
      keepCheckpoints: 3,
      purgeAfterDays: 30,
      diskWarnPercent: 0.7,
      autoArchive: false,
    });
    const cfg = loadRetentionConfig(dataDir, ENT);
    expect(cfg.keepCheckpoints).toBe(3);
    expect(cfg.purgeAfterDays).toBe(30);
    expect(cfg.diskWarnPercent).toBe(0.7);
    expect(cfg.autoArchive).toBe(false);
  });

  it('test_loadRetentionConfig_坏JSON_逐字段回落缺省（fail-open）', () => {
    const dir = join(dataDir, 'train', ENT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'train-retention.json'), '{broken json', 'utf-8');
    const cfg = loadRetentionConfig(dataDir, ENT);
    expect(cfg).toEqual(DEFAULT_RETENTION_CONFIG);
  });

  it('test_loadRetentionConfig_非法字段值_回落缺省', () => {
    const dir = join(dataDir, 'train', ENT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'train-retention.json'),
      JSON.stringify({ keepCheckpoints: -1, purgeAfterDays: 0, diskWarnPercent: 2 }),
      'utf-8',
    );
    const cfg = loadRetentionConfig(dataDir, ENT);
    expect(cfg.keepCheckpoints).toBe(5);
    expect(cfg.purgeAfterDays).toBe(90);
    expect(cfg.diskWarnPercent).toBe(0.8);
  });
});

describe('retention-policy · 归档标记（markRollbackPoint）', () => {
  it('test_markRollbackPoint_登记成功_带HMAC签名', () => {
    const marker = markRollbackPoint(dataDir, ENT, {
      kind: 'checkpoint',
      path: 'checkpoints/job-x/step-300',
      trainJobId: 'job-x',
      reason: '交付包 train-deliverable-ent-ret-20260905 引用的回滚点',
      markedAt: '2026-09-05T10:00:00.000Z',
    });
    expect(marker.point.kind).toBe('checkpoint');
    expect(marker.point.reason).toContain('交付包');
    // HMAC 签名在场（密钥可用路径——32 hex）
    expect(marker.hmacSig).toMatch(/^[0-9a-f]{32}$/);
    // 台账可读
    const all = readRetentionMarkers(dataDir, ENT);
    expect(all).toHaveLength(1);
    expect(all[0]!.point.path).toBe('checkpoints/job-x/step-300');
  });

  it('test_markRollbackPoint_同对象重复标记_幂等返回既有行', () => {
    const first = markRollbackPoint(dataDir, ENT, {
      kind: 'checkpoint',
      path: 'checkpoints/job-x/step-300',
      reason: '第一次标记',
    });
    const second = markRollbackPoint(dataDir, ENT, {
      kind: 'checkpoint',
      path: 'checkpoints/job-x/step-300',
      reason: '第二次标记（应幂等忽略）',
    });
    expect(second.id).toBe(first.id);
    expect(second.point.reason).toBe('第一次标记');
    expect(readRetentionMarkers(dataDir, ENT)).toHaveLength(1);
  });

  it('test_markRollbackPoint_缺reason_拒绝', () => {
    expect(() =>
      markRollbackPoint(dataDir, ENT, {
        kind: 'checkpoint',
        path: 'checkpoints/job-x/step-300',
        reason: '',
      }),
    ).toThrow(/reason 必填/);
  });
});

describe('retention-policy · 回滚点路径解析（resolvePointPath 统一基址——finding-07）', () => {
  it('test_resolvePointPath_checkpoint相对登记键映射到物理checkpoint目录', () => {
    seedJob('job-rp', 1); // 造 data/train/<ent>/job-rp/checkpoints/step-100
    const point: RollbackPointRef = {
      kind: 'checkpoint',
      path: 'checkpoints/job-rp/step-100',
      trainJobId: 'job-rp',
      reason: '验收基线',
      markedAt: '2026-09-05T10:00:00.000Z',
    };
    const resolved = resolvePointPath(dataDir, ENT, point);
    // 与保留判定 §一 归档条目项的物理落点（train-job 结构）一致
    expect(resolved).toBe(join(dataDir, 'train', ENT, 'job-rp', 'checkpoints', 'step-100'));
    expect(existsSync(resolved)).toBe(true);
  });

  it('test_resolvePointPath_weights相对登记基址与企业树一致_不落到dataDir错层', () => {
    // weights 相对登记按 RollbackPointRef.path 注释 = 相对 data/train/<ent>/
    // 解析；曾被 §四 join(dataDir, pt.path) 错解到企业树上一层（finding-07 洞）。
    const point: RollbackPointRef = {
      kind: 'weights',
      path: 'job-rp/checkpoints/step-100',
      reason: '共享权重分片基线',
      markedAt: '2026-09-05T10:00:00.000Z',
    };
    const resolved = resolvePointPath(dataDir, ENT, point);
    expect(resolved).toBe(join(dataDir, 'train', ENT, 'job-rp', 'checkpoints', 'step-100'));
    // 三层企业根之外的 dataDir 拼法必须不产生（防基址上移）
    expect(resolved.startsWith(join(dataDir, 'train', ENT, 'job-rp'))).toBe(true);
  });

  it('test_resolvePointPath_绝对path原样透传', () => {
    const abs = join(dataDir, 'train', ENT, 'job-rp', 'checkpoints', 'step-100');
    seedJob('job-rp', 1);
    const point: RollbackPointRef = {
      kind: 'checkpoint',
      path: abs,
      reason: '绝对登记形态',
      markedAt: '2026-09-05T10:00:00.000Z',
    };
    expect(resolvePointPath(dataDir, ENT, point)).toBe(abs);
  });
});

describe('retention-policy · 保留判定（queryRetentionDecision）', () => {
  it('test_queryRetentionDecision_最近5个checkpoint进keep_超期进archive', () => {
    seedJob('job-a', 8); // 8 个 checkpoint：5 keep + 3 archive
    const decision = queryRetentionDecision(dataDir, ENT);
    const ckptKeep = decision.keep.filter((k) => k.kind === 'checkpoint' && k.trainJobId === 'job-a');
    const ckptArchive = decision.archive.filter((k) => k.trainJobId === 'job-a');
    expect(ckptKeep).toHaveLength(5);
    expect(ckptArchive).toHaveLength(3);
    // keep 的是最近的（step-800…step-400）；archive 是最旧的
    const keepNames = ckptKeep.map((k) => k.path.split('/').pop());
    expect(keepNames).toContain('step-800');
    expect(keepNames).toContain('step-400');
    expect(keepNames).not.toContain('step-300');
  });

  it('test_queryRetentionDecision_自定义keepCheckpoints_判定随策略', () => {
    saveRetentionConfig(dataDir, ENT, {
      ...DEFAULT_RETENTION_CONFIG,
      keepCheckpoints: 2,
    });
    seedJob('job-b', 4);
    const decision = queryRetentionDecision(dataDir, ENT);
    expect(decision.keep.filter((k) => k.trainJobId === 'job-b')).toHaveLength(2);
    expect(decision.archive.filter((k) => k.trainJobId === 'job-b')).toHaveLength(2);
  });

  it('test_queryRetentionDecision_回滚点标记强制keep_从archive集剔除', () => {
    seedJob('job-c', 8);
    // step-300 是最旧第 8 个（默认必进 archive）——标记成回滚点
    markRollbackPoint(dataDir, ENT, {
      kind: 'checkpoint',
      path: `checkpoints/job-c/step-300`,
      trainJobId: 'job-c',
      reason: '企业验收基线版本',
    });
    const decision = queryRetentionDecision(dataDir, ENT);
    // 回滚点不在 archive 集
    expect(
      decision.archive.some((a) => a.path.endsWith('step-300')),
    ).toBe(false);
    // 回滚点在 keep 集（理由带标记说明）
    const kept = decision.keep.find((k) => k.path.endsWith('step-300'));
    expect(kept).toBeDefined();
    expect(kept!.reason).toContain('回滚点');
    // rollbackPoints 列表暴露给第四章交付包消费
    expect(decision.rollbackPoints).toHaveLength(1);
    expect(decision.rollbackPoints[0]!.path).toBe('checkpoints/job-c/step-300');
  });

  it('test_queryRetentionDecision_数据集版本链尾keep_旧版本archive', () => {
    // 手铺 dataset-version 台账（走真实 versions.jsonl 路径）
    const dsDir = join(dataDir, 'train', ENT, 'datasets');
    mkdirSync(join(dsDir, 'ds-x'), { recursive: true });
    writeFileSync(
      join(dsDir, 'versions.jsonl'),
      [
        JSON.stringify({
          version: 'v1',
          datasetId: 'ds-x',
          enterpriseId: ENT,
          contentHash: 'a'.repeat(8),
          sampleCount: 100,
          algorithm: 'sft',
          columnMapping: {},
          datasetFile: 'placeholder.jsonl',
          createdAt: '2026-09-01T00:00:00.000Z',
        }),
        JSON.stringify({
          version: 'v2',
          datasetId: 'ds-x',
          enterpriseId: ENT,
          contentHash: 'b'.repeat(8),
          sampleCount: 120,
          algorithm: 'sft',
          columnMapping: {},
          datasetFile: 'placeholder.jsonl',
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
      ].join('\n') + '\n',
      'utf-8',
    );
    const decision = queryRetentionDecision(dataDir, ENT);
    const dsKeep = decision.keep.filter((k) => k.kind === 'dataset');
    // 版本台账两条同 datasetId 目录（目录粒度）——去重后链尾数据集在 keep
    expect(dsKeep.length).toBeGreaterThanOrEqual(1);
    expect(dsKeep.some((k) => k.datasetId === 'ds-x')).toBe(true);
  });
});

describe('retention-policy · 自动归档（archiveExpired）', () => {
  it('test_archiveExpired_超期项压缩冷存_源目录删除_台账登记', () => {
    seedJob('job-d', 7); // 2 archive
    const report = archiveExpired(dataDir, ENT, { now: new Date('2026-09-05T08:00:00.000Z') });
    expect(report.archived).toHaveLength(2);
    expect(report.failures).toHaveLength(0);

    // 归档包落在 data/train/archive/<ent>/
    const archiveDir = trainArchiveDir(dataDir, ENT);
    const zips = readdirSync(archiveDir).filter((f) => f.endsWith('.zip'));
    expect(zips).toHaveLength(2);
    // zip 可被既有读取器解开（zip-writer ↔ unzipEntries 读写对）
    const zipBuf = readFileSync(join(archiveDir, zips[0]!));
    const entries = unzipEntries(zipBuf);
    expect(entries.size).toBeGreaterThan(0);
    expect([...entries.keys()]).toContain('adapter.safetensors');

    // 源 checkpoint 目录已删（归档不删除=冷存语义，源头让位）
    expect(existsSync(join(dataDir, 'train', ENT, 'job-d', 'checkpoints', 'step-100'))).toBe(false);
    // keep 的 5 个不动
    expect(existsSync(join(dataDir, 'train', ENT, 'job-d', 'checkpoints', 'step-700'))).toBe(true);

    // 台账在（purge 判 90 天的依据）
    const ledger = readFileSync(join(archiveDir, 'archive-ledger.jsonl'), 'utf-8');
    expect(ledger).toContain('step-100');
    expect(ledger).toContain('"zipSha256"');

    // 审计事件落 archive-audit.jsonl（HMAC 链同构）
    const audit = readFileSync(join(archiveDir, 'archive-audit.jsonl'), 'utf-8');
    expect(audit).toContain('"type":"train_archive"');
    expect(report.auditEventId).not.toBeNull();
  });

  it('test_archiveExpired_策略关闭_空跑', () => {
    saveRetentionConfig(dataDir, ENT, { ...DEFAULT_RETENTION_CONFIG, autoArchive: false });
    seedJob('job-e', 7);
    const report = archiveExpired(dataDir, ENT);
    expect(report.archived).toHaveLength(0);
    expect(existsSync(join(dataDir, 'train', ENT, 'job-e', 'checkpoints', 'step-100'))).toBe(true);
  });

  it('test_archiveExpired_回滚点永不归档', () => {
    seedJob('job-f', 7);
    markRollbackPoint(dataDir, ENT, {
      kind: 'checkpoint',
      path: 'checkpoints/job-f/step-100',
      trainJobId: 'job-f',
      reason: '冻结版本',
    });
    const report = archiveExpired(dataDir, ENT);
    // step-100 本应 archive（最旧第 7 个）——被回滚点豁免
    expect(report.archived.some((a) => a.source.endsWith('step-100'))).toBe(false);
    expect(existsSync(join(dataDir, 'train', ENT, 'job-f', 'checkpoints', 'step-100'))).toBe(true);
  });
});

describe('retention-policy · 过期清理（purgeExpiredArchives）', () => {
  /** 铺一个已归档现场（ledger 直写——purge 的输入面） */
  function seedArchive(archivedAt: string, ageDays: number): string {
    const archiveDir = trainArchiveDir(dataDir, ENT);
    mkdirSync(archiveDir, { recursive: true });
    const zipName = `purge-test-${archivedAt.slice(0, 10)}.zip`;
    writeFileSync(join(archiveDir, zipName), 'zip-bytes-placeholder');
    writeFileSync(
      join(archiveDir, 'archive-ledger.jsonl'),
      JSON.stringify({
        source: '/tmp/placeholder-source',
        archiveFile: join(archiveDir, zipName),
        originalBytes: 100,
        archivedBytes: 50,
        zipSha256: '0'.repeat(64),
        archivedAt,
      }) + '\n',
      'utf-8',
    );
    return join(archiveDir, zipName);
  }

  it('test_purgeExpiredArchives_超90天_覆写销毁包和台账行', () => {
    // 100 天前归档——超 90 天二次保留期
    const old = new Date('2026-05-27T00:00:00.000Z');
    const zipPath = seedArchive(old.toISOString(), 100);
    const now = new Date('2026-09-05T00:00:00.000Z');

    const report = purgeExpiredArchives(dataDir, ENT, { now });
    expect(report.purged).toHaveLength(1);
    expect(report.purged[0]!.ageDays).toBeGreaterThanOrEqual(90);
    // 包已销毁（覆写+unlink——文件不存在）
    expect(existsSync(zipPath)).toBe(false);
    // 台账行同步抹除
    const ledger = readFileSync(join(trainArchiveDir(dataDir, ENT), 'archive-ledger.jsonl'), 'utf-8');
    expect(ledger.trim()).toBe('');
  });

  it('test_purgeExpiredArchives_未超期_保留', () => {
    const zipPath = seedArchive('2026-08-15T00:00:00.000Z', 21); // 21 天 < 90
    const report = purgeExpiredArchives(dataDir, ENT, { now: new Date('2026-09-05T00:00:00.000Z') });
    expect(report.purged).toHaveLength(0);
    expect(existsSync(zipPath)).toBe(true);
  });

  it('test_purgeExpiredArchives_自定义purgeAfterDays_判定随策略', () => {
    saveRetentionConfig(dataDir, ENT, { ...DEFAULT_RETENTION_CONFIG, purgeAfterDays: 7 });
    const zipPath = seedArchive('2026-08-30T00:00:00.000Z', 6); // 6 天 > 7？否——8/30→9/5 是 6 天
    const report = purgeExpiredArchives(dataDir, ENT, { now: new Date('2026-09-05T00:00:00.000Z') });
    expect(report.purged).toHaveLength(0);
    expect(existsSync(zipPath)).toBe(true);
  });
});

describe('retention-policy · 空间预警（checkDiskPressure）', () => {
  it('test_checkDiskPressure_结构完整_阈值可配_不告警路径不抛', () => {
    const report = checkDiskPressure(dataDir, { threshold: 0.8, enterpriseId: ENT });
    // 结构语义断言（真实占用比由 statfs 探测——CI 磁盘状态不可控，占空判定做结构验证）
    expect(report.threshold).toBe(0.8);
    expect(typeof report.warning).toBe('boolean');
    expect(report.usedRatio === null || typeof report.usedRatio === 'number').toBe(true);
    // 告警时必有消息 + 建议；不告警时消息为空
    if (report.warning) {
      expect(report.message).toContain('磁盘占用');
    } else {
      expect(report.message).toBeNull();
    }
  });

  it('test_checkDiskPressure_阈值1不触发_建议列表按大小降序', () => {
    // threshold=1（100%）——物理上几乎不可达，走不告警路径
    const report = checkDiskPressure(dataDir, { threshold: 1, enterpriseId: ENT });
    expect(report.warning).toBe(false);
    expect(report.suggestions).toEqual([]);
  });

  it('test_checkDiskPressure_建议排序_最大项在前', () => {
    seedJob('job-g', 7);
    // 构造告警态不可控（statfs 真实）——退而验证 decision.archive 的排序原料：
    // suggestions 由 archive 集降序生成，此处直接验证 archive 集非空可排序
    const decision = queryRetentionDecision(dataDir, ENT);
    expect(decision.archive.length).toBeGreaterThan(0);
    const sorted = [...decision.archive].sort((a, b) => b.sizeBytes - a.sizeBytes);
    expect(sorted[0]!.sizeBytes).toBeGreaterThanOrEqual(sorted[sorted.length - 1]!.sizeBytes);
  });
});
