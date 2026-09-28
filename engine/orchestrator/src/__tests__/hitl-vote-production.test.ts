// ============================================================
// hitl-vote-production.test.ts · v1.5.4 章四 · 多实例表决生产链接线
// ============================================================
//
// 目的：证明「runMultiInstanceVote → hitl-handler.vote() → 生产入口」整链可达。
//   前半：经 HITL 处理器调用表决（共识/分歧/fail-closed 三态）。
//   后半：CLI `vote` 子命令是该链的真实生产分支（源码级接线自证）。
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHITLHandler } from '../hitl-handler';
import type { InstanceRunner } from '../multi-instance-vote';

/** 确定性实例运行器（按 slot 产出 value——覆盖共识/分歧） */
function fixedRunner(valueOf: (slot: number) => string): InstanceRunner {
  return async (_task, ctx) => ({ instanceId: ctx.instanceId, value: valueOf(ctx.slot) });
}

describe('HITL 处理器 vote（v1.5.4 章四——runMultiInstanceVote 的生产调用）', () => {
  it('共识：N=3 全一致 ⇒ decision=consensus，无异常入队', async () => {
    const hitl = createHITLHandler();
    const outcome = await hitl.vote({
      task: 't',
      instances: 3,
      divergenceThreshold: 0.34,
      runner: fixedRunner(() => 'yes'),
    });
    expect(outcome.decision).toBe('consensus');
    expect(outcome.route).toBe('accept');
    expect(hitl.getExceptions()).toHaveLength(0);
  });

  it('分歧：三路各一票（平票）⇒ decision=divergence，入人工介入队列（type=vote_divergence）', async () => {
    const hitl = createHITLHandler();
    const outcome = await hitl.vote({
      task: 't',
      instances: 3,
      divergenceThreshold: 0.34,
      runner: fixedRunner((s) => ['a', 'b', 'c'][s] ?? 'x'),
    });
    expect(outcome.decision).toBe('divergence');
    expect(outcome.tied).toBe(true);
    const ex = hitl.getExceptions();
    expect(ex).toHaveLength(1);
    expect(ex[0]!.type).toBe('vote_divergence');
    expect(ex[0]!.message).toContain('分歧');
  });

  it('fail-closed：instances<2 抛错并记异常（拒绝伪表决）', async () => {
    const hitl = createHITLHandler();
    await expect(hitl.vote({ task: 't', instances: 1 })).rejects.toThrow();
    expect(hitl.getExceptions().some((e) => e.type === 'vote_divergence')).toBe(true);
  });
});

describe('CLI vote 子命令（生产入口接线自证）', () => {
  it('cli.ts 含 vote 子命令 → createHITLHandler → hitl.vote 的真实分支（非注释/字符串）', () => {
    const src = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf-8');
    expect(src).toContain("case 'vote':");
    expect(src).toContain('createHITLHandler');
    expect(src).toContain('voteHandler.vote(');
  });

  it('cli.ts 分歧路由措辞分离（v1.5.5 P2-c：escalate 不误报「已入人工介入队列」）', () => {
    const src = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf-8');
    // route='escalate'（升级大模型重跑）与 route='hitl'（入人工介入队列）是两条处置链，
    // 措辞必须分支——此前 escalate 也打印「已入人工介入队列」，误导操作者。
    expect(src).toContain("outcome.route === 'escalate'");
    expect(src).toContain('升级大模型重跑');
    expect(src).toContain('分歧已入人工介入队列');
  });
});
