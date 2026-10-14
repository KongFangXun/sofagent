// judge-runtime.test.ts · 多头分发/批量并行/不占主模型槽位（行为锁）/顺序不变性/超限拒答/权重溯源/tokenizer 校验/许可证核对 单测
// ============================================================
import { describe, it, expect } from 'vitest';
import { JudgeRuntime, JudgeSlotCoordination, DecisionModelRegistry } from '../router/judge-runtime';
import { choiceHead, JudgeHeadError, type EncoderLike } from '../router/judge-heads';
import { makeChoiceQuestion, type DecisionRequest, type ScoreQuestion, type NoulQuestion } from '../router/decision-primitives';

/** 确定性测试编码器（契约测试以接口为准——不以具体基座为准） */
function mockEncoder(revision = 'test-rev-1'): EncoderLike {
  return {
    modelRevision: revision,
    maxContextTokens: 64,
    encode(state: string): number[][] {
      // 简单确定性编码：每字符 → 长度 2 向量
      return [...state].map((ch) => [ch.charCodeAt(0), ch.length]);
    },
    isSingleToken(text: string): boolean {
      return text.length <= 6; // 测试口径：≤6 字符视为单 token
    },
    decodeToken(token: number): string {
      return String.fromCharCode(token);
    },
  };
}

const FALLBACK = { id: 'none-fit', label: '无合适项' };

describe('三头分发与批量并行', () => {
  it('test_judge_混合三原语一次编码多头并行_结果附modelRevision', () => {
    const rt = new JudgeRuntime(mockEncoder('rev-abc'));
    const choiceQ = makeChoiceQuestion('qc', '选形态', [{ id: 'a', label: '自动' }, { id: 'b', label: '强化' }], FALLBACK);
    const scoreQ: ScoreQuestion = { kind: 'score', id: 'qs', question: '风险分', min: 0, max: 10 };
    const noulQ: NoulQuestion = { kind: 'noul', id: 'qn', question: '放行' };
    const req: DecisionRequest = { state: 'some state', questions: [choiceQ, scoreQ, noulQ] };
    const result = rt.judge(req);
    expect(result.answers).toHaveLength(3);
    expect(result.modelRevision).toBe('rev-abc'); // 权重溯源随判定
    expect(new Set(result.answers.map((a) => a.questionId)).size).toBe(3); // 无串扰无缺问
  });

  it('test_judge_三问只编码1次（spy 计数 encode 调用 == 1）', () => {
    const base = mockEncoder('rev-once');
    let encodeCalls = 0;
    const spyEncoder: EncoderLike = {
      ...base,
      encode(state: string): number[][] {
        encodeCalls += 1;
        return base.encode(state);
      },
    };
    const rt = new JudgeRuntime(spyEncoder);
    const choiceQ = makeChoiceQuestion('qc', '选形态', [{ id: 'a', label: '自动' }, { id: 'b', label: '强化' }], FALLBACK);
    const scoreQ: ScoreQuestion = { kind: 'score', id: 'qs', question: '风险分', min: 0, max: 10 };
    const noulQ: NoulQuestion = { kind: 'noul', id: 'qn', question: '放行' };
    const result = rt.judge({ state: 'some state', questions: [choiceQ, scoreQ, noulQ] });
    expect(result.answers).toHaveLength(3);
    // 一次编码多头并行（claim 的机械锁）——三问共享同一次编码，非逐问重复
    expect(encodeCalls).toBe(1);
  });
});

describe('不占主模型槽位（行为锁）', () => {
  it('test_behaviorLock_判定期间无主模型推理请求', () => {
    const rt = new JudgeRuntime(mockEncoder());
    const noulQ: NoulQuestion = { kind: 'noul', id: 'q', question: '判' };
    rt.judge({ state: 's', questions: [noulQ] });
    expect(rt.mainModelRequestsDuringJudge).toBe(0); // 判定全程零主模型请求
  });
  it('test_judgeSlot_判定槽位与主模型槽位独立（并发信号量分离）', () => {
    const coord = new JudgeSlotCoordination(1);
    const a = coord.acquireJudgeSlot();
    expect(a.ok).toBe(true);
    const b = coord.acquireJudgeSlot();
    expect(b.ok).toBe(false); // 判定槽位满
    if (a.ok) a.release();
    const c = coord.acquireJudgeSlot();
    expect(c.ok).toBe(true); // 释放后可再取
  });
});

describe('换基座不改判定头契约', () => {
  it('test_contract_两个不同encoder实现_同契约同判定头跑通', () => {
    const enc1 = mockEncoder('rev-1');
    const enc2 = { ...mockEncoder('rev-2'), maxContextTokens: 128 };
    const noulQ: NoulQuestion = { kind: 'noul', id: 'q', question: '判' };
    const r1 = new JudgeRuntime(enc1).judge({ state: 's', questions: [noulQ] });
    const r2 = new JudgeRuntime(enc2).judge({ state: 's', questions: [noulQ] });
    expect(r1.answers[0]!.kind).toBe('noul');
    expect(r2.answers[0]!.kind).toBe('noul'); // 契约稳定——换基座只换 modelRevision
    expect(r1.modelRevision).toBe('rev-1');
    expect(r2.modelRevision).toBe('rev-2');
  });
});

describe('顺序不变性（置换等变）', () => {
  it('test_permutationInvariance_候选集打乱后分数分布不变', () => {
    const enc = mockEncoder();
    const opts1 = ['选项甲', '选项乙', '选项丙'];
    const opts2 = ['选项丙', '选项甲', '选项乙'];
    const d1 = choiceHead(enc, 'state-x', opts1);
    const d2 = choiceHead(enc, 'state-x', opts2);
    for (const o of opts1) {
      expect(d2.scores[o]).toBeCloseTo(d1.scores[o]!, 10); // 同候选同分（顺序无关）
    }
    // 分布归一
    const sum = Object.values(d1.scores).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe('超限拒答不截断', () => {
  it('test_overLimit_state超上限_failClosed报错', () => {
    const smallEncoder = { ...mockEncoder(), maxContextTokens: 4 };
    const noulQ: NoulQuestion = { kind: 'noul', id: 'q', question: '判' };
    expect(() => new JudgeRuntime(smallEncoder).judge({ state: 'this-state-is-way-too-long-for-4-tokens', questions: [noulQ] })).toThrow(
      /超上限.*fail-closed/,
    );
  });
});

describe('tokenizer 对齐校验', () => {
  it('test_tokenizer_选项未单token化_拒载该问句', () => {
    const enc = mockEncoder(); // ≤6 字符单 token
    expect(() => choiceHead(enc, 's', ['这是一个超长的选项文本'])).toThrow(/未单 token 化/);
  });
  it('test_tokenizer_decode回环一致', () => {
    const enc = mockEncoder();
    expect(enc.decodeToken(enc.encode('A')[0]![0]!)).toBe('A');
  });
});

describe('判定模型注册（许可证核对结论落数）', () => {
  it('test_registry_注册态可查_许可证结论随注册落数', () => {
    const reg = new DecisionModelRegistry();
    reg.register({
      id: 'mock-encoder',
      encoderFactory: mockEncoder,
      license: { name: 'Apache-2.0', commercialUse: true, notes: '无营收门槛' },
    });
    reg.register({
      id: 'lfm-style',
      encoderFactory: mockEncoder,
      license: { name: 'LFM Open License v1.0', commercialUse: true, revenueCapUsd: 10_000_000, notes: '$10M 营收线' },
    });
    expect(reg.list()).toHaveLength(2);
    expect(reg.get('lfm-style')!.license.revenueCapUsd).toBe(10_000_000);
  });
});
