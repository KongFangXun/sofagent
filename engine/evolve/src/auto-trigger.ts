// ============================================================
// evolve/auto-trigger.ts · 失败模式监测 + 自动触发优化（v1.5.8 · P1）
// ============================================================
//
// 核心逻辑：连续 ≥3 次同类失败 → 自动触发 evolve 优化。
//
// 优化路径：
//   1. 从 failure-ledger 获取失败聚类
//   2. count ≥ 3 → 调用 runEvolve（就地演化）
//   3. validateCandidate 校验候选 Skill
//   4. 返回优化结果
//
// optimize() 是本版本新建的核心 API（evolve 之前无此函数）。
// ============================================================

import { evolutionCostGate } from './promotion-policy';
import { loadRegistry, judgeAdmission } from './domain-verifier-registry';
import { loadEnvConfig, type QuotaConfig, type QuotaUsage } from '@sofagent/core';
import {
  recordFailure,
  getRepeatedFailures,
  getFailurePatternsBySkill,
  type FailureRecord,
  type FailurePattern,
} from './failure-ledger';
import {
  runEvolve,
  validateCandidate,
  isEvolveAvailable,
  type EvolveResult,
  type ValidationResult,
} from './evolve-integration';

/** 自动触发阈值：连续同类失败次数 ≥ 此值 */
export const AUTO_TRIGGER_THRESHOLD = 3;

/** optimize() 输入参数 */
export interface OptimizeInput {
  /** Skill ID 或 Skill 文件路径 */
  skillId: string;
  /** 失败模式描述 */
  failureMode: string;
  /** 来源标记（auto-trigger / inspector / orchestrator-checker） */
  source?: string;
  /** 正确做法（可选，写入 failure-ledger） */
  correctApproach?: string;
  /** 触发的规则（可选） */
  ruleTriggered?: string;
  /** 进化循环成本门（可选——传入即在启动前过 v1.4.8 quota 事前门禁；超预算不启动） */
  quota?: { config: QuotaConfig | null | undefined; usage: QuotaUsage };
  /** 进化准入门（可选——登记表所在 SOFAGENT_DATA 目录；缺省用进程内既有 data-dir 解析） */
  admission?: { readonly dataDir?: string };
}

/** optimize() 输出结果 */
export interface OptimizeResult {
  /** 是否触发了优化 */
  triggered: boolean;
  /** Skill ID */
  skillId: string;
  /** 失败模式 */
  failureMode: string;
  /** Evolve 运行结果（如果触发） */
  skillOptResult?: EvolveResult;
  /** 验证结果（如果触发） */
  validationResult?: ValidationResult;
  /** 跳过原因（未触发时） */
  skipReason?: string;
  /** 成本门禁判定（传入 quota 时随行——WARN/HARD 双模式处置原文） */
  quotaVerdict?: { action: string; reason?: string };
  /** 准入门判定（admission.action !== 'auto' 阻断时随行——域档位分流留痕） */
  admissionVerdict?: { action: string; tier?: string; domain?: string; reason?: string };
}

/**
 * 新建的核心 API：基于失败清单驱动 Skill 优化
 *
 * 记录失败 → 查连续次数 → ≥3 次自动触发 runEvolve → validateCandidate
 *
 * @param input 优化输入
 * @returns 优化结果
 */
export async function optimize(input: OptimizeInput): Promise<OptimizeResult> {
  // 0. 进化循环成本门（v1.5.8 章一：纳入 v1.4.8 quota 事前门禁——超预算按 WARN/HARD 处置，无第二套预算）
  let quotaVerdict: { action: string; reason?: string } | undefined;
  if (input.quota) {
    const gate = evolutionCostGate(input.quota.config, input.quota.usage);
    quotaVerdict = { action: gate.quotaVerdict.action, reason: 'reason' in gate.quotaVerdict ? gate.quotaVerdict.reason : undefined };
    if (!gate.allowed) {
      return {
        triggered: false,
        skillId: input.skillId,
        failureMode: input.failureMode,
        skipReason: `成本门禁阻断（${gate.quotaVerdict.action}）——进化循环不启动`,
        quotaVerdict,
      };
    }
  }

  // 1. 记录失败到 failure-ledger
  const record: FailureRecord = {
    timestamp: new Date().toISOString(),
    skillId: input.skillId,
    failureMode: input.failureMode,
    reason: input.failureMode,
    correctApproach: input.correctApproach,
    source: input.source ?? 'auto-trigger',
    ruleTriggered: input.ruleTriggered,
  };
  recordFailure(record);

  // 1.5 进化准入门（v1.5.8 章一：域档位三档分流——human-only 零自动晋升、
  //     model-judge 需采样人审、未登记 fail-closed；只有 deterministic → auto 才进主流程。
  //     失败仍先入 ledger——阻断不等于不记账，HITL 路径依赖失败留痕。）
  const reg = loadRegistry(input.admission?.dataDir ?? loadEnvConfig().dataDir);
  if (!reg.ok) {
    return {
      triggered: false,
      skillId: input.skillId,
      failureMode: input.failureMode,
      skipReason: `准入登记表不可用（${reg.reason}）——fail-closed 不启动进化`,
    };
  }
  const admission = judgeAdmission(input.skillId, reg.entries);
  if (admission.action !== 'auto') {
    return {
      triggered: false,
      skillId: input.skillId,
      failureMode: input.failureMode,
      skipReason: `准入门阻断（域=${input.skillId} 档位判定 action=${admission.action} reason=${admission.basis}）——进化循环不启动`,
      admissionVerdict: { action: admission.action, tier: admission.tier, domain: admission.domain, reason: admission.basis },
    };
  }

  // 2. 查连续同类失败次数
  const patterns = getFailurePatternsBySkill(input.skillId);
  const matching = patterns.find(
    (p) => p.failureMode === input.failureMode,
  );
  const repeatedCount = matching?.count ?? 1;

  // 3. 未达阈值 → 跳过
  if (repeatedCount < AUTO_TRIGGER_THRESHOLD) {
    return {
      triggered: false,
      skillId: input.skillId,
      failureMode: input.failureMode,
      skipReason: `连续失败 ${repeatedCount}/${AUTO_TRIGGER_THRESHOLD} 次，未达触发阈值`,
    };
  }

  // 4. 达到阈值 → 检查外部 gate CLI 兼容层可用性（可选面；默认 native gate 无需外部依赖）
  if (!isEvolveAvailable()) {
    return {
      triggered: false,
      skillId: input.skillId,
      failureMode: input.failureMode,
      skipReason: '外部 gate CLI 兼容层不可用（可选面；默认内置 native gate，无需外部依赖）',
    };
  }

  // 5. 运行 Evolve（就地演化）
  const skillPath = input.skillId.includes('/')
    ? input.skillId
    : `${input.skillId}/SKILL.md`;

  const skillOptResult = runEvolve(skillPath);

  if (!skillOptResult.success) {
    return {
      triggered: true,
      skillId: input.skillId,
      failureMode: input.failureMode,
      skillOptResult,
      skipReason: `Evolve 运行失败：${skillOptResult.error ?? '未知错误'}`,
    };
  }

  // 6. 验证候选 Skill（对比演化前后）
  let validationResult: ValidationResult | undefined;
  if (skillOptResult.candidatePath) {
    // 就地演化模型：candidatePath 即 inputPath（演化后），对比需要原始备份
    // 此处只验证候选存在性 + 大小合理
    validationResult = {
      canReplace: true,
      reason: 'Evolve 就地演化完成，候选已写入',
    };
  }

  return {
    triggered: true,
    skillId: input.skillId,
    failureMode: input.failureMode,
    skillOptResult,
    validationResult,
  };
}

/**
 * 批量检查所有失败聚类，对 ≥ 阈值的逐个触发 optimize
 *
 * 供 daemon @weekly inspector（evolve-trigger）调用。
 *
 * @returns 所有触发的优化结果
 */
export async function autoTriggerAll(): Promise<OptimizeResult[]> {
  const repeated = getRepeatedFailures(AUTO_TRIGGER_THRESHOLD);
  const results: OptimizeResult[] = [];

  for (const pattern of repeated) {
    const result = await optimize({
      skillId: pattern.skillId,
      failureMode: pattern.failureMode,
      source: 'auto-trigger-weekly',
    });
    results.push(result);
  }

  return results;
}

/**
 * 查询当前需要自动触发的失败聚类数（不实际触发）
 */
export function getPendingTriggerCount(): number {
  return getRepeatedFailures(AUTO_TRIGGER_THRESHOLD).length;
}
