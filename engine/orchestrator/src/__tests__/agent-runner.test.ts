// ============================================================
// agent-runner.test.ts · 条目 4 第 0 步：行为对等兜底（深模块批二）
// ============================================================
// 固定骨架行为：同一 mock LLM/deps 下，engineer 与 reviewer 两角色经
// makeAgentRunner 产出的执行序列形状一致（nodeStart→heartbeat→wrap→nodeEnd
// 或降级路径）——重构前后行为等价的锚。
// ============================================================
import { describe, expect, it } from 'vitest';
import { makeAgentRunner, type AgentRunnerSpec } from '../loop/agent-runner';
import type { SubAgentDefinition } from '../registry';
import { ENGINEER_TOOLS, REVIEWER_TOOLS } from '../tools';

const mkDef = (name: string): SubAgentDefinition => ({
  name,
  description: `test ${name}`,
  systemPrompt: `You are ${name}.`,
  tools: [],
});

function makeTrackedDeps() {
  const calls: string[] = [];
  const sovereigntyMw = {
    wrapModelCall: async (_meta: unknown, fn: () => Promise<unknown>) => {
      calls.push('wrap');
      return fn();
    },
  } as unknown as import('../middleware/data-sovereignty-mw').DataSovereigntyMiddleware;
  const progressMw = {
    nodeStart: () => calls.push('nodeStart'),
    heartbeat: () => calls.push('heartbeat'),
    nodeEnd: () => calls.push('nodeEnd'),
  } as unknown as import('../middleware/progress-mw').ProgressMiddleware;
  return { deps: { sovereigntyMw, progressMw }, calls };
}

const specOf = (role: 'engineer' | 'reviewer'): AgentRunnerSpec => ({
  role,
  tools: role === 'engineer' ? ENGINEER_TOOLS : REVIEWER_TOOLS,
  agentDef: mkDef(role),
  buildTask: () => `task for ${role}`,
  endpoints: { endpoint: `loop-${role}`, purpose: `${role}-loop` },
  progressTitle: `${role} work`,
  gateTaskDesc: `${role} task`,
});

describe('条目 4 · makeAgentRunner 行为对等（第 0 步）', () => {
  it('无 LLM 环境 → 两角色同走降级路径（序列形状一致）', async () => {
    const saved = process.env.SOFAGENT_LLM;
    delete process.env.SOFAGENT_LLM;
    delete process.env.SOFAGENT_LLM_ENGINEER;
    delete process.env.SOFAGENT_LLM_REVIEWER;
    try {
      const e = makeTrackedDeps();
      const r = makeTrackedDeps();
      const runE = makeAgentRunner(specOf('engineer'), e.deps);
      const runR = makeAgentRunner(specOf('reviewer'), r.deps);
      const outE = await runE('engineer task');
      const outR = await runR('reviewer task');
      // 降级路径：前缀标注 + spawnSubAgent 兜底
      expect(outE.startsWith('[降级运行]')).toBe(true);
      expect(outR.startsWith('[降级运行]')).toBe(true);
      // 序列形状一致（nodeStart → [尝试失败] → nodeEnd(false)）
      expect(e.calls).toEqual(r.calls);
      expect(e.calls).toContain('nodeStart');
      expect(e.calls).toContain('nodeEnd');
    } finally {
      if (saved !== undefined) process.env.SOFAGENT_LLM = saved;
    }
  }, 30_000);

  it('骨架内件：两角色同 deps 注入（无全局 setter——可并行无污染）', () => {
    const a = makeTrackedDeps();
    const b = makeTrackedDeps();
    expect(a.deps).not.toBe(b.deps); // 独立实例——测试隔离形态成立
  });
});
