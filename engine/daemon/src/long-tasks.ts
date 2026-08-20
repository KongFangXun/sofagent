// ============================================================
// long-tasks.ts · 异步长任务自治（v1.3.8 交付四 · Durable L3 配套）
// ============================================================
//
// daemon 从「文件监控被动模式」升级为「长任务自主运行」：
// FDE 离场后 daemon 按计划自主发起长任务（每周 Benchmark 复测 /
// 每日知识健康巡检 / 每月审计链校验），不依赖外部触发。
//
// 五件能力（changelog v1.3.8 §四）：
//   1. cron 三档糖：@daily/@weekly/@monthly 宏展开为底层 5 段 cron 表达式
//      （scheduler.ts 已有解析——宏只做展开层，不重复造解析器）
//   2. 依赖图：dependsOn: string[]——前任务最近一次 run 状态 PASS 才触发
//      后任务；否则跳过并记 skipped-reason
//   3. WAL 续跑联动：崩溃恢复钩子 onCrashRecovery(callback)——本包只定义
//      钩子接口 + 直接读 data/wal.jsonl 的 status 字段（fs 读取，不跨包
//      import durable/——wal.ts 属 orchestrator 包，跨包依赖会引入循环）
//   4. 注册表：.sofagent/long-tasks.yml（daemon 已依赖 js-yaml——cron.ts
//      读 watch.yml 同款），FDE 交付时声明企业长任务清单
//   5. 死循环检测：连续 N 次执行输出无变化（N 可配置默认 6）→ 写
//      daemon-health.json 的 warnings 数组触发 replan 审计告警，不无限空转
//
// 设计轴（状态驱动 cadence 留口）：cron 为基线，backoffOnWait: true 时
// 上次 run 状态 waiting → 下轮间隔 ×2；材料变化（output 变化）恢复原间隔。
// ============================================================

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { createScheduler, nextCronTime, type ScheduledTask, type TaskRun } from './scheduler';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** cron 三档糖宏（展开层——底层解析仍走 scheduler 的 5 段表达式） */
export type CronMacro = '@daily' | '@weekly' | '@monthly';

/** 宏 → 5 段 cron 表达式（UTC 口径——与 nextCronTime 的 UTC 搜索对齐） */
export const CRON_MACRO_EXPANSION: Record<CronMacro, string> = {
  '@daily': '0 0 * * *', // 每天 00:00
  '@weekly': '0 0 * * 0', // 每周日 00:00
  '@monthly': '0 0 1 * *', // 每月 1 日 00:00
};

/** 长任务 run 状态（PASS/FAIL/SKIPPED/WAITING——依赖图与 backoff 的判据） */
export type LongTaskRunStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'WAITING';

/** 单次长任务执行记录（history/<id>/<ts>.json 结构对齐 scheduler.TaskRun） */
export interface LongTaskRun {
  /** 关联任务 ID */
  taskId: string;
  /** 开始时间 ISO 8601 */
  startedAt: string;
  /** 结束时间 ISO 8601 */
  finishedAt?: string;
  /** 退出码 0=成功 */
  exitCode: number;
  /** 输出内容 */
  output: string;
  /** 运行状态（PASS=exitCode 0；WAITING=等外部输入；SKIPPED=依赖未满足） */
  status: LongTaskRunStatus;
  /** 跳过原因（status=SKIPPED 时——依赖图阻断的细节） */
  skippedReason?: string;
}

/** 长任务声明（注册表条目——.sofagent/long-tasks.yml 的 items[] 之一） */
export interface LongTaskSpec {
  /** 任务名（依赖图 dependsOn 引用键——同注册表内唯一） */
  name: string;
  /** 调度：三档宏或 5 段 cron 表达式 */
  schedule: CronMacro | string;
  /** 执行时注入的 prompt */
  prompt: string;
  /** 依赖前置任务名列表（前任务最近一次 PASS 才触发；缺省无依赖） */
  dependsOn?: string[];
  /** 死循环检测阈值（连续 N 次输出无变化触发告警；缺省用全局默认 6） */
  maxNoChangeRuns?: number;
  /** 状态驱动 cadence：上次 WAITING → 下轮间隔 ×2（材料变化恢复） */
  backoffOnWait?: boolean;
  /** 状态 active/paused（缺省 active） */
  status?: 'active' | 'paused';
}

/** 长任务注册表（.sofagent/long-tasks.yml 顶层结构） */
export interface LongTaskRegistry {
  /** 注册表版本（格式演进预留） */
  version: number;
  /** 长任务清单 */
  tasks: LongTaskSpec[];
}

/** 崩溃恢复回调载荷（WAL 续跑联动——宿主接线 durable 层） */
export interface CrashRecoveryEvent {
  /** 未完成的 WAL 条目（status !== 'done' 的原始记录） */
  entry: { id?: string; op?: string; status?: string } & Record<string, unknown>;
  /** 来源文件路径 */
  source: string;
  /** 恢复建议（'resume'——续跑；'discard'——放弃） */
  suggestion: 'resume' | 'discard';
}

/** 死循环告警写入 daemon-health.json warnings 数组的条目 */
export interface LongTaskWarning {
  /** 告警时间 ISO 8601 */
  ts: string;
  /** 任务名 */
  task: string;
  /** 告警类型（no-progress——连续 N 次无变化） */
  kind: 'no-progress';
  /** 连续无变化次数 */
  consecutiveNoChange: number;
  /** 处置建议（replan——重规划而非继续空转） */
  action: 'replan';
  /** 上次输出指纹（变化的判据——前 16 位） */
  outputFingerprint: string;
}

// ────────────────────────────────────────────────────────────
// 1. cron 三档糖（宏展开层）
// ────────────────────────────────────────────────────────────

/**
 * 展开调度宏为底层 5 段 cron 表达式。
 *
 * @daily → `0 0 * * *` / @weekly → `0 0 * * 0` / @monthly → `0 0 1 * *`
 * 非宏字符串原样透传（已是 5 段表达式——scheduler 解析）。
 *
 * @param schedule 宏或 cron 表达式
 * @returns 5 段 cron 表达式
 */
export function expandScheduleMacro(schedule: CronMacro | string): string {
  if (schedule in CRON_MACRO_EXPANSION) {
    return CRON_MACRO_EXPANSION[schedule as CronMacro];
  }
  return schedule;
}

/**
 * 判定调度串是否为受支持宏。
 */
export function isCronMacro(schedule: string): schedule is CronMacro {
  return schedule in CRON_MACRO_EXPANSION;
}

// ────────────────────────────────────────────────────────────
// 4. 注册表（.sofagent/long-tasks.yml 读写）
// ────────────────────────────────────────────────────────────

/**
 * 注册表文件路径（<projectDir>/.sofagent/long-tasks.yml）。
 */
export function longTasksRegistryPath(projectDir: string): string {
  return join(projectDir, '.sofagent', 'long-tasks.yml');
}

/**
 * 读取长任务注册表（FDE 交付时声明的企业长任务清单）。
 *
 * daemon 已依赖 js-yaml（cron.ts 读 watch.yml 同款）——跟随现状用 YAML，
 * 不引入新依赖。文件不存在/损坏 → 空注册表（不 crash）。
 *
 * @param projectDir 项目根目录
 * @returns 注册表（空表兜底）
 */
export function loadLongTaskRegistry(projectDir: string): LongTaskRegistry {
  const path = longTasksRegistryPath(projectDir);
  if (!existsSync(path)) return { version: 1, tasks: [] };
  try {
    const raw = yamlLoad(readFileSync(path, 'utf-8')) as Partial<LongTaskRegistry> | null;
    if (!raw || !Array.isArray(raw.tasks)) return { version: 1, tasks: [] };
    // 运行时校验：每条至少含 name + schedule + prompt（坏条目过滤，不整表丢弃）
    const tasks = raw.tasks.filter((t): t is LongTaskSpec => {
      if (!t || typeof t !== 'object') return false;
      const e = t as unknown as Record<string, unknown>;
      return typeof e.name === 'string' && typeof e.schedule === 'string' && typeof e.prompt === 'string';
    });
    return { version: typeof raw.version === 'number' ? raw.version : 1, tasks };
  } catch {
    return { version: 1, tasks: [] };
  }
}

/**
 * 写入长任务注册表（FDE 声明 / 运维增删——daemon 读取）。
 *
 * @param projectDir 项目根目录
 * @param registry 注册表
 */
export function saveLongTaskRegistry(projectDir: string, registry: LongTaskRegistry): void {
  const path = longTasksRegistryPath(projectDir);
  mkdirSync(join(projectDir, '.sofagent'), { recursive: true });
  writeFileSync(path, yamlDump(registry, { lineWidth: 120 }), 'utf-8');
}

// ────────────────────────────────────────────────────────────
// 5. 死循环检测 + 告警落 daemon-health.json warnings
// ────────────────────────────────────────────────────────────

/** daemon-health.json 路径（与 daemon-health.ts 同口径——SOFAGENT_DATA 优先） */
function healthFilePath(dataBase?: string): string {
  const base = dataBase || process.env.SOFAGENT_DATA || join(process.env.HOME || '~', '.sofagent', 'data');
  return join(base, 'daemon-health.json');
}

/**
 * 输出指纹（无变化判据——sha256 前 16 位）。
 * 用 crypto 而非全文比对：超长输出（报告类）对比成本可控且稳定。
 */
function fingerprint(output: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(output).digest('hex').slice(0, 16);
}

/**
 * 追加一条 no-progress 告警到 daemon-health.json 的 warnings 数组。
 *
 * 现有 daemon-health.json 无 warnings 字段（v1.3.8 交付四新增）——
 * 读旧文件保留全部既有字段，追加 warnings（数组 append，去重同任务告警）。
 * 文件不存在 → 建最小结构（只含 warnings——其余字段由 writeHealthFile 主管）。
 *
 * @param warning 告警条目
 * @param dataBase 数据根目录（缺省 SOFAGENT_DATA）
 */
export function appendLongTaskWarning(warning: LongTaskWarning, dataBase?: string): void {
  const path = healthFilePath(dataBase);
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    } catch {
      existing = {}; // 损坏——不阻断告警写入
    }
  }
  const warnings = Array.isArray(existing['warnings']) ? (existing['warnings'] as LongTaskWarning[]) : [];
  // 同任务旧告警覆盖（保留最新一次——历史轨迹在 audit log，这里只报当前态）
  const next = [...warnings.filter((w) => !(w && typeof w === 'object' && w.task === warning.task)), warning];
  existing['warnings'] = next;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

/**
 * 更新任务的连续无变化计数并按需触发告警。
 *
 * @param task 任务声明
 * @param output 本次输出
 * @param state 连续计数状态（调用方持有——返回新值持久化）
 * @param dataBase 数据根目录（告警落盘用）
 * @returns 新的连续无变化次数（0 = 有变化重置）
 */
export function trackNoProgress(
  task: LongTaskSpec,
  output: string,
  state: { lastFingerprint: string | null; consecutiveNoChange: number },
  dataBase?: string,
): { lastFingerprint: string; consecutiveNoChange: number; warned: boolean } {
  const fp = fingerprint(output);
  const threshold = task.maxNoChangeRuns ?? DEFAULT_MAX_NO_CHANGE_RUNS;
  if (state.lastFingerprint === null || fp !== state.lastFingerprint) {
    // 有变化（或首次）——计数重置
    return { lastFingerprint: fp, consecutiveNoChange: 0, warned: false };
  }
  const consecutive = state.consecutiveNoChange + 1;
  if (consecutive >= threshold) {
    // 触发 replan 审计告警（而非无限空转）
    appendLongTaskWarning(
      {
        ts: new Date().toISOString(),
        task: task.name,
        kind: 'no-progress',
        consecutiveNoChange: consecutive,
        action: 'replan',
        outputFingerprint: fp,
      },
      dataBase,
    );
    return { lastFingerprint: fp, consecutiveNoChange: consecutive, warned: true };
  }
  return { lastFingerprint: fp, consecutiveNoChange: consecutive, warned: false };
}

/** 死循环检测默认阈值（连续 6 次无变化触发告警——可被 task.maxNoChangeRuns 覆盖） */
export const DEFAULT_MAX_NO_CHANGE_RUNS = 6;

// ────────────────────────────────────────────────────────────
// 3. WAL 续跑联动（崩溃恢复钩子——不跨包依赖）
// ────────────────────────────────────────────────────────────

/**
 * 读取 data/wal.jsonl 中未完成的条目（status !== 'done'）。
 *
 * ⚠️ 边界：不 import orchestrator 的 durable/wal.ts（跨包依赖会引入
 * orchestrator ↔ daemon 循环——orchestrator devDependencies 里有 daemon）。
 * 只用 fs 读 JSONL 行 + 解析 status 字段（格式约定见 durable 层文档）。
 *
 * @param dataBase 数据根目录（wal.jsonl 落 <dataBase>/wal.jsonl）
 * @returns 未完成条目（空数组 = 无需恢复）
 */
export function readUnfinishedWalEntries(dataBase?: string): Array<{ id?: string; op?: string; status?: string } & Record<string, unknown>> {
  const base = dataBase || process.env.SOFAGENT_DATA || join(process.env.HOME || '~', '.sofagent', 'data');
  const path = join(base, 'wal.jsonl');
  if (!existsSync(path)) return [];
  const unfinished: Array<{ id?: string; op?: string; status?: string } & Record<string, unknown>> = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as { status?: string } & Record<string, unknown>;
      // 约定：done = 已完成；其余（pending/in-flight/...）均视为未完成需续跑
      if (entry.status !== 'done') unfinished.push(entry);
    } catch {
      // 坏行跳过（WAL 尾部半行——崩溃写入中断的典型形态）
    }
  }
  return unfinished;
}

// ────────────────────────────────────────────────────────────
// 长任务调度器（组装上述五件——对外主入口）
// ────────────────────────────────────────────────────────────

/** 长任务执行器（宿主注入——daemon 把 prompt 交给 SubAgent 跑） */
export type LongTaskRunner = (task: LongTaskSpec) => { exitCode: number; output: string; waiting?: boolean };

/** 崩溃恢复回调（宿主接线 durable 层续跑） */
export type CrashRecoveryCallback = (event: CrashRecoveryEvent) => void;

/** 长任务运行时状态（内存态——依赖图判据与 backoff 基数） */
interface LongTaskRuntimeState {
  /** 任务名 → 最近一次 run 状态 */
  lastStatus: Map<string, LongTaskRunStatus>;
  /** 任务名 → 最近一次输出指纹（死循环检测） */
  lastFingerprint: Map<string, string | null>;
  /** 任务名 → 连续无变化计数 */
  consecutiveNoChange: Map<string, number>;
  /** 任务名 → 当前 backoff 倍率（backoffOnWait 累积用，1=原始间隔） */
  backoffMultiplier: Map<string, number>;
}

/**
 * 创建长任务调度器。
 *
 * 用法（daemon 启动序列）：
 *   const lt = createLongTaskScheduler({ projectDir, dataBase });
 *   lt.onCrashRecovery((e) => durableResume(e.entry));  // 示意名：宿主自定义的 WAL 续跑函数（接口注入，非本库实现）
 *   lt.runDueTasks(myRunner);                           // 每轮巡检调用
 *
 * @param options 调度器配置
 */
export function createLongTaskScheduler(options: {
  /** 项目根目录（注册表 .sofagent/long-tasks.yml 读取） */
  projectDir: string;
  /** 数据根目录（history / daemon-health.json / wal.jsonl 落盘） */
  dataBase?: string;
  /** 死循环检测全局默认阈值（任务级 maxNoChangeRuns 优先；缺省 6） */
  maxNoChangeRuns?: number;
}) {
  const { projectDir, dataBase, maxNoChangeRuns } = options;
  const scheduler = createScheduler(dataBase);
  const state: LongTaskRuntimeState = {
    lastStatus: new Map(),
    lastFingerprint: new Map(),
    consecutiveNoChange: new Map(),
    backoffMultiplier: new Map(),
  };
  const crashCallbacks: CrashRecoveryCallback[] = [];

  // 内部辅助：注册表条目名 → scheduler 已建任务映射（懒建缓存）
  const schedulerTaskByName = new Map<string, ScheduledTask>();

  /** 懒建/查 scheduler 任务（注册表条目首次触发时建，后续复用 nextRun 滚动） */
  function ensureSchedulerTask(spec: LongTaskSpec): ScheduledTask | null {
    const cached = schedulerTaskByName.get(spec.name);
    if (cached && scheduler.get(cached.id)) return scheduler.get(cached.id)!;
    // 注册表条目 → scheduler 任务（name 作关联键；schedule 宏先展开）
    const existing = scheduler.list().find((t) => t.name === `long-task:${spec.name}`);
    if (existing) {
      schedulerTaskByName.set(spec.name, existing);
      return existing;
    }
    const created = scheduler.create({
      name: `long-task:${spec.name}`,
      type: 'cron',
      schedule: expandScheduleMacro(spec.schedule),
      prompt: spec.prompt,
    });
    schedulerTaskByName.set(spec.name, created);
    return created;
  }

  /** 依赖图判定：全部 dependsOn 前任务最近一次 run 是否 PASS */
  function dependenciesSatisfied(spec: LongTaskSpec): { ok: boolean; blockedBy?: string } {
    for (const dep of spec.dependsOn ?? []) {
      const st = state.lastStatus.get(dep);
      if (st !== 'PASS') return { ok: false, blockedBy: dep };
    }
    return { ok: true };
  }

  /** 执行单任务（依赖图 → 跑 → 状态/指纹/backoff 更新） */
  function runTask(spec: LongTaskSpec, runner: LongTaskRunner, now?: Date): LongTaskRun {
    // 时间统一走注入 now（可测性）；缺省真实时钟
    const startedAt = (now ?? new Date()).toISOString();

    // 依赖图：前任务最近一次非 PASS（含未跑过）→ 跳过 + skipped-reason
    const dep = dependenciesSatisfied(spec);
    if (!dep.ok) {
      const run: LongTaskRun = {
        taskId: spec.name,
        startedAt,
        finishedAt: startedAt,
        exitCode: 0,
        output: `依赖未满足，跳过执行`,
        status: 'SKIPPED',
        skippedReason: `前置任务 ${dep.blockedBy} 最近一次状态非 PASS（当前：${state.lastStatus.get(dep.blockedBy!) ?? '未运行'}）`,
      };
      state.lastStatus.set(spec.name, 'SKIPPED');
      appendRunHistory(spec.name, run);
      return run;
    }

    // 执行（宿主 runner——daemon 把 prompt 交给 SubAgent）
    const { exitCode, output, waiting } = runner(spec);
    const finishedAt = (now ?? new Date()).toISOString();

    // 状态归一：waiting 优先于 PASS/FAIL（等外部输入是第三态）
    const status: LongTaskRunStatus = waiting ? 'WAITING' : exitCode === 0 ? 'PASS' : 'FAIL';

    // 死循环检测（输出无变化计数——SKIPPED 不计）
    const fpState = {
      lastFingerprint: state.lastFingerprint.get(spec.name) ?? null,
      consecutiveNoChange: state.consecutiveNoChange.get(spec.name) ?? 0,
    };
    const tracked = trackNoProgress(
      { ...spec, maxNoChangeRuns: spec.maxNoChangeRuns ?? maxNoChangeRuns },
      output,
      fpState,
      dataBase,
    );
    state.lastFingerprint.set(spec.name, tracked.lastFingerprint);
    state.consecutiveNoChange.set(spec.name, tracked.consecutiveNoChange);

    // 状态驱动 cadence（设计轴留口）：
    //   WAITING → 下轮间隔 ×2（连续 waiting 累积）；材料变化（输出指纹变化）恢复 ×1
    if (status === 'WAITING' && spec.backoffOnWait) {
      const cur = state.backoffMultiplier.get(spec.name) ?? 1;
      state.backoffMultiplier.set(spec.name, Math.min(cur * 2, 32)); // 上限 32× 防永久休眠
    } else if (tracked.consecutiveNoChange === 0) {
      state.backoffMultiplier.set(spec.name, 1); // 有材料变化恢复原间隔
    }

    state.lastStatus.set(spec.name, status);

    const run: LongTaskRun = { taskId: spec.name, startedAt, finishedAt, exitCode, output, status };
    appendRunHistory(spec.name, run);
    return run;
  }

  /** run 历史落盘（复用 scheduler 的 history 结构——<dataBase>/scheduler/history/） */
  function appendRunHistory(taskName: string, run: LongTaskRun): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { writeFileSync: wf, mkdirSync: mk } = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { randomUUID } = require('crypto') as typeof import('crypto');
      const base = dataBase || process.env.SOFAGENT_DATA || join(process.env.HOME || '~', '.sofagent', 'data');
      const dir = join(base, 'scheduler', 'history', `long-task:${taskName}`);
      mk(dir, { recursive: true });
      const safeTime = run.startedAt.replace(/[:.]/g, '-');
      const suffix = randomUUID().slice(0, 8);
      wf(join(dir, `${safeTime}-${suffix}.json`), JSON.stringify(run, null, 2) + '\n', 'utf-8');
    } catch {
      // 历史落盘失败不阻断调度（内存态已更新）
    }
  }

  /** 读长任务 run 历史（LongTaskRun 结构——与 scheduler.history 的 TaskRun 兼容读取） */
  function loadRunHistory(taskName: string): LongTaskRun[] {
    const runs = scheduler.history(`long-task:${taskName}`) as unknown as LongTaskRun[];
    return runs.map((r) => ({
      ...r,
      status: (r.status ?? (r.exitCode === 0 ? 'PASS' : 'FAIL')) as LongTaskRunStatus,
    }));
  }

  return {
    /** 注册表读取（对外暴露——daemon 启动时打日志） */
    registry(): LongTaskRegistry {
      return loadLongTaskRegistry(projectDir);
    },

    /**
     * 注册崩溃恢复回调（WAL 续跑联动）。
     *
     * 本包不 import durable/wal.ts（跨包依赖边界）——只定义钩子：
     * 调度器创建时扫描 wal.jsonl 未完成条目逐条回调，由宿主接线续跑。
     */
    onCrashRecovery(callback: CrashRecoveryCallback): void {
      crashCallbacks.push(callback);
      // 立即派发当前未完成条目（调度器创建 = 崩溃后重启时刻）
      for (const entry of readUnfinishedWalEntries(dataBase)) {
        try {
          callback({ entry, source: 'wal.jsonl', suggestion: 'resume' });
        } catch {
          // 回调异常不阻断其余条目恢复
        }
      }
    },

    /**
     * 跑一轮到期任务（daemon 主循环周期调用）。
     *
     * 到期语义：注册表条目首次出现（内存无状态）视为到期——daemon 重启后
     * 补跑一次（对齐「错过不补」缺口的补偿语义）；之后走 scheduler 的
     * nextRun 滚动 + backoff 倍率拉长（状态驱动 cadence 的落点）。
     * 依赖图在执行前判定。
     *
     * @param runner 宿主执行器
     * @param now 当前时间（测试注入）
     * @returns 本轮执行结果（含 SKIPPED）
     */
    runDueTasks(runner: LongTaskRunner, now?: Date): LongTaskRun[] {
      const registry = loadLongTaskRegistry(projectDir);
      const results: LongTaskRun[] = [];

      for (const spec of registry.tasks) {
        if (spec.status === 'paused') continue;

        const current = now ?? new Date();
        // 到期判定：首次出现（内存无 lastStatus = 本进程未跑过）或 nextRun ≤ now
        const firstRunInProcess = !state.lastStatus.has(spec.name);
        const schedTask = firstRunInProcess ? ensureSchedulerTask(spec) : (() => {
          const t = ensureSchedulerTask(spec);
          return t;
        })();
        if (!schedTask) continue;
        const due = firstRunInProcess || (schedTask.nextRun ? new Date(schedTask.nextRun) <= current : true);
        if (!due) continue;

        const run = runTask(spec, runner, current);

        // 滚动 nextRun：基础 cron 下一跳 × backoff 倍率（waiting 累积拉长）
        const finishedAt = run.finishedAt ?? current.toISOString();
        const baseNext = nextCronTime(expandScheduleMacro(spec.schedule), new Date(finishedAt));
        const multiplier = spec.backoffOnWait ? (state.backoffMultiplier.get(spec.name) ?? 1) : 1;
        const nextRun = multiplier > 1
          ? new Date(new Date(finishedAt).getTime() + (new Date(baseNext).getTime() - new Date(finishedAt).getTime()) * multiplier).toISOString()
          : baseNext;
        scheduler.update(schedTask.id, { nextRun });

        results.push(run);
      }
      return results;
    },

    /** 查任务当前 backoff 倍率（观测出口——1=原间隔） */
    backoffOf(taskName: string): number {
      return state.backoffMultiplier.get(taskName) ?? 1;
    },

    /** 查任务最近一次状态（依赖图判据可观测） */
    lastStatusOf(taskName: string): LongTaskRunStatus | undefined {
      return state.lastStatus.get(taskName);
    },

    /** 长任务 run 历史（LongTaskRun 结构） */
    history(taskName: string): LongTaskRun[] {
      return loadRunHistory(taskName);
    },

    /** 内部 scheduler 句柄（高级用法——daemon 直接操作 nextRun/status） */
    _scheduler: scheduler,
  };
}
