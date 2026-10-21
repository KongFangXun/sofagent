// calibration.test.ts · v1.7.0 §二 · 校准实现单测
// 覆盖面（对齐 §二验收 7 条）：
//   1. 拟合正确性——已知分布校准后 ECE 下降（构造过度自信样本 → 拟合 → ECE 降）
//   2. fit→apply 往返 + 粒度配置读取断言（改 bucketCount → 桶数变）
//   3. score 保序（校准前后档位 argmax 一致 + 相邻档序不变）
//   4. 校准集隔离断言（交集非空返回违规清单）
//   5. 无权重加载（loadCalibration 只读 JSON 不触权重面 + 缺信息 fail-closed）
//   6. computeEce 空样本返回 not-measured 哨兵（非 0）
//   7. TVD（已知题集全变差 + 空题集哨兵）
//   8. 达阈判定（达标 / 未达标 / not-measured 三组）
//   9. 门槛按原语分档重标（thresholdsByPrimitive——不得回落全局默认）
import { describe, it, expect } from 'vitest';
import {
  bucketedTemperatureFit,
  applyBucketedTemperature,
  resolveCalibrationConfig,
  assertDisjoint,
  computeEce,
  binRecords,
  serializeCalibration,
  loadCalibration,
  buildCalibrationReport,
  knownProbabilityTvd,
  totalVariationDistance,
  buildKnownProbabilityQuestionSet,
  eceVerdict,
  thresholdsByPrimitive,
  goldenSectionMinimize,
  calibrateAfterTraining,
  ECE_HARD_LINE,
  ECE_NOT_MEASURED,
  STATISTIC_NAME,
  CalibrationError,
  type CalibrationFitItem,
} from '../rlcd/calibration';
import type { RlcdTrainSample } from '../rlcd/train-rlcd';

/** 构造 noul 校准样本（确定性伪随机——固定模式，不依赖外部随机源） */
function noulItems(
  count: number,
  truthProb: number,
  overconfidence: number,
  familyPrefix = 'fam',
): CalibrationFitItem[] {
  const out: CalibrationFitItem[] = [];
  for (let i = 0; i < count; i++) {
    const outcome = (i % 100) < truthProb * 100; // 确定性频率 = truthProb
    // 报出概率：真值向 overconfidence 方向拉伸（>1 过度自信，=1 已校准）
    const stretched = truthProb + (truthProb - 0.5) * (overconfidence - 1);
    const p = Math.min(Math.max(stretched, 0.01), 0.99);
    out.push({
      primitive: 'noul',
      lang: i % 2 === 0 ? 'zh' : 'en',
      familyKey: `${familyPrefix}-${i % 10}`,
      reportedProb: p,
      outcome,
    });
  }
  return out;
}

describe('§二 分桶温度拟合与往返', () => {
  it('test_goldenSection_单谷函数收敛到已知极小点', () => {
    // f(x) = (x-2)² 在 [0,5] 上极小点 x=2（一维优化器的正确性锚）
    const r = goldenSectionMinimize((x) => (x - 2) * (x - 2), 0, 5);
    expect(r.x).toBeCloseTo(2, 4);
    expect(r.fx).toBeCloseTo(0, 8);
  });

  it('test_fit_overconfidentNoul拟合后温度大于1_ECE下降', () => {
    // 构造：真值 0.7、报出 0.86（过度自信）——温度 > 1 会把 0.86 压回 ~0.7
    const items = noulItems(200, 0.7, 1.5333); // 0.7 + 0.2*0.5333 ≈ 0.86
    const fit = bucketedTemperatureFit({ items });
    // 拟合正确性：校准后 ECE 须低于校准前
    const beforeBins = binRecords(
      items.map((it) => ({ predicted: it.reportedProb as number, actual: (it.outcome as boolean) ? 1 : 0 })),
      10,
    );
    const afterBins = binRecords(
      items.map((it) => ({
        predicted: applyBucketedTemperature(fit, it).prob as number,
        actual: (it.outcome as boolean) ? 1 : 0,
      })),
      10,
    );
    const eceBefore = computeEce(beforeBins) as number;
    const eceAfter = computeEce(afterBins) as number;
    expect(eceAfter).toBeLessThan(eceBefore);
  });

  it('test_fitToApply_往返一致_apply结果落在概率域', () => {
    const items = noulItems(50, 0.6, 1.4);
    const fit = bucketedTemperatureFit({ items });
    for (const it of items) {
      const { prob } = applyBucketedTemperature(fit, it);
      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThanOrEqual(1);
      // noul 过半语义保序：校准前 ≥0.5 ⇒ 校准后 ≥0.5
      expect((prob as number) >= 0.5).toBe((it.reportedProb as number) >= 0.5);
    }
    expect(fit.monotonicity.held).toBe(true);
  });

  it('test_bucketCount_配置读取断言_改配置桶数变', () => {
    const items = noulItems(60, 0.6, 1.3);
    const fit5 = bucketedTemperatureFit({ items, config: { bucketCount: 5 } });
    const fit10 = bucketedTemperatureFit({ items }); // 缺省 10
    expect(fit5.bucketCount).toBe(5);
    expect(fit5.buckets).toHaveLength(5);
    expect(fit10.bucketCount).toBe(10);
    expect(fit10.buckets).toHaveLength(10);
    // 非法粒度拒载
    expect(() => resolveCalibrationConfig({ bucketCount: 1 })).toThrow(CalibrationError);
    expect(() => resolveCalibrationConfig({ bucketCount: 101 })).toThrow(CalibrationError);
  });

  it('test_choice三原语分别_多类分布拟合与apply', () => {
    // choice 三选：真值集中首项 60%，报出过度集中 85%
    const items: CalibrationFitItem[] = [];
    for (let i = 0; i < 120; i++) {
      const selected = (i % 10) < 6 ? 0 : i % 3 === 0 ? 1 : 2;
      items.push({
        primitive: 'choice',
        lang: i % 2 === 0 ? 'zh' : 'en',
        familyKey: `ch-${i % 8}`,
        reportedDist: [0.85, 0.08, 0.07],
        realizedIndex: selected,
      });
    }
    const fit = bucketedTemperatureFit({ items });
    expect(fit.primitive).toBe('choice');
    expect(fit.monotonicity.held).toBe(true);
    const { dist } = applyBucketedTemperature(fit, { primitive: 'choice', reportedDist: [0.85, 0.08, 0.07] });
    // 温度 > 1：报出分布被压平（首项 < 0.85）；argmax 仍是首项（保序）
    expect(dist?.[0]).toBeLessThan(0.85);
    expect(dist?.[0]).toBeGreaterThan(dist?.[1] as number);
  });

  it('test_score保序_校准不破档位序结构', () => {
    // score 有序三档：真值集中中档，报出向高档偏（序信息保持的检验面）
    const items: CalibrationFitItem[] = [];
    for (let i = 0; i < 150; i++) {
      const truthDist = (i % 10) < 5 ? [0.2, 0.5, 0.3] : [0.3, 0.4, 0.3];
      items.push({
        primitive: 'score',
        lang: i % 2 === 0 ? 'zh' : 'en',
        familyKey: `sc-${i % 9}`,
        reportedDist: [0.25, 0.3, 0.45],
        truthDist,
      });
    }
    const fit = bucketedTemperatureFit({ items });
    // 保序断言（§二验收第 2 条）：argmax 档不位移 + 相邻档序不变
    expect(fit.monotonicity.held).toBe(true);
    expect(fit.monotonicity.violations).toHaveLength(0);
    const after = applyBucketedTemperature(fit, { primitive: 'score', reportedDist: [0.25, 0.3, 0.45] });
    expect(after.dist?.indexOf(Math.max(...(after.dist as number[])))).toBe(2); // argmax 仍是高档位
  });

  it('test_混装原语_拒载', () => {
    const mixed: CalibrationFitItem[] = [
      { primitive: 'noul', lang: 'zh', familyKey: 'a', reportedProb: 0.7, outcome: true },
      { primitive: 'choice', lang: 'zh', familyKey: 'b', reportedDist: [0.5, 0.5], realizedIndex: 0 },
    ];
    expect(() => bucketedTemperatureFit({ items: mixed })).toThrow(/混装原语/);
  });
});

describe('§二 校准集隔离断言', () => {
  it('test_assertDisjoint_交集非空返回违规清单', () => {
    const train = noulItems(10, 0.6, 1.2, 'train');
    const calib = noulItems(10, 0.6, 1.2, 'calib');
    calib[3]!.familyKey = train[3]!.familyKey; // 注入一个共同家族键
    const r = assertDisjoint(train, calib);
    expect(r.disjoint).toBe(false);
    expect(r.violations).toContain(train[3]!.familyKey);
  });

  it('test_assertDisjoint_无交集通过', () => {
    const train = noulItems(10, 0.6, 1.2, 'train');
    const calib = noulItems(10, 0.6, 1.2, 'calib');
    const r = assertDisjoint(train, calib);
    expect(r.disjoint).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('test_calibrateAfterTraining_隔离违规时isolationRefused_防污染ECE', () => {
    const trainSamples: RlcdTrainSample[] = [
      {
        key: { criterionId: 'crit-a', language: 'zh' },
        labelSource: 'deterministic',
        probabilityTarget: { noulReported: 0.7, noulOutcome: true },
        realizedOutcome: { noulReported: 0.7, noulOutcome: true },
      },
    ];
    // 校准集样本的 familyKey 与训练样本 criterionId 相同 → 违规（criterionId 直配）
    const calibItems = noulItems(20, 0.6, 1.3, 'x');
    for (const it of calibItems) it.familyKey = 'crit-a';
    const r = calibrateAfterTraining({
      primitiveBuckets: { noul: calibItems },
      trainSamples,
    });
    expect(r.isolationRefused).toBe(true);
    expect(r.isolation.disjoint).toBe(false);
    // CR3 🟠-3：违规 ⇒ 拒出读数（fail-closed 落地）——fits 全部 not-fit，
    // 不产出任何可被消费的桶温拟合（此前只置标志、拟合照常产出完整产物）
    expect(r.fits).toHaveLength(3);
    for (const f of r.fits) {
      expect(f.status).toBe('not-fit');
      expect('fit' in f && f.fit !== undefined).toBe(false);
    }
  });

  it('test_assertDisjoint_粒度错配_校准键为训练判据细分时拒绝', () => {
    // 复核第 1 轮漏报 case：训练侧键=criterionId 'crit-a'、校准侧键=
    // familyKey 'crit-a:sub-1'——同判据不同字串，字串精确比对会放过
    const train = noulItems(5, 0.6, 1.2, 'ignored');
    for (const it of train) it.familyKey = 'crit-a';
    const calib = noulItems(5, 0.6, 1.2, 'ignored');
    for (const it of calib) it.familyKey = 'crit-a:sub-1';
    const r = assertDisjoint(train, calib);
    expect(r.disjoint).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain('crit-a:sub-1');
    expect(r.violations[0]).toContain('粒度错配');
    expect(r.violations[0]).toContain('crit-a');
  });

  it('test_assertDisjoint_粒度错配_对称面_训练键为校准判据细分时拒绝', () => {
    // 对称漏报面：训练侧细分键 vs 校准侧粗键
    const train = noulItems(5, 0.6, 1.2, 'ignored');
    for (const it of train) it.familyKey = 'crit-b:tenant-1';
    const calib = noulItems(5, 0.6, 1.2, 'ignored');
    for (const it of calib) it.familyKey = 'crit-b';
    const r = assertDisjoint(train, calib);
    expect(r.disjoint).toBe(false);
    expect(r.violations[0]).toContain('粒度错配');
  });

  it('test_assertDisjoint_异判据不误伤_前缀相似但非冒号层级', () => {
    // 'crit-a' 与 'crit-ab' 前缀相似但非 `:` 层级细分 → 仍隔离通过；
    // 不同判据的正常细分并存亦通过
    const train = noulItems(3, 0.6, 1.2, 'ignored');
    for (const it of train) it.familyKey = 'crit-a';
    const calib = noulItems(3, 0.6, 1.2, 'ignored');
    for (const it of calib) it.familyKey = 'crit-ab:sub';
    const r = assertDisjoint(train, calib);
    expect(r.disjoint).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('test_calibrateAfterTraining_粒度错配隔离拒绝_原漏报case转红', () => {
    // 复核第 1 轮原漏报 case 的生产面入口：trainSamples criterionId
    // 'crit-a' + 校准 familyKey 'crit-a:sub-1' → isolationRefused=true
    const trainSamples: RlcdTrainSample[] = [
      {
        key: { criterionId: 'crit-a', language: 'zh' },
        labelSource: 'deterministic',
        probabilityTarget: { noulReported: 0.7, noulOutcome: true },
        realizedOutcome: { noulReported: 0.7, noulOutcome: true },
      },
    ];
    const calibItems = noulItems(20, 0.6, 1.3, 'x');
    for (const it of calibItems) it.familyKey = 'crit-a:sub-1';
    const r = calibrateAfterTraining({
      primitiveBuckets: { noul: calibItems },
      trainSamples,
    });
    expect(r.isolationRefused).toBe(true);
    expect(r.isolation.disjoint).toBe(false);
    expect(r.isolation.violations[0]).toContain('粒度错配');
  });
});

describe('§二 ECE 与 not-measured 哨兵', () => {
  it('test_computeEce_空样本返回哨兵字符串非0', () => {
    const ece = computeEce([]);
    expect(ece).toBe(ECE_NOT_MEASURED);
    expect(typeof ece).toBe('string'); // 哨兵是字符串——与数值 0 严格分型
    expect(ece).not.toBe(0);
  });

  it('test_computeEce_标准分箱数值正确', () => {
    // 两桶：5 样本报 0.7 真值率 0.6（|0.7-0.6|=0.1）；5 样本报 0.3 真值率 0.4（|0.3-0.4|=0.1）
    // ECE = 0.5*0.1 + 0.5*0.1 = 0.1
    const records = [
      ...Array.from({ length: 3 }, () => ({ predicted: 0.7, actual: 1 as 0 | 1 })),
      ...Array.from({ length: 2 }, () => ({ predicted: 0.7, actual: 0 as 0 | 1 })),
      ...Array.from({ length: 2 }, () => ({ predicted: 0.3, actual: 1 as 0 | 1 })),
      ...Array.from({ length: 3 }, () => ({ predicted: 0.3, actual: 0 as 0 | 1 })),
    ];
    expect(computeEce(binRecords(records, 10))).toBeCloseTo(0.1, 6);
  });

  it('test_binRecords_空桶avg为0不计歪ECE', () => {
    const bins = binRecords([{ predicted: 0.55, actual: 1 }], 10);
    // 只有 [0.5,0.6) 桶有样本——空桶 count=0
    expect(bins.filter((b) => b.count === 0)).toHaveLength(9);
    expect(computeEce(bins)).toBeCloseTo(0.45, 6); // |0.55-1| = 0.45
  });
});

describe('§二 独立制品（无权重加载）', () => {
  it('test_serializeLoad_往返一致_无权重亦可加载', () => {
    const items = noulItems(40, 0.65, 1.35);
    const fit = bucketedTemperatureFit({ items });
    const json = serializeCalibration(fit, { evaluatorVersion: 'judge-eval@v1.7.0' });
    const loaded = loadCalibration(json);
    // 加载只读 JSON——不触任何权重面（loadCalibration 签名无权重参数即断言面）
    expect(loaded.schema).toBe('calibration-artifact/v1');
    expect(loaded.primitive).toBe('noul');
    expect(loaded.bucketCount).toBe(fit.bucketCount);
    expect(loaded.temperatures).toHaveLength(fit.buckets.length);
    expect(loaded.temperatures[0]?.temperature).toBeCloseTo(fit.buckets[0]?.temperature as number, 10);
    expect(loaded.statistic).toBe(STATISTIC_NAME);
    expect(loaded.evaluatorVersion).toBe('judge-eval@v1.7.0');
    expect(loaded.fittedAt).toBeTruthy();
  });

  it('test_loadCalibration_缺校准信息fail_closed拒载', () => {
    // 逐项剔除校准信息字段——任一缺失须拒载
    const base = JSON.parse(
      serializeCalibration(bucketedTemperatureFit({ items: noulItems(30, 0.6, 1.3) }), { evaluatorVersion: 'ev-1' }),
    ) as Record<string, unknown>;
    for (const field of ['primitive', 'temperatures', 'evaluatorVersion', 'fittedAt', 'fitMetrics']) {
      const broken = { ...base };
      delete broken[field];
      expect(() => loadCalibration(JSON.stringify(broken))).toThrow(CalibrationError);
    }
    expect(() => loadCalibration('not-json')).toThrow(CalibrationError);
  });

  it('test_serialize_概率字段无toFixed截断', () => {
    // 概率有效位数：序列化点无 toFixed/精度截断（JSON.stringify 保全长位数）
    const items = noulItems(30, 0.6, 1.3);
    const fit = bucketedTemperatureFit({ items });
    const json = serializeCalibration(fit, { evaluatorVersion: 'ev' });
    expect(json).not.toMatch(/toFixed/);
    const loaded = loadCalibration(json);
    const temps = loaded.temperatures.map((t) => t.temperature);
    const orig = fit.buckets.map((b) => b.temperature);
    for (let i = 0; i < temps.length; i++) {
      expect(temps[i]).toBe(orig[i]); // 逐位全等——无通道精度损失
    }
  });
});

describe('§二 三态对照报告', () => {
  it('test_buildCalibrationReport_三态并列_空态ECE为哨兵', () => {
    const trained = Array.from({ length: 20 }, (_, i) => ({
      predicted: 0.8,
      actual: ((i % 10) < 7 ? 1 : 0) as 0 | 1,
    }));
    const calibrated = Array.from({ length: 20 }, (_, i) => ({
      predicted: 0.71,
      actual: ((i % 10) < 7 ? 1 : 0) as 0 | 1,
    }));
    const report = buildCalibrationReport({
      zeroShotRecords: [], // 第一态空——训练基座本版未实测时
      trainedRecords: trained,
      calibratedRecords: calibrated,
    });
    expect(report.states.zeroShot.sampleCount).toBe(0);
    expect(report.states.zeroShot.ece).toBe(ECE_NOT_MEASURED); // 空态哨兵非 0
    expect(report.states.trained.ece).not.toBe(ECE_NOT_MEASURED);
    // 校准后 ECE 优于训练后（0.71 vs 真值 0.7 更近）
    expect(report.states.calibrated.ece as number).toBeLessThan(report.states.trained.ece as number);
    // 第一态口径注记在位（mock 读数不进对照列——W4 接口注释锚）
    expect(report.note).toContain('训练基座本版实测');
    expect(report.note).toContain('mock');
  });
});

describe('§二 已知题集 TVD', () => {
  it('test_tvd_完全重合为0_完全不交为1', () => {
    expect(totalVariationDistance([0.5, 0.5], [0.5, 0.5])).toBe(0);
    expect(totalVariationDistance([1, 0], [0, 1])).toBe(1);
    // 半重合：TVD = ½(|0.7-0.5| + |0.3-0.5|) = 0.2
    expect(totalVariationDistance([0.7, 0.3], [0.5, 0.5])).toBeCloseTo(0.2, 10);
  });

  it('test_knownProbabilityTvd_完全重合题集均值0_偏差题集TVD升', () => {
    const perfect = buildKnownProbabilityQuestionSet();
    const r0 = knownProbabilityTvd(perfect);
    expect(r0.meanTvd).toBe(0);
    // 注入偏差：红球题报出 [0.5, 0.5]（真值 [0.7, 0.3]）——TVD = 0.2
    const biased = buildKnownProbabilityQuestionSet({ 0: [0.5, 0.5] });
    const r1 = knownProbabilityTvd(biased);
    expect(r1.meanTvd as number).toBeGreaterThan(0);
    expect(r1.perQuestion[0]?.tvd).toBeCloseTo(0.2, 10);
  });

  it('test_knownProbabilityTvd_空题集返回not_measured哨兵', () => {
    const r = knownProbabilityTvd([]);
    expect(r.meanTvd).toBe(ECE_NOT_MEASURED);
    expect(r.perQuestion).toHaveLength(0);
  });

  it('test_构造题集_真值由构造可复算', () => {
    const qs = buildKnownProbabilityQuestionSet();
    // 每题真值分布归一（构造合法性——可复算前提）
    for (const q of qs) {
      const sum = q.truthDist.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
    expect(qs[0]?.truthDist).toEqual([0.7, 0.3]); // 30 红 70 蓝
    expect(qs[1]?.truthDist).toEqual([5 / 6, 1 / 6]); // 骰子
  });
});

describe('§二 达阈判定（0.10 冻结线）', () => {
  it('test_eceVerdict_达标组全档通过', () => {
    const r = eceVerdict([
      { primitive: 'choice', lang: 'zh', ece: 0.06 },
      { primitive: 'choice', lang: 'en', ece: 0.08 },
      { primitive: 'score', lang: 'zh', ece: 0.05 },
      { primitive: 'score', lang: 'en', ece: 0.09 },
      { primitive: 'noul', lang: 'zh', ece: 0.04 },
      { primitive: 'noul', lang: 'en', ece: 0.10 }, // 恰在线上——≤ 即达
    ]);
    expect(r.achieved).toBe(true);
    expect(r.hardLine).toBe(ECE_HARD_LINE);
    expect(r.hardLine).toBe(0.10);
  });

  it('test_eceVerdict_未达标组任一档超线即否', () => {
    const r = eceVerdict([
      { primitive: 'choice', lang: 'zh', ece: 0.06 },
      { primitive: 'choice', lang: 'en', ece: 0.13 }, // 超线
      { primitive: 'noul', lang: 'zh', ece: 0.05 },
      { primitive: 'noul', lang: 'en', ece: 0.07 },
    ]);
    expect(r.achieved).toBe(false);
    const failSlot = r.slots.find((s) => !s.pass);
    expect(failSlot?.reason).toContain('未达阈');
  });

  it('test_eceVerdict_not_measured档不得记达标', () => {
    const r = eceVerdict([
      { primitive: 'noul', lang: 'zh', ece: ECE_NOT_MEASURED },
      { primitive: 'noul', lang: 'en', ece: 0.05 },
    ]);
    expect(r.achieved).toBe(false);
    expect(r.slots[0]?.pass).toBe(false);
    expect(r.slots[0]?.reason).toContain('not-measured');
  });
});

describe('§二 门槛按原语分档重标（thresholdsByPrimitive）', () => {
  it('test_thresholds_逐原语出档_不回落全局默认', () => {
    const confs = {
      choice: [0.4, 0.45, 0.5, 0.55, 0.6, 0.65], // choice 剖面偏低（相似选项重排普遍不确定）
      score: [0.3, 0.35, 0.36, 0.37, 0.38, 0.4], // score 剖面密集
      noul: [0.7, 0.8, 0.85, 0.9, 0.92, 0.95], // noul 剖面偏高（是非题判对自信）
    };
    const th = thresholdsByPrimitive(confs);
    expect(th).toHaveLength(3);
    // 逐原语独立门槛——三原语门槛互不相同（分档非全局默认的断言面）
    const values = th.map((t) => t.autoMinConfidence);
    expect(new Set(values).size).toBe(3);
    expect(th.every((t) => t.source === 'calibrated-distribution-quantile')).toBe(true);
    // noul 门槛 > choice 门槛（剖面差异被门槛保留）
    const byP = Object.fromEntries(th.map((t) => [t.primitive, t]));
    expect(byP.noul?.autoMinConfidence).toBeGreaterThan(byP.choice?.autoMinConfidence as number);
  });

  it('test_thresholds_缺原语分布拒载_不得编造默认阈值', () => {
    expect(() => thresholdsByPrimitive({ choice: [0.5, 0.6], noul: [0.8, 0.9] })).toThrow(/score/);
    expect(() => thresholdsByPrimitive({})).toThrow();
  });

  it('test_thresholds_分位参数非法拒载', () => {
    expect(() => thresholdsByPrimitive(
      { choice: [0.5], score: [0.5], noul: [0.5] },
      { qHigh: 0.5, qMid: 0.8 }, // qMid > qHigh 倒置
    )).toThrow(CalibrationError);
  });
});

describe('§二 训练后校准步骤（train-rlcd 消费面）', () => {
  it('test_calibrateAfterTraining_三原语分别拟合_空原语not_fit', () => {
    const noulCalib = noulItems(40, 0.65, 1.3, 'calib-n');
    const r = calibrateAfterTraining({
      primitiveBuckets: { noul: noulCalib }, // choice/score 无校准样本
      trainSamples: [],
    });
    expect(r.isolation.disjoint).toBe(true);
    expect(r.isolationRefused).toBe(false);
    const noulFit = r.fits.find((f) => f.primitive === 'noul');
    expect(noulFit?.status).toBe('fitted');
    expect(noulFit?.fit?.primitive).toBe('noul');
    // 空原语标 not-fit（不虚构拟合）
    expect(r.fits.find((f) => f.primitive === 'choice')?.status).toBe('not-fit');
    expect(r.fits.find((f) => f.primitive === 'score')?.status).toBe('not-fit');
  });
});
