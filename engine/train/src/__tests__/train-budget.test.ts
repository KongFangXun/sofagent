// train-budget.test.ts · v1.3.6 交付⑦ 测试
//
// 验收标准逐条覆盖：
// - job.json 带预算字段，超预算自动暂停（三维度任一超即超）
// - 超预算记 train_budget_exceeded 审计 + 人工可续跑/终止（人审语义）
// - 完成时报告实际消耗（耗时/步数/成本——成本透明）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkBudget,
  createTrainBudgetMonitor,
  buildBudgetReport,
  loadTrainJobs,
  upsertTrainJob,
  findTrainJob,
} from '../train/train-budget';

describe('checkBudget 三维度判定', () => {
  it('未设预算 → 不限制（within=true）', () => {
    const r = checkBudget(undefined, { elapsedMinutes: 999, steps: 999, cost: 999 });
    expect(r.within).toBe(true);
  });

  it('时间超限 → maxMinutes 维度告警', () => {
    const r = checkBudget({ maxMinutes: 10 }, { elapsedMinutes: 11, steps: 0, cost: 0 });
    expect(r.within).toBe(false);
    if (!r.within) expect(r.violation.dimension).toBe('maxMinutes');
  });

  it('步数超限 → maxSteps 维度告警', () => {
    const r = checkBudget({ maxSteps: 100 }, { elapsedMinutes: 0, steps: 101, cost: 0 });
    expect(r.within).toBe(false);
    if (!r.within) expect(r.violation.dimension).toBe('maxSteps');
  });

  it('成本超限 → maxCost 维度告警', () => {
    const r = checkBudget({ maxCost: 5 }, { elapsedMinutes: 0, steps: 0, cost: 5.5 });
    expect(r.within).toBe(false);
    if (!r.within) expect(r.violation.dimension).toBe('maxCost');
  });

  it('只设部分维度 → 未设维度不限制', () => {
    const r = checkBudget({ maxSteps: 100 }, { elapsedMinutes: 500, steps: 50, cost: 99 });
    expect(r.within).toBe(true); // 时间/成本未设限
  });
});

describe('TrainBudgetMonitor 超预算暂停 + 人审', () => {
  it('累计进度超步数 → 自动暂停（挂起等人审）', () => {
    const monitor = createTrainBudgetMonitor({
      jobId: 'job-001',
      budget: { maxSteps: 100 },
    });

    expect(monitor.feedProgress({ step: 50 }).within).toBe(true);
    const over = monitor.feedProgress({ step: 150 });
    expect(over.within).toBe(false);
    expect(monitor.isPaused()).toBe(true);
    expect(monitor.pause()?.violation.dimension).toBe('maxSteps');
    expect(monitor.pause()?.jobId).toBe('job-001');
  });

  it('时间流逝超限 → 暂停', () => {
    const monitor = createTrainBudgetMonitor({ jobId: 'job-002', budget: { maxMinutes: 30 } });
    expect(monitor.feedElapsed(31).within).toBe(false);
    expect(monitor.isPaused()).toBe(true);
  });

  it('成本累计超限 → 暂停（costPerStep 累计）', () => {
    const monitor = createTrainBudgetMonitor({
      jobId: 'job-003',
      budget: { maxCost: 1 },
      costPerStep: 0.5,
    });
    monitor.feedProgress({ step: 1 }); // cost=0.5
    const over = monitor.feedProgress({ step: 2 }); // cost=1.0 → 不超（不严格大于）
    expect(over.within).toBe(true);
    const over2 = monitor.feedProgress({ step: 3 }); // cost=1.5 → 超
    expect(over2.within).toBe(false);
  });

  it('人审 resume → 清除暂停态（续跑从 checkpoint 恢复）', () => {
    const monitor = createTrainBudgetMonitor({ jobId: 'job-004', budget: { maxSteps: 10 } });
    monitor.feedProgress({ step: 20 });
    expect(monitor.isPaused()).toBe(true);

    expect(monitor.resolvePause('resume')).toBe(true);
    expect(monitor.isPaused()).toBe(false);
  });

  it('人审 terminate → 终止态（不再接收事件）', () => {
    const monitor = createTrainBudgetMonitor({ jobId: 'job-005', budget: { maxSteps: 10 } });
    monitor.feedProgress({ step: 20 });
    expect(monitor.resolvePause('terminate')).toBe(true);

    // 终止后事件被忽略
    expect(monitor.feedProgress({ step: 100 }).within).toBe(true);
    expect(monitor.usage().steps).toBe(20); // 不更新
  });

  it('非暂停态 resolve → false（无效操作）', () => {
    const monitor = createTrainBudgetMonitor({ jobId: 'job-006', budget: { maxSteps: 100 } });
    expect(monitor.resolvePause('resume')).toBe(false);
  });
});

describe('预算报告（成本透明）', () => {
  it('完成时报告实际消耗（耗时/步数/成本）', () => {
    const report = buildBudgetReport({
      jobId: 'job-007',
      budget: { maxMinutes: 60, maxSteps: 1000 },
      usage: { elapsedMinutes: 45, steps: 800, cost: 3.2 },
    });
    expect(report.jobId).toBe('job-007');
    expect(report.usage).toEqual({ elapsedMinutes: 45, steps: 800, cost: 3.2 });
    expect(report.exceeded).toBe(false);
    expect(report.exceededDimensions).toEqual([]);
  });

  it('超预算报告标注超限维度', () => {
    const report = buildBudgetReport({
      jobId: 'job-008',
      budget: { maxCost: 1 },
      usage: { elapsedMinutes: 10, steps: 100, cost: 2.5 },
      exceeded: true,
    });
    expect(report.exceeded).toBe(true);
    expect(report.exceededDimensions).toEqual(['maxCost']);
  });
});

describe('训练任务状态持久化（train/jobs.json）', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'train-budget-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('upsert + find 跨进程可查（MCP tool 消费面）', () => {
    upsertTrainJob(dataDir, {
      jobId: 'job-100',
      status: 'running',
      budget: { maxSteps: 500 },
      usage: { elapsedMinutes: 10, steps: 200, cost: 1 },
      updatedAt: new Date().toISOString(),
    });

    const found = findTrainJob(dataDir, 'job-100');
    expect(found?.status).toBe('running');
    expect(found?.budget?.maxSteps).toBe(500);
    expect(loadTrainJobs(dataDir)).toHaveLength(1);
  });

  it('upsert 同 jobId → 更新而非重复', () => {
    const base = {
      jobId: 'job-101',
      status: 'running' as const,
      usage: { elapsedMinutes: 0, steps: 0, cost: 0 },
      updatedAt: new Date().toISOString(),
    };
    upsertTrainJob(dataDir, base);
    upsertTrainJob(dataDir, { ...base, status: 'paused' });
    expect(loadTrainJobs(dataDir)).toHaveLength(1);
    expect(findTrainJob(dataDir, 'job-101')?.status).toBe('paused');
  });

  it('坏数据降级空表（不崩溃）', () => {
    mkdirSync(join(dataDir, 'train'), { recursive: true });
    writeFileSync(join(dataDir, 'train', 'jobs.json'), '{broken');
    expect(loadTrainJobs(dataDir)).toEqual([]);
  });
});
