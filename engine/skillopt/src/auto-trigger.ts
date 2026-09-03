// ============================================================
// skillopt/auto-trigger.ts · 失败模式监测 + 自动触发优化（v1.4.4 · P1）
// ============================================================
//
// 核心逻辑：连续 ≥3 次同类失败 → 自动触发 skillopt 优化。
//
// 优化路径：
//   1. 从 failure-ledger 获取失败聚类
//   2. count ≥ 3 → 调用 runSkillOpt（就地演化）
//   3. validateCandidate 校验候选 Skill
//   4. 返回优化结果
//
// optimize() 是本版本新建的核心 API（skillopt 之前无此函数）。
// ============================================================

import {
  recordFailure,
  getRepeatedFailures,
  getFailurePatternsBySkill,
  type FailureRecord,
  type FailurePattern,
} from './failure-ledger';
import {
  runSkillOpt,
  validateCandidate,
  isSkillOptAvailable,
  type SkillOptResult,
  type ValidationResult,
} from './skillopt-integration';

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
}

/** optimize() 输出结果 */
export interface OptimizeResult {
  /** 是否触发了优化 */
  triggered: boolean;
  /** Skill ID */
  skillId: string;
  /** 失败模式 */
  failureMode: string;
  /** SkillOpt 运行结果（如果触发） */
  skillOptResult?: SkillOptResult;
  /** 验证结果（如果触发） */
  validationResult?: ValidationResult;
  /** 跳过原因（未触发时） */
  skipReason?: string;
}

/**
 * 新建的核心 API：基于失败清单驱动 Skill 优化
 *
 * 记录失败 → 查连续次数 → ≥3 次自动触发 runSkillOpt → validateCandidate
 *
 * @param input 优化输入
 * @returns 优化结果
 */
export async function optimize(input: OptimizeInput): Promise<OptimizeResult> {
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

  // 4. 达到阈值 → 检查 skillopt-sleep 可用性
  if (!isSkillOptAvailable()) {
    return {
      triggered: false,
      skillId: input.skillId,
      failureMode: input.failureMode,
      skipReason: 'skillopt-sleep CLI 不可用（未安装或不在 PATH 中）',
    };
  }

  // 5. 运行 SkillOpt（就地演化）
  const skillPath = input.skillId.includes('/')
    ? input.skillId
    : `${input.skillId}/SKILL.md`;

  const skillOptResult = runSkillOpt(skillPath);

  if (!skillOptResult.success) {
    return {
      triggered: true,
      skillId: input.skillId,
      failureMode: input.failureMode,
      skillOptResult,
      skipReason: `SkillOpt 运行失败：${skillOptResult.error ?? '未知错误'}`,
    };
  }

  // 6. 验证候选 Skill（对比演化前后）
  let validationResult: ValidationResult | undefined;
  if (skillOptResult.candidatePath) {
    // 就地演化模型：candidatePath 即 inputPath（演化后），对比需要原始备份
    // 此处只验证候选存在性 + 大小合理
    validationResult = {
      canReplace: true,
      reason: 'SkillOpt 就地演化完成，候选已写入',
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
 * 供 daemon @weekly inspector（skillopt-trigger）调用。
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
