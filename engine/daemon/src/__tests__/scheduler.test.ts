// ============================================================
// scheduler.test.ts · 定时任务调度器测试（v1.2.9 功能②）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { createScheduler, nextCronTime, expandCronSugar } from '../scheduler';

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

// ============================================================
// v1.3.8 交付四：cron 三档糖（@daily/@weekly/@monthly 宏展开层）
// ============================================================

describe('expandCronSugar · cron 三档糖（v1.3.8 交付四）', () => {
  it('@daily → 0 0 * * *', () => {
    expect(expandCronSugar('@daily')).toBe('0 0 * * *');
  });

  it('@weekly → 0 0 * * 0', () => {
    expect(expandCronSugar('@weekly')).toBe('0 0 * * 0');
  });

  it('@monthly → 0 0 1 * *', () => {
    expect(expandCronSugar('@monthly')).toBe('0 0 1 * *');
  });

  it('非宏字符串原样返回（5 段表达式不受影响）', () => {
    expect(expandCronSugar('*/15 * * * *')).toBe('*/15 * * * *');
    expect(expandCronSugar('0 9 * * 1-5')).toBe('0 9 * * 1-5');
  });

  it('nextCronTime 直接吃宏（展开层在入口）', () => {
    const from = new Date('2026-08-19T10:00:00Z');
    // @daily → 次日 00:00 UTC
    expect(nextCronTime('@daily', from)).toBe('2026-08-20T00:00:00.000Z');
    // @weekly → 下周日 00:00（2026-08-19 是周三 → 8/23 周日）
    expect(nextCronTime('@weekly', from)).toBe('2026-08-23T00:00:00.000Z');
    // @monthly → 下月 1 日 00:00
    expect(nextCronTime('@monthly', from)).toBe('2026-09-01T00:00:00.000Z');
  });
});

// 宏 × scheduler 实例（需要 describe('scheduler') 的 testDir 作用域——并入该 describe）
describe('scheduler · cron 三档糖集成（v1.3.8 交付四）', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('create 落盘前展开宏（tasks.json 存 5 段表达式）', () => {
    const sched = createScheduler(testDir);
    const task = sched.create({
      name: '宏任务',
      type: 'cron',
      schedule: '@daily',
      prompt: '每日巡检',
    });
    expect(task.schedule).toBe('0 0 * * *');
    // nextRun 是明天 00:00 UTC
    const next = new Date(task.nextRun!);
    expect(next.getUTCHours()).toBe(0);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it('update 改 schedule 时宏同样展开', () => {
    const sched = createScheduler(testDir);
    const task = sched.create({ name: 't', type: 'cron', schedule: '@daily', prompt: 'p' });
    const updated = sched.update(task.id, { schedule: '@weekly' });
    expect(updated!.schedule).toBe('0 0 * * 0');
  });
});
