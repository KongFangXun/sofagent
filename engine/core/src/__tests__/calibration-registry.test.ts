// calibration-registry.test.ts · v1.7.0 §三 · 校准判据纪律登记表单测
// 覆盖面（对齐 §三验收）：
//   1. 登记——calibrated 须带 evidence 三件（少一件拒载）
//   2. 门禁红绿——决策路径 uncalibrated → throw；补齐校准依据 → 过
//   3. 漂移提示不阻断——超阈返回提示对象（enforcement='hint-only'）
//   4. 锚点不可比——四件任一变更 → comparable:false
//   5. 普查登记——registerLegacyConfidenceClaims 落数（数量对账）
import { describe, it, expect } from 'vitest';
import {
  CalibrationClaimRegistry,
  calibrationClaimRegistry,
  registerLegacyConfidenceClaims,
  judgmentAnchor,
  anchorComparability,
  CalibrationRegistryError,
  type ConfidenceClaim,
} from '../calibration-registry';

/** 造一条合法声明（测试基件——字段可覆写） */
function mkClaim(overrides: Partial<ConfidenceClaim> = {}): ConfidenceClaim {
  return {
    id: 'test-claim',
    path: 'engine/test/claim.ts:1',
    statistic: 'max-prob',
    calibStatus: 'uncalibrated',
    inDecisionPath: false,
    ...overrides,
  };
}

describe('§三 登记表：calibrated 须带证据', () => {
  it('test_register_calibrated缺evidence拒载', () => {
    const reg = new CalibrationClaimRegistry();
    expect(() =>
      reg.registerConfidenceClaim(mkClaim({ calibStatus: 'calibrated' })),
    ).toThrow(/缺 evidence/);
  });

  it('test_register_evidence三件少一件逐项拒载', () => {
    const reg = new CalibrationClaimRegistry();
    const evidence = { calibrationSetVersion: 'calib-v1', ece: 0.06, fittedAt: '2026-10-20T00:00:00Z' };
    for (const field of ['calibrationSetVersion', 'fittedAt'] as const) {
      const broken = { ...evidence };
      (broken as Record<string, unknown>)[field] = '';
      expect(() =>
        reg.registerConfidenceClaim(mkClaim({ calibStatus: 'calibrated', evidence: broken })),
      ).toThrow(CalibrationRegistryError);
    }
    expect(() =>
      reg.registerConfidenceClaim(mkClaim({ calibStatus: 'calibrated', evidence: { ...evidence, ece: 1.5 } })),
    ).toThrow(/非法/);
  });

  it('test_register_缺id或缺path或缺statistic拒载', () => {
    const reg = new CalibrationClaimRegistry();
    expect(() => reg.registerConfidenceClaim(mkClaim({ id: '' }))).toThrow(/id/);
    expect(() => reg.registerConfidenceClaim(mkClaim({ path: '' }))).toThrow(/path/);
    expect(() => reg.registerConfidenceClaim(mkClaim({ statistic: '' }))).toThrow(/statistic/);
  });

  it('test_register_同id覆盖幂等', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(mkClaim({ note: 'first' }));
    reg.registerConfidenceClaim(mkClaim({ note: 'second' }));
    expect(reg.size).toBe(1);
    expect(reg.get('test-claim')?.note).toBe('second');
  });
});

describe('§三 门禁：决策路径未校准即断言失败', () => {
  it('test_gate_决策路径uncalibrated_throw红态', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(mkClaim({ id: 'gate-1', inDecisionPath: true }));
    expect(() => reg.assertNoUncalibratedInDecisionPath()).toThrow(/未校准/);
    // 错误信息含消费点定位（可指认）
    expect(() => reg.assertNoUncalibratedInDecisionPath()).toThrow(/gate-1/);
  });

  it('test_gate_非决策路径uncalibrated不触发门禁', () => {
    const reg = new CalibrationClaimRegistry();
    // 登记不改造的普查项（非决策路径 uncalibrated）——只登记不拦截
    reg.registerConfidenceClaim(mkClaim({ id: 'census-1', inDecisionPath: false }));
    expect(() => reg.assertNoUncalibratedInDecisionPath()).not.toThrow();
  });

  it('test_gate_补齐校准依据后过绿态', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(
      mkClaim({
        id: 'gate-ok',
        inDecisionPath: true,
        calibStatus: 'calibrated',
        evidence: { calibrationSetVersion: 'calib-v1', ece: 0.06, fittedAt: '2026-10-20T00:00:00Z' },
      }),
    );
    expect(() => reg.assertNoUncalibratedInDecisionPath()).not.toThrow();
  });

  it('test_gate_claimsInDecisionPath只取路径子集', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(mkClaim({ id: 'on-path', inDecisionPath: true }));
    reg.registerConfidenceClaim(mkClaim({ id: 'off-path', inDecisionPath: false }));
    const inPath = reg.claimsInDecisionPath();
    expect(inPath.map((c) => c.id)).toEqual(['on-path']);
  });
});

describe('§三 漂移监测：超阈只提示不阻断', () => {
  it('test_drift_超阈返回提示对象不抛错', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(
      mkClaim({
        id: 'drift-base',
        calibStatus: 'calibrated',
        evidence: { calibrationSetVersion: 'calib-v1', ece: 0.06, fittedAt: '2026-10-20T00:00:00Z' },
      }),
    );
    reg.recordDrift({ window: '2026-10-21T10:00Z', ece: 0.15, sampleCount: 200 }); // 超基线 0.06 + 0.05
    const hint = reg.checkDrift();
    expect(hint.exceeded).toBe(true);
    expect(hint.action).toBe('refit-suggested');
    // 纪律口径读数：只提示不阻断（enforcement 字段是行为锁的文档面）
    expect(hint.enforcement).toBe('hint-only');
    // checkDrift 本身不抛错（超阈不是异常——观测不是执法）
    expect(() => reg.checkDrift()).not.toThrow();
  });

  it('test_drift_阈内绿态', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(
      mkClaim({
        id: 'drift-base',
        calibStatus: 'calibrated',
        evidence: { calibrationSetVersion: 'calib-v1', ece: 0.06, fittedAt: '2026-10-20T00:00:00Z' },
      }),
    );
    reg.recordDrift({ window: 'w1', ece: 0.08, sampleCount: 100 });
    const hint = reg.checkDrift();
    expect(hint.exceeded).toBe(false);
    expect(hint.action).toBe('none');
  });

  it('test_drift_无calibrated基线时说明而非报错', () => {
    const reg = new CalibrationClaimRegistry();
    reg.recordDrift({ window: 'w1', ece: 0.2, sampleCount: 50 });
    const hint = reg.checkDrift();
    expect(hint.exceeded).toBe(false);
    expect(hint.details[0]).toContain('无 calibrated 声明');
  });

  it('test_drift_非法样本拒载', () => {
    const reg = new CalibrationClaimRegistry();
    expect(() => reg.recordDrift({ window: 'w', ece: 2, sampleCount: 1 })).toThrow(CalibrationRegistryError);
    expect(() => reg.recordDrift({ window: 'w', ece: 0.1, sampleCount: -1 })).toThrow(CalibrationRegistryError);
  });
});

describe('§三 四件套锚点：任一变更即不可比', () => {
  it('test_anchor_四件齐可构建_缺一拒载', () => {
    const a = judgmentAnchor({ weightsV: 'w1', questionsV: 'q1', criteriaV: 'c1', thresholdV: 't1' });
    expect(a.schema).toBe('judgment-anchor/v1');
    expect(() => judgmentAnchor({ weightsV: '', questionsV: 'q1', criteriaV: 'c1', thresholdV: 't1' })).toThrow(/weightsV/);
    expect(() => judgmentAnchor({ weightsV: 'w', questionsV: 'q', criteriaV: 'c', thresholdV: '' })).toThrow(/thresholdV/);
  });

  it('test_anchor_四件全同可比', () => {
    const old = judgmentAnchor({ weightsV: 'w1', questionsV: 'q1', criteriaV: 'c1', thresholdV: 't1' });
    const same = judgmentAnchor({ weightsV: 'w1', questionsV: 'q1', criteriaV: 'c1', thresholdV: 't1' });
    const r = anchorComparability(old, same);
    expect(r.comparable).toBe(true);
    expect(r.changedComponents).toHaveLength(0);
  });

  it('test_anchor_任一变更不可比且列名', () => {
    const old = judgmentAnchor({ weightsV: 'w1', questionsV: 'q1', criteriaV: 'c1', thresholdV: 't1' });
    // 判据集改了（c1 → c2）——同一条问句的概率读数不可比（跨口径比数防线）
    const newA = judgmentAnchor({ weightsV: 'w1', questionsV: 'q1', criteriaV: 'c2', thresholdV: 't1' });
    const r = anchorComparability(old, newA);
    expect(r.comparable).toBe(false);
    expect(r.changedComponents).toEqual(['criteriaV']);
    // 多件同变——全列
    const newB = judgmentAnchor({ weightsV: 'w2', questionsV: 'q2', criteriaV: 'c2', thresholdV: 't1' });
    expect(anchorComparability(old, newB).changedComponents.sort()).toEqual(['criteriaV', 'questionsV', 'weightsV']);
  });
});

describe('§三 既有置信度普查登记', () => {
  it('test_census_普查落数_多数uncalibrated_数量对账', () => {
    const reg = new CalibrationClaimRegistry();
    registerLegacyConfidenceClaims(reg);
    const all = reg.all();
    // 数量对账（与 docs/VALIDATION.md §校准判据纪律汇总表合计一致——11 条）
    expect(all.length).toBe(11);
    // 多数 uncalibrated（登记与暴露，实际收敛归 v1.9.0）
    const uncal = all.filter((c) => c.calibStatus === 'uncalibrated');
    expect(uncal.length).toBe(9);
    expect(all.filter((c) => c.calibStatus === 'calibrated').length).toBe(2);
    // 决策路径上的未校准项被门禁拦截（普查项如实登记 → 门禁如实红——
    // 这正是「登记与暴露」的意义：不隐藏现状）
    expect(() => reg.assertNoUncalibratedInDecisionPath()).toThrow(/未校准/);
    // 幂等（重复登记不重复计数）
    registerLegacyConfidenceClaims(reg);
    expect(reg.size).toBe(11);
  });

  it('test_census_单例登记面可读', () => {
    // 引擎级单例（check-calibration-claims.sh 对账的运行时面）
    registerLegacyConfidenceClaims(calibrationClaimRegistry);
    expect(calibrationClaimRegistry.size).toBeGreaterThanOrEqual(11);
    const ids = calibrationClaimRegistry.all().map((c) => c.id);
    expect(ids).toContain('decision-channel/default-grade-thresholds/allow');
    expect(ids).toContain('intent-triage/l1-min-confidence');
  });
});
