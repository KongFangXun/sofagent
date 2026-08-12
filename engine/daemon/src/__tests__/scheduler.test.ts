// ============================================================
// scheduler.test.ts · 定时任务调度器测试（v1.2.9 功能②）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { createScheduler, nextCronTime } from '../scheduler';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-sched-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('scheduler', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  describe('create + list + get', () => {
    it('创建 cron 任务后能列出和获取', () => {
      const sched = createScheduler(testDir);
      const task = sched.create({
        name: '每日报表',
        type: 'cron',
        schedule: '0 9 * * *',
        prompt: '生成每日报表',
      });

      expect(task.id).toBeTruthy();
      expect(task.status).toBe('active');
      expect(task.nextRun).toBeTruthy();

      const all = sched.list();
      expect(all.length).toBe(1);
      expect(all[0]!.name).toBe('每日报表');

      const got = sched.get(task.id);
      expect(got).not.toBeNull();
      expect(got!.schedule).toBe('0 9 * * *');
    });

    it('创建 once 任务（一次性）', () => {
      const sched = createScheduler(testDir);
      const future = new Date(Date.now() + 3600_000).toISOString();
      const task = sched.create({
        name: '一次性提醒',
        type: 'once',
        schedule: future,
        prompt: '提醒',
      });

      expect(task.type).toBe('once');
      expect(task.nextRun).toBe(future);
    });
  });

  describe('pause + resume', () => {
    it('暂停后状态变为 paused', () => {
      const sched = createScheduler(testDir);
      const task = sched.create({
        name: 'test',
        type: 'cron',
        schedule: '*/5 * * * *',
        prompt: 'p',
      });

      const paused = sched.pause(task.id);
      expect(paused!.status).toBe('paused');
    });

    it('恢复后状态变为 active 且 nextRun 更新', () => {
      const sched = createScheduler(testDir);
      const task = sched.create({
        name: 'test',
        type: 'cron',
        schedule: '*/5 * * * *',
        prompt: 'p',
      });
      sched.pause(task.id);

      const resumed = sched.resume(task.id);
      expect(resumed!.status).toBe('active');
      expect(resumed!.nextRun).toBeTruthy();
    });
  });

  describe('delete', () => {
    it('删除任务后 list 返回空', () => {
      const sched = createScheduler(testDir);
      const task = sched.create({
        name: 'to-delete',
        type: 'cron',
        schedule: '0 * * * *',
        prompt: 'p',
      });

      expect(sched.delete(task.id)).toBe(true);
      expect(sched.list().length).toBe(0);
    });

    it('删除不存在的任务返回 false', () => {
      const sched = createScheduler(testDir);
      expect(sched.delete('nonexistent')).toBe(false);
    });
  });

  describe('trigger + history', () => {
    it('触发任务后记录历史', () => {
      const sched = createScheduler(testDir);
      const task = sched.create({
        name: 'triggerable',
        type: 'cron',
        schedule: '0 * * * *',
        prompt: 'run me',
      });

      const run = sched.trigger(task.id, () => ({
        exitCode: 0,
        output: 'success',
      }));

      expect(run.exitCode).toBe(0);
      expect(run.output).toBe('success');

      const history = sched.history(task.id);
      expect(history.length).toBe(1);
      expect(history[0]!.exitCode).toBe(0);

      // lastRun 应被更新
      const updated = sched.get(task.id);
      expect(updated!.lastRun).toBeTruthy();
    });

    it('多次触发积累历史', () => {
      const sched = createScheduler(testDir);
      const task = sched.create({
        name: 'multi',
        type: 'cron',
        schedule: '0 * * * *',
        prompt: 'p',
      });

      sched.trigger(task.id, () => ({ exitCode: 0, output: 'run1' }));
      sched.trigger(task.id, () => ({ exitCode: 1, output: 'run2 failed' }));

      const history = sched.history(task.id);
      expect(history.length).toBe(2);
    });
  });

  describe('getDueTasks', () => {
    it('返回已到期且 active 的任务', () => {
      const sched = createScheduler(testDir);
      const past = new Date(Date.now() - 60_000).toISOString();
      const task = sched.create({
        name: 'overdue',
        type: 'once',
        schedule: past,
        prompt: 'p',
      });

      const due = sched.getDueTasks();
      expect(due.length).toBe(1);
      expect(due[0]!.id).toBe(task.id);
    });

    it('paused 的任务不返回', () => {
      const sched = createScheduler(testDir);
      const task = sched.create({
        name: 'paused',
        type: 'cron',
        schedule: '*/5 * * * *',
        prompt: 'p',
      });
      sched.pause(task.id);

      const due = sched.getDueTasks();
      expect(due.length).toBe(0);
    });
  });

  describe('持久化', () => {
    it('新实例读取已持久化的任务', () => {
      const sched1 = createScheduler(testDir);
      sched1.create({
        name: 'persist',
        type: 'cron',
        schedule: '0 0 * * *',
        prompt: 'daily',
      });

      const sched2 = createScheduler(testDir);
      expect(sched2.list().length).toBe(1);
      expect(sched2.list()[0]!.name).toBe('persist');
    });

    it('tasks.json 文件存在', () => {
      const sched = createScheduler(testDir);
      sched.create({
        name: 'file-test',
        type: 'cron',
        schedule: '0 * * * *',
        prompt: 'p',
      });

      expect(existsSync(join(testDir, 'scheduler', 'tasks.json'))).toBe(true);
    });
  });
});

describe('nextCronTime', () => {
  it('每分钟触发（* * * * *）', () => {
    const from = new Date('2026-08-06T12:00:00Z');
    const next = nextCronTime('* * * * *', from);
    expect(new Date(next).getUTCMinutes()).toBe(1);
  });

  it('每天 9 点（0 9 * * *）', () => {
    const from = new Date('2026-08-06T08:30:00Z');
    const next = nextCronTime('0 9 * * *', from);
    const nextDate = new Date(next);
    expect(nextDate.getUTCHours()).toBe(9);
    expect(nextDate.getUTCMinutes()).toBe(0);
  });

  it('每 15 分钟（*/15 * * * *）', () => {
    const from = new Date('2026-08-06T12:07:00Z');
    const next = nextCronTime('*/15 * * * *', from);
    const nextDate = new Date(next);
    expect(nextDate.getUTCMinutes()).toBe(15);
  });

  it('无效表达式抛异常', () => {
    expect(() => nextCronTime('invalid')).toThrow();
  });
});
