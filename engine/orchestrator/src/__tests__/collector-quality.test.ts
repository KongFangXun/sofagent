// collector-quality.test.ts · 质量门/选样/中英文占比统计单测
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  runQualityGates,
  privateSampleHash,
  FrozenCandidateSet,
  shouldRecalibrateThresholds,
} from '../router/collectors/quality-gates';
import { selectSamples, buildFlippedPair, langRatio } from '../router/collectors/active-sampling';
import type { DecisionSample } from '../router/decision-dataset-schema';

function mkSample(overrides?: Partial<DecisionSample> & { origin?: string; postSplitInfo?: boolean }): DecisionSample {
  const q = { kind: 'noul' as const, id: 'q1', question: '放行？' };
  return {
    state: 'diff-x',
    questions: [q],
    answers: [{ kind: 'noul', questionId: 'q1', probability: 0.8 }],
    label: { source: 'deterministic' },
    provenance: { traceId: 't1' },
    enterpriseId: 'e',
    lang: 'zh',
    ...overrides,
  };
}

describe('门一 来源真实性', () => {
  it('test_gate1_未建链样本_拒收', () => {
    const s = mkSample({ provenance: {} });
    const r = runQualityGates([s]);
    expect(r.rejected[0]!.gate).toBe('gate-1-provenance');
  });
  it('test_gate1_合成来源_默认拒收', () => {
    const s = mkSample({ origin: 'synthetic' } as never);
    const r = runQualityGates([s]);
    expect(r.rejected[0]!.reason).toContain('合成');
  });
});

describe('门二 跨集泄漏', () => {
  it('test_gate2_与公开基准交集_拒收（零交集断言）', () => {
    const s = mkSample();
    const pub = new Set([privateSampleHash(s)]);
    const r = runQualityGates([s], { publicBenchmarkHashes: pub });
    expect(r.rejected[0]!.gate).toBe('gate-2-leakage');
  });
  it('test_gate2_回放泄漏_切分点后信息进前输入_拒收', () => {
    const s = mkSample({ postSplitInfo: true } as never);
    const r = runQualityGates([s], { splitPoint: { at: '2026-10-01T00:00:00Z' } });
    expect(r.rejected[0]!.reason).toContain('回放泄漏');
  });
});

describe('门三 标签噪声对账', () => {
  it('test_gate3_deterministic与human冲突_进复核队列不投票', () => {
    const s = mkSample();
    const labels = new Map([[privateSampleHash(s), [
      { source: 'deterministic', label: 'allow' },
      { source: 'human-only', label: 'deny' },
    ]]]);
    const r = runQualityGates([s], { multiSourceLabels: labels });
    expect(r.reviewQueue).toHaveLength(1);
    expect(r.passed).toHaveLength(1); // 冲突不弃样本——进复核
  });
  it('test_gate3_两侧一致_不进队列', () => {
    const s = mkSample();
    const labels = new Map([[privateSampleHash(s), [
      { source: 'deterministic', label: 'allow' },
      { source: 'human-only', label: 'allow' },
    ]]]);
    const r = runQualityGates([s], { multiSourceLabels: labels });
    expect(r.reviewQueue).toHaveLength(0);
  });
});

describe('门四 校准标注', () => {
  it('test_gate4_硬样本标noProbabilityTarget_不进校准', () => {
    const hard = mkSample({ answers: [{ kind: 'noul', questionId: 'q1' }] }); // 无 probability
    const soft = mkSample();
    const r = runQualityGates([hard, soft]);
    expect(r.noProbabilityTarget).toContain(hard);
    expect(r.calibrationEligible).toContain(soft);
    expect(r.calibrationEligible).not.toContain(hard);
  });
});

describe('主动学习四类选样', () => {
  const s1 = mkSample({ state: 'a' });
  const s2 = mkSample({ state: 'b' });
  it('test_select_uncertainty_近0_5优先且理由留痕', () => {
    const probs = new Map([[privateSampleHash(s1), 0.51], [privateSampleHash(s2), 0.95]]);
    const picks = selectSamples([s1, s2], { strategy: 'uncertainty', probabilities: probs, topK: 1 });
    expect(picks[0]!.sample.state).toBe('a'); // 0.51 更近边界
    expect(picks[0]!.reason).toContain('不确定优先');
  });
  it('test_select_disagreement_分歧哈希命中', () => {
    const dg = new Set([privateSampleHash(s2)]);
    const picks = selectSamples([s1, s2], { strategy: 'disagreement', disagreementHashes: dg, topK: 5 });
    expect(picks).toHaveLength(1);
    expect(picks[0]!.reason).toContain('分歧优先');
  });
  it('test_select_representative_稀疏域优先', () => {
    const a = { ...mkSample({ state: 'a' }), criterionDomain: 'audit' } as DecisionSample;
    const b = { ...mkSample({ state: 'b' }), criterionDomain: 'rare-domain' } as DecisionSample;
    const counts = new Map([['audit', 50], ['rare-domain', 1]]);
    const picks = selectSamples([a, b], { strategy: 'representative', domainCounts: counts, topK: 1 });
    expect((picks[0]!.sample as { criterionDomain: string }).criterionDomain).toBe('rare-domain');
  });
  it('test_select_drift_失准域命中', () => {
    const b = { ...mkSample({ state: 'b' }), criterionDomain: 'drifted' } as DecisionSample;
    const picks = selectSamples([b], { strategy: 'drift', driftedDomains: new Set(['drifted']), topK: 5 });
    expect(picks).toHaveLength(1);
  });
});

describe('焦点翻转对', () => {
  it('test_buildFlippedPair_单变量翻转_标synthetic不进校准', () => {
    const base = mkSample();
    const out = buildFlippedPair({
      base,
      flippedState: 'diff-y',
      flippedAnswer: { kind: 'noul', questionId: 'q1', probability: 0.2 },
      focusFact: '文件在白名单内',
    });
    expect(out.flipped.state).toBe('diff-y');
    expect(out.original.state).toBe('diff-x'); // 其余逐字不动
    expect((out.flipped as { synthetic?: boolean }).synthetic).toBe(true);
    expect(out.flipped.contrastive!.familyId).toBe(out.familyId);
    expect(out.flipped.label.source).toBe('model-judge'); // 扩面非定标
  });
});

describe('候选集冻结与门槛重标', () => {
  it('test_frozenSet_分数只能降_试图升被拒', () => {
    const s = mkSample();
    const h = privateSampleHash(s);
    const frozen = new FrozenCandidateSet([s], new Map([[h, 0.8]]));
    expect(frozen.updateScore(h, 0.9).ok).toBe(false); // 升被拒
    expect(frozen.updateScore(h, 0.7).ok).toBe(true); // 降允许
  });
  it('test_frozenSet_冻结后无追加路径', () => {
    const frozen = new FrozenCandidateSet([mkSample()], new Map());
    const r = frozen.updateScore('unknown-hash', 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('新建集');
  });
  it('test_thresholdRecalibration_换基座或漂移触发', () => {
    expect(shouldRecalibrateThresholds({ baseModelChanged: true })).toBe(true);
    expect(shouldRecalibrateThresholds({ driftDetected: true })).toBe(true);
    expect(shouldRecalibrateThresholds({})).toBe(false);
  });
});

describe('中英文占比分列', () => {
  it('test_langRatio_分列不合并', () => {
    const samples = [mkSample({ lang: 'zh' }), mkSample({ lang: 'zh' }), mkSample({ lang: 'en' })];
    const r = langRatio(samples);
    expect(r.zh).toBe(2);
    expect(r.en).toBe(1);
    expect(r.zhRatio).toBeCloseTo(2 / 3);
  });
});
