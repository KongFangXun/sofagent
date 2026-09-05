// ============================================================
// train-archive.test.ts · v1.4.5 第五章 测试（daemon 侧）
//
// 覆盖：
// - 配置解析：watch.yml train-archive: 段（缺失默认 @weekly 启用 /
//   显式关闭 / 坏 YAML fail-open）
// - cron 薄适配：loadTrainArchiveCronConfig（enabled + schedule 两键）
// - 归档轮次：runTrainArchiveTask 三步（归档 + 清理 + 空间预警）
//   —— dataDir 直铺 data/train/<ent>/ 现场（磁盘契约——不依赖
//   orchestrator 运行时的深层导入链，走 npm workspace 真实包）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadTrainArchiveConfig,
  DEFAULT_TRAIN_ARCHIVE_CONFIG,
  runTrainArchiveTask,
} from '../tasks/train-archive';
import { loadTrainArchiveCronConfig } from '../cron';

let tmpProjectDir: string;
let tmpDataDir: string;
let savedData: string | undefined;

beforeEach(() => {
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ta-cfg-'));
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ta-data-'));
  savedData = process.env.SOFAGENT_DATA;
  process.env.SOFAGENT_DATA = tmpDataDir;
});

afterEach(() => {
  try {
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  } catch {
    /* best-effort 清理 */
  }
  if (savedData === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = savedData;
});

const writeWatch = (content: string) => {
  fs.mkdirSync(path.join(tmpProjectDir, '.sofagent'), { recursive: true });
  fs.writeFileSync(path.join(tmpProjectDir, '.sofagent', 'watch.yml'), content, 'utf-8');
};

describe('loadTrainArchiveConfig（watch.yml train-archive: 段）', () => {
  it('test_loadTrainArchiveConfig_段缺失_返回默认weekly启用', () => {
    const config = loadTrainArchiveConfig(tmpProjectDir);
    expect(config).toEqual(DEFAULT_TRAIN_ARCHIVE_CONFIG);
    expect(config.enabled).toBe(true);
    expect(config.schedule).toBe('@weekly');
    expect(config.purge).toBe(true);
    expect(config.diskCheck).toBe(true);
  });

  it('test_loadTrainArchiveConfig_显式enabledFalse_返回禁用', () => {
    writeWatch('train-archive:\n  enabled: false\n');
    const config = loadTrainArchiveConfig(tmpProjectDir);
    expect(config.enabled).toBe(false);
  });

  it('test_loadTrainArchiveConfig_覆盖schedule与子开关', () => {
    writeWatch([
      'train-archive:',
      '  enabled: true',
      '  schedule: "@monthly"',
      '  purge: false',
      '  diskCheck: false',
    ].join('\n'));
    const config = loadTrainArchiveConfig(tmpProjectDir);
    expect(config.schedule).toBe('@monthly');
    expect(config.purge).toBe(false);
    expect(config.diskCheck).toBe(false);
  });

  it('test_loadTrainArchiveConfig_坏YAML_不抛错返回默认', () => {
    writeWatch('train-archive: [unclosed');
    expect(() => loadTrainArchiveConfig(tmpProjectDir)).not.toThrow();
    expect(loadTrainArchiveConfig(tmpProjectDir).enabled).toBe(true);
  });
});

describe('loadTrainArchiveCronConfig（cron 薄适配）', () => {
  it('test_loadTrainArchiveCronConfig_段缺失_默认weekly', () => {
    const cfg = loadTrainArchiveCronConfig(tmpProjectDir);
    expect(cfg).toEqual({ enabled: true, schedule: '@weekly' });
  });

  it('test_loadTrainArchiveCronConfig_显式daily', () => {
    writeWatch('train-archive:\n  schedule: "@daily"\n');
    const cfg = loadTrainArchiveCronConfig(tmpProjectDir);
    expect(cfg.schedule).toBe('@daily');
    expect(cfg.enabled).toBe(true);
  });

  it('test_loadTrainArchiveCronConfig_禁用', () => {
    writeWatch('train-archive:\n  enabled: false\n');
    expect(loadTrainArchiveCronConfig(tmpProjectDir).enabled).toBe(false);
  });
});

describe('runTrainArchiveTask（归档轮次）', () => {
  /** 铺一个带 7 个 checkpoint 的企业 job 现场（state.json 磁盘契约直写） */
  function seedEnterpriseJob(enterpriseId: string, jobId: string, checkpoints: number): void {
    const jobDir = path.join(tmpDataDir, 'train', enterpriseId, jobId);
    fs.mkdirSync(path.join(jobDir, 'checkpoints'), { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, 'state.json'),
      JSON.stringify({
        jobId,
        enterpriseId,
        status: 'completed',
        job: {
          schemaVersion: 'v1',
          jobId,
          dataPath: '/tmp/placeholder.jsonl',
          baseModel: 'Qwen3-8B',
          algorithm: 'sft',
          hyperparams: {},
          checkpointPath: path.join(jobDir, 'checkpoints'),
          outputDir: path.join(jobDir, 'output'),
        },
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        usage: { elapsedMinutes: 0, steps: 0, cost: 0 },
      }),
    );
    for (let i = 1; i <= checkpoints; i++) {
      const ckpt = path.join(jobDir, 'checkpoints', `step-${i * 100}`);
      fs.mkdirSync(ckpt, { recursive: true });
      fs.writeFileSync(path.join(ckpt, 'adapter.safetensors'), `w-${i}`);
    }
  }

  it('test_runTrainArchiveTask_超期checkpoint归档_清理与预警结构齐', async () => {
    seedEnterpriseJob('ent-ta', 'job-ta', 7); // 5 keep + 2 archive

    const result = await runTrainArchiveTask(tmpDataDir, {
      now: new Date('2026-09-05T08:00:00.000Z'),
    });

    // 企业分区被扫到
    expect(result.enterprises).toContain('ent-ta');
    // 归档摘要：2 项成功 0 失败
    const summary = result.archives.find((a) => a.enterpriseId === 'ent-ta');
    expect(summary).toBeDefined();
    expect(summary!.archived).toBe(2);
    expect(summary!.failures).toBe(0);
    // 源目录已冷存让位
    expect(
      fs.existsSync(path.join(tmpDataDir, 'train', 'ent-ta', 'job-ta', 'checkpoints', 'step-100')),
    ).toBe(false);
    // 空间预警结构在场（告警与否取决于真实磁盘——结构语义断言）
    expect(typeof result.diskWarning.warning).toBe('boolean');
    // 清理摘要结构在场（无 90 天过期归档 → 0 purged）
    const purge = result.purges.find((p) => p.enterpriseId === 'ent-ta');
    expect(purge).toBeDefined();
    expect(purge!.purged).toBe(0);
  });

  it('test_runTrainArchiveTask_配置禁用_空跑', async () => {
    seedEnterpriseJob('ent-off', 'job-off', 7);
    const result = await runTrainArchiveTask(tmpDataDir, {
      config: { enabled: false, schedule: '@weekly', purge: true, diskCheck: true },
    });
    expect(result.enterprises).toEqual([]);
    expect(result.archives).toEqual([]);
    expect(
      fs.existsSync(path.join(tmpDataDir, 'train', 'ent-off', 'job-off', 'checkpoints', 'step-100')),
    ).toBe(true);
  });

  it('test_runTrainArchiveTask_无data目录_优雅空跑', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ta-empty-'));
    try {
      const result = await runTrainArchiveTask(empty);
      expect(result.enterprises).toEqual([]);
      expect(result.archives).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
