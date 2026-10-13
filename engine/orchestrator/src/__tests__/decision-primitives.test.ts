// decision-primitives.test.ts · 三原语类型构造 / 越界拒绝 / 批量形态单测
// ============================================================
// 覆盖面（对齐 devlog 章一验收标准）：
//   ① 三原语类型定义在位（choice 带分布 / score 带区间 / noul 带真值概率）
//   ② 问句集限定：类型不符拒绝
//   ③ Choice 候选缺兜底项拒载；兜底/弃权可区分且互补不等价
//   ④ 批量形态：同状态多问一次调用、不串扰、无静默缺问
//   ⑤ 既有置信度映射（high/med/low ↔ 概率）
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  makeChoiceQuestion,
  makeChoiceAnswer,
  makeScoreAnswer,
  makeNoulAnswer,
  makeDecisionResult,
  validateChoiceQuestion,
  legacyConfidenceToNoul,
  noulToLegacyConfidence,
  DecisionPrimitiveError,
  type ScoreQuestion,
  type NoulQuestion,
  type DecisionRequest,
} from '../router/decision-primitives';

const FALLBACK = { id: 'none-fit', label: '以上都不是（信息不足）' };

function triChoice() {
  return makeChoiceQuestion(
    'q-classify',
    '该 AI 节点应采用哪种处理形态？',
    [
      { id: 'auto', label: '🔄 自动执行' },
      { id: 'enhance', label: '⚡ 强化岗位' },
      { id: 'hold', label: '👤 暂不动' },
    ],
    FALLBACK,
    { verificationPath: 'audit://rule-A16/actions-declared' },
  );
}

describe('三原语类型构造', () => {
  it('test_makeChoiceQuestion_标准三选一带兜底_构造成功且兜底唯一', () => {
    const q = triChoice();
    expect(q.kind).toBe('choice');
    expect(q.options).toHaveLength(4);
    expect(q.options.filter((o) => o.isFallback)).toHaveLength(1);
    expect(q.verificationPath).toBe('audit://rule-A16/actions-declared');
  });

  it('test_makeChoiceAnswer_全候选分布_输出选中项与概率分布', () => {
    const q = triChoice();
    const a = makeChoiceAnswer(q, 'auto', { auto: 0.6, enhance: 0.2, hold: 0.15, 'none-fit': 0.05 });
    expect(a.kind).toBe('choice');
    expect(a.selected).toBe('auto');
    expect(a.distribution).toHaveProperty('none-fit', 0.05);
    expect(a.fallbackSelected).toBe(false);
    expect(a.abstained).toBe(false);
  });

  it('test_makeScoreAnswer_分值区间不确定度_三者自洽构造成功', () => {
    const q: ScoreQuestion = { kind: 'score', id: 'q-risk', question: '该变更的风险分？', min: 0, max: 10 };
    const a = makeScoreAnswer(q, 6.5, { lower: 5.5, upper: 7.5 }, 1.0);
    expect(a.value).toBe(6.5);
    expect(a.lower).toBe(5.5);
    expect(a.upper).toBe(7.5);
    expect(a.uncertainty).toBe(1.0);
  });

  it('test_makeNoulAnswer_真值概率构造成功', () => {
    const q: NoulQuestion = { kind: 'noul', id: 'q-allow', question: '该动作应放行吗？' };
    const a = makeNoulAnswer(q, 0.83);
    expect(a.probability).toBe(0.83);
  });
});

describe('越界拒绝（fail-closed）', () => {
  it('test_makeChoiceQuestion_空普通候选集_拒载', () => {
    expect(() => makeChoiceQuestion('q1', '问', [], FALLBACK)).toThrow(DecisionPrimitiveError);
  });

  it('test_validateChoiceQuestion_候选集缺兜底项_加载期拒载', () => {
    const broken = { ...triChoice(), options: triChoice().options.filter((o) => !o.isFallback) };
    expect(() => validateChoiceQuestion(broken)).toThrow(/兜底项数=0/);
  });

  it('test_makeChoiceAnswer_分布不含全候选_拒绝', () => {
    const q = triChoice();
    expect(() => makeChoiceAnswer(q, 'auto', { auto: 1.0 })).toThrow(/不一致/);
  });

  it('test_makeChoiceAnswer_分布和不为1_拒绝', () => {
    const q = triChoice();
    expect(() => makeChoiceAnswer(q, 'auto', { auto: 0.5, enhance: 0.2, hold: 0.1, 'none-fit': 0.05 })).toThrow(/和=/);
  });

  it('test_makeChoiceAnswer_分布含负概率_拒绝', () => {
    const q = triChoice();
    expect(() => makeChoiceAnswer(q, 'auto', { auto: 1.2, enhance: -0.2, hold: 0, 'none-fit': 0 })).toThrow(/负概率/);
  });

  it('test_makeChoiceAnswer_兜底选中且弃权同真_拒绝（互补不等价）', () => {
    const q = triChoice();
    const dist = { auto: 0.05, enhance: 0.05, hold: 0.05, 'none-fit': 0.85 };
    expect(() => makeChoiceAnswer(q, 'none-fit', dist, { abstained: true })).toThrow(/不可同时为 true/);
  });

  it('test_makeChoiceAnswer_弃权时selected非兜底_拒绝', () => {
    const q = triChoice();
    expect(() => makeChoiceAnswer(q, 'auto', { auto: 0.9, enhance: 0.04, hold: 0.03, 'none-fit': 0.03 }, { abstained: true })).toThrow(
      /弃权时 selected 须指向兜底项/,
    );
  });

  it('test_makeChoiceAnswer_兜底选中不弃权_合法且可区分', () => {
    const q = triChoice();
    const a = makeChoiceAnswer(q, 'none-fit', { auto: 0.1, enhance: 0.1, hold: 0.1, 'none-fit': 0.7 });
    expect(a.fallbackSelected).toBe(true);
    expect(a.abstained).toBe(false); // 与弃权可区分
  });

  it('test_makeScoreAnswer_分值越界_拒绝', () => {
    const q: ScoreQuestion = { kind: 'score', id: 'q', question: '', min: 0, max: 10 };
    expect(() => makeScoreAnswer(q, 11, { lower: 10, upper: 12 }, 1)).toThrow(/越界/);
  });

  it('test_makeScoreAnswer_区间不含分值_拒绝', () => {
    const q: ScoreQuestion = { kind: 'score', id: 'q', question: '', min: 0, max: 10 };
    expect(() => makeScoreAnswer(q, 5, { lower: 6, upper: 8 }, 1)).toThrow(/包含分值/);
  });

  it('test_makeNoulAnswer_概率越界_拒绝', () => {
    const q: NoulQuestion = { kind: 'noul', id: 'q', question: '' };
    expect(() => makeNoulAnswer(q, 1.2)).toThrow(/越界/);
    expect(() => makeNoulAnswer(q, -0.1)).toThrow(/越界/);
  });
});

describe('问句集限定（类型绑定）', () => {
  it('test_validateDecisionPairing_答案类型与问句不符_拒绝', () => {
    const q = triChoice();
    const req: DecisionRequest = { state: 's', questions: [q] };
    const wrongAnswer = makeNoulAnswer({ kind: 'noul', id: 'q-classify', question: '' }, 0.5);
    expect(() => makeDecisionResult(req, [wrongAnswer])).toThrow(/问句集限定/);
  });

  it('test_validateDecisionPairing_缺答案_拒绝（无静默缺问）', () => {
    const req: DecisionRequest = { state: 's', questions: [triChoice()] };
    expect(() => makeDecisionResult(req, [])).toThrow(/缺答案/);
  });

  it('test_validateDecisionPairing_存在弃权但缺归因_拒绝', () => {
    const q = triChoice();
    const req: DecisionRequest = { state: 's', questions: [q] };
    const a = makeChoiceAnswer(q, 'none-fit', { auto: 0.1, enhance: 0.1, hold: 0.1, 'none-fit': 0.7 }, { abstained: false });
    // 手造弃权形态（绕过构造器互斥检查以测归因必填性）
    const abstainAnswer = { ...a, abstained: true };
    expect(() => makeDecisionResult(req, [abstainAnswer])).toThrow(/abstainAttribution/);
  });
});

describe('批量形态（多问并行）', () => {
  it('test_makeDecisionResult_混合三原语多问一次校验通过_问题间不串扰', () => {
    const choiceQ = triChoice();
    const scoreQ: ScoreQuestion = { kind: 'score', id: 'q-risk', question: '风险分？', min: 0, max: 10 };
    const noulQ: NoulQuestion = { kind: 'noul', id: 'q-allow', question: '放行？' };
    const req: DecisionRequest = { state: '同状态', questions: [choiceQ, scoreQ, noulQ] };
    const result = makeDecisionResult(req, [
      makeChoiceAnswer(choiceQ, 'auto', { auto: 0.7, enhance: 0.15, hold: 0.1, 'none-fit': 0.05 }),
      makeScoreAnswer(scoreQ, 3, { lower: 2, upper: 4 }, 0.8),
      makeNoulAnswer(noulQ, 0.72),
    ]);
    expect(result.answers).toHaveLength(3);
    expect(new Set(result.answers.map((a) => a.questionId)).size).toBe(3);
  });
});

describe('既有置信度映射（并存口径）', () => {
  it('test_legacyConfidenceToNoul_三档保序映射', () => {
    expect(legacyConfidenceToNoul('high')).toBeGreaterThan(legacyConfidenceToNoul('med'));
    expect(legacyConfidenceToNoul('med')).toBeGreaterThan(legacyConfidenceToNoul('low'));
  });

  it('test_noulToLegacyConfidence_往返档位稳定（档内闭合）', () => {
    expect(noulToLegacyConfidence(legacyConfidenceToNoul('high'))).toBe('high');
    expect(noulToLegacyConfidence(legacyConfidenceToNoul('med'))).toBe('med');
    expect(noulToLegacyConfidence(legacyConfidenceToNoul('low'))).toBe('low');
  });
});
