// reward-shaping.ts · 训练期惩罚信号折算（v1.5.8 章五）
//
// 承接 v1.4.4 规则→reward 映射：映射源 = @sofagent/audit 的
// severityWeightOf（export/rule-schema 定义、public-api re-export 于
// buildVerifiersManifest 行——本模块**经包名 import 消费，不复制映射逻辑**，
// evolve 侧零自有 severity→weight 表 = 无第三套映射）。
//
// 输出形态：reward 判据（penalty 信号随数据集交付——本仓不在训练进程插桩）。

import { severityWeightOf } from '@sofagent/audit';
import type { PolicyHitVerdict } from './training-policy';

/** 单条惩罚信号 */
export interface PenaltySignal {
  trajectoryId: string;
  ruleId: string;
  /** 惩罚权重（= severityWeightOf(规则严重级)——单一来源） */
  penaltyWeight: number;
}

/** 惩罚折算结果（reward 判据形态） */
export interface RewardShapingResult {
  signals: PenaltySignal[];
  /** 总惩罚（供 reward 公式消费的标量摘要） */
  totalPenalty: number;
  /** 语义：penalty 以前缀减项进 reward 判据（reward = base − totalPenalty 由训练侧算） */
  basis: string;
}

/**
 * 惩罚折算：策略命中 × 规则严重级权重 → reward 惩罚判据。
 *
 * severity → weight 的**唯一来源**是 audit 的 severityWeightOf——本函数不做
 * 任何自有映射（验收断言形态：本文件 grep 无自有 severity/weight 映射定义）。
 */
export function shapeRewardPenalty(
  verdict: PolicyHitVerdict,
  priorityOf: (ruleId: string) => 'critical' | 'warning' | 'extended' | 'crutch',
): RewardShapingResult {
  const signals: PenaltySignal[] = verdict.hits.map((h) => ({
    trajectoryId: h.trajectoryId,
    ruleId: h.ruleId,
    penaltyWeight: severityWeightOf(priorityOf(h.ruleId)),
  }));
  const totalPenalty = signals.reduce((acc, s) => acc + s.penaltyWeight, 0);
  return {
    signals,
    totalPenalty,
    basis: `命中 ${signals.length} 条训练期策略轨迹——惩罚权重经 @sofagent/audit severityWeightOf 折算（以规则严重级实时取值——单一来源，此处不重复钉数字），reward 判据以减项形态随数据集交付`,
  };
}

/** decision-log 留痕入参（策略命中 + 惩罚折算 + 规则集版本） */
export interface ShapingLedgerEntry {
  ts: string;
  rulesetVersion: string;
  hitCount: number;
  totalPenalty: number;
  ruleIds: string[];
}

/** 折算留痕（含规则集版本——哪个规则集版本影响了哪批数据） */
export function recordShaping(
  verdict: PolicyHitVerdict,
  result: RewardShapingResult,
  rulesetVersion: string,
  now?: string,
): ShapingLedgerEntry {
  return {
    ts: now ?? new Date().toISOString(),
    rulesetVersion,
    hitCount: verdict.hits.length,
    totalPenalty: result.totalPenalty,
    ruleIds: Array.from(new Set(verdict.hits.map((h) => h.ruleId))),
  };
}
