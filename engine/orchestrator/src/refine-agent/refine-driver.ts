// ============================================================
// refine-agent/refine-driver.ts · Refine 循环驱动（v1.3.7 交付 T04）
// ============================================================
//
// Refine Agent = "从能用到好用"——复用 loop-agent 引擎，换 L2 判据。
//
// 与 Onboard 的差异（协议设计 §7.1）：
//   |          | Onboard Agent（v1.4.0）       | Refine Agent（本版）          |
//   |----------|-------------------------------|-------------------------------|
//   | 目标     | 从「不能用」到「能用」        | 从「能用」到「好用」          |
//   | 判据     | Ontology 本体数据（对错）     | 质量规则集（好坏）            |
//   | FORGE    | release-gate-loop（发版门禁） | fresh-eyes-loop（新鲜眼审查） |
//   | 触发     | activate 后立即               | Onboard 收敛 PASS 后          |
//   | L1/L3/L4 | 自建                          | **复用 loop-agent 引擎**      |
//
// 复用策略：
//   - L1 judge：直接 import loop-agent/judge.ts 的 judgeRunResult
//   - L2 judge：注入 qualityJudge（替代 ontology-comparator）
//   - L3 localizer：直接 import loop-agent/error-localizer.ts 的 localizeError
//   - L4 fixer：直接 import loop-agent/fix-applier.ts 的 applyFix
//   - L5 收敛：直接复用 loop-agent/driver.ts 的 runOnboardLoop（注入 l2Judge）
//
// 这意味着 Refine 不重写循环骨架——它复用 runOnboardLoop，
// 只是把 l2Judge 换成 qualityJudge，把 fixer 换成 qualityFixer。
// ============================================================

import type { OnboardRunOutcome, OnboardDriverOptions, OnboardLoopResult } from '../loop-agent/driver';
import type { DiffReport } from '../loop-agent/diff-report';
import type { JudgeVerdict } from '../loop-agent/judge';
import type { LlmLocalizerDeps, LocalizationContext } from '../loop-agent/error-localizer';
import type { LlmFixerDeps, AuditGateDeps, FileOpsDeps } from '../loop-agent/fix-applier';
import type { LlmExtractOptions } from '../loop-agent/output-extractor';
import type { QualityRuleSet } from './quality-rule-set';
import type { LoadRuleSetOptions } from './quality-rule-set';
import { loadQualityRuleSet } from './quality-rule-set';
import { judgeQuality, qualityFeedbackText } from './quality-judge';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** Refine 循环选项 */
export interface RefineDriverOptions {
  /** Agent 身份码 */
  agentId?: string;
  /** 任务 ID（缺省自动生成） */
  taskId?: string;
  /** 最大循环轮数（默认 3） */
  maxRounds?: number;
  /** 超时阈值（ms，默认 120_000） */
  timeoutMs?: number;
  /**
   * 运行器（可注入 mock——测试不调 LLM）。
   * 与 Onboard 的 runner 签名一致：接收 (task, round)，返回产出。
   */
  runner?: (task: string, round: number) => Promise<OnboardRunOutcome>;
  /** 质量规则集（缺省加载内置三规则） */
  ruleSet?: QualityRuleSet;
  /** 质量规则集加载选项（ruleSet 缺省时使用） */
  ruleSetOptions?: LoadRuleSetOptions;
  /** LLM 辅助提取选项（传给 qualityJudge 的字段提取） */
  llmExtractOptions?: LlmExtractOptions;
  /** L3 定位器 LLM 依赖（可注入 mock） */
  l3Deps?: LlmLocalizerDeps;
  /** L3 定位器上下文材料 */
  l3Context?: LocalizationContext;
  /** L4 修复器依赖（LLM + 审计 + 文件操作，均可注入 mock） */
  l4LlmDeps?: LlmFixerDeps;
  l4AuditDeps?: AuditGateDeps;
  l4FileOpsDeps?: FileOpsDeps;
  /** L5 收敛参数（默认连续 2 轮质量通过即收敛） */
  l5ConvergeThreshold?: number;
  /** 调试记录文件路径 */
  debugLogPath?: string;
  /** 日志输出 */
  log?: (msg: string) => void;
}

/** Refine 循环结果（复用 OnboardLoopResult 结构，语义不变） */
export type RefineLoopResult = OnboardLoopResult;

// ────────────────────────────────────────────────────────────
// 核心驱动
// ────────────────────────────────────────────────────────────

/**
 * Refine 循环驱动——Onboard 收敛 PASS 后触发，从「能用」到「好用」。
 *
 * 复用策略：调 runOnboardLoop，注入：
 *   - l2Judge = qualityJudge（质量规则集判定，替代 ontology-comparator）
 *   - l3Localizer = 包装的 localizeError（注入 Refine 上下文）
 *   - l4Fixer = 包装的 applyFix（注入 Refine 依赖）
 *   - l5Config.convergeThreshold（默认 2——质量规则通过即收敛）
 *   - fixer = qualityFixer（质量反馈而非工程反馈）
 *
 * runOnboardLoop 的骨架（activate → run → judge → L2 → L3 → L4 → L5）完全复用，
 * 只换 L2 判据入口和 fixer。
 *
 * @param task 初始任务描述
 * @param options Refine 选项
 * @returns RefineLoopResult
 */
export async function runRefineLoop(
  task: string,
  options: RefineDriverOptions = {},
): Promise<RefineLoopResult> {
  const log = options.log ?? (() => {});

  // 1. 加载质量规则集
  const ruleSet = options.ruleSet ?? loadQualityRuleSet(options.ruleSetOptions);
  log(`📋 Refine 质量规则集加载完成：${ruleSet.rules.length} 条规则（内置 ${ruleSet.sourceCounts.builtin} / FDE ${ruleSet.sourceCounts.fde_delivery} / 团队 ${ruleSet.sourceCounts.team_feedback}）`);

  // 2. 构造 L2 质量判定器（注入 qualityJudge 替代 ontology-comparator）
  const l2Judge = (outcome: OnboardRunOutcome, taskId: string): Promise<DiffReport> => {
    return judgeQuality(outcome, taskId, {
      taskId,
      ruleSet,
      ...(options.llmExtractOptions ? { llmOptions: options.llmExtractOptions } : {}),
    });
  };

  // 3. 构造 L3 定位器（复用 loop-agent error-localizer，注入 Refine 上下文）
  const l3Localizer = options.l3Context
    ? async (diffReport: DiffReport) => {
        const { localizeError } = await import('../loop-agent/error-localizer');
        return localizeError(diffReport, options.l3Context!, options.l3Deps);
      }
    : undefined;

  // 4. 构造 L4 修复器（复用 loop-agent fix-applier，注入 Refine 依赖）
  const l4Fixer =
    options.l4LlmDeps || options.l4AuditDeps || options.l4FileOpsDeps
      ? async (localization: Awaited<ReturnType<typeof import('../loop-agent/error-localizer')['localizeError']>>, diffReport: DiffReport) => {
          const { applyFix } = await import('../loop-agent/fix-applier');
          return applyFix(
            localization,
            diffReport,
            options.l4LlmDeps,
            options.l4AuditDeps,
            options.l4FileOpsDeps,
          );
        }
      : undefined;

  // 5. 构造 fixer（质量反馈——基于 L2 差异报告生成修复指引）
  const fixer = async (
    _task: string,
    outcome: OnboardRunOutcome,
    verdict: JudgeVerdict,
  ): Promise<string> => {
    // 先跑一次质量判定拿到差异报告
    const diffReport = await judgeQuality(outcome, options.taskId ?? 'refine', {
      taskId: options.taskId ?? 'refine',
      ruleSet,
      ...(options.llmExtractOptions ? { llmOptions: options.llmExtractOptions } : {}),
    });
    const feedback = qualityFeedbackText(diffReport, verdict);
    if (feedback) {
      return `${feedback}\n\n---\n原始任务：\n${task}`;
    }
    // 无质量差异 → 通用反馈
    return `## 修复指引\n运行判定为「${verdict.state}」：${verdict.detail}\n\n---\n原始任务：\n${task}`;
  };

  // 6. 注入 runOnboardLoop 选项（复用循环骨架）
  const onboardOptions: OnboardDriverOptions = {
    agentId: options.agentId,
    taskId: options.taskId ?? `refine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    maxRounds: options.maxRounds ?? 3,
    timeoutMs: options.timeoutMs ?? 120_000,
    l5Config: {
      convergeThreshold: options.l5ConvergeThreshold ?? 2,
      divergeThreshold: 4,
    },
    l2Judge,
    ...(l3Localizer ? { l3Localizer } : {}),
    ...(l4Fixer ? { l4Fixer } : {}),
    fixer,
    ...(options.runner ? { runner: options.runner } : {}),
    ...(options.debugLogPath ? { debugLogPath: options.debugLogPath } : {}),
    log,
  };

  log(`🚀 Refine L1 启动 · taskId=${onboardOptions.taskId}`);

  // 7. 复用 runOnboardLoop 执行循环（骨架完全复用，只换 L2 判据）
  const { runOnboardLoop } = await import('../loop-agent/driver');
  const result = await runOnboardLoop(task, onboardOptions);

  log(`🏁 Refine 结束 · finalState=${result.finalState} · convergence=${result.convergence ?? 'n/a'} · 共 ${result.rounds.length} 轮`);

  return result;
}

// ────────────────────────────────────────────────────────────
// Onboard → Refine 自动触发（driver.ts onConverged 回调挂点）
// ────────────────────────────────────────────────────────────

/** Onboard 收敛回调的上下文（driver.ts onConverged 传入） */
export interface OnboardConvergedContext {
  /** 任务 ID */
  taskId: string;
  /** Agent 身份码 */
  agentId?: string;
  /** 循环轮数 */
  rounds: number;
}

/** Onboard → Refine 自动触发的配置 */
export interface RefineTriggerConfig {
  /** Refine 运行器（注入 mock——测试不调 LLM） */
  runner?: (task: string, round: number) => Promise<OnboardRunOutcome>;
  /** 质量规则集加载选项 */
  ruleSetOptions?: LoadRuleSetOptions;
  /** L5 收敛阈值 */
  l5ConvergeThreshold?: number;
  /** 日志输出 */
  log?: (msg: string) => void;
}

/**
 * 创建 Onboard 收敛 → Refine 触发回调。
 *
 * 这个回调注入到 loop-agent/driver.ts 的 onConverged 挂点
 * （driver.ts L383-386 收敛出口加的 onConverged 回调）。
 *
 * 链路：
 *   runOnboardLoop → L5 converged → onConverged(ctx) → runRefineLoop
 *
 * driver.ts 本身不 import refine-agent（保持单向依赖），
 * 调用方负责创建回调并注入。
 *
 * @param triggerConfig Refine 触发配置
 * @returns onConverged 回调函数
 */
export function createRefineOnConvergedCallback(
  triggerConfig: RefineTriggerConfig = {},
): (ctx: OnboardConvergedContext) => Promise<RefineLoopResult> {
  return async (ctx: OnboardConvergedContext): Promise<RefineLoopResult> => {
    const log = triggerConfig.log ?? (() => {});
    log(`🔗 Onboard 收敛 PASS（taskId=${ctx.taskId}，${ctx.rounds} 轮）→ 自动触发 Refine Agent`);

    return runRefineLoop(
      `Refine 质量优化（Onboard 收敛后自动触发，taskId=${ctx.taskId}）`,
      {
        taskId: `refine-auto-${ctx.taskId}`,
        agentId: ctx.agentId,
        ...(triggerConfig.runner ? { runner: triggerConfig.runner } : {}),
        ...(triggerConfig.ruleSetOptions ? { ruleSetOptions: triggerConfig.ruleSetOptions } : {}),
        ...(triggerConfig.l5ConvergeThreshold != null
          ? { l5ConvergeThreshold: triggerConfig.l5ConvergeThreshold }
          : {}),
        log,
      },
    );
  };
}
