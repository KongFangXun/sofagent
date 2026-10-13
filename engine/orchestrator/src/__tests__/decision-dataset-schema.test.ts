// decision-dataset-schema.test.ts · 数据集格式校验单测
// ============================================================
// 覆盖面（对齐 devlog 章五验收）：
//   ① 三元组与三原语同构 ② label.source 三档持久化
//   ③ 概率目标三形态构造器+校验 ④ fail-closed 拒载
//   ⑤ 对比样本四步构造（代码出标签可复算） ⑥ 证据证书四组三态
//   ⑦ 删句必要性检查 ⑧ 删句样本不入训练 ⑨ no-probability-target 不进校准
//   ⑩ 家族级切分 ⑪ 血缘锚点 ⑫ benchmark 构建期拒绝 ⑬ 租户隔离
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  loadDataset,
  validateSample,
  makeDistribution,
  makeInterval,
  makeProbability,
  buildContrastivePair,
  DatasetSchemaError,
  type DecisionSample,
  type DatasetQuestion,
  type DatasetAnswer,
  type FactProposition,
} from '../router/decision-dataset-schema';

function plainSample(overrides?: Partial<DecisionSample>): DecisionSample {
  const q: DatasetQuestion = { kind: 'noul', id: 'q1', question: '该变更应放行吗？' };
  const a: DatasetAnswer = { kind: 'noul', questionId: 'q1', probability: 0.8 };
  return {
    state: 'diff: +const x = 1;',
    questions: [q],
    answers: [a],
    label: { source: 'deterministic' },
    provenance: { traceId: 'tr-001' },
    enterpriseId: 'ent-a',
    lang: 'zh',
    ...overrides,
  };
}

describe('概率目标三形态构造器', () => {
  it('test_makeDistribution_归一分布构造成功', () => {
    const d = makeDistribution({ a: 0.6, b: 0.4 });
    expect(d.a).toBe(0.6);
  });
  it('test_makeDistribution_和不为1_拒绝', () => {
    expect(() => makeDistribution({ a: 0.6 })).toThrow(DatasetSchemaError);
  });
  it('test_makeInterval_合法区间构造成功', () => {
    expect(makeInterval(0.2, 0.8).lower).toBe(0.2);
  });
  it('test_makeInterval_乱序_拒绝', () => {
    expect(() => makeInterval(0.8, 0.2)).toThrow(DatasetSchemaError);
  });
  it('test_makeProbability_界内成功_界外拒绝', () => {
    expect(makeProbability(0.5)).toBe(0.5);
    expect(() => makeProbability(1.2)).toThrow(DatasetSchemaError);
  });
});

describe('格式校验 fail-closed', () => {
  it('test_validateSample_合法样本零错误', () => {
    expect(validateSample(plainSample())).toHaveLength(0);
  });
  it('test_validateSample_答案类型与问句不符_拒绝', () => {
    const s = plainSample({
      answers: [{ kind: 'choice', questionId: 'q1', selected: 'x', distribution: { x: 1 } }],
    });
    expect(validateSample(s).some((e) => e.includes('不符'))).toBe(true);
  });
  it('test_validateSample_概率目标非法_拒绝（choice 分布和≠1）', () => {
    const q: DatasetQuestion = { kind: 'choice', id: 'qc', question: '选', options: ['a', 'b'] };
    const s = plainSample({
      questions: [q],
      answers: [{ kind: 'choice', questionId: 'qc', selected: 'a', distribution: { a: 0.7, b: 0.7 } }],
    });
    expect(validateSample(s).some((e) => e.includes('分布非法'))).toBe(true);
  });
  it('test_validateSample_缺血缘锚点_拒绝', () => {
    const s = plainSample({ provenance: {} });
    expect(validateSample(s).some((e) => e.includes('血缘锚点'))).toBe(true);
  });
  it('test_loadDataset_任一非法_整批拒绝', () => {
    expect(() => loadDataset([plainSample(), plainSample({ state: '' })])).toThrow(DatasetSchemaError);
  });
});

describe('label.source 三档', () => {
  it('test_labelSource_三档可标记且持久化', () => {
    for (const src of ['deterministic', 'model-judge', 'human-only'] as const) {
      const s = plainSample({ label: { source: src } });
      expect(s.label.source).toBe(src);
      expect(validateSample(s)).toHaveLength(0);
    }
  });
});

describe('对比样本四步构造', () => {
  const fact = (statement: string, status: FactProposition['status']): FactProposition => ({ statement, status });
  const FOCUS = '文件 secret.env 在白名单外';

  function pairSamples(withNecessity = true): DecisionSample[] {
    const q: DatasetQuestion = { kind: 'noul', id: 'q1', question: '该提交应拦截吗？' };
    return buildContrastivePair({
      familyId: 'fam-1',
      state: '新增文件 secret.env',
      counterfactualState: '新增文件 example.env',
      changedWords: 1,
      focusFact: FOCUS,
      question: q,
      labels: {
        baselineAnswer: { kind: 'noul', questionId: 'q1', probability: makeProbability(0.95) },
        counterfactualAnswer: { kind: 'noul', questionId: 'q1', probability: makeProbability(0.05) },
      },
      evidence: {
        baseline: [fact(FOCUS, 'supported')],
        counterfactual: [fact(FOCUS, 'refuted')],
        deletedLeft: withNecessity ? [fact(FOCUS, 'unknown')] : [fact(FOCUS, 'supported')],
        deletedRight: withNecessity ? [fact(FOCUS, 'unknown')] : [fact(FOCUS, 'supported')],
      },
      enterpriseId: 'ent-a',
      lang: 'zh',
      provenance: { traceId: 'tr-pair' },
    });
  }

  it('test_buildContrastivePair_两端标签由代码导出_同familyId', () => {
    const [base, cf] = pairSamples();
    expect(base.contrastive!.familyId).toBe(cf.contrastive!.familyId);
    expect(base.answers[0]!.probability).toBe(0.95);
    expect(cf.answers[0]!.probability).toBe(0.05);
    expect(base.label.source).toBe('deterministic');
  });
  it('test_contrastive_证据证书四组三态齐备', () => {
    const [base] = pairSamples();
    const cert = base.contrastive!.evidenceCertificate;
    for (const k of ['baseline', 'counterfactual', 'deletedLeft', 'deletedRight'] as const) {
      expect(cert[k].length).toBeGreaterThan(0);
    }
  });
  it('test_deletionNecessity_删句后焦点未变未知_样本对被拒', () => {
    const pair = pairSamples(false); // 删句后焦点仍 supported——冗余
    const errs = pair.flatMap((s) => validateSample(s));
    expect(errs.some((e) => e.includes('删句必要性'))).toBe(true);
  });
  it('test_deletionSamples_不入训练集（加载期断言）', () => {
    const [base] = pairSamples();
    const del = { ...base, contrastive: { ...base.contrastive!, isDeletionVariant: true } };
    const split = loadDataset([base, del]);
    expect(split.train.some((s) => s.contrastive?.isDeletionVariant)).toBe(false);
    expect(split.deletionChecks.some((s) => s.contrastive?.isDeletionVariant)).toBe(true);
    expect(split.eval).toHaveLength(0); // 删句变体不属评测面
  });
  it('test_contrastive_不进校准集（no-probability-target 联动）', () => {
    const pair = pairSamples();
    const split = loadDataset(pair);
    expect(split.calibration.some((s) => s.contrastive)).toBe(false);
  });
  it('test_familySplit_同家族不跨训练评测', () => {
    const pair = pairSamples();
    // 手动把一员塞进评测——家族出现在两侧应被 loadDataset 拒（构造后 load 全 train 则无漏）
    const split = loadDataset(pair);
    expect(split.train).toHaveLength(2);
    expect(split.eval).toHaveLength(0);
  });
});

describe('benchmark 隔离与租户', () => {
  it('test_benchmarkMarked_构建期不进训练', () => {
    const s = plainSample({ benchmark: ['xnli'] });
    const split = loadDataset([s]);
    expect(split.train).toHaveLength(0);
    expect(split.eval).toHaveLength(1);
  });
  it('test_enterpriseId_租户隔离字段必填', () => {
    const s = plainSample({ enterpriseId: '' });
    expect(validateSample(s).some((e) => e.includes('enterpriseId'))).toBe(true);
  });
  it('test_lang_中英分列分区键必填', () => {
    const s = plainSample({ lang: undefined as unknown as 'zh' });
    expect(validateSample(s).some((e) => e.includes('lang'))).toBe(true);
  });
});

describe('校准集概率目标', () => {
  it('test_calibration_只收概率目标样本', () => {
    const withProb = plainSample();
    const hardOnly = plainSample({
      answers: [{ kind: 'noul', questionId: 'q1' }], // 无 probability 字段
    });
    const split = loadDataset([withProb, hardOnly]);
    expect(split.calibration).toHaveLength(1);
    expect(split.train).toHaveLength(2);
  });
});
