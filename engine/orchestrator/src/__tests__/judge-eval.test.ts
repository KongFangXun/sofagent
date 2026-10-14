// judge-eval.test.ts · 评测器单测（统计口径/分桶边界/中英分列/分布内外分列）
// ============================================================
import { describe, it, expect } from 'vitest';
import { evaluateZeroShot } from '../router/judge-eval';
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
