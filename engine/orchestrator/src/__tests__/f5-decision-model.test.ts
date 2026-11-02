// ============================================================
// f5-decision-model.test.ts · F5 R2-3 验收（decision-model 档真实可达）
// ------------------------------------------------------------
// 判据（J3 §四首条 + devlog/F5.md 交付规格 #3）：`decision-model` 档从「插槽预留」
// 接通为「真实可达」——判定由 DecisionChannel 出类型化答案，**不经过生成模型**。
// 回归锁：未注入通道时 **fail-closed 抛错**，绝不静默返回 ''（那等于落回生成分支/空实现）。
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runDecisionModel as runPlannerDecision,
  setDecisionChannel as setPlannerChannel,
} from '../loop/plan-node';
import {
  runDecisionModel as runEngineerDecision,
  setDecisionChannel as setEngineerChannel,
} from '../loop/engineer-decide';
import type { DecisionChannel } from '../router/decision-channel';

const RESULT = {
  answers: [{ id: 'q1', value: 'continue', probability: 0.9, status: 'answered' as const }],
  modelVersion: 'stub@1',
  tempBucket: 'choice×2',
  latencyMs: 1,
};

function stub(): DecisionChannel & { judge: ReturnType<typeof vi.fn> } {
  return { name: 'stub', judge: vi.fn(async () => RESULT) } as never;
}

beforeEach(() => {
  setPlannerChannel(null);
  setEngineerChannel(null);
});

describe('F5 R2-3 · decision-model 档接通', () => {
  it('M1 未注入通道 ⇒ fail-closed 抛错（禁止静默返回空串 = 落回生成分支）', async () => {
    await expect(runPlannerDecision('task')).rejects.toThrow(/绝不回落生成模型/);
    await expect(runEngineerDecision('task')).rejects.toThrow(/绝不回落生成模型/);
  });

  it('M2 注入通道 ⇒ 返回类型化答案（四字段），且 state 经单一构造入口', async () => {
    const ch = stub();
    setPlannerChannel(ch, [
      { id: 'q1', primitive: 'choice', options: ['continue', 'human_review'], fallback: 'human_review' },
    ]);
    const out = await runPlannerDecision('请判定该动作是否继续');
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed).sort()).toEqual(['answers', 'latencyMs', 'modelVersion', 'tempBucket']);
    expect(parsed.answers[0].value).toBe('continue');
    expect(ch.judge).toHaveBeenCalledTimes(1);
    const [state, questions] = ch.judge.mock.calls[0] as [ { text: string }, unknown[] ];
    expect(state.text).toContain('请判定该动作是否继续');
    expect(questions).toHaveLength(1);
  });

  it('M3 超界 ⇒ 弃权（抛 over-limit），不截断、不调用通道', async () => {
    const ch = stub();
    setPlannerChannel(ch, []);
    await expect(runPlannerDecision('x'.repeat(9000))).rejects.toThrow(/over-limit/);
    expect(ch.judge).not.toHaveBeenCalled();
  });

  it('M4 engineer 侧同构：注入后同样可达，未注入同样 fail-closed', async () => {
    const ch = stub();
    setEngineerChannel(ch, []);
    const out = await runEngineerDecision('判定该操作');
    expect(JSON.parse(out).modelVersion).toBe('stub@1');
    setEngineerChannel(null);
    await expect(runEngineerDecision('判定该操作')).rejects.toThrow(/绝不回落生成模型/);
  });
});
