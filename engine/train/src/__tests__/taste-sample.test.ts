// taste-sample.test.ts · v1.7.0 §七 · 品味样本构造 + 三要素校验 + 行为锁测试
// ============================================================
// 覆盖：三要素校验（缺 refs/delta/effect 分别显式拒绝并列缺失项）；
// 空集容忍（insufficient-samples 不报错不造假）；note 不入训练输入；
// ECE 未达阈行为锁（archive-only 不进训练集）；窗口率三态见 effect-backfill。
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildTasteSamples, assertThreeElements, type DivergencePatternInput, type RulerChangeInput } from '../taste-sample';
import { eceVerdict, ECE_HARD_LINE, type PerPrimitivePerLanguageEce } from '../rlcd/calibration';

function pattern(): DivergencePatternInput {
  return {
    patternId: 'div-abc12345',
    memberTs: ['2026-10-19T10:00:00.000Z', '2026-10-19T12:00:00.000Z'],
    windowStart: '2026-10-19T10:00:00.000Z',
    windowEnd: '2026-10-19T12:00:00.000Z',
    involvedSurfaces: ['TOOL_GATE:A1'],
    count: 2,
  };
}

function change(overrides: Partial<RulerChangeInput> = {}): RulerChangeInput {
  return {
    aspect: 'criterion',
    targetId: 'A1-1',
    delta: { op: 'modify', before: { question: '旧问句' }, after: { question: '新问句' } },
    rationale: { trigger: 'override', refs: ['2026-10-19T10:00:00.000Z', '2026-10-19T12:00:00.000Z'], note: '人对机器判定不服（人读留痕）' },
    effect: { windowDays: 30, overrideRateBefore: 0.2, overrideRateAfter: 0.1, verdict: 'improved' },
    ...overrides,
  };
}

/** §二 eceVerdict 行为锁消费：ECE 未达阈（achieved=false）读数 */
function unachievedEceGate() {
  const readings: PerPrimitivePerLanguageEce[] = [
    { primitive: 'noul', lang: 'zh', ece: 0.25 }, // 未达 0.10 线
    { primitive: 'noul', lang: 'en', ece: 0.08 },
  ];
  return eceVerdict(readings);
}

describe('品味样本构造 · 三要素校验', () => {
  it('test_taste_缺refs显式拒绝并列出缺失项', () => {
    const c = change({ rationale: { trigger: 'override', refs: [], note: 'x' } });
    expect(() => assertThreeElements(pattern(), c)).toThrow(/refs/);
  });

  it('test_taste_缺delta显式拒绝（before_after全缺）', () => {
    const c = change({ delta: { op: 'modify' } });
    expect(() => assertThreeElements(pattern(), c)).toThrow(/delta/);
  });

  it('test_taste_缺effect显式拒绝并列出缺失项', () => {
    const c = change();
    delete (c as Partial<RulerChangeInput>).effect;
    expect(() => assertThreeElements(pattern(), c)).toThrow(/effect/);
  });

  it('test_taste_构造器对三缺失类样本逐条拒绝_不静默丢弃', () => {
    // 三类缺失样本混入构造输入——逐条进 rejected 并列缺失项，合法样本照常构造
    const result = buildTasteSamples(
      [
        { pattern: pattern(), change: change({ rationale: { trigger: 'override', refs: [] } }) },
        { pattern: pattern(), change: change({ delta: { op: 'modify' } }) },
        { pattern: pattern(), change: (() => { const c = change(); delete c.effect; return c; })() },
        { pattern: pattern(), change: change({ targetId: 'OK-1' }) },
      ],
      { achieved: true },
    );
    expect(result.rejected.length).toBe(3);
    expect(result.rejected.map((r) => r.targetId)).toEqual(['A1-1', 'A1-1', 'A1-1']);
    for (const r of result.rejected) expect(r.missing.length).toBeGreaterThan(0);
    expect(result.samples.length).toBe(1); // 合法样本不被波及
    expect(result.samples[0]!.rulerChange.targetId).toBe('OK-1');
  });
});

describe('品味样本构造 · 空集容忍与纯净性', () => {
  it('test_taste_零偏离返回空集_insufficient_samples_不报错不造假', () => {
    const result = buildTasteSamples([], { achieved: true });
    expect(result.samples).toEqual([]);
    expect(result.status).toBe('insufficient-samples');
    // 不设样本量下限断言：空集即合法产出（冷启动期 override 稀疏为正常态）
    expect(result.rejected).toEqual([]);
  });

  it('test_taste_note不入训练输入（样本纯净性）', () => {
    const result = buildTasteSamples([{ pattern: pattern(), change: change() }], { achieved: true });
    const sample = result.samples[0]!;
    // 机器消费面只认 trigger/refs/delta/effect 四结构化字段——note 不在任何训练输入字段
    expect(JSON.stringify(sample)).not.toContain('人对机器判定不服');
    expect(sample.trigger).toBe('override');
    expect(sample.refs).toEqual(['2026-10-19T10:00:00.000Z', '2026-10-19T12:00:00.000Z']);
    expect(sample.label).toBe('improved');
    // 样本四要素齐：divergence（事发情境）+ rulerChange（换尺子）+ trigger/refs + label
    expect(sample.divergence.patternId).toBe('div-abc12345');
    expect(sample.rulerChange.delta.after).toEqual({ question: '新问句' });
  });
});

describe('品味样本构造 · ECE 行为锁（未校准只入档不进训练集）', () => {
  it('test_taste_ECE未达阈产出标archive_only_不写入训练集', () => {
    // 消费 §二 eceVerdict 真实输出（achieved=false——noul/zh 档 0.25 > 0.10 线）
    const verdict = unachievedEceGate();
    expect(verdict.achieved).toBe(false);
    const result = buildTasteSamples([{ pattern: pattern(), change: change() }], { achieved: verdict.achieved });
    expect(result.disposition).toBe('archive-only'); // 只入档不进训练集
    expect(result.samples.length).toBe(1); // 样本照常构造（入档面），去向锁在 disposition
  });

  it('test_taste_ECE达阈产出标train_ready', () => {
    const result = buildTasteSamples([{ pattern: pattern(), change: change() }], { achieved: true });
    expect(result.disposition).toBe('train-ready');
  });

  it('test_taste_行为锁冻结线在案_ece_hard_line_0_10', () => {
    // 行为锁依赖 §二冻结线（0.10）——常量对账（事后只许收紧不许放宽）
    expect(ECE_HARD_LINE).toBe(0.10);
    const verdict = eceVerdict([{ primitive: 'noul', lang: 'zh', ece: 0.10 }]);
    expect(verdict.achieved).toBe(true); // 恰在线上 = 达阈（≤）
    const over = eceVerdict([{ primitive: 'noul', lang: 'zh', ece: 0.1001 }]);
    expect(over.achieved).toBe(false);
  });
});
