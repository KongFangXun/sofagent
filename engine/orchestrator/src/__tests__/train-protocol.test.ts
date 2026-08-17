// train-protocol.test.ts · v1.3.6 交付⑥ 测试
//
// 验收标准逐条覆盖：
// - job.json schema 定义（zod），校验失败拒绝 spawn（结构化错误）
// - stdout JSON 流解析（progress/checkpoint/done/failed），坏行不崩溃
// - SIGINT → 优雅退出（退出码 0）；30s 超时升级 SIGKILL

import { describe, it, expect, vi } from 'vitest';
import {
  validateTrainJob,
  buildTrainSpawnArgs,
  parseTrainEvent,
  parseTrainEventStream,
  createSignalController,
} from '../train/train-protocol';

// ────────────────────────────────────────────────────────────
// 约定①：job.json schema
// ────────────────────────────────────────────────────────────

const VALID_JOB = {
  schemaVersion: 'v1',
  jobId: 'job-001',
  dataPath: '/data/train.jsonl',
  baseModel: 'qwen3-8b',
  algorithm: 'sft',
  hyperparams: { lr: 0.00002, epochs: 3 },
  checkpointPath: '/ckpt/job-001',
  outputDir: '/out/job-001',
};

describe('约定① job.json schema', () => {
  it('合法 job.json 校验通过', () => {
    const result = validateTrainJob(VALID_JOB);
    expect(result.valid).toBe(true);
    expect(result.job?.jobId).toBe('job-001');
    expect(result.job?.hyperparams).toEqual({ lr: 0.00002, epochs: 3 });
  });

  it('带预算字段的 job.json 校验通过（交付⑦同源）', () => {
    const result = validateTrainJob({
      ...VALID_JOB,
      budget: { maxMinutes: 60, maxSteps: 1000, maxCost: 10 },
    });
    expect(result.valid).toBe(true);
    expect(result.job?.budget?.maxCost).toBe(10);
  });

  it('带 resumeFrom 断点的 job.json 校验通过（约定③续跑）', () => {
    const result = validateTrainJob({
      ...VALID_JOB,
      resumeFrom: { checkpointPath: '/ckpt/job-001/step-500', step: 500 },
    });
    expect(result.valid).toBe(true);
    expect(result.job?.resumeFrom?.step).toBe(500);
  });

  it('缺必填字段 → 校验失败 + 结构化 issues（拒绝 spawn）', () => {
    const result = validateTrainJob({ schemaVersion: 'v1', jobId: 'job-001' });
    expect(result.valid).toBe(false);
    expect(result.issues!.length).toBeGreaterThan(0);
    expect(result.issues!.some((i) => i.includes('dataPath'))).toBe(true);
  });

  it('未知字段 → 校验失败（strict 模式——防散参数漂移）', () => {
    const result = validateTrainJob({ ...VALID_JOB, stray: 'unexpected' });
    expect(result.valid).toBe(false);
  });

  it('非法 algorithm 枚举 → 校验失败', () => {
    const result = validateTrainJob({ ...VALID_JOB, algorithm: 'rlhf-magic' });
    expect(result.valid).toBe(false);
  });

  it('spawn 参数收敛为 --config <job.json>（Node 不传散参数）', () => {
    expect(buildTrainSpawnArgs('/tmp/job.json')).toEqual(['train.py', '--config', '/tmp/job.json']);
  });
});

// ────────────────────────────────────────────────────────────
// 约定②：stdout 事件流解析
// ────────────────────────────────────────────────────────────

describe('约定② stdout JSON 事件流', () => {
  it('progress 事件解析（step/loss/reward）', () => {
    const r = parseTrainEvent('{"type":"progress","step":10,"loss":0.5,"reward":1.2}');
    expect(r.event).toEqual({ type: 'progress', step: 10, loss: 0.5, reward: 1.2 });
  });

  it('checkpoint 事件解析', () => {
    const r = parseTrainEvent('{"type":"checkpoint","path":"/ckpt/step-100","step":100}');
    expect(r.event).toEqual({ type: 'checkpoint', path: '/ckpt/step-100', step: 100 });
  });

  it('done / failed 事件解析', () => {
    expect(parseTrainEvent('{"type":"done"}').event).toEqual({ type: 'done' });
    expect(parseTrainEvent('{"type":"failed","reason":"OOM"}').event).toEqual({
      type: 'failed',
      reason: 'OOM',
    });
  });

  it('failed 缺 reason → 错误（reason 必填）', () => {
    const r = parseTrainEvent('{"type":"failed"}');
    expect(r.event).toBeUndefined();
    expect(r.error).toContain('reason');
  });

  it('坏行不崩溃——JSON 解析失败返回 error + 原始行', () => {
    const r = parseTrainEvent('WARNING: torch deprecation ...');
    expect(r.event).toBeUndefined();
    expect(r.error).toBe('JSON 解析失败');
    expect(r.rawLine).toBe('WARNING: torch deprecation ...');
  });

  it('未知事件类型 → error 不崩溃', () => {
    const r = parseTrainEvent('{"type":"weird"}');
    expect(r.event).toBeUndefined();
    expect(r.error).toContain('weird');
  });

  it('空行静默跳过（不计错误）', () => {
    const r = parseTrainEvent('   ');
    expect(r.event).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  it('流式解析：好行收集 + 坏行隔离续解析（错误容忍）', () => {
    const lines = [
      '{"type":"progress","step":1}',
      'some library warn output',
      '{"type":"checkpoint","path":"/ckpt/1","step":1}',
      '{"type":"broken"',
      '{"type":"done"}',
    ];
    const { events, errors } = parseTrainEventStream(lines);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('progress');
    expect(events[2].type).toBe('done');
    expect(errors).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────
// 约定③：信号控制（SIGINT 优雅退出 / 超时升级 SIGKILL）
// ────────────────────────────────────────────────────────────

describe('约定③ 信号控制', () => {
  it('SIGINT 后进程优雅退出 → sigint 动作（不升级 SIGKILL）', async () => {
    const kill = vi.fn();
    // 第 1 次存活探测 true（发 SIGINT 前），之后优雅退出 false
    let aliveChecks = 0;
    const isAlive = () => {
      aliveChecks++;
      return aliveChecks <= 1;
    };
    const controller = createSignalController({ kill, isAlive, sigintTimeoutMs: 5000 });

    const action = await controller.gracefulStop(12345);
    expect(action).toEqual({ action: 'sigint' });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(12345, 'SIGINT');
  });

  it('SIGINT 超时未退出 → 升级 SIGKILL（进程卡死兜底）', async () => {
    const kill = vi.fn();
    const isAlive = () => true; // 一直存活 = 卡死
    const controller = createSignalController({ kill, isAlive, sigintTimeoutMs: 500 });

    const action = await controller.gracefulStop(12345);
    expect(action.action).toBe('sigkill');
    expect((action as { reason: string }).reason).toContain('SIGINT');
    expect(kill).toHaveBeenCalledTimes(2); // SIGINT + SIGKILL
    expect(kill).toHaveBeenNthCalledWith(1, 12345, 'SIGINT');
    expect(kill).toHaveBeenNthCalledWith(2, 12345, 'SIGKILL');
  });

  it('进程已退出 → noop（无需信号）', async () => {
    const kill = vi.fn();
    const controller = createSignalController({ kill, isAlive: () => false });
    const action = await controller.gracefulStop(12345);
    expect(action).toEqual({ action: 'noop' });
    expect(kill).not.toHaveBeenCalled();
  });
});
