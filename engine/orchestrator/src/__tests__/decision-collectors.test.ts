// decision-collectors.test.ts · 三源抽取/来源门/去重/泄漏防护/九类采集点归类判据单测
// ============================================================
import { describe, it, expect } from 'vitest';
import { collectFromHistory } from '../router/collectors/history-collector';
import { collectFromHitl } from '../router/collectors/hitl-collector';
import { collectFromPr } from '../router/collectors/pr-collector';
import { collectAll } from '../router/collectors';
import { HardSampleCollector, assertHardSampleKind } from '../router/collectors/hard-sample-collector';
import { validateSample, type DecisionSample } from '../router/decision-dataset-schema';

function baseSample(): DecisionSample {
  const q = { kind: 'noul' as const, id: 'q1', question: '放行？' };
  return {
    state: 'diff: +x',
    questions: [q],
    answers: [{ kind: 'noul', questionId: 'q1', probability: 0.8 }],
    label: { source: 'deterministic' },
    provenance: { traceId: 't1' },
    enterpriseId: 'ent-a',
    lang: 'zh',
  };
}

describe('三源抽取', () => {
  it('test_historyCollector_建链轨迹抽取三元组_格式过章五校验器', () => {
    const r = collectFromHistory([{
      traceId: 'tr-1', statePrefix: 'prefix-state', actualDisposition: 'block',
      chainAnchored: true, origin: 'runtime', enterpriseId: 'e', lang: 'zh',
    }]);
    expect(r.accepted).toHaveLength(1);
    expect(validateSample(r.accepted[0]!)).toHaveLength(0); // 与章五校验器兼容
    expect(r.accepted[0]!.label.source).toBe('deterministic');
    // run-01 项 9：disposition→概率是硬编码映射（allow→0.9 档位承诺），非真实
    // 概率目标——采集器标 calibrationEligible=false，不进校准集（防映射常数污染 ECE）
    expect(r.accepted[0]!.calibrationEligible).toBe(false);
  });
  it('test_historyCollector_未建链_拒收且原因可查', () => {
    const r = collectFromHistory([{ traceId: 'tr-2', statePrefix: 's', actualDisposition: 'allow', chainAnchored: false, enterpriseId: 'e', lang: 'zh' }]);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('未建链');
  });
  it('test_historyCollector_合成与自述来源_拒收', () => {
    const r = collectFromHistory([
      { traceId: 'a', statePrefix: 's', actualDisposition: 'allow', chainAnchored: true, origin: 'synthetic', enterpriseId: 'e', lang: 'zh' },
      { traceId: 'b', statePrefix: 's', actualDisposition: 'allow', chainAnchored: true, origin: 'agent-self-report', enterpriseId: 'e', lang: 'zh' },
    ]);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it('test_hitlCollector_裁决抽human档_理解证据二值随行', () => {
    const r = collectFromHitl([
      { hitlSessionId: 'h1', state: 's', verdict: 'approved', hadEngagement: true, enterpriseId: 'e', lang: 'zh' },
      { hitlSessionId: 'h2', state: 's', verdict: 'rejected', hadEngagement: false, enterpriseId: 'e', lang: 'en' },
    ]);
    expect(r.accepted).toHaveLength(2);
    expect(r.accepted[0]!.label.source).toBe('human-only');
    expect(r.accepted[0]!.hitlMeta.understood).toBe('evidenced');
    expect(r.accepted[1]!.hitlMeta.understood).toBe('unobserved'); // 未观测≠未理解（禁止合并）
  });

  it('test_prCollector_采纳拒绝成标签_中间态跳过', () => {
    const r = collectFromPr([
      { prNumber: 1, state: 's', outcome: 'merged', enterpriseId: 'e', lang: 'zh' },
      { prNumber: 2, state: 's', outcome: 'rejected', enterpriseId: 'e', lang: 'zh' },
      { prNumber: 3, state: 's', outcome: 'changes-requested', enterpriseId: 'e', lang: 'zh' },
    ]);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected[0]!.reason).toContain('中间态');
  });
});

describe('统一入口：去重与泄漏防护', () => {
  it('test_collectAll_近重复被去除留痕_不静默混入', () => {
    const rep = collectAll({
      history: [
        { traceId: 't1', statePrefix: 'same', actualDisposition: 'allow', chainAnchored: true, enterpriseId: 'e', lang: 'zh' },
        { traceId: 't2', statePrefix: 'same', actualDisposition: 'allow', chainAnchored: true, enterpriseId: 'e', lang: 'zh' },
      ],
    });
    expect(rep.samples).toHaveLength(1);
    expect(rep.nearDuplicates).toHaveLength(1);
  });
  it('test_collectAll_同一轨迹不跨训练验证集（轨迹粒度切分）', () => {
    const rep = collectAll({
      history: Array.from({ length: 8 }, (_, i) => ({
        traceId: i < 4 ? 'tr-shared' : `tr-${i}`, // 前 4 条同轨迹
        statePrefix: `state-${i}`,
        actualDisposition: 'allow' as const,
        chainAnchored: true,
        enterpriseId: 'e',
        lang: 'zh' as const,
      })),
    });
    const trainTraces = new Set(rep.split.train.map((s) => s.provenance.traceId));
    const evalTraces = new Set(rep.split.eval.map((s) => s.provenance.traceId));
    for (const t of trainTraces) expect(evalTraces.has(t), `轨迹 ${t} 跨侧`).toBe(false);
  });
  it('test_collectAll_拒收原因分布与中英分列可观测', () => {
    const rep = collectAll({
      history: [{ traceId: 'x', statePrefix: 's', actualDisposition: 'allow', chainAnchored: false, enterpriseId: 'e', lang: 'zh' }],
      hitl: [{ hitlSessionId: 'h', state: 's', verdict: 'approved', hadEngagement: false, enterpriseId: 'e', lang: 'en' }],
    });
    expect(Object.keys(rep.rejectionReasons).length).toBe(1);
    expect(rep.langCounts).toEqual({ zh: 0, en: 1 });
    expect(rep.labelSourceCounts['human-only']).toBe(1);
  });
  it('test_collectAll_冷启动合成通道标记synthetic', () => {
    const rep = collectAll(
      { history: [{ traceId: 't', statePrefix: 's', actualDisposition: 'allow', chainAnchored: true, origin: 'runtime', enterpriseId: 'e', lang: 'zh' }] },
      { coldStartChannels: ['audit-chain-history'] },
    );
    expect(rep.coldStartChannels).toContain('audit-chain-history');
  });
});

describe('九类采集点归类判据', () => {
  const sample = baseSample();
  it('test_hard1_弃权_概率门槛必同记', () => {
    expect(assertHardSampleKind({ kind: 'abstention', sample, evidence: { abstainedOrFallback: { abstained: true, fallbackSelected: false, probability: 0.4, threshold: 0.75 } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'abstention', sample, evidence: { abstainedOrFallback: { abstained: false, fallbackSelected: false, probability: 0.4, threshold: 0.75 } } }).ok).toBe(false);
  });
  it('test_hard2_取舍_必要性检查不过被拒', () => {
    expect(assertHardSampleKind({ kind: 'context-tradeoff', sample, evidence: { pairComparable: { focusBecameUnknownAfterRemoval: true, budget: { candidates: 3, contextWindow: 8192, rerankEnabled: false } } } }).ok).toBe(true);
    const bad = assertHardSampleKind({ kind: 'context-tradeoff', sample, evidence: { pairComparable: { focusBecameUnknownAfterRemoval: false, budget: { candidates: 3, contextWindow: 8192, rerankEnabled: false } } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('必要性检查未过');
  });
  it('test_hard3_路由对比_三档一致不构成本类', () => {
    expect(assertHardSampleKind({ kind: 'routing-divergence', sample, evidence: { layerDivergence: { l0: 'allow', l1: 'ask', l2: 'deny' } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'routing-divergence', sample, evidence: { layerDivergence: { l0: 'allow', l1: 'allow', l2: 'allow' } } }).ok).toBe(false);
  });
  it('test_hard4_措辞不变性_语义等价未确认被拒', () => {
    expect(assertHardSampleKind({ kind: 'paraphrase-invariance', sample, evidence: { paraphraseConfirmed: { semanticEquivalenceConfirmed: true, driftByType: { synonym: 0.02 } } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'paraphrase-invariance', sample, evidence: { paraphraseConfirmed: { semanticEquivalenceConfirmed: false, driftByType: {} } } }).ok).toBe(false);
  });
  it('test_hard5_OOD_判据域在集内被拒_域外分列', () => {
    const col = new HardSampleCollector(() => '2026-10-13T00:00:00Z');
    expect(col.collect({ kind: 'ood', sample, evidence: { oodDomain: { criterionDomain: 'medical-triage', inCurrentCriteriaSet: false } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'ood', sample, evidence: { oodDomain: { criterionDomain: 'audit', inCurrentCriteriaSet: true } } }).ok).toBe(false);
    expect(col.oodSplit().outOfDistribution).toBe(1);
  });
  it('test_hard6_漂移_缺时点被拒', () => {
    expect(assertHardSampleKind({ kind: 'drift', sample, evidence: { driftObserved: { t1BucketReliability: [0.8], t2BucketReliability: [0.5], t1: '2026-09', t2: '2026-10' } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'drift', sample, evidence: { driftObserved: { t1BucketReliability: [], t2BucketReliability: [], t1: '', t2: '' } } }).ok).toBe(false);
  });
  it('test_hard6_漂移_逐桶零变化不构成本类（run-01 项 7）', () => {
    // 两时点在位但可靠图无单向偏移（全等数组）——此前仅查 t1/t2 非空即落 ok
    const noDrift = assertHardSampleKind({
      kind: 'drift', sample,
      evidence: { driftObserved: { t1BucketReliability: [0.8, 0.6], t2BucketReliability: [0.8, 0.6], t1: '2026-09', t2: '2026-10' } },
    });
    expect(noDrift.ok).toBe(false);
    if (!noDrift.ok) expect(noDrift.reason).toContain('逐桶零变化');
    // 长度不齐（分桶口径漂移）同样拒收
    const mismatched = assertHardSampleKind({
      kind: 'drift', sample,
      evidence: { driftObserved: { t1BucketReliability: [0.8], t2BucketReliability: [0.8, 0.5], t1: '2026-09', t2: '2026-10' } },
    });
    expect(mismatched.ok).toBe(false);
    // 至少一桶单调变化才算 drift 类
    expect(assertHardSampleKind({
      kind: 'drift', sample,
      evidence: { driftObserved: { t1BucketReliability: [0.8, 0.6], t2BucketReliability: [0.7, 0.6], t1: '2026-09', t2: '2026-10' } },
    }).ok).toBe(true);
  });
  it('test_hard7_对抗_两形态判据', () => {
    expect(assertHardSampleKind({ kind: 'adversarial', sample, evidence: { adversarialForm: { inducedAnswerShift: true } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'adversarial', sample, evidence: { adversarialForm: { carriesPolicyText: true } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'adversarial', sample, evidence: { adversarialForm: { carriesPolicyText: false } } }).ok).toBe(false);
  });
  it('test_hard7_对抗_缺判别键拒收（run-01 项 6）', () => {
    // 空对象/无判别键——此前 `in` 检查全不命中直落 ok:true（归类虚高）
    const empty = assertHardSampleKind({ kind: 'adversarial', sample, evidence: { adversarialForm: {} } });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toContain('缺判别键');
    // 无关键段的对象同样拒收
    const noKeys = assertHardSampleKind({ kind: 'adversarial', sample, evidence: { adversarialForm: { note: '看起来像对抗样本' } as never } });
    expect(noKeys.ok).toBe(false);
  });
  it('test_hard8_对齐分歧_两侧一致不构成', () => {
    expect(assertHardSampleKind({ kind: 'alignment-disagreement', sample, evidence: { labelConflict: { modelLabel: 'allow', humanLabel: 'deny' } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'alignment-disagreement', sample, evidence: { labelConflict: { modelLabel: 'allow', humanLabel: 'allow' } } }).ok).toBe(false);
  });
  it('test_hard9_出站裁决_白名单内被拒', () => {
    expect(assertHardSampleKind({ kind: 'egress-verdict', sample, evidence: { egressEvent: { host: 'evil.example.com', whitelisted: false } } }).ok).toBe(true);
    expect(assertHardSampleKind({ kind: 'egress-verdict', sample, evidence: { egressEvent: { host: 'api.internal', whitelisted: true } } }).ok).toBe(false);
  });
  it('test_ledger_九类分别落数_零值也落_与未就位可区分', () => {
    const col = new HardSampleCollector();
    const ledgers = col.ledger();
    expect(ledgers).toHaveLength(9);
    for (const l of ledgers) {
      expect(l.hitCount).toBe(0); // 零值也落
      expect(l.collectorReady).toBe(true); // 与「未就位」可区分
      expect(l.lastHitAt).toBeNull();
    }
  });
  it('test_ledger_中英分列落数', () => {
    const col = new HardSampleCollector();
    col.collect({ kind: 'abstention', sample, evidence: { abstainedOrFallback: { abstained: true, fallbackSelected: false, probability: 0.3, threshold: 0.75 } } });
    const enSample = { ...baseSample(), lang: 'en' as const };
    col.collect({ kind: 'abstention', sample: enSample, evidence: { abstainedOrFallback: { abstained: true, fallbackSelected: false, probability: 0.3, threshold: 0.75 } } });
    expect(col.langSplit()).toEqual({ zh: 1, en: 1 });
  });
});
