// ============================================================
// ab-test/types.ts · Sub Agent A/B 自进化类型定义
// v1.1.7 新增
// v1.1.7：迁移至 @sofagent/ab-test
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
 * 评分权重
 */
export interface ScoreWeights {
  exactMatch: number;
  semanticSimilarity: number;
  ruleCompliance: number;
}

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
 * 默认评分权重
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  exactMatch: 0.5,
  semanticSimilarity: 0.2,
  ruleCompliance: 0.3,
};
