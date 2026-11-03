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

  it('M2 注入通道 ⇒ 返回类型化答案（四字段 + 影子标记），且 state 经单一构造入口', async () => {
    const ch = stub();
    setPlannerChannel(ch, [
      { id: 'q1', primitive: 'choice', options: ['continue', 'human_review'], fallback: 'human_review' },
    ]);
    const out = await runPlannerDecision('请判定该动作是否继续');
    const parsed = JSON.parse(out);
    // 契约四字段必须齐；shadow 档（默认）额外带 shadowApplied:false（J3:144 落痕信号，
    // 「只落痕不影响行为」的机械可辨标记——非契约字段，带外于 DecisionResult 序列化产物）
    for (const k of ['answers', 'latencyMs', 'modelVersion', 'tempBucket']) {
      expect(Object.keys(parsed)).toContain(k);
    }
    expect(parsed.shadowApplied).toBe(false); // 默认 shadow 档：结果未生效
    expect(parsed.answers[0].value).toBe('continue');
    expect(ch.judge).toHaveBeenCalledTimes(1);
    const [state, questions] = ch.judge.mock.calls[0] as [ { text: string }, unknown[] ];
    expect(state.text).toContain('请判定该动作是否继续');
    expect(questions).toHaveLength(1);
  });

  it('M5 影子门接线：live 未对账 ⇒ ShadowGateError；对账后 live 生效无 shadowApplied', async () => {
    const ch = stub();
    setPlannerChannel(ch, []);
    const { setJudgeMode: setPlannerMode } = await import('../loop/plan-node');
    // live 但 reconciled=0 ⇒ 拒绝启用
    setPlannerMode('active', { reconciled: 0 });
    await expect(runPlannerDecision('判定')).rejects.toThrow(/影子期未对账|ShadowGate/);
    // 对账后 live ⇒ 生效（无 shadowApplied 标记）
    setPlannerMode('active', { reconciled: 3 });
    const out = await runPlannerDecision('判定');
    expect(JSON.parse(out).shadowApplied).toBeUndefined();
    // 还原默认 shadow，防污染后续用例
    setPlannerMode('shadow');
  });

  it('M6 engineer 侧吞错修复：defaultDecideCallLLM 在 decision-model 档失败必须外显', async () => {
    const { defaultDecideCallLLM } = await import('../loop/engineer-decide');
    // 未注入通道（runDecisionModel 会抛）⇒ 外层不得吞成 ''
    await expect(
      defaultDecideCallLLM('prompt', { target: 'decision-model' } as never),
    ).rejects.toThrow(/绝不回落生成模型/);
    // 其他档（如 block）维持原语义返回 ''
    await expect(
      defaultDecideCallLLM('prompt', { target: 'block' } as never),
    ).resolves.toBe('');
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
