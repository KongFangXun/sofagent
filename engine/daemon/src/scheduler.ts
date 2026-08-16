// ============================================================
// scheduler.ts · 定时任务调度器（v1.3.6 功能②）
//
// ScheduledTask CRUD + pause/resume/trigger/history
// 支持 cron（周期）和 once（一次性）两种类型
//
// 存储：
//   data/scheduler/tasks.json         全量索引
//   data/scheduler/history/<id>/<ts>.json  运行历史
// ============================================================

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

export type ScheduleType = 'cron' | 'once';

export interface ScheduledTask {
  /** UUID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 类型：cron 周期 / once 一次性 */
  type: ScheduleType;
  /** cron 表达式 或 ISO 8601 datetime */
  schedule: string;
  /** 执行时注入的 prompt */
  prompt: string;
  /** 状态：active / paused */
  status: 'active' | 'paused';
  /** 最后运行时间 ISO 8601 */
  lastRun?: string;
  /** 下次运行时间 ISO 8601 */
  nextRun?: string;
  /** 创建时间 ISO 8601 */
  createdAt: string;
}

export interface TaskRun {
  /** 关联的任务 ID */
  taskId: string;
  /** 开始时间 ISO 8601 */
  startedAt: string;
  /** 结束时间 ISO 8601 */
  finishedAt?: string;
  /** 退出码 0=成功 */
  exitCode: number;
  /** 输出内容 */
  output: string;
}

// ────────────────────────────────────────────────────────────
// 路径解析
// ────────────────────────────────────────────────────────────

function getSchedulerRoot(dataBase?: string): string {
  const base = dataBase || process.env.SOFAGENT_DATA || join(process.env.HOME || '~', '.sofagent', 'data');
  return join(base, 'scheduler');
}

function getTasksPath(schedulerRoot: string): string {
  return join(schedulerRoot, 'tasks.json');
}

function getHistoryDir(schedulerRoot: string, taskId: string): string {
  return join(schedulerRoot, 'history', taskId);
}

// ────────────────────────────────────────────────────────────
// 持久化
// ────────────────────────────────────────────────────────────

/** 读取全量任务索引 */
export function loadTasks(dataBase?: string): ScheduledTask[] {
  const root = getSchedulerRoot(dataBase);
  const path = getTasksPath(root);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ScheduledTask[];
  } catch {
    return [];
  }
}

/** 写入全量任务索引 */
function saveTasks(tasks: ScheduledTask[], dataBase?: string): void {
  const root = getSchedulerRoot(dataBase);
  mkdirSync(root, { recursive: true });
  writeFileSync(getTasksPath(root), JSON.stringify(tasks, null, 2) + '\n', 'utf-8');
}

/** 读取单个任务历史 */
export function loadHistory(taskId: string, dataBase?: string): TaskRun[] {
  const root = getSchedulerRoot(dataBase);
  const dir = getHistoryDir(root, taskId);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse(); // 最新在前
  const runs: TaskRun[] = [];
  for (const f of files) {
    try {
      runs.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TaskRun);
    } catch {
      // 坏文件跳过
    }
  }
  return runs;
}

/** 追加一条运行历史 */
function appendHistory(taskId: string, run: TaskRun, dataBase?: string): void {
  const root = getSchedulerRoot(dataBase);
  const dir = getHistoryDir(root, taskId);
  mkdirSync(dir, { recursive: true });
  // 文件名含毫秒 + 随机后缀，防止同秒触发时文件名冲突
  const safeTime = run.startedAt.replace(/[:.]/g, '-');
  const suffix = randomUUID().slice(0, 8);
  const filename = `${safeTime}-${suffix}.json`;
  writeFileSync(join(dir, filename), JSON.stringify(run, null, 2) + '\n', 'utf-8');
}

// ────────────────────────────────────────────────────────────
// cron 解析（简化版——支持基本 5 段 cron 表达式）
// ────────────────────────────────────────────────────────────

/**
 * 计算 cron 表达式的下一次触发时间。
 *
 * 支持基本格式：`分 时 日 月 周`
 * 每段支持：数字 / `*` / `,` / `-` / `/` 步进
 *
 * @param cronExpr cron 表达式
 * @param from 从哪个时间开始计算（默认 now）
 * @returns ISO 8601 datetime 字符串
 */
export function nextCronTime(cronExpr: string, from?: Date): string {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron 表达式格式错误（需要 5 段：分 时 日 月 周）: ${cronExpr}`);
  }

  const [minF = '', hourF = '', dayF = '', monthF = '', dowF = ''] = parts;
  const now = from ?? new Date();
  // 从下一分钟开始搜索
  const start = new Date(now);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  // 最多搜索 366 天
  const maxIter = 366 * 24 * 60;
  for (let i = 0; i < maxIter; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (
      matchField(minF, candidate.getUTCMinutes(), 0, 59) &&
      matchField(hourF, candidate.getUTCHours(), 0, 23) &&
      matchField(dayF, candidate.getUTCDate(), 1, 31) &&
      matchField(monthF, candidate.getUTCMonth() + 1, 1, 12) &&
      matchField(dowF, candidate.getUTCDay(), 0, 6)
    ) {
      return candidate.toISOString();
    }
  }

  // 兜底：返回 1 天后
  return new Date(now.getTime() + 86400_000).toISOString();
}

/**
 * 匹配 cron 单段。
 * 支持：星号 / 数字 / 逗号列表 / 范围 / 步进
 */
function matchField(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;

  // 逗号分隔
  for (const part of field.split(',')) {
    if (matchPart(part.trim(), value, min, max)) return true;
  }
  return false;
}

function matchPart(part: string, value: number, min: number, max: number): boolean {
  // 步进 `*/N` 或 `A-B/N`
  const stepMatch = part.match(/^(.*)\/(\d+)$/);
  const step = stepMatch ? parseInt(stepMatch[2]!, 10) : 1;
  const range = stepMatch ? stepMatch[1]! : part;

  let lo: number, hi: number;
  if (range === '*') {
    lo = min;
    hi = max;
  } else {
    const rangeMatch = range.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      lo = parseInt(rangeMatch[1]!, 10);
      hi = parseInt(rangeMatch[2]!, 10);
    } else {
      lo = hi = parseInt(range, 10);
    }
  }

  if (value < lo || value > hi) return false;
  if (step > 1 && (value - lo) % step !== 0) return false;
  return true;
}

// ────────────────────────────────────────────────────────────
// 公共 API
// ────────────────────────────────────────────────────────────

/**
 * 创建定时任务调度器实例。
 *
 * @param dataBase 数据根目录（可选）
 */
export function createScheduler(dataBase?: string) {
  return {
    /**
     * 创建新任务。
     * @returns 创建的 ScheduledTask（含分配的 id + nextRun）
     */
    create(input: Omit<ScheduledTask, 'id' | 'status' | 'createdAt' | 'nextRun'>): ScheduledTask {
      const task: ScheduledTask = {
        ...input,
        id: randomUUID(),
        status: 'active',
        createdAt: new Date().toISOString(),
        nextRun: input.type === 'cron'
          ? nextCronTime(input.schedule)
          : input.schedule,
      };
      const tasks = loadTasks(dataBase);
      tasks.push(task);
      saveTasks(tasks, dataBase);
      return task;
    },

    /** 列出全部任务 */
    list(): ScheduledTask[] {
      return loadTasks(dataBase);
    },

    /** 按 ID 获取单个任务 */
    get(taskId: string): ScheduledTask | null {
      return loadTasks(dataBase).find((t) => t.id === taskId) ?? null;
    },

    /** 更新任务 */
    update(taskId: string, patch: Partial<Omit<ScheduledTask, 'id' | 'createdAt'>>): ScheduledTask | null {
      const tasks = loadTasks(dataBase);
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) return null;
      tasks[idx] = { ...tasks[idx]!, ...patch };
      // 重新计算 nextRun
      if (patch.schedule || patch.type) {
        tasks[idx]!.nextRun = tasks[idx]!.type === 'cron'
          ? nextCronTime(tasks[idx]!.schedule)
          : tasks[idx]!.schedule;
      }
      saveTasks(tasks, dataBase);
      return tasks[idx]!;
    },

    /** 暂停任务 */
    pause(taskId: string): ScheduledTask | null {
      return this.update(taskId, { status: 'paused' });
    },

    /** 恢复任务 */
    resume(taskId: string): ScheduledTask | null {
      const task = this.update(taskId, { status: 'active' });
      if (task && task.type === 'cron') {
        return this.update(taskId, { nextRun: nextCronTime(task.schedule) });
      }
      return task;
    },

    /** 删除任务（含历史） */
    delete(taskId: string): boolean {
      const tasks = loadTasks(dataBase);
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) return false;
      tasks.splice(idx, 1);
      saveTasks(tasks, dataBase);
      // 历史目录由调用方决定是否清理（通常保留）
      return true;
    },

    /** 手动触发任务执行（记录历史） */
    trigger(taskId: string, runner: (task: ScheduledTask) => { exitCode: number; output: string }): TaskRun {
      const task = this.get(taskId);
      if (!task) throw new Error(`任务不存在: ${taskId}`);

      const startedAt = new Date().toISOString();
      const { exitCode, output } = runner(task);
      const finishedAt = new Date().toISOString();

      const run: TaskRun = {
        taskId,
        startedAt,
        finishedAt,
        exitCode,
        output,
      };

      appendHistory(taskId, run, dataBase);

      // 更新 lastRun + nextRun
      this.update(taskId, {
        lastRun: finishedAt,
        nextRun: task.type === 'cron' ? nextCronTime(task.schedule, new Date(finishedAt)) : undefined,
      });

      return run;
    },

    /** 获取任务运行历史 */
    history(taskId: string): TaskRun[] {
      return loadHistory(taskId, dataBase);
    },

    /**
     * 获取所有到期的 active 任务。
     * 用于 daemon 启动时恢复 once 任务 + 定期巡检 cron 任务。
     */
    getDueTasks(now?: Date): ScheduledTask[] {
      const current = now ?? new Date();
      return loadTasks(dataBase).filter((t) => {
        if (t.status !== 'active') return false;
        if (!t.nextRun) return false;
        return new Date(t.nextRun) <= current;
      });
    },
  };
}
