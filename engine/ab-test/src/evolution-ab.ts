// ============================================================
// evolution-ab.ts · 进化模块 A/B 对照（开/关双跑）
// v1.4.5 第七章一新增（复用 v1.3.5 ab-runner 基础设施）
// ============================================================
//
// 同一任务集双跑：
//   对照组（evolution OFF）＝ 裸 skill 路径跑任务
//   实验组（evolution ON）＝ 同 skill + 进化知识注入路径跑任务
// 复用 runABTest（方案 C/B 降级 + evalCase 评分 + 加权裁决），
// 不重复实现 A/B 运行器——本文件只做「进化开关」的组装配与
// 开关对照执行路径的确定性验证。
//
// 显著性判定：两独立比例的 z 检验（双侧，α=0.05，|z| ≥ 1.96 显著）
// ——evolution report 的统计结论出口。
// ============================================================

import type { TestCase } from '@sofagent/eval';
import { runABTest } from './ab-runner';
import { DEFAULT_SCORE_WEIGHTS } from './types';
import type { ABConfig, ABTestResult } from './types';

/** 进化 A/B 配置 */
export interface EvolutionABConfig {
  /** 对照组 skill 路径（进化 OFF——裸 skill） */
  baselineSkillPath: string;
  /** 实验组 skill 路径（进化 ON——注入进化知识后的 skill 副本） */
  evolvedSkillPath: string;
  /** 评估集路径 */
  evalSetPath: string;
  /** 最小样本数（样本不足 → tie 不裁决） */
  minSampleSize: number;
}

/** 进化 A/B 结果（runABTest 原始结果 + 进化语义标注） */
export interface EvolutionABResult {
  /** 原始 A/B 结果（复用 runABTest 产出） */
  ab: ABTestResult;
  /** 实验组（进化 ON）是否胜出 */
  evolutionWins: boolean;
  /** 统计显著性（|z| ≥ 1.96 才 true） */
  statisticallySignificant: boolean;
  /** z 值（双侧比例检验） */
  zScore: number;
  /** 结论说明（报告直接引用） */
  conclusion: string;
}

/** 缺省配置（对齐 ab-runner 既有缺省） */
export function defaultEvolutionABConfig(
  baselineSkillPath: string,
  evolvedSkillPath: string,
  evalSetPath: string,
): EvolutionABConfig {
  return {
    baselineSkillPath,
    evolvedSkillPath,
    evalSetPath,
    minSampleSize: 5,
  };
}

/** 两独立比例 z 检验（双侧）——p1/p2 为 0-1 通过率，n1/n2 为样本数 */
export function twoProportionZTest(
  p1: number,
  n1: number,
  p2: number,
  n2: number,
): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const pooled = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

/** 显著性阈值（|z| ≥ 1.96 = 双侧 α 0.05） */
export const SIGNIFICANCE_Z_THRESHOLD = 1.96;

/**
 * 跑进化模块 A/B 对照。
 *
 * current = baseline（进化 OFF）/ candidate = evolved（进化 ON）——
 * 语义对齐 runABTest 的 current/candidate 裁决方向。
 */
export async function runEvolutionAB(
  config: EvolutionABConfig,
  testCases: TestCase[],
): Promise<EvolutionABResult> {
  const abConfig: ABConfig = {
    current: config.baselineSkillPath,
    candidate: config.evolvedSkillPath,
    evalSet: config.evalSetPath,
    promoteThreshold: 3,
    minSampleSize: config.minSampleSize,
    scoreWeights: DEFAULT_SCORE_WEIGHTS,
  };
  const ab = await runABTest(abConfig, testCases);

  // 显著性：两比例 z 检验（overall 0-1 通过率维度）
  const n = testCases.length;
  const z = twoProportionZTest(ab.candidateScore.overall, n, ab.currentScore.overall, n);
  const significant = Math.abs(z) >= SIGNIFICANCE_Z_THRESHOLD && n >= config.minSampleSize;

  const evolutionWins = ab.winner === 'candidate';
  let conclusion: string;
  if (n < config.minSampleSize) {
    conclusion = `样本不足（${n} < ${config.minSampleSize}）——不裁决，如实记数据`;
  } else if (!significant) {
    conclusion = `进化模块差异不显著（z=${z.toFixed(2)}，|z| < ${SIGNIFICANCE_Z_THRESHOLD}）——不可声称「越用越好」`;
  } else if (evolutionWins) {
    conclusion = `进化模块显著更优（z=${z.toFixed(2)}）——对照实验支持进化增益结论`;
  } else {
    conclusion = `对照组显著更优（z=${z.toFixed(2)}）——进化模块本轮负增益，需复盘`;
  }

  return {
    ab,
    evolutionWins: evolutionWins && significant,
    statisticallySignificant: significant,
    zScore: z,
    conclusion,
  };
}
