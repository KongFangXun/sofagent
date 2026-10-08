// promotion-policy.test.ts · 三维判据 / 三态输出 / 回退对称 / 四道证据门槛 / 台账单测（v1.5.8 章二）
import { describe, expect, it } from 'vitest';
import {
  judgePromotion,
  judgeDemotion,
  judgeEvidenceGates,
  recordPromotionDecision,
  recordBenefitMetrics,
  evolutionCostGate,
  PROMOTION_FREQUENCY_THRESHOLD,
  PROMOTION_PERSISTENCE_DAYS,
  PROMOTION_VERIFICATION_PASSRATE,
  PROMOTION_TRAIN_PASSRATE,
  CALIBRATION_EPSILON,
  noopDecisionWriter,
  type PromotionInput,
} from '../promotion-policy';
import { checkQuota } from '@sofagent/core';

function input(over: Partial<PromotionInput> = {}): PromotionInput {
  return {
    itemId: 'item-1',
    injectionFrequency: 6,
    persistenceDays: 20,
    passRate: 0.85,
    currentLayer: 'inject',
    ...over,
  };
}

describe('章二 · 晋级判据三维（频次 × 存续期 × 验证态 → 三态）', () => {
  it('三维全过（train 档）→ promote-train 且必带人审门', () => {
    const v = judgePromotion(input({ passRate: 0.95 }));
    expect(v.action).toBe('promote-train');
    expect((v as { requiresHumanApproval?: boolean }).requiresHumanApproval).toBe(true);
  });

  it('三维过 skill 档（验证未到 train 档）→ promote-skill', () => {
    const v = judgePromotion(input({ passRate: 0.85 }));
    expect(v.action).toBe('promote-skill');
  });

  it('任一维不足 → keep-inject（basis 含三维快照）', () => {
    expect(judgePromotion(input({ injectionFrequency: 2 })).action).toBe('keep-inject');
    expect(judgePromotion(input({ persistenceDays: 5 })).action).toBe('keep-inject');
    expect(judgePromotion(input({ passRate: 0.5 })).action).toBe('keep-inject');
  });

  it('阈值常量集中导出（落数表 #4/#5/#6——禁散落魔法数）', () => {
    expect(PROMOTION_FREQUENCY_THRESHOLD).toBeGreaterThan(0);
    expect(PROMOTION_PERSISTENCE_DAYS).toBeGreaterThan(0);
    expect(PROMOTION_VERIFICATION_PASSRATE).toBeLessThan(PROMOTION_TRAIN_PASSRATE);
    expect(CALIBRATION_EPSILON).toBeGreaterThan(0);
  });
});

describe('章二 · 回退对称（三层可逆）', () => {
  it('train 层验证失败 → demote-skill', () => {
    const v = judgeDemotion('train', true);
    expect(v?.action).toBe('demote-skill');
  });

  it('skill 层验证失败 → demote-inject', () => {
    const v = judgeDemotion('skill', true);
    expect(v?.action).toBe('demote-inject');
  });

  it('inject 层无更下层（null）与未失败（null）', () => {
    expect(judgeDemotion('inject', true)).toBeNull();
    expect(judgeDemotion('skill', false)).toBeNull();
  });

  it('回退判定不新建机制——本模块零 snapshot/restore 语义导出（静态判据）', async () => {
    // 静态断言：模块导出面不得含 snapshot/restore 命名（复用既有机制，防复制改名绕过）
    // vitest ESM 态无 require——以 import * as 取模块命名空间
    const mod = await import('../promotion-policy');
    const names = Object.keys(mod);
    const forbidden = names.filter((n) => /snapshot|restore/i.test(n) && !/Snapshot$/.test(n));
    // criteriaSnapshot / evidenceSnapshot 是台账数据字段（判定快照），非回退机制导出——
    // 机制面判据：导出名含 snapshot/restore 的「函数/类」（机制语义），数据字段排除
    expect(forbidden).toEqual([]);
  });
});

describe('章二 · 晋级证据门槛（四道）', () => {
  const gatesOk = {
    feedbackSetGain: 13.9,
    heldOutGain: 1.43,
    candidateScore: 0.82,
    historicalBestScore: 0.80,
    changedSurfaces: ['skill-file' as const],
    calibration: { ece: 0.05, brier: 0.20, baselineEce: 0.06, baselineBrier: 0.21 },
    accuracyImproved: true,
  };

  it('四门全过 → passed', () => {
    const v = judgeEvidenceGates(gatesOk);
    expect(v.passed).toBe(true);
    expect(v.rejectionReasons).toHaveLength(0);
  });

  it('① 留出集优先：反馈集涨而留出集不涨 → 拒（HarnessDev 口径）', () => {
    const v = judgeEvidenceGates({ ...gatesOk, heldOutGain: 0 });
    expect(v.passed).toBe(false);
    expect(v.gateResults.heldOutFirst).toBe(false);
    expect(v.rejectionReasons[0]).toContain('留出集');
  });

  it('② 严格优于历史最佳：持平 = 不接受', () => {
    const v = judgeEvidenceGates({ ...gatesOk, candidateScore: 0.80 });
    expect(v.passed).toBe(false);
    expect(v.rejectionReasons.join()).toContain('持平');
  });

  it('③ 单变量可归因：多变量捆包拒收', () => {
    const v = judgeEvidenceGates({ ...gatesOk, changedSurfaces: ['skill-file', 'weights'] });
    expect(v.passed).toBe(false);
    expect(v.gateResults.singleVariable).toBe(false);
  });

  it('④ 校准不退化：逐维判定——ECE 升超 ε 拒（准确率升同样拒）', () => {
    const v = judgeEvidenceGates({
      ...gatesOk,
      calibration: { ece: 0.10, brier: 0.20, baselineEce: 0.05, baselineBrier: 0.21 },
      accuracyImproved: true,
    });
    expect(v.passed).toBe(false);
    expect(v.rejectionReasons.join()).toContain('ECE');
    expect(v.rejectionReasons.join()).toContain('准确率升而校准降');
  });

  it('④ Brier 维独立判（ECE 稳而 Brier 劣化拒）', () => {
    const v = judgeEvidenceGates({
      ...gatesOk,
      calibration: { ece: 0.05, brier: 0.30, baselineEce: 0.05, baselineBrier: 0.21 },
    });
    expect(v.passed).toBe(false);
    expect(v.rejectionReasons.join()).toContain('Brier');
  });
});

describe('章二 · 台账与四指标', () => {
  it('晋级判定落 decision-log（判据快照可追溯——writer 收到 EVOLUTION 条目）', () => {
    const received: Array<{ kind: string; why: string; evidence?: string[] }> = [];
    const writer = (e: { kind: string; moment: string; why: string; evidence?: string[] }) => {
      received.push(e);
      return { ts: '2026-10-09T00:00:00Z' };
    };
    const inp = input();
    const entry = recordPromotionDecision(inp, judgePromotion(inp), writer);
    expect(received).toHaveLength(1);
    expect(received[0]!.kind).toBe('EVOLUTION');
    expect(received[0]!.why).toContain('promote-skill');
    expect(entry.criteriaSnapshot).toEqual(inp); // 快照可复算
  });

  it('writer 缺省 no-op 不抛错（留痕缺失如实暴露但不阻断判定面）', () => {
    const inp = input({ passRate: 0.3 });
    expect(() => recordPromotionDecision(inp, judgePromotion(inp), noopDecisionWriter)).not.toThrow();
  });

  it('四指标可计算可记录（通过率趋势 / 复发率 / 复用率 / 介入率）', () => {
    const r = recordBenefitMetrics(
      { passRateTrend: 0.03, recurrenceRate: 0.12, skillReuseRate: 2.5, interventionRate: 0.4 },
      { start: '2026-10-01', end: '2026-10-08' },
    );
    expect(r.metrics.passRateTrend).toBeCloseTo(0.03);
    expect(r.metrics.recurrenceRate).toBeCloseTo(0.12);
    expect(r.metrics.skillReuseRate).toBeCloseTo(2.5);
    expect(r.metrics.interventionRate).toBeCloseTo(0.4);
    expect(r.windowEnd).toBe('2026-10-08');
  });
});

describe('章二 · 成本 quota 门禁（无第二套预算）', () => {
  it('超预算 HARD → 进化循环不允许启动（复用 core checkQuota）', () => {
    const cfg = { maxTokens: 1000, period: 'daily' as const, mode: 'HARD' as const };
    const v = evolutionCostGate(cfg, { usedTokens: 2000 });
    expect(v.allowed).toBe(false);
    expect(v.quotaVerdict.action).toBe('block');
    // 无第二套预算：判定即 core checkQuota 原文
    expect(v.quotaVerdict).toEqual(checkQuota(cfg, { usedTokens: 2000 }));
  });

  it('未超预算 → 放行（WARN 模式下超限为 allow-with-warning）', () => {
    const cfg = { maxTokens: 1000, period: 'daily' as const, mode: 'WARN' as const };
    const v = evolutionCostGate(cfg, { usedTokens: 1200 });
    expect(v.allowed).toBe(true); // WARN 不 block——按既有双模式处置
    expect(v.quotaVerdict.action).toBe('allow-with-warning');
    const ok = evolutionCostGate(cfg, { usedTokens: 500 });
    expect(ok.quotaVerdict.action).toBe('allow');
  });
});
