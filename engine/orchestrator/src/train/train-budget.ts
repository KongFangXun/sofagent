// train-budget.ts · v1.3.6 交付⑦ · 训练预算控制（成本透明 · train-job 横切能力）
//
// 定位：训练是算力密集型长任务——企业交付要能设预算上限（时间 / 步数 /
// 估算算力成本），超预算自动暂停 + 人审。对齐「成本透明」产品原则 +
// 模型网关的预算控制模式。
//
// 与协议三约定（交付⑥）同源：
//   - 预算字段写入 job.json（协议①）
//   - 超预算通过 SIGINT 暂停（协议③——存 checkpoint 优雅退出）
//   - 预算事件进 stdout 流（协议②）
// 三者强耦合，同版交付后整条链路同源。

import type { TrainBudget } from './train-protocol.js';

/** 实际消耗（训练进度快照——从 stdout 事件流累计） */
export interface TrainUsage {
  /** 已耗时间（分钟） */
  elapsedMinutes: number;
  /** 已训练步数 */
  steps: number;
  /** 估算算力成本（与模型网关预算控制同口径） */
  cost: number;
}

/** 超限判定（哪个维度超 + 实际值/上限） */
export interface BudgetViolation {
  dimension: 'maxMinutes' | 'maxSteps' | 'maxCost';
  actual: number;
  limit: number;
}

/** 预算检查结论 */
export type BudgetCheckResult =
  | { within: true; usage: TrainUsage }
  | { within: false; usage: TrainUsage; violation: BudgetViolation };

/**
 * 检查预算是否超限（时间 / 步数 / 成本三维度，任一超即超）。
 * 预算未设的维度跳过（不设 = 不限制该维度）。
 */
export function checkBudget(budget: TrainBudget | undefined, usage: TrainUsage): BudgetCheckResult {
  if (!budget) {
    return { within: true, usage };
  }
  if (budget.maxMinutes != null && usage.elapsedMinutes > budget.maxMinutes) {
    return {
      within: false,
      usage,
      violation: { dimension: 'maxMinutes', actual: usage.elapsedMinutes, limit: budget.maxMinutes },
    };
  }
  if (budget.maxSteps != null && usage.steps > budget.maxSteps) {
    return {
      within: false,
      usage,
      violation: { dimension: 'maxSteps', actual: usage.steps, limit: budget.maxSteps },
    };
  }
  if (budget.maxCost != null && usage.cost > budget.maxCost) {
    return {
      within: false,
      usage,
      violation: { dimension: 'maxCost', actual: usage.cost, limit: budget.maxCost },
    };
  }
  return { within: true, usage };
}

// ════════════════════════════════════════
// 预算监控器（train-job 横切）
// ════════════════════════════════════════

/** 超预算暂停决策——人审前的挂起态 */
export interface BudgetPause {
  jobId: string;
  violation: BudgetViolation;
  /** 暂停时的实际消耗（报告快照） */
  usage: TrainUsage;
  /** 暂停时间（ISO） */
  pausedAt: string;
}

/** 人审决策：续跑 / 终止 */
export type BudgetHumanDecision = 'resume' | 'terminate';

/**
 * 训练预算监控器——从事件流累计消耗，超预算触发暂停。
 *
 * 生命周期（对齐协议三约定）：
 *   1. 消费 stdout 事件（协议②）→ 更新 usage
 *   2. 每次更新后 checkBudget → 超限触发暂停（SIGINT 存 checkpoint，协议③）
 *      + 记 train_budget_exceeded 审计（调用方接 emitDecision）
 *   3. 暂停挂起等人工决定「续跑 / 终止」
 */
export interface TrainBudgetMonitor {
  /** 喂入进度事件（step/loss/reward），更新累计消耗并重检预算 */
  feedProgress(input: { step: number; reward?: number }): BudgetCheckResult;
  /** 喂入时间流逝（分钟）——由控制面定时器驱动 */
  feedElapsed(minutes: number): BudgetCheckResult;
  /** 喂入成本增量 */
  feedCost(delta: number): BudgetCheckResult;
  /** 当前累计消耗 */
  usage(): TrainUsage;
  /** 是否处于暂停挂起态 */
  isPaused(): boolean;
  /** 暂停详情（未暂停返回 null） */
  pause(): BudgetPause | null;
  /**
   * 人审决策落地（续跑 / 终止）。
   * - resume：清除暂停态（续跑从 checkpoint 恢复，协议③）
   * - terminate：保持终止（监控器不再接收事件）
   * @returns false = 非暂停态调用（无效操作）
   */
  resolvePause(decision: BudgetHumanDecision): boolean;
}

export function createTrainBudgetMonitor(opts: {
  jobId: string;
  budget?: TrainBudget;
  /** 每步估算成本（成本维度累计——实际值由模型网关计费回填） */
  costPerStep?: number;
}): TrainBudgetMonitor {
  const { jobId, budget, costPerStep = 0 } = opts;
  let elapsedMinutes = 0;
  let steps = 0;
  let cost = 0;
  let paused: BudgetPause | null = null;
  let terminated = false;

  const usage = (): TrainUsage => ({ elapsedMinutes, steps, cost });

  const check = (): BudgetCheckResult => {
    if (terminated || paused) {
      // 已暂停/终止——不再重复触发，返回当前快照
      return { within: true, usage: usage() };
    }
    const result = checkBudget(budget, usage());
    if (!result.within) {
      paused = {
        jobId,
        violation: result.violation,
        usage: usage(),
        pausedAt: new Date().toISOString(),
      };
    }
    return result;
  };

  return {
    feedProgress(input) {
      if (terminated || paused) return { within: true, usage: usage() };
      steps = input.step;
      cost += costPerStep;
      return check();
    },
    feedElapsed(minutes) {
      if (terminated || paused) return { within: true, usage: usage() };
      elapsedMinutes = minutes;
      return check();
    },
    feedCost(delta) {
      if (terminated || paused) return { within: true, usage: usage() };
      cost += delta;
      return check();
    },
    usage,
    isPaused: () => paused !== null,
    pause: () => paused,
    resolvePause(decision) {
      if (!paused) return false; // 非暂停态——无效操作
      if (decision === 'resume') {
        paused = null; // 清除暂停态（续跑从 checkpoint 恢复）
        return true;
      }
      // terminate：保持终止态
      terminated = true;
      paused = null;
      return true;
    },
  };
}

// ════════════════════════════════════════
// 预算报告（成本透明）
// ════════════════════════════════════════

/** 预算报告（训练完成/暂停时报告实际消耗——写 evaluation-log 关联） */
export interface TrainBudgetReport {
  jobId: string;
  /** 预算配置（未设预算为 null） */
  budget: TrainBudget | null;
  /** 实际消耗 */
  usage: TrainUsage;
  /** 是否超预算暂停过 */
  exceeded: boolean;
  /** 超限维度（未超为空数组） */
  exceededDimensions: BudgetViolation['dimension'][];
  /** 生成时间（ISO） */
  generatedAt: string;
}

/**
 * 生成预算报告（完成/暂停时调用——成本透明）。
 * @param exceeded 本次运行是否触发过超预算暂停
 */
export function buildBudgetReport(opts: {
  jobId: string;
  budget?: TrainBudget;
  usage: TrainUsage;
  exceeded?: boolean;
}): TrainBudgetReport {
  const dimensions: BudgetViolation['dimension'][] = [];
  if (opts.budget && opts.exceeded) {
    const result = checkBudget(opts.budget, opts.usage);
    if (!result.within) dimensions.push(result.violation.dimension);
  }
  return {
    jobId: opts.jobId,
    budget: opts.budget ?? null,
    usage: opts.usage,
    exceeded: opts.exceeded ?? false,
    exceededDimensions: dimensions,
    generatedAt: new Date().toISOString(),
  };
}

// ════════════════════════════════════════
// 训练任务状态持久化（MCP tool 跨进程查预算 / 人审续跑）
// ════════════════════════════════════════

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

/** 训练任务状态（持久化——train/jobs.json） */
export interface TrainJobState {
  jobId: string;
  /** 生命周期状态 */
  status: 'running' | 'paused' | 'terminated' | 'done';
  budget?: TrainBudget;
  usage: TrainUsage;
  /** 超预算暂停详情（status=paused 时存在） */
  pause?: BudgetPause;
  updatedAt: string;
}

/** 训练任务状态文件路径（单一出口） */
export function trainJobsPath(dataDir: string): string {
  return join(dataDir, 'train', 'jobs.json');
}

/** 读取全量训练任务状态（坏数据降级空表） */
export function loadTrainJobs(dataDir: string): TrainJobState[] {
  const file = trainJobsPath(dataDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return Array.isArray(parsed) ? (parsed as TrainJobState[]) : [];
  } catch {
    return [];
  }
}

/** 原子写训练任务状态 */
export function saveTrainJobs(dataDir: string, jobs: TrainJobState[]): void {
  const file = trainJobsPath(dataDir);
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(jobs, null, 2), 'utf-8');
}

/**
 * 更新单个训练任务状态（upsert 语义——按 jobId 合并）。
 * @returns 更新后的任务状态
 */
export function upsertTrainJob(dataDir: string, job: TrainJobState): TrainJobState {
  const jobs = loadTrainJobs(dataDir);
  const idx = jobs.findIndex((j) => j.jobId === job.jobId);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  saveTrainJobs(dataDir, jobs);
  return job;
}

/** 按 jobId 查找训练任务状态 */
export function findTrainJob(dataDir: string, jobId: string): TrainJobState | null {
  return loadTrainJobs(dataDir).find((j) => j.jobId === jobId) ?? null;
}

// ════════════════════════════════════════
// 超预算审计留痕（train_budget_exceeded）
// ════════════════════════════════════════

/**
 * 记 train_budget_exceeded 审计事件（decision-log 留痕——对齐 model_register 模式）。
 * 超预算自动暂停时由控制面调用（SIGINT 存 checkpoint 之后）。
 */
export async function emitBudgetExceededAudit(pause: BudgetPause, dataDir?: string): Promise<void> {
  try {
    const audit = (await import('@sofagent/audit')) as unknown as {
      emitDecision: (input: Record<string, unknown>, dir?: string) => unknown;
    };
    audit.emitDecision(
      {
        agentId: 'sofagent-train-budget',
        sessionId: `train-budget-${pause.jobId}`,
        kind: 'CONFIG_CHANGE',
        moment: 'ACT',
        // v1.3.6 交付⑮：超预算暂停等人审 = 升级人工（判断时刻分类 escalate）
        category: 'escalate',
        why: `train_budget_exceeded：训练任务 ${pause.jobId} 超预算暂停（${pause.violation.dimension}：实际 ${pause.violation.actual} / 上限 ${pause.violation.limit}），等待人审续跑/终止`,
        evidence: [
          `dimension=${pause.violation.dimension}`,
          `actual=${pause.violation.actual}`,
          `limit=${pause.violation.limit}`,
        ],
      },
      dataDir,
    );
  } catch {
    // 留痕降级不阻塞（预算暂停本身已生效）
  }
}
