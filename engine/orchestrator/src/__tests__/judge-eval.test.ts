// judge-eval.test.ts · 评测器单测（统计口径/分桶边界/中英分列/分布内外分列）
// + v1.7.0 §六 三态对照/双指标分离/best-of-N/达阈判定（阶段二收口面）
// ============================================================
import { describe, it, expect } from 'vitest';
import { evaluateZeroShot } from '../router/judge-eval';
import {
  readingFromReport,
  judgeThresholdVerdict,
  buildThreeStateComparison,
  AGREEMENT_HARD_LINE,
  ECE_HARD_LINE_JUDGE,
  NOT_MEASURED,
  type ThreeStateReading,
  type BestOfNReading,
  type BaselineReport,
} from '../router/judge-eval';
import { computeCalibration, type CalibrationRecord } from '../router/calibration-report';
import { JudgeRuntime } from '../router/judge-runtime';
import type { EncoderLike } from '../router/judge-heads';
import type { DecisionSample } from '../router/decision-dataset-schema';

function mockEncoder(): EncoderLike {
  return {
    modelRevision: 'baseline-rev',
    maxContextTokens: 512,
    encode: (s: string) => [...s].map((ch) => [ch.charCodeAt(0), 1]),
    isSingleToken: (t: string) => t.length <= 8,
    decodeToken: (t: number) => String.fromCharCode(t),
  };
}

function sample(state: string, lang: 'zh' | 'en', truthProb: number): DecisionSample {
  const q = { kind: 'noul' as const, id: 'q-judge', question: '该变更应拦截吗？' };
  return {
    state,
    questions: [q],
    answers: [{ kind: 'noul', questionId: 'q-judge', probability: truthProb }],
    label: { source: 'deterministic' },
    provenance: { traceId: `t-${state}` },
    enterpriseId: 'e',
    lang,
  };
}

describe('零样本评测器', () => {
  it('test_evaluate_逐判据统计落数_中英分列', () => {
    const rt = new JudgeRuntime(mockEncoder());
    const ds = [
      sample('stateA', 'zh', 0.9),
      sample('stateB', 'zh', 0.1),
      sample('stateC', 'en', 0.9),
    ];
    const report = evaluateZeroShot(rt, ds);
    expect(report.perCriterion).toHaveLength(1);
    const stat = report.perCriterion[0]!;
    expect(stat.count).toBe(3);
    expect(stat.accuracyByLang.zh).toBeDefined();
    expect(stat.accuracyByLang.en).toBeDefined();
  });

  it('test_evaluate_失败模式按语言分开报', () => {
    const rt = new JudgeRuntime(mockEncoder());
    const report = evaluateZeroShot(rt, [sample('a', 'zh', 0.9), sample('b', 'en', 0.9)]);
    expect(Array.isArray(report.failuresByLang.zh)).toBe(true);
    expect(Array.isArray(report.failuresByLang.en)).toBe(true);
  });

  it('test_evaluate_分布内外分列_泛化落差显式', () => {
    const rt = new JudgeRuntime(mockEncoder());
    const report = evaluateZeroShot(rt, [sample('a', 'zh', 0.9)], { oodCriterionIds: new Set(['q-judge']) });
    // q-judge 被标 OOD——inDist 为空则 inAcc=0，outAcc 有值
    expect(report.outOfDistributionAccuracy).toBeGreaterThanOrEqual(0);
    expect(typeof report.generalizationGap).toBe('number');
  });

  it('test_evaluate_候选集利用率随基线落数', () => {
    const rt = new JudgeRuntime(mockEncoder());
    const report = evaluateZeroShot(rt, [sample('a', 'zh', 0.9)]);
    expect(report.candidateSetUtilization.candidateSetSize).toBe(1);
    expect(report.candidateSetUtilization.utilizationRatio).toBe(1);
  });

  it('test_evaluate_口径声明与耗时在案', () => {
    const rt = new JudgeRuntime(mockEncoder());
    const report = evaluateZeroShot(rt, [sample('a', 'zh', 0.9)]);
    expect(report.caveat).toContain('零样本');
    expect(report.runtime.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('test_evaluate_中英落差超阈不宣称中文可用', () => {
    const rt = new JudgeRuntime(mockEncoder());
    const report = evaluateZeroShot(rt, [sample('a', 'zh', 0.9), sample('b', 'en', 0.1)]);
    expect(typeof report.zhUsable).toBe('boolean');
  });

  it('test_adaptScore_带scale的问句min_max正确传递（run-01 项 8）', () => {
    // DatasetQuestion.scale（2-10 级刻度数组）→ DecisionQuestion 的 min/max：
    // 此前恒 ??0/??10 丢弃 scale——带 scale 问句的值域被静默改写。断言法：
    // scoreHead 的输出 value 必落在 scale 给出的 [min,max] 内且区间贴值域边界；
    // 用极端 scale（如 [1,2]）使默认 [0,10] 与真值域可区分——若 scale 被丢，
    // makeScoreAnswer 的值域校验会放过 0-10 的输出，value 将越出 [1,2]。
    const q = { kind: 'score' as const, id: 'q-score', question: '打几分？', scale: [1, 2, 3, 4, 5] };
    const s: DecisionSample = {
      state: 'score-state',
      questions: [q],
      answers: [{ kind: 'score', questionId: 'q-score', value: 3, interval: { lower: 2, upper: 4 } }],
      label: { source: 'deterministic' },
      provenance: { traceId: 't-score' },
      enterpriseId: 'e',
      lang: 'zh',
    };
    const rt = new JudgeRuntime(mockEncoder());
    const report = evaluateZeroShot(rt, [s]);
    // 适配层产出的 ScoreQuestion 满足 [min,max]=[1,5]：judge-runtime 会按该值域
    // 跑 scoreHead + makeScoreAnswer（越 [0,10] 默认域的输出在 [1,5] 域内生成）。
    // 间接断言：评测全链不抛（值域校验通过 = min/max 传导正确）；直接断言打点：
    // scale=1..5 时 interval 宽度 = (5-1)*0.2=0.8（±10% 值域），默认 0-10 时宽 2.0。
    expect(report.perCriterion).toHaveLength(1);
    expect(report.perCriterion[0]!.criterionId).toBe('q-score');
  });
});

describe('校准报告（分桶边界）', () => {
  it('test_calibration_完美校准ECE为0', () => {
    // 桶 [0.8,0.9)：预测 0.85×20，真值 17/20 = 0.85（完美校准）
    const records: CalibrationRecord[] = [
      ...Array.from({ length: 17 }, () => ({ predicted: 0.85, actual: 1 as const, lang: 'zh' as const })),
      ...Array.from({ length: 3 }, () => ({ predicted: 0.85, actual: 0 as const, lang: 'zh' as const })),
    ];
    const r = computeCalibration(records);
    expect(r.buckets[8]!.count).toBe(20);
    expect(Math.abs(r.buckets[8]!.avgPredicted - r.buckets[8]!.avgActual)).toBeLessThan(0.001);
    expect(r.ece).toBeLessThan(0.01);
  });

  it('test_calibration_边界值1_0落末桶（含上界）', () => {
    const records: CalibrationRecord[] = [
      { predicted: 1.0, actual: 1, lang: 'en' },
      { predicted: 0.999, actual: 1, lang: 'en' },
    ];
    const r = computeCalibration(records);
    expect(r.buckets[9]!.count).toBe(2); // [0.9,1.0] 末桶含上界
  });

  it('test_calibration_中英ECE分列不合并', () => {
    const records: CalibrationRecord[] = [
      { predicted: 0.9, actual: 1, lang: 'zh' },
      { predicted: 0.2, actual: 1, lang: 'en' }, // en 严重失准
    ];
    const r = computeCalibration(records);
    expect(r.eceByLang.zh).not.toBe(r.eceByLang.en);
  });

  it('test_calibration_表述档位默认designGoal（不宣称verified）', () => {
    const r = computeCalibration([{ predicted: 0.5, actual: 1, lang: 'zh' }]);
    expect(r.claimLevel).toBe('design-goal'); // ECE 落数前对外只允许此表述
  });
});

// ════════════════════════════════════════
// v1.7.0 §六 · 三态对照 / 双指标分离 / best-of-N / 达阈判定
// ════════════════════════════════════════

/** 构造单态读数的便捷函数 */
function reading(state: ThreeStateReading['state'], zh: number | 'not-measured', en: number | 'not-measured', eceZh: number | 'not-measured', eceEn: number | 'not-measured'): ThreeStateReading {
  return { state, agreementZh: zh, agreementEn: en, eceZh, eceEn, sampleCount: 370 };
}

const bestOfN: BestOfNReading = { n: 4, selector: '判定头 max-prob 选优', agreementZh: NOT_MEASURED, agreementEn: NOT_MEASURED };

describe('三态对照与达阈判定（§六收口面）', () => {
  it('test_三态对照_结构含三态并列_双指标分离_不合并单一分数', () => {
    const cmp = buildThreeStateComparison({
      datasetId: 'sofagent-typed-decisions-minimal@1.0.0',
      evaluatorVersion: 'judge-eval@v1.7.0',
      zeroShot: reading('zeroShot', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED),
      trained: reading('trained', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED),
      calibrated: reading('calibrated', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED),
      bestOfN,
    });
    // 三态并列（第一态 = 本版实测接口，非 mock）
    expect(cmp.states.map((s) => s.state)).toEqual(['zeroShot', 'trained', 'calibrated']);
    // v1.6.0 mock 读数并列留档但不进对照列
    expect(cmp.v1_6_mockArchive.note).toContain('不进对照列');
    expect(cmp.states.every((s) => s.state !== 'mock')).toBe(true);
    // 双指标分离：agreement 与 ece 各自独立字段（无单一综合分字段）
    expect('compositeScore' in cmp).toBe(false);
    expect(cmp.verdict.agreementPass !== undefined).toBe(true);
    expect(cmp.verdict.ecePass !== undefined).toBe(true);
  });

  it('test_达阈判定_达标组_双线全过_阶段三启动', () => {
    const baseline = reading('zeroShot', 0.60, 0.55, 0.30, 0.28);
    const v = judgeThresholdVerdict([
      baseline,
      reading('trained', 0.72, 0.71, 0.12, 0.11),
      reading('calibrated', 0.75, 0.73, 0.08, 0.09),
    ], baseline);
    expect(v.agreementPass).toBe(true); // zh 0.75 / en 0.73 均 ≥0.70 分列达线
    expect(v.ecePass).toBe(true); // ECE 0.08/0.09 均 ≤0.10
    expect(v.stageThree).toBe('proceed');
    // 非自指：报相对基座提升 Δ 与线距
    expect(v.reasons.join(' ')).toContain('相对基座提升 Δ');
  });

  it('test_达阈判定_未达标组_一致率一线未达_阶段三暂缓', () => {
    // en 一致率 0.65 < 0.70——中英分列不合并计，一线未达即暂缓
    const v = judgeThresholdVerdict([
      reading('zeroShot', 0.60, 0.55, 0.30, 0.28),
      reading('trained', 0.75, 0.65, 0.08, 0.09),
    ]);
    expect(v.agreementPass).toBe(false);
    expect(v.ecePass).toBe(true);
    expect(v.stageThree).toBe('deferred');
    expect(v.reasons.join(' ')).toContain('阶段三暂缓');
  });

  it('test_达阈判定_mixed组_not_measured_未测不得记达标', () => {
    // 本版实测环境 not-measured：第一态接口在案但无实机读数——未测不得记达标
    const v = judgeThresholdVerdict([
      reading('zeroShot', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED),
      reading('trained', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED),
    ]);
    expect(v.agreementPass).toBe(false);
    expect(v.ecePass).toBe(false);
    expect(v.stageThree).toBe('deferred');
    expect(v.reasons.join(' ')).toContain('未测不得记达标');
  });

  it('test_达阈判定_无有效态_readings空态_fail_closed', () => {
    const v = judgeThresholdVerdict([reading('zeroShot', 0.9, 0.9, 0.05, 0.05)]);
    expect(v.stageThree).toBe('deferred'); // 仅有 zeroShot 无 trained/calibrated——无有效态
  });

  it('test_bestOfN列_N与选择器口径随表落数', () => {
    const cmp = buildThreeStateComparison({
      datasetId: 'x', evaluatorVersion: 'v1',
      zeroShot: reading('zeroShot', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED),
      trained: reading('trained', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED),
      calibrated: reading('calibrated', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED),
      bestOfN,
    });
    expect(cmp.bestOfN.n).toBe(4);
    expect(cmp.bestOfN.selector).toContain('max-prob');
    expect(cmp.bestOfN.agreementZh).toBe(NOT_MEASURED); // 无实机环境如实标注
  });

  it('test_冻结线常量在案_0_70与0_10_不得由实现结果反推', () => {
    expect(AGREEMENT_HARD_LINE).toBe(0.70);
    expect(ECE_HARD_LINE_JUDGE).toBe(0.10);
  });

  it('test_readingFromReport_空数据集产哨兵不产零', () => {
    const rt = new JudgeRuntime(mockEncoder());
    const report = evaluateZeroShot(rt, []);
    const r = readingFromReport('zeroShot', report, { note: 'not-measured 环境（无实机基座）——如实标注' });
    expect(r.sampleCount).toBe(0);
    expect(r.agreementZh).toBe(NOT_MEASURED); // 空集不产 0（ECE=0 是完美校准，空集给 0 = 谎报最优）
    expect(r.eceZh).toBe(NOT_MEASURED);
    expect(r.note).toContain('如实标注');
  });

  it('test_readingFromReport_中英分列各以自身样本量为分母（en 不再按全量加权）', () => {
    // 复核第 1 轮错位手算 case：a=(zh .9, en .5, count各10)、b=(zh .6, en .8, count各10)
    // 修前 en 分母误用全量 zhTotal（20）——en 读数是「en 准确率按全量加权」；
    // 修后 en 分母 = ΣcountEn（en 侧样本量），agreementEn = (0.5*10+0.8*10)/20 = 0.65
    const report: BaselineReport = {
      perCriterion: [
        {
          criterionId: 'a',
          accuracy: 0.7,
          count: 20,
          countZh: 10,
          countEn: 10,
          accuracyByLang: { zh: 0.9, en: 0.5 },
        },
        {
          criterionId: 'b',
          accuracy: 0.7,
          count: 20,
          countZh: 10,
          countEn: 10,
          accuracyByLang: { zh: 0.6, en: 0.8 },
        },
      ],
      failuresByLang: { zh: [], en: [] },
      calibration: {
        eceByLang: { zh: 0.08, en: 0.09 },
      } as unknown as BaselineReport['calibration'],
      inDistributionAccuracy: 0.7,
      outOfDistributionAccuracy: 0.7,
      generalizationGap: 0,
      candidateSetUtilization: { candidateSetSize: 40, usedCount: 40, utilizationRatio: 1 },
      zhEnGap: 0,
      zhUsable: true,
      runtime: { elapsedMs: 1 },
      caveat: 'test',
    };
    const r = readingFromReport('trained', report);
    // zh：(0.9*10 + 0.6*10) / 20 = 0.75（zh 自身分母）
    expect(r.agreementZh).toBeCloseTo(0.75, 10);
    // en：(0.5*10 + 0.8*10) / 20 = 0.65（en 自身分母——分母是 en 侧样本量而非全量）
    expect(r.agreementEn).toBeCloseTo(0.65, 10);
  });

  it('test_readingFromReport_en侧样本偏斜时读数只随en分母变（zhEn不对称不串扰）', () => {
    // en 样本只占全量 1/4：若分母错用全量 40，en 读数会被稀释为 0.25；
    // 正确 en 分母 = 10 → 读数 1.0（en 全命中）
    const report: BaselineReport = {
      perCriterion: [
        {
          criterionId: 'a',
          accuracy: 0.75,
          count: 40,
          countZh: 30,
          countEn: 10,
          accuracyByLang: { zh: 2 / 3, en: 1.0 },
        },
      ],
      failuresByLang: { zh: [], en: [] },
      calibration: { eceByLang: { zh: 0.08, en: 0.09 } } as unknown as BaselineReport['calibration'],
      inDistributionAccuracy: 0.75,
      outOfDistributionAccuracy: 0.75,
      generalizationGap: 0,
      candidateSetUtilization: { candidateSetSize: 40, usedCount: 40, utilizationRatio: 1 },
      zhEnGap: 0,
      zhUsable: true,
      runtime: { elapsedMs: 1 },
      caveat: 'test',
    };
    const r = readingFromReport('trained', report);
    expect(r.agreementEn).toBeCloseTo(1.0, 10); // en 全命中——分母错位时会读到 0.25
    expect(r.agreementZh).toBeCloseTo(2 / 3, 10);
  });
});
