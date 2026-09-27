// ============================================================
// multi-instance-vote.test.ts · 多实例自验证单测（v1.5.4 第四章）
//
// 覆盖验收标准：
//   ① N 实例并发 + 多数表决可用
//   ② 分歧超阈值路由 HITL（或升级大模型重跑）
//   ③ 平票语义（tie 永不判共识）
//   ④ fail-closed（实例数 < 2 拒绝 / 法定人数不足升级）
//   ⑤ 与 HITL 处理器接线（分歧入人工介入异常队列）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  runMultiInstanceVote,
  summarizeVote,
  normalizeVoteValue,
  DEFAULT_VOTE_CONFIG,
  MultiInstanceVoteError,
  type InstanceRunner,
  type VoteInstanceOutput,
} from '../multi-instance-vote';
import { createHITLHandler, type ExceptionRecord } from '../hitl-handler';

/** 构造一个「按 slot 返回固定答案」的 runner（其余 slot 用最后一档兜底）。 */
function fixedRunner(values: (string | Error)[]): InstanceRunner {
  return async (_task, ctx): Promise<VoteInstanceOutput> => {
    const v = values[ctx.slot] ?? values[values.length - 1]!;
    if (v instanceof Error) throw v;
    return { instanceId: ctx.instanceId, value: v };
  };
}

/** 构造一个「按实例序号决定成败」的 runner。 */
function toggleRunner(): InstanceRunner {
  return async (_task, ctx): Promise<VoteInstanceOutput> => {
    if (ctx.slot % 2 === 0) return { instanceId: ctx.instanceId, value: 'B' };
    throw new Error(`实例 ${ctx.instanceId} 失败`);
  };
}

describe('runMultiInstanceVote · 多数表决', () => {
  it('N=3 全一致 ⇒ consensus / route=accept / agreement=1', async () => {
    const out = await runMultiInstanceVote({
      instances: 3,
      task: '判定：这批单据是否合规',
      divergenceThreshold: 0.34,
      runner: fixedRunner(['allow', 'allow', 'allow']),
    });
    expect(out.decision).toBe('consensus');
    expect(out.route).toBe('accept');
    expect(out.winner).toBe('allow');
    expect(out.succeeded).toBe(3);
    expect(out.agreement).toBeCloseTo(1);
    expect(out.divergence).toBeCloseTo(0);
    expect(out.tied).toBe(false);
  });

  it('N=3 严格多数（2−1）⇒ consensus（多数票胜出）', async () => {
    const out = await runMultiInstanceVote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      runner: fixedRunner(['allow', 'allow', 'deny']),
    });
    expect(out.decision).toBe('consensus');
    expect(out.route).toBe('accept');
    expect(out.winner).toBe('allow');
    expect(out.tally[0]).toMatchObject({ value: 'allow', count: 2 });
    expect(out.divergence).toBeCloseTo(1 / 3);
  });
});

describe('runMultiInstanceVote · 分歧路由', () => {
  it('三方分歧（1−1−1）⇒ 平票判分歧 + 缺省路由 hitl', async () => {
    const out = await runMultiInstanceVote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      runner: fixedRunner(['allow', 'deny', 'abstain']),
    });
    expect(out.decision).toBe('divergence');
    expect(out.route).toBe('hitl');
    expect(out.tied).toBe(true);
    expect(out.tally).toHaveLength(3);
  });

  it('分歧 + onDivergence=escalate ⇒ 路由升级大模型重跑', async () => {
    const out = await runMultiInstanceVote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      onDivergence: 'escalate',
      runner: fixedRunner(['allow', 'deny', 'abstain']),
    });
    expect(out.decision).toBe('divergence');
    expect(out.route).toBe('escalate');
  });

  it('分歧记录进 HITL 人工介入异常队列（接线实测）', async () => {
    const recorded: ExceptionRecord[] = [];
    const hitl = createHITLHandler({ callbacks: { recordException: (r) => recorded.push(r) } });
    const out = await hitl.vote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      runner: fixedRunner(['allow', 'deny', 'abstain']),
    });
    expect(out.decision).toBe('divergence');
    expect(recorded.some((r) => r.type === 'vote_divergence')).toBe(true);
    expect(hitl.getExceptions().length).toBeGreaterThanOrEqual(1);
  });

  it('共识不产生异常（hitl.vote 直通）', async () => {
    const recorded: ExceptionRecord[] = [];
    const hitl = createHITLHandler({ callbacks: { recordException: (r) => recorded.push(r) } });
    const out = await hitl.vote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      runner: fixedRunner(['x', 'x', 'x']),
    });
    expect(out.route).toBe('accept');
    expect(recorded).toHaveLength(0);
  });
});

describe('runMultiInstanceVote · 平票与法定人数（fail-closed）', () => {
  it('N=2 一票各一 ⇒ 平票判分歧（tie 永不判共识）', async () => {
    const out = await runMultiInstanceVote({
      instances: 2,
      task: 't',
      divergenceThreshold: 0.34,
      runner: fixedRunner(['A', 'B']),
    });
    expect(out.tied).toBe(true);
    expect(out.decision).toBe('divergence');
    expect(out.route).toBe('hitl');
  });

  it('法定人数不足（N=3 仅 1 成功）⇒ 分歧 + 升级（即便 onDivergence=hitl）', async () => {
    const out = await runMultiInstanceVote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      onDivergence: 'hitl',
      runner: fixedRunner(['allow', new Error('e2'), new Error('e3')]),
    });
    expect(out.succeeded).toBe(1);
    expect(out.quorum).toBe(2);
    expect(out.decision).toBe('divergence');
    expect(out.route).toBe('escalate');
    expect(out.errors).toHaveLength(2);
  });

  it('全失败 ⇒ winner=null + 升级', async () => {
    const out = await runMultiInstanceVote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      runner: fixedRunner([new Error('a'), new Error('b'), new Error('c')]),
    });
    expect(out.succeeded).toBe(0);
    expect(out.winner).toBeNull();
    expect(out.decision).toBe('divergence');
    expect(out.route).toBe('escalate');
  });

  it('instances < 2 ⇒ 抛 MultiInstanceVoteError（拒绝伪表决）', async () => {
    await expect(
      runMultiInstanceVote({ instances: 1, task: 't', divergenceThreshold: 0.34 }),
    ).rejects.toBeInstanceOf(MultiInstanceVoteError);
    await expect(
      runMultiInstanceVote({ instances: 0, task: 't', divergenceThreshold: 0.34 }),
    ).rejects.toBeInstanceOf(MultiInstanceVoteError);
  });

  it('阈值越界 ⇒ 抛 MultiInstanceVoteError', async () => {
    await expect(
      runMultiInstanceVote({ instances: 3, task: 't', divergenceThreshold: 2 }),
    ).rejects.toBeInstanceOf(MultiInstanceVoteError);
  });
});

describe('runMultiInstanceVote · 并发与多样性', () => {
  it('N 实例并发发起（最大在飞数 = N）', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const runner: InstanceRunner = async (_task, ctx) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
      return { instanceId: ctx.instanceId, value: 'same' };
    };
    const out = await runMultiInstanceVote({ instances: 4, task: 't', divergenceThreshold: 0.34, runner });
    expect(maxInflight).toBe(4);
    expect(out.succeeded).toBe(4);
  });

  it('温度按 base + slot × step 展开（制造实例间多样性）', async () => {
    const temps: number[] = [];
    const runner: InstanceRunner = async (_task, ctx) => {
      temps[ctx.slot] = ctx.temperature;
      return { instanceId: ctx.instanceId, value: 'v' };
    };
    await runMultiInstanceVote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      baseTemperature: 0.2,
      temperatureStep: 0.2,
      runner,
    });
    expect(temps).toHaveLength(3);
    expect(temps[0]!).toBeCloseTo(0.2);
    expect(temps[1]!).toBeCloseTo(0.4);
    expect(temps[2]!).toBeCloseTo(0.6);
  });

  it('单实例超时 ⇒ 计入失败，不拖垮整批', async () => {
    const runner: InstanceRunner = async (_task, ctx) => {
      if (ctx.slot === 0) await new Promise((r) => setTimeout(r, 50));
      return { instanceId: ctx.instanceId, value: 'ok' };
    };
    const out = await runMultiInstanceVote({
      instances: 3,
      task: 't',
      divergenceThreshold: 0.34,
      instanceTimeoutMs: 10,
      runner,
    });
    expect(out.failed).toBe(1);
    expect(out.errors[0]!.error).toContain('超时');
    expect(out.succeeded).toBe(2);
  });
});

describe('summarizeVote / normalizeVoteValue（纯函数）', () => {
  it('summarizeVote 平票：前二名票数相同 ⇒ tied=true', () => {
    const out = summarizeVote({
      outputs: [
        { instanceId: 'a', value: 'x' },
        { instanceId: 'b', value: 'y' },
      ],
      errors: [],
      totalInstances: 2,
      divergenceThreshold: 0.34,
      onDivergence: 'hitl',
    });
    expect(out.tied).toBe(true);
    expect(out.decision).toBe('divergence');
  });

  it('summarizeVote 同票按键字典序稳定排序', () => {
    const out = summarizeVote({
      outputs: [
        { instanceId: 'a', value: 'b' },
        { instanceId: 'b', value: 'a' },
      ],
      errors: [],
      totalInstances: 2,
      divergenceThreshold: 1,
      onDivergence: 'hitl',
    });
    expect(out.tally.map((t) => t.value)).toEqual(['a', 'b']);
  });

  it('normalizeVoteValue：常见答案字段优先，其次排序 JSON', () => {
    expect(normalizeVoteValue('  hi  ')).toBe('hi');
    expect(normalizeVoteValue({ answer: 'allow', reason: 'x' })).toBe('allow');
    expect(normalizeVoteValue({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(normalizeVoteValue(null)).toBe('');
  });

  it('DEFAULT_VOTE_CONFIG 可用作缺省（缺省 runner 不会在注入 runner 时被调用）', () => {
    expect(DEFAULT_VOTE_CONFIG.instances).toBe(3);
    expect(DEFAULT_VOTE_CONFIG.onDivergence).toBe('hitl');
  });
});

describe('toggleRunner 用作实例成败混合场景', () => {
  it('N=4 交替成败 ⇒ 有效票不足/可判', async () => {
    const out = await runMultiInstanceVote({
      instances: 4,
      task: 't',
      divergenceThreshold: 0.34,
      runner: toggleRunner(),
    });
    // slot 0/2 成功（值 B），slot 1/3 失败 ⇒ 成功率 2/4，quorum=3 不足 ⇒ 升级
    expect(out.succeeded).toBe(2);
    expect(out.quorum).toBe(3);
    expect(out.route).toBe('escalate');
  });
});
