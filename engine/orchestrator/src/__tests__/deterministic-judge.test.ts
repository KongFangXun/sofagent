// ============================================================
// deterministic-judge.test.ts · 确定性判定原语 单元+集成测试
// ============================================================
// 覆盖（架构师设计 §测试）：
// - 判别双闸门（gate A state marker / gate B instructions）逐规则正反例
// - 答案面 fail-closed 歧义清单（平局/等距/序列重复/极值非恰一项/
//   档界乱序/表区间不连续/bin2s 两数不一致/bandIdx 越值域）
// - 边界语义（档界含下不含上 / 满分制同域 / bin2s score==cut 归 1）
// - 留痕 schema（source='deterministic' 而 trace 缺/observed 空 → 抛错）
// - 集成：JudgeRuntime 全命中 encode spy 断言 0 次（零编码快速路径）；
//   deterministic=null 与现状一致（A/B 对照——逐问走模型路径）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  DeterministicJudge,
  DEFAULT_DETERMINISTIC_JUDGE,
  RULE_FAMILY,
  type DeterministicRule,
} from '../router/deterministic-judge';
import {
  makeChoiceQuestion,
  makeChoiceAnswer,
  type ChoiceQuestion,
} from '../router/decision-primitives';
import { JudgeRuntime } from '../router/judge-runtime';
import type { EncoderLike } from '../router/judge-heads';

const judge = DEFAULT_DETERMINISTIC_JUDGE;

// ══════════════════════════════════════════════════════════
// 判别双闸门 · 逐规则正反例
// ══════════════════════════════════════════════════════════

describe('DeterministicJudge.route · 判别双闸门', () => {
  it('extremum：数值序列 + (数值|排列) + 最(大|小)的 + 纯数字选项', () => {
    expect(
      judge.route('数值序列：5233、9982、6194、4109、5418。', '上述数值中最小的是哪一个？', {
        opt0: '5418',
        opt1: '6194',
        opt2: '4109',
        opt3: '5233',
        opt4: '9982',
      }),
    ).toBe('extremum');
    // 干扰前缀（60% 行带）——包含匹配不加 ^ 锚
    expect(
      judge.route('对了，办公室靠窗的那盆绿植上周刚换过一盆。\n数值序列：5233、9982。', '上述数值中最大的是哪一个？', {
        opt0: '5233',
        opt1: '9982',
      }),
    ).toBe('extremum');
    // 「将上述 22 个数值从小到大排列，最大的是哪一个？」——含「排列」「最大的」
    expect(
      judge.route('数值序列：2122、3906。', '将上述 22 个数值从小到大排列，最大的是哪一个？', {
        opt0: '2122',
        opt1: '3906',
      }),
    ).toBe('extremum');
  });

  it('digit-sum 优先于 extremum（最特异先判——「各位数字之和」防被最(大|小)误吞）', () => {
    expect(
      judge.route('数值序列：1933、4777。', '上述 22 个数值中，各位数字之和最大的是哪一个？', {
        opt0: '1933',
        opt1: '4777',
      }),
    ).toBe('digit-sum');
  });

  it('nearest：目标值：N + 与目标值 + (之差最小|最接近|偏离最小)', () => {
    expect(judge.route('目标值：4361。', '哪个候选值与目标值的偏离最小？', { opt0: '3799', opt1: '4379' })).toBe('nearest');
    expect(judge.route('目标值：4361。', '下列选项中，哪一个与目标值之差最小？', { opt0: '3799', opt1: '4379' })).toBe('nearest');
    expect(judge.route('目标值：4361。', '下列哪个数值与目标值最接近？', { opt0: '3799', opt1: '4379' })).toBe('nearest');
  });

  it('binary/edges/table：评审得分族三格式', () => {
    expect(
      judge.route('评审得分：28 分（满分 100 分）。\n判级标准（二分档）：0 档＝未达标（低于 60 分）；1 档＝达标（60 分及以上）。', '依据判级标准，本次评审属于哪一档？', {}),
    ).toBe('binary');
    expect(judge.route('评审得分：51 分（满分 80 分）。\n档界：20/40/60/80。', '按上述档位划分，该得分属于第几档？', {})).toBe('edges');
    // EN DASH（U+2013 –）非 ASCII hyphen
    expect(
      judge.route('评审得分：55 分（满分 80 分）。\n档位标准表：0–20 分＝第 1 档；21–40 分＝第 2 档。', '按上述档位划分，该得分属于第几档？', {}),
    ).toBe('table');
  });

  it('语义面落穿（闸门不过——fail-open 不侵蚀语义判定面）', () => {
    // boolq/csqa/snli 文本选项 → 纯数字闸门拦
    expect(
      judge.route('The tower tilt began during construction…', 'was the leaning tower of pisa built leaning', {
        opt0: 'no',
        opt1: 'yes',
      }),
    ).toBeNull();
    // 状态无 marker → 闸门 A 不过
    expect(judge.route('一段普通中文叙述，不含任何标记。', '上述数值中最大的是哪一个？', { opt0: '1', opt1: '2' })).toBeNull();
    // 数值序列但问句无最(大|小) → 闸门 B 不过
    expect(judge.route('数值序列：5233、9982。', '上述数值的平均值是多少？', { opt0: '5233', opt1: '9982' })).toBeNull();
    // 评审得分但无档界表述 → 落穿（gradelong 同族形态）
    expect(judge.route('评审得分：42 分。评分标准叙述嵌在长文里……', '该得分属于哪一档？', {})).toBeNull();
    // gradelong：档位标准嵌叙述（0-2 级）——本版刻意不识别
    expect(
      judge.route('工单内容：服务不可用。\n评分标准（按紧急程度分 0-2 级）：0 级＝不紧急；1 级＝一般；2 级＝紧急。', '按上述 0-2 级标准，这段工单的紧急程度应评为哪一级？', { opt0: '0 级（不紧急）', opt1: '1 级（一般）', opt2: '2 级（紧急）' }),
    ).toBeNull();
  });

  it('RULE_FAMILY：数值比较三规则→choice、分档评分三格式→score', () => {
    expect(RULE_FAMILY.extremum).toBe('choice');
    expect(RULE_FAMILY.nearest).toBe('choice');
    expect(RULE_FAMILY['digit-sum']).toBe('choice');
    expect(RULE_FAMILY.binary).toBe('score');
    expect(RULE_FAMILY.edges).toBe('score');
    expect(RULE_FAMILY.table).toBe('score');
  });
});

// ══════════════════════════════════════════════════════════
// 复算 · 边界语义 + fail-closed 歧义清单
// ══════════════════════════════════════════════════════════

describe('DeterministicJudge.solve · 边界语义', () => {
  it('extremum：序列极值 → 选项自然序下标（k≥10 家族自然序陷阱）', () => {
    // opt10+ 自然序：字典序会错位——断言 opt10 在 opt2 后
    const optionsDef: Record<string, string> = { opt0: '2122', opt1: '3906', opt2: '1198', opt10: '9068' };
    const ans = judge.solve({
      state: '数值序列：2122、3906、1198、9068。',
      instructions: '上述数值中最大的是哪一个？',
      optionsDef,
      rule: 'extremum',
      at: '2026-10-30T00:00:00Z',
    });
    expect(ans?.value).toBe(3); // 9068 在自然序第 3 位（opt10）
    expect(ans?.trace.rule).toBe('extremum');
    expect(ans?.trace.at).toBe('2026-10-30T00:00:00Z');
  });

  it('edges：档界含下不含上——band = #{e: score > e}（恰好=档界归下一档）', () => {
    // score=20，edges=[20,40,60,80] → 20 不>20 → band 0（证据 L2344 label=0）
    expect(
      judge.solve({ state: '评审得分：20 分（满分 80 分）。\n档界：20/40/60/80。', instructions: '', optionsDef: {}, rule: 'edges' })?.value,
    ).toBe(0);
    // score=21 → 21>20 → band 1（档界+1）
    expect(
      judge.solve({ state: '评审得分：21 分（满分 80 分）。\n档界：20/40/60/80。', instructions: '', optionsDef: {}, rule: 'edges' })?.value,
    ).toBe(1);
    // 满分制同域：51/80 配档界 20/40/60/80 直接映射（51>20,40 → band 2）
    expect(
      judge.solve({ state: '评审得分：51 分（满分 80 分）。\n档界：20/40/60/80。', instructions: '', optionsDef: {}, rule: 'edges' })?.value,
    ).toBe(2);
  });

  it('binary：score==cut 归档 1（「N 分及以上」语义——证据 L1368）', () => {
    const state = '评审得分：60 分（满分 100 分）。\n判级标准（二分档）：0 档＝未达标（低于 60 分）；1 档＝达标（60 分及以上）。';
    expect(judge.solve({ state, instructions: '', optionsDef: {}, rule: 'binary' })?.value).toBe(1);
    const state59 = '评审得分：59 分（满分 100 分）。\n判级标准（二分档）：0 档＝未达标（低于 60 分）；1 档＝达标（60 分及以上）。';
    expect(judge.solve({ state: state59, instructions: '', optionsDef: {}, rule: 'binary' })?.value).toBe(0);
  });

  it('table：EN DASH 表解析 + 含下不含上（与 edges 同规则）', () => {
    // 0–20/21–40/41–60/61–80（EN DASH）：55>20,40 → band 2（证据 L2334 label=2）
    const state = '评审得分：55 分（满分 80 分）。\n档位标准表：0–20 分＝第 1 档；21–40 分＝第 2 档；41–60 分＝第 3 档；61–80 分＝第 4 档。';
    expect(judge.solve({ state, instructions: '', optionsDef: {}, rule: 'table' })?.value).toBe(2);
    // 恰好=档界：80 → 80>20,40,60 → band 3（不越值域）
    const state80 = '评审得分：80 分（满分 80 分）。\n档位标准表：0–20 分＝第 1 档；21–40 分＝第 2 档；41–60 分＝第 3 档；61–80 分＝第 4 档。';
    expect(judge.solve({ state: state80, instructions: '', optionsDef: {}, rule: 'table' })?.value).toBe(3);
  });
});

describe('DeterministicJudge.solve · 答案面 fail-closed 歧义清单（undefined 落穿）', () => {
  const cases: Array<{ name: string; rule: DeterministicRule; state: string; instructions: string; optionsDef: Record<string, string> }> = [
    {
      name: 'nearest 等距平局：目标 10，两选项各距 2',
      rule: 'nearest',
      state: '目标值：10。',
      instructions: '下列哪个数值与目标值最接近？',
      optionsDef: { opt0: '8', opt1: '12' },
    },
    {
      name: 'digit-sum 平局：两选项数字和相等',
      rule: 'digit-sum',
      state: '数值序列：12、21。',
      instructions: '上述数值中，各位数字之和最大的是哪一个？',
      optionsDef: { opt0: '12', opt1: '21' },
    },
    {
      name: 'extremum 序列重复：极值归属歧义风险',
      rule: 'extremum',
      state: '数值序列：5、9、9。',
      instructions: '上述数值中最大的是哪一个？',
      optionsDef: { opt0: '5', opt1: '9', opt2: '9' },
    },
    {
      name: 'extremum 极值不在选项：序列含 9 但选项无 9',
      rule: 'extremum',
      state: '数值序列：5、9。',
      instructions: '上述数值中最大的是哪一个？',
      optionsDef: { opt0: '5' },
    },
    {
      name: 'extremum 序列污染：段内非数字',
      rule: 'extremum',
      state: '数值序列：5、x9。',
      instructions: '上述数值中最大的是哪一个？',
      optionsDef: { opt0: '5', opt1: '9' },
    },
    {
      name: 'edges 档界非严格递增：40 重复',
      rule: 'edges',
      state: '评审得分：45 分。\n档界：20/40/40/80。',
      instructions: '',
      optionsDef: {},
    },
    {
      name: 'edges 档界乱序',
      rule: 'edges',
      state: '评审得分：45 分。\n档界：40/20/60/80。',
      instructions: '',
      optionsDef: {},
    },
    {
      name: 'table 区间不连续：0–20 后接 30–40（缺 21-29）',
      rule: 'table',
      state: '评审得分：25 分。\n档位标准表：0–20 分＝第 1 档；30–40 分＝第 2 档；41–60 分＝第 3 档。',
      instructions: '',
      optionsDef: {},
    },
    {
      name: 'table 档号跳号：无第 2 档',
      rule: 'table',
      state: '评审得分：25 分。\n档位标准表：0–20 分＝第 1 档；21–40 分＝第 3 档。',
      instructions: '',
      optionsDef: {},
    },
    {
      name: 'binary 两数不一致：低于 60 与 65 及以上（缝隙）',
      rule: 'binary',
      state: '评审得分：62 分。\n判级标准（二分档）：0 档＝未达标（低于 60 分）；1 档＝达标（65 分及以上）。',
      instructions: '',
      optionsDef: {},
    },
  ];
  for (const c of cases) {
    it(`${c.name} → undefined`, () => {
      expect(
        judge.solve({ state: c.state, instructions: c.instructions, optionsDef: c.optionsDef, rule: c.rule }),
      ).toBeUndefined();
    });
  }

  it('bandIdx 越值域：score 超出表覆盖范围（table 段数-1 外）', () => {
    // 表只到 80，score=95 → band=4 > 3（segs.length-1）→ undefined
    const state = '评审得分：95 分（满分 100 分）。\n档位标准表：0–20 分＝第 1 档；21–40 分＝第 2 档；41–60 分＝第 3 档；61–80 分＝第 4 档。';
    expect(judge.solve({ state, instructions: '', optionsDef: {}, rule: 'table' })).toBeUndefined();
  });

  it('solveQuestion：路由面 fail-open（不识别→undefined）与答案面统一返回值语义', () => {
    // 不识别（闸门 B 无「最(大|小)的」词）→ undefined
    expect(
      judge.solveQuestion({ state: '数值序列：5233、9982。', instructions: '平均值是多少？', optionsDef: { opt0: '5233', opt1: '9982' } }),
    ).toBeUndefined();
    // 识别 + 歧义 → undefined
    expect(
      judge.solveQuestion({ state: '目标值：10。', instructions: '与目标值最接近？', optionsDef: { opt0: '8', opt1: '12' } }),
    ).toBeUndefined();
    // 识别 + 无歧义 → answer
    expect(
      judge.solveQuestion({ state: '数值序列：5233、9982。', instructions: '上述数值中最大的是哪一个？', optionsDef: { opt0: '5233', opt1: '9982' } })?.value,
    ).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
// 留痕 schema（decision-primitives 构造器校验）
// ══════════════════════════════════════════════════════════

describe('留痕 schema · makeChoiceAnswer 确定性来源校验', () => {
  let cq: ChoiceQuestion;
  beforeEachChoice();

  function beforeEachChoice(): void {
    cq = makeChoiceQuestion(
      'q-det',
      '上述数值中最小的是哪一个？',
      [
        { id: 'opt-0', label: '5418' },
        { id: 'opt-1', label: '4109' },
      ],
      { id: 'opt-fb', label: '以上都不是' },
    );
  }

  // 分布键须与候选集完全一致（含兜底项 opt-fb——makeChoiceAnswer 契约）
  const dist = { 'opt-0': 0.2, 'opt-1': 0.6, 'opt-fb': 0.2 };

  it("source='deterministic' 且 trace 齐 → 通过并落字段", () => {
    const ans = makeChoiceAnswer(cq, 'opt-1', dist, undefined, {
      source: 'deterministic',
      deterministicTrace: { rule: 'extremum', observed: 'min(5418,4109)=4109 → opt-1', at: '2026-10-30T00:00:00Z' },
    });
    expect(ans.source).toBe('deterministic');
    expect(ans.deterministicTrace?.rule).toBe('extremum');
  });

  it("source='deterministic' 而 trace 缺 → 抛错（留痕不留空）", () => {
    expect(() => makeChoiceAnswer(cq, 'opt-1', dist, undefined, { source: 'deterministic' })).toThrow(/trace\.rule 缺/);
  });

  it("source='deterministic' 而 observed 空 → 抛错", () => {
    expect(() =>
      makeChoiceAnswer(cq, 'opt-1', dist, undefined, {
        source: 'deterministic',
        deterministicTrace: { rule: 'extremum', observed: '', at: '2026-10-30T00:00:00Z' },
      }),
    ).toThrow(/trace\.observed 为空/);
  });

  it('带 trace 但 source 缺 → 抛错（trace 只属确定性来源）', () => {
    expect(() =>
      makeChoiceAnswer(cq, 'opt-1', dist, undefined, {
        deterministicTrace: { rule: 'extremum', observed: 'x', at: '2026-10-30T00:00:00Z' },
      }),
    ).toThrow(/source 非 'deterministic'/);
  });

  it('无 opts → 向后兼容（不落 source 字段）', () => {
    const ans = makeChoiceAnswer(cq, 'opt-1', dist);
    expect(ans.source).toBeUndefined();
    expect(ans.deterministicTrace).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// 集成 · JudgeRuntime 确定性前置路由
// ══════════════════════════════════════════════════════════

/** 计数编码器（encode 次数可观测——确定性命中路径须零编码） */
function makeSpyEncoder(): { encoder: EncoderLike; encodeCalls: () => number } {
  let calls = 0;
  const encoder: EncoderLike = {
    modelRevision: 'spy-encoder',
    maxContextTokens: 512,
    encode: (s: string): number[][] => {
      calls += 1;
      return [...s].map((_, i) => [i % 100]);
    },
    isSingleToken: () => true,
    decodeToken: (t: number): string => String(t),
  };
  return { encoder, encodeCalls: () => calls };
}

/** 数值比较问句（五选项——kcc05 形态） */
function numericChoiceQuestion() {
  return makeChoiceQuestion(
    'q-num',
    '上述数值中最小的是哪一个？',
    [
      { id: 'opt-0', label: '5418' },
      { id: 'opt-1', label: '6194' },
      { id: 'opt-2', label: '4109' },
      { id: 'opt-3', label: '5233' },
      { id: 'opt-4', label: '9982' },
    ],
    { id: 'opt-fb', label: '以上都不是' },
  );
}

describe('JudgeRuntime · 确定性前置路由集成', () => {
  it('全命中：encode spy 断言 0 次（零编码快速路径）+ source 留痕', () => {
    const { encoder, encodeCalls } = makeSpyEncoder();
    const runtime = new JudgeRuntime(encoder); // 缺省 new DeterministicJudge() 开启
    const result = runtime.judge({
      state: '数值序列：5233、9982、6194、4109、5418。',
      questions: [numericChoiceQuestion()],
    });
    expect(encodeCalls()).toBe(0); // 完全绕过 encoder
    const ans = result.answers[0]!;
    expect(ans.kind).toBe('choice');
    expect((ans as { selected: string }).selected).toBe('opt-2'); // 4109 最小
    expect((ans as { source?: string }).source).toBe('deterministic');
    expect((ans as { deterministicTrace?: { rule: string } }).deterministicTrace?.rule).toBe('extremum');
  });

  it('全命中（score 族）：分档评分问句零编码 + 档位留痕', () => {
    const { encoder, encodeCalls } = makeSpyEncoder();
    const runtime = new JudgeRuntime(encoder);
    const result = runtime.judge({
      state: '评审得分：51 分（满分 80 分）。\n档界：20/40/60/80。',
      questions: [{ kind: 'score', id: 'q-band', question: '按上述档位划分，该得分属于第几档？', min: 0, max: 3 }],
    });
    expect(encodeCalls()).toBe(0);
    const ans = result.answers[0] as { kind: string; value: number; source?: string };
    expect(ans.kind).toBe('score');
    expect(ans.value).toBe(2); // 51>20,40 → 第 2 档
    expect(ans.source).toBe('deterministic');
  });

  it('部分命中：混合问句答案按原序合并，未命中问句走 encode 路径', () => {
    const { encoder, encodeCalls } = makeSpyEncoder();
    const runtime = new JudgeRuntime(encoder);
    const result = runtime.judge({
      state: '数值序列：5233、9982、6194、4109、5418。',
      questions: [
        numericChoiceQuestion(),
        { kind: 'noul', id: 'q-noul', question: '该序列是否存在？' }, // 落穿模型
      ],
    });
    expect(encodeCalls()).toBe(1); // 未命中问句共享一次编码
    expect(result.answers).toHaveLength(2);
    expect((result.answers[0] as { source?: string }).source).toBe('deterministic');
    expect((result.answers[1] as { source?: string }).source).toBeUndefined(); // 模型路径无 source
    expect((result.answers[1] as { kind: string }).kind).toBe('noul');
  });

  it('deterministic=null（构造器）：与现状一致——逐问全走模型路径（A/B 对照）', () => {
    const { encoder, encodeCalls } = makeSpyEncoder();
    const runtime = new JudgeRuntime(encoder, null);
    const result = runtime.judge({
      state: '数值序列：5233、9982、6194、4109、5418。',
      questions: [numericChoiceQuestion()],
    });
    expect(encodeCalls()).toBe(1); // 数值面问句也走模型（对照口径）
    const ans = result.answers[0] as { source?: string };
    expect(ans.source).toBeUndefined();
  });

  it('judgeFullOutputs 同款分流：确定性 choice → uncalibrated + 放行', () => {
    const { encoder, encodeCalls } = makeSpyEncoder();
    const runtime = new JudgeRuntime(encoder);
    const outputs = runtime.judgeFullOutputs({
      request: {
        state: '数值序列：5233、9982、6194、4109、5418。',
        questions: [numericChoiceQuestion()],
      },
      noulThresholds: { noul: { lowerBand: 0.4, upperBand: 0.6 } },
    });
    expect(encodeCalls()).toBe(0); // 零编码快速路径
    const out = outputs[0]!;
    expect(out.kind).toBe('choice');
    expect(out.calibrationStatus).toBe('uncalibrated');
    expect(out.suggestedAction).toBe('放行');
    expect((out as { selected: string }).selected).toBe('opt-2');
  });
});
