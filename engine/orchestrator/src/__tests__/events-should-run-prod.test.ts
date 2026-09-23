// ============================================================
// events-should-run-prod.test.ts · 第三章生产接线验收（v1.5.2）
// ============================================================
//
// 补「gate 只在总线留扩展点、生产装配零注入」的缺口：验证 cli.ts 的生产
// EventBus 构造点确实注入 shouldRunGate，且默认态零行为变化、真实状态源可
// 触发挂起。
//
// 覆盖：
//   1. 装配 helper buildEnterpriseEventBusOptions 确实产出 shouldRunGate，
//      且 cli.ts 生产路径调用它（接线证据）；
//   2. 降级铁律：所有状态源不可得 → 与未注入 gate 逐字一致（无挂起/无死信）；
//   3. 真实状态源触发挂起：health（断路器）/ human-gate（hitl 标记）/ quota（COST）；
//   4. 状态源抛错 → 判通过（绝不因缺数据挂起生产事件）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { EventBus } from '../events/bus';
import {
  buildEnterpriseEventBusOptions,
  createDefaultShouldRunGate,
} from '../events/should-run';
import { EVENT_TYPES, type SofagentEvent } from '../events/types';
import { createCircuitBreaker } from '../sandbox/circuit-breaker';
import { emitDecision, queryByKind } from '@sofagent/audit';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-should-run-prod-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeBus(shouldRunGate?: ReturnType<typeof createDefaultShouldRunGate>): EventBus {
  return new EventBus({
    dataDir: tmpDir,
    sleep: async () => {},
    now: () => new Date('2026-09-20T00:00:00.000Z'),
    ...(shouldRunGate !== undefined ? { shouldRunGate } : {}),
  });
}

/** 发布一条 node-output 事件（可带 metadata.agentId / targetNodeId） */
function nodeOutputInput(id: string, extra: { agentId?: string; targetNodeId?: string } = {}) {
  return {
    id,
    type: EVENT_TYPES.NODE_OUTPUT,
    source: 'node-output' as const,
    payload: { workflowId: 'wf', nodeId: 'n1', output: 'ok', success: true },
    workflowId: 'wf',
    ...(extra.targetNodeId !== undefined ? { targetNodeId: extra.targetNodeId } : {}),
    ...(extra.agentId !== undefined ? { metadata: { agentId: extra.agentId } } : {}),
  };
}

// ════════════════════════════════════════
// 一、装配点存在（cli.ts 生产路径真注入）
// ════════════════════════════════════════

describe('第三章 · 生产装配点', () => {
  it('buildEnterpriseEventBusOptions 产出 shouldRunGate（可测装配 helper）', () => {
    const options = buildEnterpriseEventBusOptions({ dataDir: tmpDir });
    expect(options.dataDir).toBe(tmpDir);
    expect(typeof options.shouldRunGate).toBe('function');
  });

  it('cli.ts 唯一的生产 EventBus 构造点确实使用了该装配 helper', () => {
    const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../cli.ts');
    const source = fs.readFileSync(cliPath, 'utf-8');
    // 接线证据：生产构造点经 helper 注入 gate（非新增裸构造）
    expect(source).toContain('buildEnterpriseEventBusOptions(');
    expect(source).toContain('new OrchestratorEventBus(');
    // 且构造与 helper 调用同处（同一段 eventBus 装配）
    const idx = source.indexOf('new OrchestratorEventBus(');
    expect(idx).toBeGreaterThan(-1);
    expect(source.slice(Math.max(0, idx - 400), idx + 400)).toContain('buildEnterpriseEventBusOptions(');
  });
});

// ════════════════════════════════════════
// 二、降级铁律：默认态零行为变化
// ════════════════════════════════════════

describe('第三章 · 降级铁律（默认态零行为变化）', () => {
  it('所有状态源不可得 → 所有事件正常投递（无挂起、无死信），与未注入 gate 逐字一致', async () => {
    // A：注入默认 gate（仅 dataDir，无任何状态源）
    const busWithGate = makeBus(createDefaultShouldRunGate({ dataDir: tmpDir }));
    // B：未注入 gate（接线前行为基线）
    const busBaseline = makeBus();
    const receivedWithGate: string[] = [];
    const receivedBaseline: string[] = [];
    busWithGate.subscribe(EVENT_TYPES.NODE_OUTPUT, (e) => {
      receivedWithGate.push(e.id);
    });
    busBaseline.subscribe(EVENT_TYPES.NODE_OUTPUT, (e) => {
      receivedBaseline.push(e.id);
    });

    const ids = ['p-1', 'p-2', 'p-3'];
    const resultsWithGate = [];
    for (const id of ids) resultsWithGate.push(await busWithGate.publish(nodeOutputInput(id)));
    for (const id of ids) await busBaseline.publish(nodeOutputInput(id));

    // 逐字一致：接收序列相同、全部投递成功、无挂起
    expect(receivedWithGate).toEqual(receivedBaseline);
    expect(receivedWithGate).toEqual(ids);
    for (const r of resultsWithGate) {
      expect(r.delivered).toBe(true);
      expect(r.suspended).toBeUndefined();
    }
    // 无挂起 → pending 恒空；无死信
    expect(busWithGate.listPending()).toEqual([]);
    expect(busWithGate.listDeadLetters()).toEqual([]);
    expect(busBaseline.listDeadLetters()).toEqual([]);
    // 投递留痕条数一致
    expect(busWithGate.listDeliveries().length).toBe(busBaseline.listDeliveries().length);
  });

  it('状态源抛错 → 判通过（绝不因缺数据挂起生产事件）', async () => {
    const gate = createDefaultShouldRunGate({
      dataDir: tmpDir,
      listAgents: () => {
        throw new Error('registry 不可读');
      },
      circuitBreaker: {
        canAcceptTask: () => {
          throw new Error('断路器不可用');
        },
      },
      queryCostDecisions: () => {
        throw new Error('决策日志不可读');
      },
    });
    const bus = makeBus(gate);
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.NODE_OUTPUT, (e) => {
      received.push(e.id);
    });

    const result = await bus.publish(nodeOutputInput('err-1', { agentId: 'a', targetNodeId: 'n1' }));
    expect(result.delivered).toBe(true);
    expect(result.suspended).toBeUndefined();
    expect(received).toEqual(['err-1']);
    expect(bus.listPending()).toEqual([]);
  });
});

// ════════════════════════════════════════
// 三、真实状态源触发挂起
// ════════════════════════════════════════

describe('第三章 · 真实状态源触发挂起', () => {
  it('health：真实断路器对该 agentId 返回不可接受 → 事件挂起且不进死信', async () => {
    // 真实断路器：连续 3 次失败 → 熔断（canAcceptTask=false）
    const breaker = createCircuitBreaker();
    breaker.recordCall('agent-x', false);
    breaker.recordCall('agent-x', false);
    breaker.recordCall('agent-x', false);
    expect(breaker.canAcceptTask('agent-x')).toBe(false);

    const bus = makeBus(createDefaultShouldRunGate({ dataDir: tmpDir, circuitBreaker: breaker }));
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.NODE_OUTPUT, (e) => {
      received.push(e.id);
    });

    const result = await bus.publish(nodeOutputInput('h-1', { agentId: 'agent-x' }));
    expect(result.suspended).toBe(true);
    expect(result.suspension?.question).toBe('health');
    expect(received).toEqual([]);
    // 挂起非失败——不进死信
    expect(bus.listDeadLetters()).toEqual([]);
    expect(bus.listPending()).toHaveLength(1);

    // 人工恢复断路器 → 下一次 publish 触发自动恢复，挂起事件被真正投递
    breaker.recover('agent-x', 'ops');
    await bus.publish(nodeOutputInput('h-2', { agentId: 'agent-x' }));
    expect(received).toContain('h-1');
  });

  it('human-gate：真实 agent 定义标记 hitl → 目标节点的事件挂起', async () => {
    const bus = makeBus(
      createDefaultShouldRunGate({
        dataDir: tmpDir,
        listAgents: () => [{ name: 'n1', hitl: true }, { name: 'n2', hitl: false }],
      }),
    );
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.NODE_OUTPUT, (e) => {
      received.push(e.id);
    });

    // n1 标记 HITL → 挂起
    const blocked = await bus.publish(nodeOutputInput('hg-1', { targetNodeId: 'n1' }));
    expect(blocked.suspended).toBe(true);
    expect(blocked.suspension?.question).toBe('human-gate');
    expect(received).toEqual([]);

    // n2 未标记 → 正常投递
    const ok = await bus.publish(nodeOutputInput('hg-2', { targetNodeId: 'n2' }));
    expect(ok.delivered).toBe(true);
    expect(received).toEqual(['hg-2']);
    expect(bus.listDeadLetters()).toEqual([]);
  });

  it('quota：真实 COST 决策可查态（存在告警）→ 事件挂起', async () => {
    // 真实写一条 COST 决策到 dataDir 的 decision-log
    emitDecision(
      {
        agentId: 'orchestrator',
        sessionId: 'sess-cost',
        kind: 'COST',
        moment: 'ATTRIBUTION',
        why: { text: '预算超支 WARN：本会话成本已超阈值', confidence: 'high' },
      },
      tmpDir,
    );
    expect(queryByKind('COST', {}, tmpDir).length).toBeGreaterThan(0);

    const bus = makeBus(
      createDefaultShouldRunGate({
        dataDir: tmpDir,
        queryCostDecisions: (dir) => queryByKind('COST', {}, dir),
      }),
    );
    const received: string[] = [];
    bus.subscribe(EVENT_TYPES.NODE_OUTPUT, (e) => {
      received.push(e.id);
    });

    const result = await bus.publish(nodeOutputInput('q-1'));
    expect(result.suspended).toBe(true);
    expect(result.suspension?.question).toBe('quota');
    expect(received).toEqual([]);
    expect(bus.listDeadLetters()).toEqual([]);
  });

  it('挂起事件带 decision-log 留痕（生产路径同样可查）', async () => {
    const breaker = createCircuitBreaker();
    breaker.recordCall('agent-y', false);
    breaker.recordCall('agent-y', false);
    breaker.recordCall('agent-y', false);

    const bus = makeBus(createDefaultShouldRunGate({ dataDir: tmpDir, circuitBreaker: breaker }));
    await bus.publish(nodeOutputInput('d-1', { agentId: 'agent-y' }));

    const skips = queryByKind('ORCHESTRATION', {}, tmpDir).filter((e) => e.category === 'skip');
    expect(skips).toHaveLength(1);
    expect(skips[0]!.why.tags).toContain('should-run');
    expect(skips[0]!.why.tags).toContain('health');
  });
});
