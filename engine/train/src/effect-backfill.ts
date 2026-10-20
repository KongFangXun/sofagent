// effect-backfill.ts · v1.7.0 §七 · effect 窗口回填（override 率对比 → verdict 三态）
// ============================================================
// 尺子变更的 effect 回填：变更生效后按窗口对比 override 率——
//   { windowDays, overrideRateBefore, overrideRateAfter, verdict }
//
// ⚠️ verdict 是相关不是因果（SSOT §七风险段）：override 率下降也可能来自
// 业务变化而非判据变好——本文件只落可观测对比，因果归因留人工与后续版本。
// 「override 率下降不得直接判为判据变好」的落法：verdict 字段名是中性的
// 三态（improved/neutral/regressed——描述 override 率的变动方向），注释与
// 消费面（taste-sample 标签）均显式声明「相关非因果」。
//
// 窗口默认值入配置（SSOT §七验收末条）+ override 率计算函数可单测——
// 「可算」以单测输出为凭。
// ============================================================

/** effect 回填配置（窗口默认值入配置——不散落魔法数） */
export interface EffectBackfillConfig {
  /** 对比窗口天数（变更生效前后各取一窗） */
  windowDays: number;
  /** neutral 判定的死区（|before − after| ≤ deadband ⇒ neutral——微动不算改善/回归） */
  neutralDeadband: number;
}

/** 窗口默认配置（30 天窗口 + 0.02 死区——override 率为 [0,1] 尺度） */
export const DEFAULT_EFFECT_BACKFILL_CONFIG: EffectBackfillConfig = {
  windowDays: 30,
  neutralDeadband: 0.02,
};

/** effect 回填结果（挂 RulerChangeEvent.effect） */
export interface RulerChangeEffect {
  windowDays: number;
  overrideRateBefore: number;
  overrideRateAfter: number;
  /** 三态：improved（下降超死区）/ neutral（死区内）/ regressed（上升超死区）——相关非因果 */
  verdict: 'improved' | 'neutral' | 'regressed';
}

/**
 * override 率计算（窗口内）：
 *   override 次数 / 判定总次数 ——「人否机器」频次的归一化读数。
 * @param overridesInWindow 窗口内 override（人否机器）次数
 * @param totalJudgmentsInWindow 窗口内判定总次数（0 ⇒ 除零无定义——抛错不产 NaN）
 */
export function overrideRate(overridesInWindow: number, totalJudgmentsInWindow: number): number {
  if (!Number.isInteger(overridesInWindow) || overridesInWindow < 0) {
    throw new Error(`[effect-backfill] override 次数非法：${String(overridesInWindow)}（须非负整数）`);
  }
  if (!Number.isInteger(totalJudgmentsInWindow) || totalJudgmentsInWindow <= 0) {
    throw new Error(`[effect-backfill] 判定总次数非法：${String(totalJudgmentsInWindow)}（须正整数——窗口内零判定时率无定义，调用方延窗或标 not-applicable）`);
  }
  if (overridesInWindow > totalJudgmentsInWindow) {
    throw new Error(`[effect-backfill] override 次数 ${overridesInWindow} > 判定总次数 ${totalJudgmentsInWindow}（人否机器不可能多于判定本身——输入口径错位）`);
  }
  return overridesInWindow / totalJudgmentsInWindow;
}

/**
 * 窗口对比 → verdict 三态。
 * 相关非因果：override 率下降超死区 ⇒ 'improved' 只是「override 变少了」的
 * 观测读数——不得直接解读为「判据变好」（业务变化同因可致此读数）。
 */
export function backfillEffect(input: {
  overrideRateBefore: number;
  overrideRateAfter: number;
  config?: Partial<EffectBackfillConfig>;
}): RulerChangeEffect {
  const config = { ...DEFAULT_EFFECT_BACKFILL_CONFIG, ...input.config };
  for (const [name, v] of [['overrideRateBefore', input.overrideRateBefore], ['overrideRateAfter', input.overrideRateAfter]] as const) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`[effect-backfill] ${name} 非法：${String(v)}（须非负有限数）`);
    }
  }
  const delta = input.overrideRateAfter - input.overrideRateBefore;
  const verdict: RulerChangeEffect['verdict'] =
    Math.abs(delta) <= config.neutralDeadband ? 'neutral' : delta < 0 ? 'improved' : 'regressed';
  return {
    windowDays: config.windowDays,
    overrideRateBefore: input.overrideRateBefore,
    overrideRateAfter: input.overrideRateAfter,
    // 相关非因果：verdict 描述 override 率变动方向，不构成判据质量归因
    verdict,
  };
}
