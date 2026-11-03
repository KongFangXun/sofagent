// ============================================================
// systemone-endpoint.test.ts · v1.8.0 §五 `/v1/systemone` 兼容门面单测
// ------------------------------------------------------------
// 覆盖（对应 v1.8.0 §五 验收行三条）：
//   ① 默认环回绑定（不对外监听）+ 显式暴露须告警
//   ② 请求内容不进日志（脱敏只留形态）+ ③ 自有契约不动（judge 入参逐键等于输入）
// 另加：非法 type / choice 缺候选 → 400（不静默兜底）；判定通道失败 → 502（不假装成功）
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import type { DecisionQuestion, DecisionResult, DecisionState } from '@sofagent/orchestrator';
import {
  DEFAULT_SYSTEMONE_HOST,
  SYSTEMONE_PATH,
  handleSystemoneRequest,
  redactRequestForLog,
  resolveBindHost,
  toInternal,
  toWire,
} from '../systemone-endpoint';

/** 固定判定桩：记录收到的入参，返回合法四字段结果 */
function stubJudge(over: Partial<DecisionResult> = {}) {
  const seen: { state?: DecisionState; questions?: DecisionQuestion[] } = {};
  const fn = async (state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionResult> => {
    seen.state = state;
    seen.questions = questions;
    return {
      answers: [{ id: questions[0]?.id ?? 'q1', value: 'b', probability: 0.81, distribution: { a: 0.19, b: 0.81 }, status: 'answered' }],
      modelVersion: 'sofa-s1m-test',
      tempBucket: 'choice:k2',
      latencyMs: 7,
      ...over,
    };
  };
  return { fn, seen };
}

beforeEach(() => { delete process.env.SOFAGENT_SYSTEMONE_HOST; });

describe('v1.8.0 §五 · 默认环回绑定', () => {
  it('未配置 → 127.0.0.1（不对外监听）', () => {
    const r = resolveBindHost({});
    expect(r.host).toBe(DEFAULT_SYSTEMONE_HOST);
    expect(r.publicExposed).toBe(false);
    expect(r.warning).toBeUndefined();
  });

  it('显式 0.0.0.0 → 标记对外暴露并给告警（暴露是部署决策，但必须说出来）', () => {
    const r = resolveBindHost({ SOFAGENT_SYSTEMONE_HOST: '0.0.0.0' });
    expect(r.publicExposed).toBe(true);
    expect(r.warning).toContain('对外暴露');
  });

  it('路径常量 = /v1/systemone（生态线格式同一路径）', () => {
    expect(SYSTEMONE_PATH).toBe('/v1/systemone');
  });
});

describe('v1.8.0 §五 · 请求内容不进日志', () => {
  it('脱敏后不含 state / instructions 原文，只留形态', () => {
    const secret = '客户合同金额 1234 万——这是 state 原文';
    const red = redactRequestForLog({ type: 'choice', criteria: ['a', 'b'], instructions: '判断风险', state: secret });
    expect(red).toEqual({ type: 'choice', criteriaCount: 2, instructionsChars: 4, stateChars: secret.length, hasState: true });
    expect(JSON.stringify(red)).not.toContain('合同金额');
    expect(JSON.stringify(red)).not.toContain('判断风险');
  });

  it('handle 的日志行同样零内容', async () => {
    const { fn } = stubJudge();
    const r = await handleSystemoneRequest(
      JSON.stringify({ type: 'noul', state: '机密原文', instructions: '机密指令' }),
      { judge: fn },
    );
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.log)).not.toContain('机密');
  });
});

describe('v1.8.0 §五 · 自有契约不动（适配层只翻译）', () => {
  it('judge 收到的 questions[0] 键集合 = 内部契约五键，primitive 原样', async () => {
    const { fn, seen } = stubJudge();
    await handleSystemoneRequest(JSON.stringify({ type: 'choice', criteria: ['a', 'b'], state: 's', id: 'q7' }), { judge: fn });
    expect(seen.questions?.[0]?.id).toBe('q7');
    expect(seen.questions?.[0]?.primitive).toBe('choice');
    expect(seen.questions?.[0]?.options).toEqual(['a', 'b']);
    expect(seen.state?.text).toBe('s');
    expect(seen.state?.evidenceReadiness).toBe('none');
  });

  it('score 量程映射：criteria={min,max} → range；noul 不带候选', () => {
    const s = toInternal({ type: 'score', criteria: { min: 0, max: 10 } });
    expect(s.questions[0]?.range).toEqual({ min: 0, max: 10 });
    const n = toInternal({ type: 'noul' });
    expect(n.questions[0]?.options).toBeUndefined();
    expect(n.questions[0]?.range).toBeUndefined();
  });

  it('弃权原样透出（不翻译成 HTTP 错误，四态语义不被门面吃掉）', async () => {
    const { fn } = stubJudge({
      answers: [{ id: 'q1', value: 'a', probability: 0.3, status: 'abstained', abstainReason: 'low-confidence' }],
    });
    const r = await handleSystemoneRequest(JSON.stringify({ type: 'choice', criteria: ['a', 'b'] }), { judge: fn });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ abstained: true, reason: 'low-confidence' });
  });

  it('toWire 的 choice 分支：label 取选中项、probabilities 为全候选分布', () => {
    const wire = toWire('choice', {
      answers: [{ id: 'q1', value: 'b', probability: 0.81, distribution: { a: 0.19, b: 0.81 }, status: 'answered' }],
      modelVersion: 'x', tempBucket: 'choice:k2', latencyMs: 1,
    });
    expect(wire.label).toBe('b');
    expect(wire.probabilities).toEqual({ a: 0.19, b: 0.81 });
  });
});

describe('v1.8.0 §五 · 默认拒绝与显式失败', () => {
  it('type 非法 → 400（不猜原语）', async () => {
    const { fn } = stubJudge();
    const r = await handleSystemoneRequest(JSON.stringify({ type: 'rerank' }), { judge: fn });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('type 非法');
  });

  it('choice 缺候选 → 400（不返回空分布冒充判定）', async () => {
    const { fn } = stubJudge();
    const r = await handleSystemoneRequest(JSON.stringify({ type: 'choice' }), { judge: fn });
    expect(r.status).toBe(400);
  });

  it('非 JSON → 400；判定通道抛错 → 502（不假装 200）', async () => {
    const { fn } = stubJudge();
    expect((await handleSystemoneRequest('not-json', { judge: fn })).status).toBe(400);
    const bad = await handleSystemoneRequest(JSON.stringify({ type: 'noul' }), {
      judge: async () => { throw new Error('runner 退出'); },
    });
    expect(bad.status).toBe(502);
    expect(JSON.stringify(bad.body)).toContain('判定通道失败');
  });
});
