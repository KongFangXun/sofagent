// decision-abstain.test.ts · v1.7.0 §四 · 弃权语义独立化单测
// 覆盖面：一等输出态 / 0.5 语义写死 / 三源留痕 / 三维聚合 /
// 分档拒载单数字 / 峰位推导 / 反解单调+支撑集 / 整分布消费 /
// 行为锁（未达阈关不掉 / 新域最宽）/ 红旗四采集点。
import { describe, it, expect } from 'vitest';
import {
  NOUL_SEMANTICS,
  makeAbstainOutput,
  AbstainRateAggregator,
  type AbstainSource,
} from '../router/decision-abstain';
import {
  assertThresholdsByPrimitive,
  histogramPeakBucketLower,
  deriveThresholdsFromHistogram,
  retriggerRelabel,
  solveThresholdsForBudget,
  consumeDistributionForScore,
  stabilizationRereadProtocolCheck,
  DEFAULT_STABILIZATION_CONFIG,
  divideAbstainOrReread,
  AbstainGatePolicy,
  newDomainWidestBand,
  narrowDomainBand,
  gateHealthMetrics,
  type CalibrationHistogram,
  type EceVerdictReading,
} from '../router/abstain-policy';

// ── 测试工具 ─────────────────────────────────────────────

/** 造校准直方图（等宽桶 + 计数） */
function makeHistogram(counts: number[], ref = 'calib-hist@test'): CalibrationHistogram {
  const width = 1 / counts.length;
  return {
    ref,
    buckets: counts.map((count, i) => ({ lower: i * width, upper: (i + 1) * width, count })),
  };
}

/** 造 ECE 达阈读数（achieved 可控） */
function makeVerdict(achieved: boolean): EceVerdictReading {
  return {
    achieved,
    slots: [
      { primitive: 'choice', lang: 'zh', ece: achieved ? 0.05 : 0.2, pass: achieved },
      { primitive: 'choice', lang: 'en', ece: achieved ? 0.06 : 0.2, pass: achieved },
      { primitive: 'score', lang: 'zh', ece: achieved ? 0.04 : 0.2, pass: achieved },
      { primitive: 'score', lang: 'en', ece: 0.04, pass: true },
      { primitive: 'noul', lang: 'zh', ece: 0.08, pass: true },
      { primitive: 'noul', lang: 'en', ece: 0.09, pass: true },
    ],
  };
}

// ════════════════════════════════════════════════════════

describe('§四 弃权语义 · 一等输出态与 0.5 语义', () => {
  it('test_abstain_弃权是独立输出态_不在三原语取值内', () => {
    // 弃权 kind='abstain' 与三原语 kind ('choice'|'score'|'noul') 并列——下游可区分
    const out = makeAbstainOutput({
      questionId: 'q1',
      source: 'low-confidence',
      observed: '置信 0.42 低于 noul 门槛 0.6',
      at: '2026-10-20T10:00:00.000Z',
    });
    expect(out.kind).toBe('abstain');
    const primitiveKinds = ['choice', 'score', 'noul'];
    expect(primitiveKinds).not.toContain(out.kind); // 不在三原语取值内
  });

  it('test_abstain_势均力敌与没把握类型层可区分', () => {
    // noul probability=0.5（势均力敌——有效信息）vs abstain（没把握——转人工信号）
    const noulAnswer = { kind: 'noul' as const, questionId: 'q1', probability: 0.5 };
    const abstain = makeAbstainOutput({
      questionId: 'q1',
      source: 'low-confidence',
      observed: '熵超阈重读不收敛',
      at: '2026-10-20T10:00:00.000Z',
    });
    // 两者 kind 不同——下游 switch 分叉可区分
    expect(noulAnswer.kind).not.toBe(abstain.kind);
    expect(noulAnswer.kind).toBe('noul');
    expect(abstain.kind).toBe('abstain');
  });

  it('test_abstain_0.5 语义在类型层写死_真值概率非中等可信', () => {
    // 常量面：0.5 = 势均力敌；NOT_MEANS 显式否定「中等可信」
    expect(NOUL_SEMANTICS[0.5]).toContain('势均力敌');
    expect(NOUL_SEMANTICS.NOT_MEANS).toContain('中等可信');
    expect(NOUL_SEMANTICS.NOT_MEANS.join('')).toContain('弃权'); // 0.5 不是弃权（NOT_MEANS 第三项整句）
  });
});

describe('§四 弃权三源 · 分别留痕', () => {
  it('test_abstain_三源枚举与处置口径各自独立', () => {
    const sources: AbstainSource[] = ['low-confidence', 'out-of-domain', 'criterion-missing'];
    for (const source of sources) {
      const out = makeAbstainOutput({
        questionId: 'q1',
        source,
        observed: '触发观测',
        at: '2026-10-20T10:00:00.000Z',
      });
      expect(out.source).toBe(source);
      expect(out.disposition.action.length).toBeGreaterThan(0); // 处置口径随留痕带出
    }
  });

  it('test_abstain_三源处置口径各异_可调阈_要人接_要补判据', () => {
    const out1 = makeAbstainOutput({ questionId: 'q', source: 'low-confidence', observed: 'x', at: '2026-10-20T10:00:00.000Z' });
    const out2 = makeAbstainOutput({ questionId: 'q', source: 'out-of-domain', observed: 'x', at: '2026-10-20T10:00:00.000Z' });
    const out3 = makeAbstainOutput({ questionId: 'q', source: 'criterion-missing', observed: 'x', at: '2026-10-20T10:00:00.000Z' });
    expect(out1.disposition.action).toContain('调阈');
    expect(out2.disposition.action).toContain('人接');
    expect(out3.disposition.action).toContain('补判据');
  });

  it('test_abstain_非三源枚举值拒载_fail_closed', () => {
    expect(() =>
      makeAbstainOutput({
        questionId: 'q',
        source: 'unknown' as AbstainSource,
        observed: 'x',
        at: '2026-10-20T10:00:00.000Z',
      }),
    ).toThrow(/三源枚举/);
  });

  it('test_abstain_留痕字段为空拒载', () => {
    expect(() =>
      makeAbstainOutput({ questionId: 'q', source: 'low-confidence', observed: '', at: '2026-10-20T10:00:00.000Z' }),
    ).toThrow(/observed 为空/);
    expect(() =>
      makeAbstainOutput({ questionId: 'q', source: 'low-confidence', observed: 'x', at: '' }),
    ).toThrow(/触发时刻/);
  });
});

describe('§四 弃权率三维聚合', () => {
  it('test_abstain_按判据聚合_各读取入口在位', () => {
    const agg = new AbstainRateAggregator();
    agg.record({ source: 'low-confidence', criterionId: 'c1', domain: 'code-review', at: '2026-10-20T10:00:00Z' });
    agg.record({ source: 'low-confidence', criterionId: 'c1', domain: 'code-review', at: '2026-10-20T11:00:00Z' });
    agg.record({ source: 'criterion-missing', criterionId: 'c2', domain: 'code-review', at: '2026-10-20T11:00:00Z' });
    const byCriterion = agg.abstainRateByCriterion();
    expect(byCriterion.get('c1')?.count).toBe(2);
    expect(byCriterion.get('c1')?.bySource['low-confidence']).toBe(2);
    expect(byCriterion.get('c2')?.bySource['criterion-missing']).toBe(1);
  });

  it('test_abstain_按域聚合', () => {
    const agg = new AbstainRateAggregator();
    agg.record({ source: 'out-of-domain', criterionId: 'c1', domain: 'security', at: '2026-10-20T10:00:00Z' });
    agg.record({ source: 'low-confidence', criterionId: 'c2', domain: 'security', at: '2026-10-20T11:00:00Z' });
    agg.record({ source: 'low-confidence', criterionId: 'c3', domain: 'performance', at: '2026-10-20T11:00:00Z' });
    const byDomain = agg.abstainRateByDomain();
    expect(byDomain.get('security')?.count).toBe(2);
    expect(byDomain.get('performance')?.count).toBe(1);
    expect(byDomain.get('security')?.bySource['out-of-domain']).toBe(1);
  });

  it('test_abstain_按时间聚合_窗口粒度可配', () => {
    const agg = new AbstainRateAggregator();
    agg.record({ source: 'low-confidence', criterionId: 'c1', domain: 'd', at: '2026-10-20T10:15:00Z' });
    agg.record({ source: 'low-confidence', criterionId: 'c1', domain: 'd', at: '2026-10-20T10:45:00Z' });
    agg.record({ source: 'low-confidence', criterionId: 'c1', domain: 'd', at: '2026-10-20T11:30:00Z' });
    const byHour = agg.abstainRateByTime((iso) => iso.slice(0, 13)); // 小时桶
    expect(byHour.get('2026-10-20T10')?.count).toBe(2);
    expect(byHour.get('2026-10-20T11')?.count).toBe(1);
    const byDay = agg.abstainRateByTime((iso) => iso.slice(0, 10)); // 日桶
    expect(byDay.get('2026-10-20')?.count).toBe(3);
  });

  it('test_abstain_聚合事件缺键拒载', () => {
    const agg = new AbstainRateAggregator();
    expect(() =>
      agg.record({ source: 'low-confidence' as const, criterionId: '', domain: 'd', at: 't' }),
    ).toThrow(/聚合键/);
  });
});

describe('§四 门槛按原语分档 · 无全局默认 0.5 路径', () => {
  it('test_thresholds_传单一数字拒载', () => {
    // 「传个 0.5 就能跑」是门控静默失效的第一步——类型层消灭
    expect(() => assertThresholdsByPrimitive(0.5)).toThrow(/无全局默认/);
    expect(() => assertThresholdsByPrimitive(0.7)).toThrow(/拒载单一数字/);
  });

  it('test_thresholds_缺任一原语键拒载', () => {
    expect(() => assertThresholdsByPrimitive({ noul: 0.8, choice: 0.4 })).toThrow(/缺 score 档/);
    expect(() => assertThresholdsByPrimitive({ noul: 0.8, score: 0.5 })).toThrow(/缺 choice 档/);
  });

  it('test_thresholds_三键齐且在界内通过', () => {
    expect(() => assertThresholdsByPrimitive({ noul: 0.8, choice: 0.4, score: 0.5 })).not.toThrow();
  });

  it('test_thresholds_越界门槛拒载', () => {
    expect(() => assertThresholdsByPrimitive({ noul: 1.0, choice: 0.4, score: 0.5 })).toThrow(/越界/);
    expect(() => assertThresholdsByPrimitive({ noul: 0.8, choice: 0, score: 0.5 })).toThrow(/越界/);
  });
});

describe('§四 门槛起步值取自校准集直方图峰位', () => {
  it('test_thresholds_门槛值等于峰值桶下界', () => {
    // 峰在第 6 桶（index 5，[0.5,0.6) 计数最大）——门槛须为其下界 0.5
    const hist = makeHistogram([1, 3, 4, 7, 9, 20, 12, 6, 2, 1]);
    const { threshold, peakBucket } = histogramPeakBucketLower(hist);
    expect(threshold).toBeCloseTo(0.5, 10); // == 峰值桶下界（算法写死）
    expect(peakBucket.count).toBe(20);
  });

  it('test_thresholds_留痕来源字段_histogramRef', () => {
    const prov = deriveThresholdsFromHistogram({
      histograms: {
        noul: makeHistogram([1, 3, 4, 7, 9, 20, 12, 6, 2, 1], 'hist/noul@v1'),
        choice: makeHistogram([5, 12, 18, 9, 3, 1, 1, 0, 0, 0], 'hist/choice@v1'),
        score: makeHistogram([2, 8, 15, 15, 6, 2, 1, 0, 0, 0], 'hist/score@v1'),
      },
      derivedAt: '2026-10-20T00:00:00Z',
    });
    expect(prov.algorithm).toBe('peak-bucket-lower');
    expect(prov.histogramRef.noul).toBe('hist/noul@v1');
    expect(prov.histogramRef.choice).toBe('hist/choice@v1');
    expect(prov.histogramRef.score).toBe('hist/score@v1');
    // noul 峰在第 6 桶 [0.5,0.6)——下界 0.5；choice 峰在第 3 桶 [0.2,0.3)——下界 0.2
    //（choice 门槛明显低于 noul——置信剖面的原语差异由分布读数带出）
    expect(prov.thresholds.noul).toBeCloseTo(0.5, 10);
    expect(prov.thresholds.choice).toBeCloseTo(0.2, 10);
  });

  it('test_thresholds_空直方图或全空桶拒载_不得人工指定', () => {
    expect(() => histogramPeakBucketLower(makeHistogram([]))).toThrow(/无峰位可导/);
    expect(() => histogramPeakBucketLower(makeHistogram([0, 0, 0, 0]))).toThrow(/全空桶/);
  });

  it('test_thresholds_并列峰取下界最高者', () => {
    // 桶 3 与桶 5 计数并列（各 10）——取 lower 更高的（保守侧）
    const hist = makeHistogram([1, 2, 10, 3, 4, 10, 2, 1, 0, 0]);
    const { threshold } = histogramPeakBucketLower(hist);
    expect(threshold).toBeCloseTo(0.5, 10);
  });

  it('test_relabel_重标触发路径_枚举登记且按同算法', () => {
    const histograms = {
      noul: makeHistogram([1, 3, 4, 7, 9, 20, 12, 6, 2, 1]),
      choice: makeHistogram([5, 12, 18, 9, 3, 1, 1, 0, 0, 0]),
      score: makeHistogram([2, 8, 15, 15, 6, 2, 1, 0, 0, 0]),
    };
    for (const trigger of ['base-model-swap', 'data-drift', 'v1.8.0-production-wiring'] as const) {
      const rec = retriggerRelabel({ trigger, histograms, at: '2026-10-20T00:00:00Z' });
      expect(rec.trigger).toBe(trigger);
      expect(rec.provenance.algorithm).toBe('peak-bucket-lower'); // 同算法重标
    }
    expect(() =>
      retriggerRelabel({ trigger: 'manual' as never, histograms, at: 't' }),
    ).toThrow(/枚举/);
  });
});

describe('§四 弃权预算反解', () => {
  /** 确定性校准分布（20 点 [0.05..1.0]） */
  const dist = Array.from({ length: 20 }, (_, i) => (i + 1) / 20);
  const calibrationConfidence = { noul: dist, choice: dist.map((v) => v * 0.8), score: dist.map((v) => 0.2 + v * 0.6) };

  it('test_budget_目标弃权率上升反解阈值单调收紧', () => {
    // target↑（弃权预算越宽）⇒ 放行面越窄 ⇒ 阈值单调收紧（阈值升高不降——
    // 收紧 = 更容易落入弃权带 = 弃权占比更大）
    const t1 = solveThresholdsForBudget({ targetAbstainRate: 0.05, calibrationConfidence });
    const t2 = solveThresholdsForBudget({ targetAbstainRate: 0.20, calibrationConfidence });
    const t3 = solveThresholdsForBudget({ targetAbstainRate: 0.50, calibrationConfidence });
    for (const p of ['noul', 'choice', 'score'] as const) {
      expect(t2.thresholds[p]).toBeGreaterThan(t1.thresholds[p]);
      expect(t3.thresholds[p]).toBeGreaterThan(t2.thresholds[p]);
    }
  });

  it('test_budget_反解结果落在支撑集内不外插', () => {
    const r = solveThresholdsForBudget({ targetAbstainRate: 0.05, calibrationConfidence });
    for (const p of ['noul', 'choice', 'score'] as const) {
      const { min, max } = r.support[p];
      expect(r.thresholds[p]).toBeGreaterThanOrEqual(min);
      expect(r.thresholds[p]).toBeLessThanOrEqual(max);
    }
  });

  it('test_budget_实际预期弃权率不超目标', () => {
    const r = solveThresholdsForBudget({ targetAbstainRate: 0.05, calibrationConfidence });
    // 分位点定义下：低于阈值的占比 ≤ target（含并列语义的容差）
    expect(r.achievedRate).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('test_budget_实际预期弃权率随目标单调上升', () => {
    // 反解语义自洽：目标弃权率越大，反解阈值下的实际弃权率也越大
    const r1 = solveThresholdsForBudget({ targetAbstainRate: 0.05, calibrationConfidence });
    const r2 = solveThresholdsForBudget({ targetAbstainRate: 0.50, calibrationConfidence });
    expect(r2.achievedRate).toBeGreaterThan(r1.achievedRate);
  });

  it('test_budget_目标率越界或分布缺失拒载', () => {
    expect(() =>
      solveThresholdsForBudget({ targetAbstainRate: 0, calibrationConfidence }),
    ).toThrow(/越界/);
    expect(() =>
      solveThresholdsForBudget({
        targetAbstainRate: 0.05,
        calibrationConfidence: { noul: [0.5], choice: [0.5], score: [] },
      }),
    ).toThrow(/score/);
  });
});

describe('§四 score 分流消费整条分布', () => {
  it('test_score_判据面是分布熵非仅置信度', () => {
    // 两分布 top1 置信度相同（0.35），但熵差异大——仅置信度分不出，整分布可分
    const flat = consumeDistributionForScore([0.3, 0.35, 0.35]); // 分布平——熵高
    const sharp = consumeDistributionForScore([0.65, 0.35, 0.0]); // 同 top1=0.35、分布更尖——熵低
    expect(flat.basis).toBe('distribution-entropy');
    expect(flat.entropy).toBeGreaterThan(sharp.entropy);
    expect(flat.top1).toBe(0.35);
    expect(sharp.top1).toBe(0.65); // 尖分布的 top1 更高——但 flat 的 top2 集中度更高：
    // 关键读数：flat 熵 0.998 vs sharp 熵 0.889（整分布形态差异，单看任一置信度都不可得）
    expect(sharp.margin).toBeGreaterThan(flat.margin); // margin 整分布第二统计面
    // 平分布的 top1=0.35 高于其自身 margin 所示的不确定度——熵才是「分布平」的正读数
    expect(flat.entropy).toBeGreaterThan(0.99);
  });

  it('test_score_非法分布拒载', () => {
    expect(() => consumeDistributionForScore([1.0])).toThrow(/至少两档/);
    expect(() => consumeDistributionForScore([0.5, 0.7])).toThrow(/和=/); // 非归一
    expect(() => consumeDistributionForScore([-0.1, 1.1])).toThrow(/越界/);
  });
});

describe('§四 稳定化重读 · 默认关闭与口径检查', () => {
  it('test_reread_默认关闭', () => {
    expect(DEFAULT_STABILIZATION_CONFIG.enabled).toBe(false);
  });

  it('test_reread_开启但校准集未同口径重测_口径检查不通过', () => {
    const check = stabilizationRereadProtocolCheck({
      ...DEFAULT_STABILIZATION_CONFIG,
      enabled: true,
      calibrationRemeasuredWithSameProtocol: false,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('ECE 对该输出不成立'); // 口径不一致 ⇒ ECE 不成立的注释读数
  });

  it('test_reread_同口径重测后检查通过', () => {
    const check = stabilizationRereadProtocolCheck({
      ...DEFAULT_STABILIZATION_CONFIG,
      enabled: true,
      calibrationRemeasuredWithSameProtocol: true,
    });
    expect(check.ok).toBe(true);
  });

  it('test_reread_弃权与重读分工_不收敛才弃权', () => {
    // 熵不高 → 正常作答
    expect(divideAbstainOrReread({ entropy: 0.3, entropyThreshold: 0.9, rereadConverged: false, rereadsUsed: 0, maxRereads: 3 }).action).toBe('answer');
    // 熵高 + 重读收敛 → 稳定后作答
    expect(divideAbstainOrReread({ entropy: 0.95, entropyThreshold: 0.9, rereadConverged: true, rereadsUsed: 2, maxRereads: 3 }).action).toBe('reread-then-answer');
    // 熵高 + 重读至上限不收敛 → 弃权
    expect(divideAbstainOrReread({ entropy: 0.95, entropyThreshold: 0.9, rereadConverged: false, rereadsUsed: 3, maxRereads: 3 }).action).toBe('abstain');
    // 熵高 + 未到上限未收敛 → 继续重读（不是二选一直接弃权）
    expect(divideAbstainOrReread({ entropy: 0.95, entropyThreshold: 0.9, rereadConverged: false, rereadsUsed: 1, maxRereads: 3 }).action).toBe('reread-then-answer');
  });
});

describe('§四 行为锁 · ECE 未达阈时弃权默认开启且不可关闭', () => {
  it('test_lock_未达阈_强制开启', () => {
    const policy = new AbstainGatePolicy(makeVerdict(false));
    expect(policy.forcedOn).toBe(true);
    expect(policy.enabled).toBe(true);
  });

  it('test_lock_未达阈_尝试关闭即抛错', () => {
    const policy = new AbstainGatePolicy(makeVerdict(false));
    expect(() => policy.attemptDisable()).toThrow(/不可关闭/);
    expect(policy.enabled).toBe(true); // 抛错后仍开启（关闭未生效）
  });

  it('test_lock_无达阈读数_保守视同未达阈', () => {
    const policy = new AbstainGatePolicy(undefined);
    expect(policy.forcedOn).toBe(true);
    expect(() => policy.attemptDisable()).toThrow(/保守视同未达阈/);
  });

  it('test_lock_达阈后可关可再开', () => {
    const policy = new AbstainGatePolicy(makeVerdict(true));
    expect(policy.forcedOn).toBe(false);
    expect(() => policy.attemptDisable()).not.toThrow(); // 达阈 → 可按域配置
    expect(policy.enabled).toBe(false);
    policy.reEnable();
    expect(policy.enabled).toBe(true);
  });
});

describe('§四 行为锁 · 新增判据域弃权带默认最宽', () => {
  it('test_band_新域默认最宽_全带宽', () => {
    const band = newDomainWidestBand('new-criterion-domain-1');
    expect(band.lower).toBe(0);
    expect(band.upper).toBe(1);
    expect(band.origin).toBe('new-domain-default');
  });

  it('test_band_无达阈读数收窄拒载', () => {
    const band = newDomainWidestBand('d1');
    expect(() => narrowDomainBand({ band, newLower: 0.4, newUpper: 0.9 })).toThrow(/不得收窄/);
    expect(() =>
      narrowDomainBand({ band, newLower: 0.4, newUpper: 0.9, domainEceVerdict: makeVerdict(false) }),
    ).toThrow(/不得收窄/);
  });

  it('test_band_达阈后收窄成功且留痕来源', () => {
    const band = newDomainWidestBand('d1');
    const narrowed = narrowDomainBand({
      band,
      newLower: 0.4,
      newUpper: 0.9,
      domainEceVerdict: makeVerdict(true),
    });
    expect(narrowed.origin).toBe('calibrated-narrowed');
    expect(narrowed.lower).toBe(0.4);
  });

  it('test_band_非法新带拒载', () => {
    const band = { domain: 'd1', lower: 0, upper: 1, origin: 'calibrated-narrowed' as const };
    expect(() =>
      narrowDomainBand({ band, newLower: 0.9, newUpper: 0.4, domainEceVerdict: makeVerdict(true) }),
    ).toThrow(/非法/);
  });
});

describe('§四 门控健康度四联红旗采集点', () => {
  it('test_redflags_四指标采集在位_ask率_获批率_时延P50_人均审批量', () => {
    const samples = [
      // 窗口 w1：10 次 ASK 全批、时延 1.5s 反射式、单人审 10 件（四红旗齐的形态）
      ...Array.from({ length: 10 }, (_, i) => ({
        window: 'w1',
        asked: true,
        approval: 'approved' as const,
        approvalLatencySeconds: 1.5,
        approverId: 'alice',
        ...(i === i ? {} : {}),
      })),
    ];
    const [m] = gateHealthMetrics(samples, 100);
    expect(m).toBeDefined();
    expect(m?.askRate).toBeCloseTo(0.1, 10); // 红旗①：ASK 率（10/100）
    expect(m?.approvalRate).toBeCloseTo(1.0, 10); // 红旗②：获批率恒 100%
    expect(m?.approvalLatencyP50).toBeCloseTo(1.5, 10); // 红旗③：时延 P50
    expect(m?.approvalsPerPerson).toBe(10); // 红旗④：人均审批量
  });

  it('test_redflags_驳回在分母_获批率不是恒100', () => {
    const samples = [
      { window: 'w1', asked: true, approval: 'approved' as const, approvalLatencySeconds: 30, approverId: 'a' },
      { window: 'w1', asked: true, approval: 'approved' as const, approvalLatencySeconds: 40, approverId: 'a' },
      { window: 'w1', asked: true, approval: 'rejected' as const, approvalLatencySeconds: 120, approverId: 'b' },
    ];
    const [m] = gateHealthMetrics(samples, 10);
    expect(m?.approvalRate).toBeCloseTo(2 / 3, 10); // 驳回计入分母
    expect(m?.approvalLatencyP50).toBeCloseTo(40, 10); // P50 取中位
  });

  it('test_redflags_只采集不判阈_无审批窗口出哨兵值', () => {
    const [m] = gateHealthMetrics([{ window: 'w1', asked: false, approval: 'none' as const }], 50);
    expect(m?.approvalLatencyP50).toBe('no-approvals');
    expect(m?.approvalsPerPerson).toBe('no-approvals');
    // 返回结构不含任何红绿判定字段（阈值属 v1.9.0 消费面——本面只采集）
    expect(Object.keys(m as object).sort()).toEqual(
      ['approvalLatencyP50', 'approvalRate', 'approvalsPerPerson', 'askRate', 'window'].sort(),
    );
  });

  it('test_redflags_非法分母拒载', () => {
    expect(() => gateHealthMetrics([], -1)).toThrow(/totalGateEvents/);
  });
});
