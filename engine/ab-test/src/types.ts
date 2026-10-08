// ============================================================
// ab-test/types.ts · Sub Agent A/B 自进化类型定义
// v1.3.7 新增
// v1.5.7：迁移至 @sofagent/ab-test
// ============================================================

import type { EvalBreakdown } from '@sofagent/eval';

/**
 * A/B 测试配置
 */
export interface ABConfig {
  /** 当前版本 Agent 定义路径 */
  current: string;
  /** 候选版本 Agent 定义路径 */
  candidate: string;
  /** 评估集路径 */
  evalSet: string;
  /** 晋升阈值：candidate 连续胜出 N 次后 promote */
  promoteThreshold: number;
  /** 最小样本数 */
  minSampleSize: number;
  /** 评分权重 */
  scoreWeights: ScoreWeights;
}

/**
 * 评分权重（F18 · v1.5.7：定义与默认值 SSOT 已收口至 @sofagent/eval 的
 * types.ts——ab-test 依赖 eval，为防第二份字面量此处改为 re-export。
 * 消费方（eval-scorer / mcp promote-ab / 本包下游）一律从源头或本 re-export
 * 取值，全仓机械守卫锁 0.5/0.2/0.3 第二份字面量）。
 */
export type ScoreWeights = import('@sofagent/eval').ScoreWeights;

/**
 * 单次 A/B 测试结果
 */
export interface ABTestResult {
  /** 当前版本评分 */
  currentScore: EvalBreakdown;
  /** 候选版本评分 */
  candidateScore: EvalBreakdown;
  /** 胜出方 */
  winner: 'current' | 'candidate' | 'tie';
  /** 分差（candidate - current） */
  margin: number;
  /** 连续胜出次数 */
  consecutiveWins: number;
}

/**
 * 晋升决策
 */
export interface PromotionDecision {
  /** 是否晋升 */
  shouldPromote: boolean;
  /** 决策原因 */
  reason: string;
  /** 晋升后连续胜出次数 */
  newConsecutiveWins: number;
}

/**
 * 默认评分权重（F18 · v1.5.7：re-export @sofagent/eval 的 SSOT——本包不再
 * 持有字面量副本；既有消费方 import 路径不变，取值随 SSOT 单点演进）。
 */
export const DEFAULT_SCORE_WEIGHTS = require('@sofagent/eval').DEFAULT_SCORE_WEIGHTS as import('@sofagent/eval').ScoreWeights;
