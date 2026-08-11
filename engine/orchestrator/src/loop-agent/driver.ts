// ============================================================
// loop-agent/driver.ts · Onboard Agent L1 循环驱动（v1.3.2 交付 8）
// ============================================================
//
// L1 = 半自动，工程级判定循环：
//   activate（准备运行上下文）→ run（执行 Agent，复用 dag-runner）
//   → judge（crash/error/超时三态，不判对错）→ fix（给人工/自动修复
//   反馈）→ re-run（带反馈重跑）→ 直到不崩或达最大轮数。
//
// 边界：L1 不判语义对错（那是 L2-L5 的事，v1.3.2 交付）。
//
// 交付 12 联动：runner 抛异常 → convergeToolError 收敛为结构化消息
//   （不中断循环——工具失败转 error 判定，进入 fix）。
// 交付 11 联动：默认 fixer 读 llm-call-trace（按 taskId 过滤）定位失败。
// 交付 6/7 协同：调试记录带 agentId（跨设备审计聚合可追溯）。
//
// 零新依赖——复用 dag-runner / @sofagent/core / @sofagent/think 等既有包。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { loadEnvConfig, convergeToolError } from '@sofagent/core';
import {
  judgeRunResult,
  type JudgeOptions,
  type JudgeState,
  type JudgeVerdict,
  type RunOutcome,
} from './judge';
import type { LlmCallRecord } from '@sofagent/core';
import type { DiffReport } from './diff-report';
import type { LocalizationResult } from './error-localizer';
import type { FixApplyResult } from './fix-applier';

/** 调试记录默认相对路径：{dataDir}/audit/runtime/loop-debug.jsonl */
export const LOOP_DEBUG_LOG_REL = 'audit/runtime/loop-debug.jsonl';

/** 调试记录（带 agentId——交付 6/7 协同） */
export interface LoopDebugRecord {
  /** ISO 8601 时间戳 */
  ts: string;
  /** Agent 身份码（交付 6 身份码协同） */
  agentId?: string;
  /** 任务 ID（交付 11 Trace 关联键） */
  taskId: string;
  /** 轮次 */
  round: number;
  /** 判定状态 */
  state: JudgeState;
  /** 判定理由 */
  detail: string;
  /** 本轮耗时（ms） */
  durationMs?: number;
}

/** 单轮运行结果（判定输入） */
export interface OnboardRunOutcome extends RunOutcome {
  /** 产出文本（成功时的输出摘要） */
  output?: string;
}

/** 修复反馈——下一轮任务的前置上下文 */
export interface FixFeedback {
  /** 反馈文本（追加到任务描述前） */
  feedback: string;
}

/** OnboardDriver 选项 */
export interface OnboardDriverOptions {
  /** Agent 身份码（交付 6 协同；写入调试记录） */
  agentId?: string;
  /** 任务 ID（缺省自动生成） */
  taskId?: string;
  /** 最大循环轮数（默认 3——activate+run+judge+fix+re-run） */
  maxRounds?: number;
  /** 超时阈值（ms，默认 120_000；透传 judge） */
  timeoutMs?: number;
  /**
   * 运行器（可注入 mock——测试不调 LLM）。
   * 默认 dagRunnerAdapter：runDAG 单节点 workflow 执行。
   * 抛异常由驱动收敛为 error（交付 12 联动，不中断循环）。
   */
  runner?: (task: string, round: number) => Promise<OnboardRunOutcome>;
  /** 判定器（可注入 mock；默认 judgeRunResult） */
  judge?: (outcome: OnboardRunOutcome, options: JudgeOptions) => JudgeVerdict;
  /**
   * 修复反馈器（可注入 mock；默认读 llm-call-trace 定位失败——交付 11 联动）。
   * 返回下一轮任务前追加的修复反馈文本。
   */
  fixer?: (task: string, outcome: OnboardRunOutcome, verdict: JudgeVerdict) => Promise<string>;
  /** 调试记录文件路径（默认 {dataDir}/audit/runtime/loop-debug.jsonl；可覆盖测试隔离） */
  debugLogPath?: string;
  /** 日志输出 */
  log?: (msg: string) => void;
  /** v1.3.2 交付 4：L5 收敛参数 */
  l5Config?: L5ConvergenceConfig;
  /** v1.3.2 交付 1：L2 语义判定器（可注入 mock；默认 null = 跳过 L2） */
  l2Judge?: (outcome: OnboardRunOutcome, taskId: string) => Promise<DiffReport>;
  /** v1.3.2 交付 2：L3 定位器（可注入 mock；L2 有差异时调用） */
  l3Localizer?: (diffReport: DiffReport) => Promise<LocalizationResult>;
  /** v1.3.2 交付 3：L4 修复器（可注入 mock；L3 定位后调用） */
  l4Fixer?: (localization: LocalizationResult, diffReport: DiffReport) => Promise<FixApplyResult>;
}

/** 单轮记录 */
export interface OnboardRound {
  /** 轮次（1-based） */
  round: number;
  /** 本轮任务描述（含历史修复反馈前缀） */
  task: string;
  /** 本轮运行产出 */
  outcome: OnboardRunOutcome;
  /** 本轮判定 */
  verdict: JudgeVerdict;
  /** 修复反馈（非末轮时存在） */
  fixFeedback?: string;
  /** v1.3.2 交付 1：L2 语义判定差异报告 */
  diffReport?: DiffReport;
  /** v1.3.2 交付 2：L3 定位结果 */
  localization?: LocalizationResult;
  /** v1.3.2 交付 3：L4 修复结果 */
  fixResult?: FixApplyResult;
}

/** 循环结果 */
export interface OnboardLoopResult {
  /** 任务 ID */
  taskId: string;
  /** Agent 身份码（可选） */
  agentId?: string;
  /** 各轮记录 */
  rounds: OnboardRound[];
  /** 最终判定（passed / crash / error / timeout） */
  finalState: JudgeState;
  /** 总耗时（ms） */
  totalDurationMs: number;
  /** v1.3.2 交付 4：L5 收敛状态 */
  convergence?: ConvergenceState;
}

/** v1.3.2 交付 4：L5 收敛状态 */
export type ConvergenceState = 'converged' | 'diverged' | 'max-rounds';

/** v1.3.2 交付 4：L5 收敛判定参数 */
export interface L5ConvergenceConfig {
  /** 连续 N 轮 L1 crash-free 且 L2 无差异 → 判收敛（默认 3） */
  convergeThreshold?: number;
  /** 连续 M 轮 L4 改了仍 FAIL → 判发散（默认 5） */
  divergeThreshold?: number;
}

/** 默认收敛参数 */
export const DEFAULT_L5_CONFIG: Required<L5ConvergenceConfig> = {
  convergeThreshold: 3,
  divergeThreshold: 5,
};

/** 解析默认调试记录路径（SOFAGENT_HOME 可覆盖——测试隔离） */
export function resolveLoopDebugLogPath(dataDir?: string, override?: string): string {
  if (override) return override;
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, LOOP_DEBUG_LOG_REL);
}

/**
 * 追加一条调试记录（append-only JSONL，带 agentId）。
 * 容错：写盘失败仅告警（调试记录是辅助追溯，不阻断循环）。
 */
export function appendLoopDebugRecord(record: LoopDebugRecord, filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch {
    // 调试记录写入失败静默
  }
}

/** 读取调试记录（可按 taskId / agentId 过滤） */
export function readLoopDebugRecords(
  filePath: string,
  filter: { taskId?: string; agentId?: string } = {},
): LoopDebugRecord[] {
  if (!existsSync(filePath)) return [];
  const records: LoopDebugRecord[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const r = JSON.parse(trimmed) as LoopDebugRecord;
      if (filter.taskId !== undefined && r.taskId !== filter.taskId) continue;
      if (filter.agentId !== undefined && r.agentId !== filter.agentId) continue;
      records.push(r);
    } catch {
      // 坏行跳过
    }
  }
  return records;
}

/**
 * 默认运行器——dag-runner 适配器（交付 8 复用 dag-runner）。
 *
 * 把任务封装为单节点 workflow，调 runDAG 执行。runDAG 不可用
 * （无 LLM 配置 / createReactAgent 缺失）时抛错——由驱动用
 * convergeToolError 收敛为 error 判定（不中断循环）。
 */
export async function defaultDagRunner(task: string, round: number): Promise<OnboardRunOutcome> {
  const startedAt = Date.now();
  const { runDAG } = await import('../dag-runner');
  const workflowYaml = [
    'name: onboard-l1',
    'nodes:',
    `  - id: run-${round}`,
    '    agent: engineer',
    '    task: |',
    `      ${task.replace(/\n/g, '\n      ')}`,
    '    depends_on: []',
  ].join('\n');
  const result = await runDAG(task, workflowYaml);
  return {
    exitCode: 0,
    output: typeof result.finalOutput === 'string' ? result.finalOutput : JSON.stringify(result.finalOutput),
    stdout: typeof result.finalOutput === 'string' ? result.finalOutput : '',
    durationMs: Date.now() - startedAt,
  };
}

/**
 * 默认修复反馈器——读 llm-call-trace 定位失败（交付 11 联动）。
 *
 * 按 taskId 过滤调用 Trace，把最近失败调用（stopReason 非 completed）
 * 的错误信息拼成修复反馈；无 Trace 时给通用修复建议。
 */
export async function defaultTraceFixer(
  task: string,
  outcome: OnboardRunOutcome,
  verdict: JudgeVerdict,
  taskId: string,
): Promise<string> {
  void outcome;
  let traceLines = '';
  try {
    const { readLlmCallTrace } = await import('@sofagent/core');
    const records: LlmCallRecord[] = readLlmCallTrace({ taskId });
    const failures = records.filter((r) => r.stopReason !== 'completed' && r.stopReason !== '');
    if (failures.length > 0) {
      traceLines = failures
        .slice(-3)
        .map((r) => `- ${r.stopReason}@${r.model}: ${r.error ?? '无错误信息'}`)
        .join('\n');
    }
  } catch {
    // Trace 读取失败——走通用反馈
  }

  const head = traceLines
    ? `## 修复指引（LLM 调用 Trace 定位，taskId=${taskId}）\n以下调用失败，请针对性修复：\n${traceLines}`
    : `## 修复指引\n运行判定为「${verdict.state}」：${verdict.detail}\n请检查进程配置/环境/依赖后重试。`;
  return `${head}\n\n---\n原始任务：\n${task}`;
}

/**
 * Onboard Agent L1 循环驱动——activate → run → judge → fix → re-run。
 *
 * @param task 初始任务描述
 * @param options 驱动选项（runner/judge/fixer 均可注入 mock）
 * @returns OnboardLoopResult
 */
export async function runOnboardLoop(
  task: string,
  options: OnboardDriverOptions = {},
): Promise<OnboardLoopResult> {
  const maxRounds = options.maxRounds ?? 3;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const agentId = options.agentId;
  const taskId = options.taskId ?? `onboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const log = options.log ?? (() => {});
  const runner = options.runner ?? defaultDagRunner;
  const judge = options.judge ?? judgeRunResult;
  const fixer =
    options.fixer ??
    (async (t: string, o: OnboardRunOutcome, v: JudgeVerdict) =>
      defaultTraceFixer(t, o, v, taskId));
  const debugLogPath = resolveLoopDebugLogPath(undefined, options.debugLogPath);
  const l5Config = { ...DEFAULT_L5_CONFIG, ...options.l5Config };
  const l2Judge = options.l2Judge;
  const l3Localizer = options.l3Localizer;
  const l4Fixer = options.l4Fixer;

  const startedAt = Date.now();
  const rounds: OnboardRound[] = [];
  let currentTask = task;

  // v1.3.2 交付 4：L5 收敛追踪
  let consecutivePassCount = 0;
  let consecutiveFailAfterFixCount = 0;
  let convergenceState: ConvergenceState | undefined;

  log(`🚀 Onboard L1 启动 · taskId=${taskId}${agentId ? ` · agentId=${agentId}` : ''}`);

  // activate：写首条调试记录（运行上下文就绪）
  appendLoopDebugRecord({
    ts: new Date().toISOString(),
    agentId,
    taskId,
    round: 0,
    state: 'passed',
    detail: 'activate：循环启动',
  }, debugLogPath);

  for (let round = 1; round <= maxRounds; round++) {
    log(`🔁 第 ${round}/${maxRounds} 轮 · run`);
    let outcome: OnboardRunOutcome;
    try {
      outcome = await runner(currentTask, round);
    } catch (err) {
      // 交付 12 联动：工具失败收敛为结构化消息（不中断循环）
      const converged = convergeToolError(`onboard-run-${round}`, err);
      outcome = {
        exitCode: 1,
        stderr: `${converged.status}: ${converged.error}`,
        durationMs: Date.now() - startedAt,
        output: converged.suggestion,
      };
      log(`⚠️ 第 ${round} 轮 runner 异常已收敛：${converged.error}`);
    }

    const verdict = judge(outcome, { timeoutMs });
    log(`🧭 第 ${round} 轮 L1 判定：${verdict.state}（${verdict.detail.slice(0, 80)}）`);

    // 写调试记录（带 agentId——交付 6/7 协同）
    appendLoopDebugRecord({
      ts: new Date().toISOString(),
      agentId,
      taskId,
      round,
      state: verdict.state,
      detail: verdict.detail,
      durationMs: verdict.durationMs ?? outcome.durationMs,
    }, debugLogPath);

    // v1.3.2 交付 1：L2 语义判定（L1 passed 时才判语义对错）
    let diffReport: DiffReport | undefined;
    let localization: LocalizationResult | undefined;
    let fixResult: FixApplyResult | undefined;

    const l1Passed = verdict.state === 'passed';

    if (l1Passed && l2Judge) {
      diffReport = await l2Judge(outcome, taskId);
      log(`🔬 第 ${round} 轮 L2 语义判定：${diffReport.mismatches.length} 条差异`);

      if (diffReport.mismatches.length > 0) {
        // L2 有差异 → L3 定位 → L4 修复
        if (l3Localizer) {
          localization = await l3Localizer(diffReport);
          log(`🔍 第 ${round} 轮 L3 定位：${localization.errorSource}（置信度 ${localization.confidence}）`);
        }
        if (l4Fixer && localization) {
          fixResult = await l4Fixer(localization, diffReport);
          log(`🔧 第 ${round} 轮 L4 修复：${fixResult.applied ? '审计通过' : '审计拦截已回滚'}`);
        }
      }
    }

    // v1.3.2 交付 4：L5 收敛判定
    // FAIL 定义：L1 crash/error/timeout 或 L2 有 mismatch
    const l2Failed = diffReport ? diffReport.mismatches.length > 0 : false;
    const roundFailed = !l1Passed || l2Failed;
    const l4Applied = fixResult?.applied === true;

    // 无 L2 时保持 v1.3.1 L1 原始行为（passed → 立即 break）
    if (!l2Judge && l1Passed) {
      rounds.push({ round, task: currentTask, outcome, verdict });
      break;
    }

    // 有 L2 时走 L5 收敛/发散逻辑
    if (!roundFailed) {
      // L1 crash-free 且 L2 无差异 → 连续 PASS 计数
      consecutivePassCount++;
      consecutiveFailAfterFixCount = 0;
      if (consecutivePassCount >= l5Config.convergeThreshold) {
        convergenceState = 'converged';
        rounds.push({ round, task: currentTask, outcome, verdict, diffReport, localization, fixResult });
        log(`✅ L5 收敛：连续 ${consecutivePassCount} 轮 L1 crash-free 且 L2 无差异`);
        break;
      }
    } else {
      consecutivePassCount = 0;
      // L4 改了仍 FAIL → 发散计数
      if (l4Applied || (!l1Passed && round > 1)) {
        consecutiveFailAfterFixCount++;
        if (consecutiveFailAfterFixCount >= l5Config.divergeThreshold) {
          convergenceState = 'diverged';
          rounds.push({ round, task: currentTask, outcome, verdict, diffReport, localization, fixResult });
          log(`⚠️ L5 发散：连续 ${consecutiveFailAfterFixCount} 轮 L4 改了仍 FAIL，报人`);
          break;
        }
      }
    }

    // passed（L1 + L2 都通过）但未达收敛阈值 → 继续
    if (!roundFailed) {
      rounds.push({ round, task: currentTask, outcome, verdict, diffReport, localization, fixResult });
      if (round >= maxRounds) {
        convergenceState = convergenceState ?? 'max-rounds';
        break;
      }
      continue;
    }

    let fixFeedback: string | undefined;
    if (round < maxRounds) {
      fixFeedback = await fixer(currentTask, outcome, verdict);
      rounds.push({ round, task: currentTask, outcome, verdict, fixFeedback, diffReport, localization, fixResult });
      currentTask = fixFeedback;
      log(`🛠️ 第 ${round} 轮修复反馈已生成，re-run`);
    } else {
      // 达最大轮数仍失败——不再 fix
      convergenceState = convergenceState ?? 'max-rounds';
      rounds.push({ round, task: currentTask, outcome, verdict, diffReport, localization, fixResult });
      log(`⛔ 达最大轮数 ${maxRounds}，循环停止（finalState=${verdict.state}）`);
    }
  }

  const finalState = rounds[rounds.length - 1]?.verdict.state ?? 'error';
  log(`🏁 Onboard 结束 · finalState=${finalState} · convergence=${convergenceState ?? 'n/a'} · 共 ${rounds.length} 轮`);
  return {
    taskId,
    agentId,
    rounds,
    finalState,
    totalDurationMs: Date.now() - startedAt,
    ...(convergenceState ? { convergence: convergenceState } : {}),
  };
}
