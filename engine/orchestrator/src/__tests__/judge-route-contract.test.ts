// ============================================================
// judge-route-contract.test.ts · v1.8.0 §三 契约测试以接口为准（STAGE3-STRUCT-5 · T3）
// ------------------------------------------------------------
// 判据（SSOT §三 L229）：换实现路线（并行约束解码 / 扩散去噪 / 零微调）不改判定头
// 契约与判据格式——至少两条路线的契约一致性测试（同组问句下 typed 答案形状与
// 概率字段逐字段一致）。
//
// 本测试用两个 EncoderLike 替身表达两条「实现路线」：
//   路线甲 vocabChunkSize=64（不分块）· modelRevision 甲
//   路线乙 vocabChunkSize=4（分块打分）· modelRevision 乙 · 表征扰动（数值可不同）
// 断言口径：**形状必须逐字段一致，数值允许不同**——形状差异即契约破裂。
// ============================================================

import { describe, it, expect } from 'vitest';
import { JudgeRuntime } from '../router/judge-runtime';
import type { DecisionRequest } from '../router/decision-primitives';
import type { EncoderLike } from '../router/judge-heads';

/** 实现路线替身（零网络；chunk 尺寸与表征扰动是可调的两条路线差异面） */
function makeRouteEncoder(opts: {
  revision: string;
  vocabChunkSize: number;
  charModulo: number;
}): EncoderLike {
  const enc: EncoderLike = {
    modelRevision: opts.revision,
    maxContextTokens: 4096,
    vocabChunkSize: opts.vocabChunkSize,
    encode: (state: string): number[][] => [[...state].map((c) => c.charCodeAt(0) % opts.charModulo)],
    isSingleToken: () => true,
    decodeToken: (t: number) => String.fromCharCode(t),
  } as EncoderLike & { vocabChunkSize: number };
  return enc;
}

const STATE = '任务：把订单数据按金额分档，输出档位标签。';

/** 同组问句：choice（含兜底项）+ score + noul */
function makeRequest(): DecisionRequest {
  return {
    state: STATE,
    questions: [
      {
        id: 'q-choice',
        kind: 'choice',
        question: '分档数量',
        options: [
          { id: 'a3', label: '3 档' },
          { id: 'a5', label: '5 档' },
          { id: 'fb', label: '以上都不是', isFallback: true },
        ],
      },
      { id: 'q-score', kind: 'score', question: '置信水平', min: 0, max: 10 },
      { id: 'q-noul', kind: 'noul', question: '是否需要人工复核' },
    ],
  };
}

function judgeWith(route: Parameters<typeof makeRouteEncoder>[0]) {
  // deterministic=null：关闭确定性前置路由，确保全走模型路径（两条路线同口径）
  const rt = new JudgeRuntime(makeRouteEncoder(route), null);
  return rt.judge(makeRequest());
}

describe('v1.8.0 §三 · 契约测试以接口为准（两条实现路线一致性）', () => {
  const routeA = { revision: 'route-a/rev-1', vocabChunkSize: 64, charModulo: 97 };
  const routeB = { revision: 'route-b/rev-2', vocabChunkSize: 4, charModulo: 89 };

  it('①答案数组长度与 questionId 序列一致（两路线同序同数——不得缺问/乱序）', () => {
    const a = judgeWith(routeA);
    const b = judgeWith(routeB);
    const req = makeRequest();
    expect(a.answers).toHaveLength(req.questions.length);
    expect(b.answers).toHaveLength(req.questions.length);
    expect(a.answers.map((x) => x.questionId)).toEqual(req.questions.map((q) => q.id));
    expect(b.answers.map((x) => x.questionId)).toEqual(req.questions.map((q) => q.id));
  });

  it('②kind 序列一致（换路线不得改变原语判定面）', () => {
    const a = judgeWith(routeA);
    const b = judgeWith(routeB);
    expect(a.answers.map((x) => x.kind)).toEqual(b.answers.map((x) => x.kind));
    expect(a.answers.map((x) => x.kind)).toEqual(['choice', 'score', 'noul']);
  });

  it('③choice 的 distribution 键集完全一致且各自和≈1（数值可不同，键集不得变）', () => {
    const a = judgeWith(routeA).answers[0];
    const b = judgeWith(routeB).answers[0];
    expect(a.kind).toBe('choice');
    expect(b.kind).toBe('choice');
    if (a.kind !== 'choice' || b.kind !== 'choice') throw new Error('原语形状不符');
    expect(Object.keys(a.distribution).sort()).toEqual(Object.keys(b.distribution).sort());
    const sumA = Object.values(a.distribution).reduce((x, y) => x + y, 0);
    const sumB = Object.values(b.distribution).reduce((x, y) => x + y, 0);
    expect(Math.abs(sumA - 1)).toBeLessThan(1e-6);
    expect(Math.abs(sumB - 1)).toBeLessThan(1e-6);
    // 选中项必须是候选键之一（两条路线同规则）
    expect(Object.keys(a.distribution)).toContain(a.selected);
    expect(Object.keys(b.distribution)).toContain(b.selected);
  });

  it('④score 的 value/lower/upper/uncertainty 字段齐且区间有序（两路线同形状）', () => {
    const a = judgeWith(routeA).answers[1];
    const b = judgeWith(routeB).answers[1];
    expect(a.kind).toBe('score');
    expect(b.kind).toBe('score');
    if (a.kind !== 'score' || b.kind !== 'score') throw new Error('原语形状不符');
    for (const s of [a, b]) {
      expect(typeof s.value).toBe('number');
      expect(typeof s.lower).toBe('number');
      expect(typeof s.upper).toBe('number');
      expect(typeof s.uncertainty).toBe('number');
      expect(s.lower).toBeLessThanOrEqual(s.upper); // 区间有序
      expect(s.uncertainty).toBeGreaterThanOrEqual(0);
    }
  });

  it('⑤noul 的 probability ∈ [0,1]（两路线同界）', () => {
    const a = judgeWith(routeA).answers[2];
    const b = judgeWith(routeB).answers[2];
    expect(a.kind).toBe('noul');
    expect(b.kind).toBe('noul');
    if (a.kind !== 'noul' || b.kind !== 'noul') throw new Error('原语形状不符');
    for (const n of [a, b]) {
      expect(n.probability).toBeGreaterThanOrEqual(0);
      expect(n.probability).toBeLessThanOrEqual(1);
    }
  });

  it('⑥路线标识随结果走（modelRevision 各自在位——换实现不改契约但可溯源）', () => {
    const a = judgeWith(routeA);
    const b = judgeWith(routeB);
    expect(a.modelRevision).toBe('route-a/rev-1');
    expect(b.modelRevision).toBe('route-b/rev-2');
    // JudgeRuntime.judge 返回面 = { answers, modelRevision }（DecisionResult 四字段的
    // modelVersion/tempBucket/latencyMs 由通道层 DecisionChannel 补齐——本层契约只查
    // answers 形状 + 权重溯源位，两路线一致）
    for (const r of [a, b]) {
      expect(Array.isArray(r.answers)).toBe(true);
      expect(typeof r.modelRevision).toBe('string');
      for (const ans of r.answers) {
        expect(typeof ans.questionId).toBe('string');
        expect(typeof ans.kind).toBe('string');
      }
    }
  });
});
