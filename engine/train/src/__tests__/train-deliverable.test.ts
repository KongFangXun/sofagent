// train-deliverable.test.ts · v1.4.5 第四章 测试
//
// 验收标准逐条覆盖（devlog 第四章）：
// - 交付包五件内容齐：train-config / data-pipeline / eval-baseline /
//   ops-manual / weights-list 五 section 各 ≥1 件 + manifest.json
// - manifest + HMAC 签名：body 稳定签名可复算；篡改 manifest → manifestTampered
// - verify 校验双项：完整性（逐条目 sha256 + unregistered 扫描）+
//   环境兼容性（Node 版本 / 数据盘可写 / zip 可读）
// - 运维手册含续训/回滚/排查/联系方式四段
// - 缺件语义：无训练现场的企业 → 拒绝生成；血缘 job 缺失 → 占位说明非伪造
// - 第五章衔接：权重清单含 retention 标记的回滚点
//
// HMAC 密钥纪律：SOFAGENT_KEY_PATH 指向临时密钥。
// A2 纪律：测试值全中性占位。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHmac } from 'crypto';
import { stableStringify, getEnvFingerprint } from '@sofagent/core';
import {
  generateTrainDeliverable,
  verifyTrainDeliverable,
  deliverablesDir,
  renderOpsManual,
  TrainDeliverableError,
} from '../train/train-deliverable';
import { markRollbackPoint } from '../train/retention-policy';
import { buildZip, type ZipEntryInput } from '../train/zip-writer';
import { unzipEntries } from '../train/data-ingest';

/** 重打包快捷方式（篡改用例——替换条目内容后重新打 zip） */
function repack(zipPath: string, mutate: (files: ZipEntryInput[]) => ZipEntryInput[]): void {
  const entries = unzipEntries(readFileSync(zipPath));
  const files: ZipEntryInput[] = [...entries.entries()].map(([name, data]) => ({ name, data }));
  writeFileSync(zipPath, buildZip(mutate(files)));
}

// ── 测试基建 ──
const ENT = 'ent-dlv';

let dataDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-deliverable-'));
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'test-hmac-key');
  writeFileSync(process.env.SOFAGENT_KEY_PATH, 'test-deliverable-key-0123456789');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** 造一个已完成 job 现场（state.json + job.json + checkpoint） */
function seedCompletedJob(jobId: string): void {
  const jobDir = join(dataDir, 'train', ENT, jobId);
  mkdirSync(join(jobDir, 'checkpoints', 'step-100'), { recursive: true });
  const job = {
    schemaVersion: 'v1',
    jobId,
    dataPath: '/tmp/placeholder-data.jsonl',
    baseModel: 'Qwen3-8B',
    algorithm: 'sft',
    hyperparams: { lr: 0.0002, epochs: 3 },
    checkpointPath: join(jobDir, 'checkpoints'),
    outputDir: join(jobDir, 'output'),
  };
  writeFileSync(join(jobDir, 'job.json'), JSON.stringify(job, null, 2), 'utf-8');
  writeFileSync(
    join(jobDir, 'state.json'),
    JSON.stringify({
      jobId,
      enterpriseId: ENT,
      status: 'completed',
      job,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T06:00:00.000Z',
      finishedAt: '2026-09-01T06:00:00.000Z',
      usage: { elapsedMinutes: 60, steps: 100, cost: 1.5 },
    }),
    'utf-8',
  );
  writeFileSync(join(jobDir, 'checkpoints', 'step-100', 'adapter.safetensors'), 'ckpt-bytes');
}

/** 造 eval 记录（③ 基线冻结的数据源） */
function seedEvalLog(benchmarkId: string, score: number, at: string): void {
  const bmDir = join(dataDir, 'benchmarks', benchmarkId);
  mkdirSync(bmDir, { recursive: true });
  writeFileSync(
    join(bmDir, 'evaluation-log.jsonl'),
    JSON.stringify({ caseId: 'case-1', score, evaluatedAt: at }) + '\n',
    'utf-8',
  );
}

describe('train-deliverable · 生成', () => {
  it('test_generate_五件内容齐_manifest签名在包内', () => {
    seedCompletedJob('job-ok');
    seedEvalLog('bench-dlv', 87.5, '2026-09-01T06:30:00.000Z');

    const result = generateTrainDeliverable(dataDir, ENT, {
      createdAt: '2026-09-05T10:00:00.000Z',
      contact: 'FDE 值班群 placeholder',
    });

    // 包路径与命名规范
    expect(result.zipPath).toContain('train-deliverable-ent-dlv-20260905.zip');
    expect(existsSync(result.zipPath)).toBe(true);

    // 五件内容各 ≥1
    expect(result.sections['train-config']).toBeGreaterThanOrEqual(1);
    expect(result.sections['data-pipeline']).toBeGreaterThanOrEqual(1);
    expect(result.sections['eval-baseline']).toBeGreaterThanOrEqual(1);
    expect(result.sections['ops-manual']).toBeGreaterThanOrEqual(1);
    expect(result.sections['weights-list']).toBeGreaterThanOrEqual(1);

    // manifest 签名（32 hex）+ manifest 双落盘（包内 + 外置）
    expect(result.manifest.manifestHmac).toMatch(/^[0-9a-f]{32}$/);
    expect(result.manifest.hmacAlgo).toBe('stable');
    expect(
      existsSync(join(deliverablesDir(dataDir, ENT), '20260905-manifest.json')),
    ).toBe(true);

    // zip 内含五 section 目录 + manifest.json
    const entries = unzipEntries(readFileSync(result.zipPath));
    const names = [...entries.keys()];
    expect(names).toContain('manifest.json');
    expect(names.filter((n) => n.startsWith('train-config/'))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith('data-pipeline/'))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith('eval-baseline/'))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith('ops-manual/'))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith('weights-list/'))).toHaveLength(1);

    // ③ 基线冻结内容真实（eval 记录在场时不打占位说明）
    const baseline = JSON.parse(entries.get('eval-baseline/baseline.json')!.toString('utf-8'));
    expect(baseline.benchmarkId).toBe('bench-dlv');
    expect(baseline.averageScore).toBe(87.5);
  });

  it('test_generate_血缘job快照进配置模板', () => {
    seedCompletedJob('job-spec');
    const result = generateTrainDeliverable(dataDir, ENT, {
      trainJobId: 'job-spec',
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    expect(result.manifest.trainJobId).toBe('job-spec');
    const entries = unzipEntries(readFileSync(result.zipPath));
    const jobJson = JSON.parse(entries.get('train-config/job.json')!.toString('utf-8'));
    expect(jobJson.jobId).toBe('job-spec');
    expect(jobJson.baseModel).toBe('Qwen3-8B');
  });

  it('test_generate_HMAC可独立复算（同构造复验）', () => {
    seedCompletedJob('job-sig');
    const result = generateTrainDeliverable(dataDir, ENT, {
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    // 与 artifact-signing 同构造：stableStringify(body) + '|' + envFingerprint
    const body = {
      schemaVersion: result.manifest.schemaVersion,
      enterpriseId: result.manifest.enterpriseId,
      createdAt: result.manifest.createdAt,
      files: result.manifest.files,
      trainJobId: result.manifest.trainJobId,
      datasetId: result.manifest.datasetId,
      generatorVersion: result.manifest.generatorVersion,
    };
    const key = readFileSync(process.env.SOFAGENT_KEY_PATH as string, 'utf-8');
    const expected = createHmac('sha256', key)
      .update(stableStringify(body) + '|' + getEnvFingerprint(dataDir))
      .digest('hex')
      .slice(0, 32);
    expect(result.manifest.manifestHmac).toBe(expected);
  });

  it('test_generate_运维手册四段齐（续训/回滚/排查/联系方式）', () => {
    seedCompletedJob('job-manual');
    const result = generateTrainDeliverable(dataDir, ENT, {
      createdAt: '2026-09-05T10:00:00.000Z',
      contact: '企业支持热线 400-000-0000（占位）',
    });
    const entries = unzipEntries(readFileSync(result.zipPath));
    const manual = entries.get('ops-manual/MANUAL.md')!.toString('utf-8');
    expect(manual).toContain('续训');
    expect(manual).toContain('回滚');
    expect(manual).toContain('故障排查');
    expect(manual).toContain('联系方式');
    expect(manual).toContain('400-000-0000');
  });

  it('test_generate_权重清单含第五章回滚点', () => {
    seedCompletedJob('job-rb');
    markRollbackPoint(dataDir, ENT, {
      kind: 'checkpoint',
      path: 'checkpoints/job-rb/step-100',
      trainJobId: 'job-rb',
      reason: '验收冻结版本',
    });
    const result = generateTrainDeliverable(dataDir, ENT, {
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const entries = unzipEntries(readFileSync(result.zipPath));
    const weights = JSON.parse(entries.get('weights-list/weights.json')!.toString('utf-8'));
    expect(weights.rollbackPoints).toHaveLength(1);
    expect(weights.rollbackPoints[0].path).toBe('checkpoints/job-rb/step-100');
    expect(weights.rollbackPoints[0].reason).toBe('验收冻结版本');
  });

  it('test_generate_企业分区不存在_拒绝', () => {
    expect(() => generateTrainDeliverable(dataDir, ENT)).toThrow(TrainDeliverableError);
    expect(() => generateTrainDeliverable(dataDir, ENT)).toThrow(/企业分区不存在/);
  });

  it('test_generate_同名包不覆盖_拒绝重生成', () => {
    seedCompletedJob('job-idem');
    const fixed = { createdAt: '2026-09-05T10:00:00.000Z' };
    generateTrainDeliverable(dataDir, ENT, fixed);
    expect(() => generateTrainDeliverable(dataDir, ENT, fixed)).toThrow(/已存在（不覆盖/);
  });

  it('test_generate_无HMAC密钥_拒绝（宁缺毋滥）', () => {
    seedCompletedJob('job-nokey');
    // KEY_PATH 指向必然缺失的文件——getHmacKey 返回 null（密钥纪律：
    // getHmacKey 回落真实 ~/.sofagent-key，开发机在场——测试必须显式切断）
    const realKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = join(dataDir, 'no-such-key-file');
    try {
      expect(() => generateTrainDeliverable(dataDir, ENT)).toThrow(/HMAC 密钥不可用/);
    } finally {
      process.env.SOFAGENT_KEY_PATH = realKeyPath;
    }
  });
});

describe('train-deliverable · 校验（verify）', () => {
  /** 铺「生成完」现场并返回 zip 路径 */
  function generate(zipName?: string): string {
    seedCompletedJob('job-verify');
    seedEvalLog('bench-verify', 82, '2026-09-02T00:00:00.000Z');
    const result = generateTrainDeliverable(dataDir, ENT, {
      createdAt: zipName === undefined ? '2026-09-05T10:00:00.000Z' : zipName,
    });
    return result.zipPath;
  }

  it('test_verify_完整包_双项通过', () => {
    const zipPath = generate();
    const report = verifyTrainDeliverable(zipPath, { dataDir });
    expect(report.integrityOk).toBe(true);
    expect(report.manifestIntegrity).toBe('valid');
    expect(report.files).toHaveLength(5); // 五件内容逐条目（manifest 本身不进核对清单）
    expect(report.files.every((f) => f.status === 'ok')).toBe(true);
    expect(report.unregistered).toEqual([]);
    expect(report.env.nodeOk).toBe(true);
    expect(report.env.dataDirWritable).toBe(true);
    expect(report.env.zipReadable).toBe(true);
    expect(report.env.ok).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.rejectionReason).toBeNull();
  });

  it('test_verify_条目被改_sha256失配', () => {
    const zipPath = generate();
    // 重打包：替换 ops-manual 内容（manifest 仍原签名——条目级篡改场景）
    repack(zipPath, (files) =>
      files.map((f) =>
        f.name === 'ops-manual/MANUAL.md'
          ? { name: f.name, data: Buffer.from(f.data.toString('utf-8') + '\n被篡改追加') }
          : f,
      ),
    );
    const report = verifyTrainDeliverable(zipPath, { dataDir });
    expect(report.integrityOk).toBe(false);
    expect(report.files.find((f) => f.path === 'ops-manual/MANUAL.md')!.status).toBe('mismatch');
    expect(report.ok).toBe(false);
    expect(report.rejectionReason).toContain('条目核对失败');
  });

  it('test_verify_manifest被改_HMAC失配_拒绝', () => {
    const zipPath = generate('2026-09-06T10:00:00.000Z');
    repack(zipPath, (files) =>
      files.map((f) => {
        if (f.name !== 'manifest.json') return f;
        const m = JSON.parse(f.data.toString('utf-8')) as { trainJobId: string | null };
        m.trainJobId = 'job-forged'; // 篡改血缘
        return { name: f.name, data: Buffer.from(JSON.stringify(m, null, 2)) };
      }),
    );
    const report = verifyTrainDeliverable(zipPath, { dataDir });
    expect(report.manifestIntegrity).toBe('manifestTampered');
    expect(report.ok).toBe(false);
    expect(report.rejectionReason).toContain('篡改');
  });

  it('test_verify_包被塞未登记条目_unregistered暴露', () => {
    const zipPath = generate('2026-09-07T10:00:00.000Z');
    repack(zipPath, (files) => [
      ...files,
      { name: 'injected/payload.txt', data: Buffer.from('unregistered content') },
    ]);
    const report = verifyTrainDeliverable(zipPath, { dataDir });
    expect(report.unregistered).toContain('injected/payload.txt');
    expect(report.ok).toBe(false);
  });

  it('test_verify_坏zip_结构化失败不抛', () => {
    const badZip = join(dataDir, 'bad.zip');
    writeFileSync(badZip, 'not a zip at all');
    const report = verifyTrainDeliverable(badZip, { dataDir });
    expect(report.ok).toBe(false);
    expect(report.rejectionReason).toContain('zip 不可读');
  });

  it('test_verify_zip缺失_结构化失败', () => {
    const report = verifyTrainDeliverable(join(dataDir, 'nope.zip'), { dataDir });
    expect(report.ok).toBe(false);
    expect(report.rejectionReason).toContain('zip 不可读');
  });
});

describe('train-deliverable · 运维手册渲染（纯函数）', () => {
  it('test_renderOpsManual_回滚点列表渲染_缺省联系方式占位', () => {
    const manual = renderOpsManual({
      enterpriseId: ENT,
      trainJobId: 'job-manual-render',
      datasetId: 'ds-manual-render',
      productionModel: 'model-placeholder',
      rollbackPoints: ['checkpoint checkpoints/job/step-500（验收冻结）'],
      createdAt: '2026-09-05T00:00:00.000Z',
    });
    expect(manual).toContain('checkpoint checkpoints/job/step-500');
    expect(manual).toContain('model-placeholder');
    // 未传 contact → 占位指引（不静默空段）
    expect(manual).toContain('待填');
  });

  it('test_renderOpsManual_无回滚点_如实声明非空段', () => {
    const manual = renderOpsManual({
      enterpriseId: ENT,
      trainJobId: null,
      datasetId: null,
      productionModel: null,
      rollbackPoints: [],
      createdAt: '2026-09-05T00:00:00.000Z',
    });
    expect(manual).toContain('暂无登记');
  });
});
