// ============================================================
// ab-scheduler.ts · daemon A/B 自动调度器（真实任务探索-利用状态机）
// v1.3.5 新增
// ============================================================
//
// 交付二（daemon A/B 自动调度器）的核心——四阶段状态机：
//
//   利用（exploit）  candidatePlan === null && currentRunCount < threshold
//                    → 当前方案跑真实任务，指标追加 ab-history.jsonl，
//                      currentRunCount++
//   探索启动         currentRunCount >= threshold
//                    → candidatePlan = exploreCandidates.shift()，
//                      candidateRunCount = 0，lastPhase = 'explore'
//   探索累积（explore）candidatePlan !== null && candidateRunCount < threshold
//                    → 候选方案跑真实任务，指标追加，candidateRunCount++
//   判定（judge）     candidateRunCount >= threshold
//                    → aggregateRecent(current) vs aggregateRecent(candidate)
//                      对比 avgPassRate：候选更好 → consecutiveWins++，
//                      达 promoteThreshold（默认 2，对齐 v1.1.8
//                      orchestrator-compare.ts CONSECUTIVE_WINS_REQUIRED）
//                      → promote（旧 currentPlan 回 exploreCandidates 队尾，
//                      consecutiveWins = 0，并调 writeControlGraphState 联动
//                      交付三）；未达阈值 → 换下一个候选
//
// 与 v1.1.8 ab-test 包的语义划界（架构设计 §7.6）：
//   ab-test = 评估集驱动的 Skill 文件对比（EvalBreakdown 评分）；
//   本模块 = 真实任务驱动的编排拆解策略调度（ComposeVariant A/B/C/D），
//   跑的是企业真实日常任务（cron task 字段描述的业务），不是专为
//   A/B 造的测试任务——两个方案都产生业务价值。
//
// 持久化：
//   状态机 → {SOFAGENT_DATA}/ab-scheduler-state.json（原子写，重启恢复）
//   指标   → {SOFAGENT_DATA}/ab-history.jsonl（ab-history.ts 模块）
//
// 依赖注入：runABScheduledTask 第三参 deps 可注入 composeFn / runDagFn /
//   collectMetricsFn / writeGraphStateFn——测试零网络零 LLM 全链路 mock；
//   生产缺省走 composer.compose → dag-runner.runDAG →
//   orchestrator-compare.extractMetrics 真实链路。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { randomBytes } from 'crypto';
import { loadEnvConfig } from '@sofagent/core';
import { compose, type ComposeVariant } from './composer';
import { runDAG, type DAGResult } from './dag-runner';
import { extractMetrics } from './orchestrator-compare';
import {
  appendMetrics,
  aggregateRecent,
  type PlanMetrics,
} from './ab-history';
import { writeControlGraphState } from './loop-state-extractor';

// ============================================================
// 类型定义
// ============================================================

/** 状态机阶段 */
export type ABPhase = 'exploit' | 'explore' | 'judge' | 'idle';

/**
 * A/B 调度器状态机（持久化到 ab-scheduler-state.json）
 */
export interface ABSchedulerState {
  /** 当前方案（拆解策略变体 ID，如 "A-step-by-step"） */
  currentPlan: string;
  /** 候选方案（探索阶段非空，利用阶段为 null） */
  candidatePlan: string | null;
  /** 当前方案累计运行次数（达到 threshold 触发探索） */
  currentRunCount: number;
  /** 候选方案累计运行次数（达到 threshold 触发判定） */
  candidateRunCount: number;
  /** 单方案运行阈值（默认 10，cron config.threshold 可配） */
  threshold: number;
  /** 待探索候选队列（promote 时旧 currentPlan 回队尾） */
  exploreCandidates: string[];
  /** 候选方案连续胜出次数（达 promoteThreshold 触发 promote） */
  consecutiveWins: number;
  /** promote 阈值（默认 2，对齐 CONSECUTIVE_WINS_REQUIRED） */
  promoteThreshold: number;
  /** 最近一次执行的阶段 */
  lastPhase: ABPhase;
  /** 状态最后更新时间（ISO） */
  updatedAt: string;
}

/** cron 注入的调度配置（全部可选，有默认值） */
export interface ABScheduleConfig {
  /** 单方案运行阈值 N（默认 DEFAULT_THRESHOLD=10；初期建议 5 降低试错成本） */
  threshold?: number;
  /** 探索候选队列（默认 DEFAULT_EXPLORE_CANDIDATES） */
  variants?: string[];
  /** promote 所需连续胜出次数（默认 DEFAULT_PROMOTE_THRESHOLD=2） */
  promoteThreshold?: number;
  /** 真实任务描述（cron job.task；空串时仅推进状态机不跑任务——纯调度 tick） */
  task?: string;
}

/** 运行指标采集结果（单次运行 → PlanMetrics 的输入） */
export interface RunOutcome {
  passed: number;
  failed: number;
  /** 耗时（毫秒） */
  duration: number;
  /** 质量分（0-100；缺省 = passed/(passed+failed)*100，对齐 U4 firstPassRate 语义） */
  qualityScore?: number;
  /** 失败模式标签（可选，failureClusters 聚类用） */
  failureTag?: string;
}

/** 可注入依赖（测试 mock 入口；生产全缺省走真实链路） */
export interface ABSchedulerDeps {
  /**
   * 执行一次真实任务并采集指标。
   * 入参：方案 ID + 任务描述；返回 RunOutcome。
   * 缺省 = executePlanDefault（compose → runDAG → extractMetrics 真实链）。
   */
  executePlan?: (plan: string, task: string) => Promise<RunOutcome>;
  /** 判定后联动交付三的控制图状态落盘（默认 writeControlGraphState） */
  writeGraphState?: (loopId: string) => string;
  /** 当前时间（测试可固定；默认 new Date().toISOString()） */
  now?: () => string;
}

// ============================================================
// 常量
// ============================================================

/** 单方案运行阈值默认值（cron config.threshold 可覆盖） */
export const DEFAULT_THRESHOLD = 10;

/** promote 连续胜出阈值（对齐 v1.1.8 orchestrator-compare.ts CONSECUTIVE_WINS_REQUIRED） */
export const DEFAULT_PROMOTE_THRESHOLD = 2;

/** 默认探索候选队列（ComposeVariant B/C/D——A 为默认当前方案） */
export const DEFAULT_EXPLORE_CANDIDATES: readonly string[] = [
  'B-domain',
  'C-risk',
  'D-tdd',
];

/** 默认当前方案（A 步骤拆解，v1.1.8 compose 默认策略） */
export const DEFAULT_CURRENT_PLAN = 'A-step-by-step';

/** 方案 ID → ComposeVariant 首字母映射（"B-domain" → "B"） */
export function planToVariant(plan: string): ComposeVariant {
  const first = plan.trim().charAt(0).toUpperCase();
  if (first === 'A' || first === 'B' || first === 'C' || first === 'D') return first;
  return 'A';
}

// ============================================================
// 状态持久化（原子写 + 损坏回退默认）
// ============================================================

/** statePath 缺省解析：{SOFAGENT_DATA}/ab-scheduler-state.json（便携化指向 U 盘） */
export function resolveStatePath(statePath?: string): string {
  const resolvedPath = statePath ?? join(loadEnvConfig().dataDir, 'ab-scheduler-state.json');
  // 缺省路径必须仍位于 dataDir 内（防御 dataDir 被污染时的路径穿越）
  if (statePath === undefined) {
    assertWithinDataDir(resolvedPath, 'ab-scheduler-state.json');
  }
  return resolvedPath;
}

/** historyPath 缺省解析：{SOFAGENT_DATA}/ab-test/scheduler-history.jsonl（v1.2.4 规范化路径，含自动迁移） */
export function resolveHistoryPath(historyPath?: string): string {
  // 显式传入的路径直接返回（调用方负责路径安全）
  if (historyPath !== undefined) {
    return historyPath;
  }

  // 新路径：data/ab-test/scheduler-history.jsonl
  const newDataDir = loadEnvConfig().dataDir;
  const newPath = join(newDataDir, 'ab-test', 'scheduler-history.jsonl');
  assertWithinDataDir(newPath, 'ab-history.jsonl');

  // 旧路径：data/ab-history.jsonl（自动迁移）
  const oldPath = join(newDataDir, 'ab-history.jsonl');

  // 自动迁移：新路径不存在但旧路径存在 → rename
  if (!existsSync(newPath) && existsSync(oldPath)) {
    const targetDir = dirname(newPath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    renameSync(oldPath, newPath);
  }

  return newPath;
}

/** 路径穿越断言：filePath 解析后必须仍位于 dataDir 内，否则抛错 */
function assertWithinDataDir(filePath: string, label: string): void {
  const dataDir = loadEnvConfig().dataDir;
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(dataDir) + sep)) {
    throw new Error(`路径穿越检测：${label} 解析后越出 dataDir`);
  }
}

/** 构造初始状态（config 注入阈值与候选队列） */
export function initialState(config: ABScheduleConfig = {}, now: string = new Date().toISOString()): ABSchedulerState {
  return {
    currentPlan: DEFAULT_CURRENT_PLAN,
    candidatePlan: null,
    currentRunCount: 0,
    candidateRunCount: 0,
    threshold: config.threshold ?? DEFAULT_THRESHOLD,
    exploreCandidates: [...(config.variants ?? DEFAULT_EXPLORE_CANDIDATES)],
    consecutiveWins: 0,
    promoteThreshold: config.promoteThreshold ?? DEFAULT_PROMOTE_THRESHOLD,
    lastPhase: 'idle',
    updatedAt: now,
  };
}

/**
 * 加载状态机。文件不存在 → 按 config 构造初始状态；
 * 文件损坏 → 回退初始状态（best-effort，不阻塞 cron）。
 * config 中的 threshold / variants / promoteThreshold 作为缺省补齐
 * （已持久化的运行计数字段不被 config 覆盖）。
 */
export function loadState(statePath: string, config: ABScheduleConfig = {}): ABSchedulerState {
  const base = initialState(config);
  if (!existsSync(statePath)) return base;
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf-8')) as Partial<ABSchedulerState>;
    return {
      currentPlan: typeof raw.currentPlan === 'string' ? raw.currentPlan : base.currentPlan,
      candidatePlan: typeof raw.candidatePlan === 'string' ? raw.candidatePlan : null,
      currentRunCount: typeof raw.currentRunCount === 'number' ? raw.currentRunCount : 0,
      candidateRunCount: typeof raw.candidateRunCount === 'number' ? raw.candidateRunCount : 0,
      threshold: typeof raw.threshold === 'number' ? raw.threshold : base.threshold,
      exploreCandidates: Array.isArray(raw.exploreCandidates)
        ? raw.exploreCandidates.filter((c): c is string => typeof c === 'string')
        : base.exploreCandidates,
      consecutiveWins: typeof raw.consecutiveWins === 'number' ? raw.consecutiveWins : 0,
      promoteThreshold: typeof raw.promoteThreshold === 'number' ? raw.promoteThreshold : base.promoteThreshold,
      lastPhase:
        raw.lastPhase === 'exploit' || raw.lastPhase === 'explore' || raw.lastPhase === 'judge'
          ? raw.lastPhase
          : 'idle',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    };
  } catch {
    return base;
  }
}

/** 原子写状态（tmp + rename，EXDEV 降级 copy+unlink——沿用 checkpoint.ts 范式） */
export function saveState(statePath: string, state: ABSchedulerState): void {
  const dir = dirname(statePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${statePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  try {
    renameSync(tmp, statePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      copyFileSync(tmp, statePath);
      try { unlinkSync(tmp); } catch { /* 清理失败可忽略 */ }
    } else {
      throw err;
    }
  }
}

// ============================================================
// 状态机纯函数（不跑任务，只做状态转移判定）
// ============================================================

/**
 * 阈值判定：当前方案跑满 threshold 且探索队列非空 → 启动探索。
 * 幂等——已处于探索/判定阶段时不重复启动（返回原状态）。
 */
export function checkThreshold(state: ABSchedulerState, now: string = new Date().toISOString()): ABSchedulerState {
  if (state.candidatePlan !== null) return state;
  if (state.currentRunCount < state.threshold) return state;
  if (state.exploreCandidates.length === 0) return state;
  return startExploration(state, now);
}

/**
 * 探索启动：从 exploreCandidates 队首取候选方案，重置候选计数。
 * 队列为空时返回原状态（无候选可探索，继续利用）。
 */
export function startExploration(state: ABSchedulerState, now: string = new Date().toISOString()): ABSchedulerState {
  if (state.exploreCandidates.length === 0) return state;
  const [next, ...rest] = state.exploreCandidates;
  return {
    ...state,
    candidatePlan: next!,
    candidateRunCount: 0,
    exploreCandidates: rest,
    lastPhase: 'explore',
    updatedAt: now,
  };
}

/**
 * 判定 + promote：聚合 current vs candidate 最近 threshold 次指标，
 * 对比 avgPassRate：
 *   - 候选更好 → consecutiveWins++；达 promoteThreshold → promote：
 *     currentPlan = candidatePlan，旧 currentPlan 回 exploreCandidates 队尾，
 *     consecutiveWins = 0，candidatePlan 置 null（回利用阶段），
 *     并联动交付三 writeControlGraphState 落盘控制图状态。
 *   - 候选未胜出 → consecutiveWins = 0，换下一个候选
 *     （candidatePlan = exploreCandidates.shift()；队列空 → 回利用）。
 *
 * @param state        当前状态机
 * @param historyPath  ab-history.jsonl 路径
 * @param deps         writeGraphState 可注入（默认真实 writeControlGraphState）
 * @returns 更新后的状态机（不自动落盘——由 runABScheduledTask 统一 saveState）
 */
export async function judgeAndPromote(
  state: ABSchedulerState,
  historyPath: string,
  deps: Pick<ABSchedulerDeps, 'writeGraphState'> = {},
): Promise<ABSchedulerState> {
  const candidate = state.candidatePlan;
  if (candidate === null) return state;

  const currentAgg = aggregateRecent(historyPath, state.currentPlan, state.threshold);
  const candidateAgg = aggregateRecent(historyPath, candidate, state.threshold);

  const candidateWins = candidateAgg.avgPassRate > currentAgg.avgPassRate;
  const now = new Date().toISOString();
  const writeGraph = deps.writeGraphState ?? writeControlGraphState;

  if (candidateWins) {
    const wins = state.consecutiveWins + 1;
    if (wins >= state.promoteThreshold) {
      // promote：候选转正，旧当前方案回探索队尾
      const promoted: ABSchedulerState = {
        ...state,
        currentPlan: candidate,
        candidatePlan: null,
        currentRunCount: 0,
        candidateRunCount: 0,
        exploreCandidates: [...state.exploreCandidates, state.currentPlan],
        consecutiveWins: 0,
        lastPhase: 'judge',
        updatedAt: now,
      };
      // 联动交付三：promote 完成后落盘控制图状态（loopId = 新方案首次运行标识）
      try {
        writeGraph(`ab-promote-${candidate}-${now.replace(/[:.]/g, '-')}`);
      } catch {
        // 控制图落盘失败不阻塞 promote（best-effort）
      }
      return promoted;
    }
    // 连续胜出未达阈值——同一候选继续累积（重开一轮探索计数）
    return {
      ...state,
      candidateRunCount: 0,
      consecutiveWins: wins,
      lastPhase: 'judge',
      updatedAt: now,
    };
  }

  // 候选未胜出——连胜清零，换下一个候选；队列空则回利用阶段
  const [next, ...rest] = state.exploreCandidates;
  return {
    ...state,
    candidatePlan: next ?? null,
    candidateRunCount: 0,
    // 回利用阶段时重置 currentRunCount，让转正方案重新累积
    currentRunCount: next === undefined ? 0 : state.currentRunCount,
    exploreCandidates: rest,
    consecutiveWins: 0,
    lastPhase: 'judge',
    updatedAt: now,
  };
}

// ============================================================
// 单次真实任务执行（默认链路：compose → runDAG → extractMetrics）
// ============================================================

/**
 * 默认执行链：按方案 ID 映射 ComposeVariant → compose 拆解 →
 * runDAG 执行真实任务 → 从 Sub Agent 日志目录 extractMetrics 提取
 * PASS/FAIL/首次通过率。
 *
 * 失败（compose 不可用 / runDAG 抛错）不抛出——降级为
 * RunOutcome{passed:0, failed:1, failureTag:'execute-error'}，
 * 让调度器把失败如实记入历史而不是中断 cron。
 */
async function executePlanDefault(plan: string, task: string): Promise<RunOutcome> {
  const startedAt = Date.now();
  const variant = planToVariant(plan);
  try {
    const composeResult = await compose({ taskDesc: task, variant });
    if (!composeResult) {
      return {
        passed: 0,
        failed: 1,
        duration: Date.now() - startedAt,
        qualityScore: 0,
        failureTag: 'compose-unavailable',
      };
    }
    const dagResult: DAGResult = await runDAG(task, composeResult.yaml, process.cwd());
    // 从 Sub Agent 日志目录提取指标（SOFAGENT_DATA/task/logs）
    const logDir = join(loadEnvConfig().dataDir, 'task', 'logs');
    const metric = extractMetrics(logDir);
    const total = metric.firstPassRate; // U4：qualityScore 语义 = 首次通过率
    void dagResult; // DAGResult.subagentCount/warnings 已落日志，指标以日志为准
    return {
      passed: Math.round((total / 100) * Math.max(1, metric.runCount)),
      failed: Math.max(1, metric.runCount) - Math.round((total / 100) * Math.max(1, metric.runCount)),
      duration: Date.now() - startedAt,
      qualityScore: total,
      failureTag: metric.auditViolations > 0 ? 'audit-FAIL' : undefined,
    };
  } catch {
    return {
      passed: 0,
      failed: 1,
      duration: Date.now() - startedAt,
      qualityScore: 0,
      failureTag: 'execute-error',
    };
  }
}

// ============================================================
// 主入口：cron 每 tick 调用一次
// ============================================================

/**
 * A/B 调度主入口——cron `task: 'ab-schedule'` 分支每次触发调用。
 *
 * 一次调用推进一步状态机（利用跑一轮 / 探索跑一轮 / 判定一次），
 * 执行完毕 saveState 落盘后返回更新后的状态。
 *
 * @param statePath   状态机 JSON 路径（缺省 {SOFAGENT_DATA}/ab-scheduler-state.json）
 * @param config      cron config 注入（threshold / variants / promoteThreshold / task）
 * @param deps        测试 mock 入口（executePlan / writeGraphState / now）
 * @param historyPath 指标 jsonl 路径（缺省 {SOFAGENT_DATA}/ab-history.jsonl）
 */
export async function runABScheduledTask(
  statePath?: string,
  config: ABScheduleConfig = {},
  deps: ABSchedulerDeps = {},
  historyPath?: string,
): Promise<ABSchedulerState> {
  const resolvedStatePath = resolveStatePath(statePath);
  const resolvedHistoryPath = resolveHistoryPath(historyPath);
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const execute = deps.executePlan ?? executePlanDefault;

  let state = loadState(resolvedStatePath, config);
  // config 变更生效：threshold / promoteThreshold 以 cron 最新配置为准
  state = {
    ...state,
    threshold: config.threshold ?? state.threshold,
    promoteThreshold: config.promoteThreshold ?? state.promoteThreshold,
  };
  const task = config.task ?? '';

  // ── 阶段路由 ──
  if (state.candidatePlan === null && state.currentRunCount >= state.threshold) {
    // 利用已满 → 探索启动（本 tick 只转移状态，下个 tick 开始跑候选）
    state = checkThreshold(state, now);
    if (state.candidatePlan === null) {
      // 探索队列空——重置利用计数继续跑当前方案
      state = { ...state, currentRunCount: 0, lastPhase: 'exploit', updatedAt: now };
    }
    saveState(resolvedStatePath, state);
    return state;
  }

  if (state.candidatePlan !== null && state.candidateRunCount >= state.threshold) {
    // 探索已满 → 判定 + 可能 promote
    state = await judgeAndPromote(state, resolvedHistoryPath, deps);
    saveState(resolvedStatePath, state);
    return state;
  }

  // 利用 / 探索累积：跑一次真实任务并记录指标
  const activePlan = state.candidatePlan ?? state.currentPlan;
  if (task.length > 0) {
    const outcome = await execute(activePlan, task);
    const total = outcome.passed + outcome.failed;
    const metrics: PlanMetrics = {
      plan: activePlan,
      task,
      timestamp: now,
      passed: outcome.passed,
      failed: outcome.failed,
      duration: outcome.duration,
      qualityScore:
        outcome.qualityScore ?? (total > 0 ? Math.round((outcome.passed / total) * 100) : 0),
      failureTag: outcome.failureTag,
    };
    appendMetrics(resolvedHistoryPath, metrics);
  }

  if (state.candidatePlan !== null) {
    state = { ...state, candidateRunCount: state.candidateRunCount + 1, lastPhase: 'explore', updatedAt: now };
  } else {
    state = { ...state, currentRunCount: state.currentRunCount + 1, lastPhase: 'exploit', updatedAt: now };
  }

  saveState(resolvedStatePath, state);
  return state;
}
