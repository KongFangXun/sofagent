// continuous-training.test.ts · v1.4.5 第二章 daemon 侧测试
//
// 覆盖：
// - watch.yml `continuous-training:` 段解析（缺省不启用 / 显式启用 / 坏 YAML 降级）
// - runContinuousTrainingTick：未启用不训练 / 缺参不训练 / 启用全参走编排
// - 观测台账 continuous-runs.jsonl 落盘
//
// 测试纪律：SOFAGENT_DATA 指向 tmp（观测台账不落真实 HOME）；
// orchestrator 经 vi.mock 打桩（零真实训练进程）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Mock @sofagent/orchestrator（tick 装配链——零真实编排）──
const runContinuousTrainingMock = vi.fn(async () => ({
  trigger: 'schedule',
  decided: 'skip',
  reason: '样本 0/50 未达阈值（mock）',
}));
vi.mock('@sofagent/orchestrator', () => ({
  createTrainScheduler: vi.fn(() => ({
    submitTrainJob: vi.fn(() => ({ result: { record: { jobId: 'job-mock' } }, handle: null })),
  })),
  runContinuousTraining: (...args: unknown[]) => runContinuousTrainingMock(...(args as [])),
}));

import {
  loadContinuousTrainingConfig,
  runContinuousTrainingTick,
  continuousRunsLogPath,
  DEFAULT_CONTINUOUS_TRAINING_CONFIG,
} from '../tasks/continuous-training';

// ── 测试基建 ──
let projectDir: string;
let dataDir: string;
let savedData: string | undefined;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'sofagent-continuous-proj-'));
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-continuous-data-'));
  savedData = process.env.SOFAGENT_DATA;
  process.env.SOFAGENT_DATA = dataDir;
  runContinuousTrainingMock.mockClear();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  if (savedData === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = savedData;
});

/** 写 watch.yml（.sofagent/ 下） */
function writeWatch(content: string): void {
  mkdirSync(join(projectDir, '.sofagent'), { recursive: true });
  writeFileSync(join(projectDir, '.sofagent', 'watch.yml'), content, 'utf-8');
}

describe('配置解析（watch.yml continuous-training 段）', () => {
  it('test_loadConfig_段缺失_缺省不启用（算力类显式opt-in）', () => {
    const config = loadContinuousTrainingConfig(projectDir);
    expect(config.enabled).toBe(false);
    expect(config).toEqual(DEFAULT_CONTINUOUS_TRAINING_CONFIG);
  });

  it('test_loadConfig_显式enabledTrue_全参数读出', () => {
    writeWatch([
      'continuous-training:',
      '  enabled: true',
      '  enterpriseId: ent-prod',
      '  baseModel: qwen3-8b',
      '  minNewSamples: 120',
      '  maxIntervalDays: 14',
    ].join('\n'));
    const config = loadContinuousTrainingConfig(projectDir);
    expect(config.enabled).toBe(true);
    expect(config.enterpriseId).toBe('ent-prod');
    expect(config.baseModel).toBe('qwen3-8b');
    expect(config.minNewSamples).toBe(120);
    expect(config.maxIntervalDays).toBe(14);
  });

  it('test_loadConfig_坏YAML_failopen到缺省不启用', () => {
    writeWatch('continuous-training: [broken: yaml: {{{');
    const config = loadContinuousTrainingConfig(projectDir);
    expect(config.enabled).toBe(false);
  });

  it('test_loadConfig_非法阈值回落缺省', () => {
    writeWatch([
      'continuous-training:',
      '  enabled: true',
      '  enterpriseId: ent',
      '  baseModel: m',
      '  minNewSamples: -5',
      '  maxIntervalDays: 0',
    ].join('\n'));
    const config = loadContinuousTrainingConfig(projectDir);
    expect(config.minNewSamples).toBe(50);
    expect(config.maxIntervalDays).toBe(7);
  });
});

describe('runContinuousTrainingTick（daemon 单轮）', () => {
  it('test_tick_未启用_不执行不调编排且台账记因', async () => {
    const result = await runContinuousTrainingTick(projectDir);
    expect(result.executed).toBe(false);
    expect(result.reason).toContain('未启用');
    expect(runContinuousTrainingMock).not.toHaveBeenCalled();
    // 观测台账落盘
    const log = readFileSync(continuousRunsLogPath(dataDir), 'utf-8');
    expect(log).toContain('未启用');
  });

  it('test_tick_启用但缺enterpriseId_不执行并提示必配', async () => {
    writeWatch('continuous-training:\n  enabled: true\n  baseModel: qwen3-8b\n');
    const result = await runContinuousTrainingTick(projectDir);
    expect(result.executed).toBe(false);
    expect(result.reason).toContain('enterpriseId');
    expect(runContinuousTrainingMock).not.toHaveBeenCalled();
  });

  it('test_tick_全参数就绪_调编排且结果进台账', async () => {
    writeWatch([
      'continuous-training:',
      '  enabled: true',
      '  enterpriseId: ent-prod',
      '  baseModel: qwen3-8b',
      '  minNewSamples: 30',
    ].join('\n'));
    const result = await runContinuousTrainingTick(projectDir);
    expect(result.executed).toBe(true);
    expect(runContinuousTrainingMock).toHaveBeenCalledTimes(1);
    // 传给编排的参数：企业/基座/schedule 触发/阈值透传
    const call = runContinuousTrainingMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.enterpriseId).toBe('ent-prod');
    expect(call.baseModel).toBe('qwen3-8b');
    expect(call.trigger).toBe('schedule');
    expect((call.policy as { minNewSamples: number }).minNewSamples).toBe(30);
    // 台账含编排结果
    const log = readFileSync(continuousRunsLogPath(dataDir), 'utf-8');
    expect(log).toContain('"executed":true');
    expect(log).toContain('skip');
  });

  it('test_tick_编排抛错_不crash且错误进台账', async () => {
    writeWatch('continuous-training:\n  enabled: true\n  enterpriseId: ent\n  baseModel: m\n');
    runContinuousTrainingMock.mockRejectedValueOnce(new Error('scheduler down'));
    const result = await runContinuousTrainingTick(projectDir);
    expect(result.executed).toBe(false);
    expect(result.reason).toContain('scheduler down');
    // daemon 纪律：错误不抛出（下一轮照跑）
    const log = readFileSync(continuousRunsLogPath(dataDir), 'utf-8');
    expect(log).toContain('scheduler down');
  });
});
