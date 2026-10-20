// effect-backfill.test.ts · v1.7.0 §七 · effect 窗口回填测试（override 率三态）
// ============================================================
// 覆盖：窗口默认值入配置；overrideRate 计算函数（含除零/越界 fail-loud）；
// verdict 三态（improved/neutral/regressed——相关非因果）；死区配置生效。
// ============================================================
import { describe, it, expect } from 'vitest';
import { overrideRate, backfillEffect, DEFAULT_EFFECT_BACKFILL_CONFIG } from '../effect-backfill';

describe('override 率计算', () => {
  it('test_effect_overrideRate_窗口内计算', () => {
    expect(overrideRate(5, 100)).toBeCloseTo(0.05);
    expect(overrideRate(0, 100)).toBe(0);
    expect(overrideRate(100, 100)).toBe(1);
  });

  it('test_effect_overrideRate_零判定除零fail_loud', () => {
    expect(() => overrideRate(3, 0)).toThrow(/零判定/);
  });

  it('test_effect_overrideRate_计数越界fail_loud', () => {
    expect(() => overrideRate(101, 100)).toThrow(/不可能多于/);
    expect(() => overrideRate(-1, 100)).toThrow(/非法/);
  });
});

describe('窗口对比 → verdict 三态', () => {
  it('test_effect_窗口默认值入配置', () => {
    expect(DEFAULT_EFFECT_BACKFILL_CONFIG.windowDays).toBe(30);
    expect(DEFAULT_EFFECT_BACKFILL_CONFIG.neutralDeadband).toBeGreaterThan(0);
    const e = backfillEffect({ overrideRateBefore: 0.2, overrideRateAfter: 0.1 });
    expect(e.windowDays).toBe(30); // 默认窗口随产出落数
  });

  it('test_effect_下降超死区判improved', () => {
    const e = backfillEffect({ overrideRateBefore: 0.20, overrideRateAfter: 0.10 });
    expect(e.verdict).toBe('improved');
  });

  it('test_effect_死区内判neutral', () => {
    // |Δ| = 0.01 ≤ 默认死区 0.02——微动不算改善/回归
    const e = backfillEffect({ overrideRateBefore: 0.20, overrideRateAfter: 0.19 });
    expect(e.verdict).toBe('neutral');
    const e2 = backfillEffect({ overrideRateBefore: 0.20, overrideRateAfter: 0.21 });
    expect(e2.verdict).toBe('neutral');
  });

  it('test_effect_上升超死区判regressed', () => {
    const e = backfillEffect({ overrideRateBefore: 0.10, overrideRateAfter: 0.25 });
    expect(e.verdict).toBe('regressed');
  });

  it('test_effect_死区可配置收紧', () => {
    // 死区收窄到 0.005——Δ=0.01 从 neutral 变 regressed（配置项生效）
    const e = backfillEffect({ overrideRateBefore: 0.20, overrideRateAfter: 0.21, config: { neutralDeadband: 0.005 } });
    expect(e.verdict).toBe('regressed');
  });

  it('test_effect_verdict相关非因果_读数三字段齐备', () => {
    // 产出结构 = {windowDays, overrideRateBefore, overrideRateAfter, verdict}
    // ——verdict 只描述 override 率变动方向（可观测对比），不构成判据质量归因
    const e = backfillEffect({ overrideRateBefore: 0.3, overrideRateAfter: 0.1 });
    expect(e).toEqual({ windowDays: 30, overrideRateBefore: 0.3, overrideRateAfter: 0.1, verdict: 'improved' });
  });
});
