// ============================================================
// ai-node-governance.test.ts · v1.5.4 第五章 · A-4 真接线生产装配面单测
// ============================================================
//
// 覆盖「把第五章六件装到一起交给真实入口」这一层（之前只测了各件本身）：
//   1. 装配面齐备：registry/bus/tap/sink/probe 五面 + 三方法
//   2. 探针两态：未注册 → {registered:false}；已注册 → {registered:true, stack}
//   3. node-executor 包装：ai-node 引用 → 三类事件进观测面 + 出站裁决落 decision-log
//   4. 🔴 零行为变化守卫：普通企业节点（非 ai-node 引用）→ 不建治理面、零 events 落盘
//
// 隔离：SOFAGENT_DATA / SOFAGENT_KEY_PATH 全部指向临时目录（不污染仓库/真实数据面）。
// ============================================================

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateAgentIdentity } from '@sofagent/core';
import {
  createAiNodeGovernance,
  buildAiNodeGovernanceProbe,
  resetDefaultAiNodeGovernance,
} from '../ai-node-governance';
import { AiNodeRegistry, resetDefaultAiNodeRegistry } from '../ai-node-registry';
import { EventBus } from '../events/bus';
import { executeNode } from '../node-executor';

const ISO_DIR = join(tmpdir(), `sofagent-ai-node-gov-${process.pid}`);
const KEY_PATH = join(ISO_DIR, 'test-hmac-key');
mkdirSync(ISO_DIR, { recursive: true });
writeFileSync(KEY_PATH, 'a1b2c3d4e5f60718293a4b5c6d7e8f90', 'utf-8');

const ORIG_DATA = process.env.SOFAGENT_DATA;
const ORIG_KEY = process.env.SOFAGENT_KEY_PATH;
process.env.SOFAGENT_DATA = ISO_DIR;
process.env.SOFAGENT_KEY_PATH = KEY_PATH;

afterAll(() => {
  if (ORIG_DATA === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = ORIG_DATA;
  if (ORIG_KEY === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = ORIG_KEY;
  rmSync(ISO_DIR, { recursive: true, force: true });
});

/** 隔离事件总线（零真实退避等待） */
function newBus(dir: string): EventBus {
  return new EventBus({ dataDir: dir, decisionContext: false, sleep: async () => {} });
}

describe('createAiNodeGovernance：生产装配面', () => {
  it('装配齐备（registry/bus/tap/sink/probe）+ 三方法可调用', async () => {
    const dir = join(ISO_DIR, 'assembly');
    mkdirSync(dir, { recursive: true });
    const registry = new AiNodeRegistry();
    const gov = createAiNodeGovernance({ dataDir: dir, registry, bus: newBus(dir) });

    expect(gov.registry).toBe(registry);
    expect(typeof gov.probe).toBe('function');
    expect(typeof gov.recordToolCall).toBe('function');
    expect(typeof gov.adjudicateEgress).toBe('function');
    expect(typeof gov.recordTaskCompleted).toBe('function');
    expect(gov.tap.handled).toBe(0);

    await gov.recordToolCall({ nodeId: 'n', tool: 't', argsDigest: 'sha256:x', outcome: 'ok' });
    expect(gov.tap.handled).toBe(1);

    // 出站裁决：注入 sink → 落 decision-log（TOOL_GATE）
    const out = gov.adjudicateEgress('n', { host: 'api.github.com' }, null);
    expect(out.allowed).toBe(false); // 空策略 fail-closed
    expect(out.recorded).toBe(true); // sink 落盘成功
    const dl = join(dir, 'audit', 'decision-log.jsonl');
    expect(existsSync(dl)).toBe(true);
    const last = JSON.parse(readFileSync(dl, 'utf8').trim().split('\n').pop() as string);
    expect(last.kind).toBe('TOOL_GATE');
    expect(last.artifactRef).toBe('egress/n/api.github.com');

    gov.dispose();
  });

  it('探针两态：未注册 false / 已注册 true + stack', () => {
    const registry = new AiNodeRegistry();
    const probe = buildAiNodeGovernanceProbe(registry);
    expect(probe('ghost')).toEqual({ registered: false });

    const id = generateAgentIdentity('known', { principal: 'acme', constraints: ['仅读'] });
    registry.register({ identity: id, stack: 'langgraph', eventEndpoint: { kind: 'inline' } });
    expect(probe(id.agentId)).toEqual({ registered: true, stack: 'langgraph' });
  });
});

describe('executeNode 治理包装：ai-node 引用路径', () => {
  beforeEach(() => {
    resetDefaultAiNodeRegistry();
    resetDefaultAiNodeGovernance();
  });

  it('ai-node 引用 → 三类事件进观测面 + 出站裁决落链', async () => {
    const dir = join(ISO_DIR, `node-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const id = generateAgentIdentity('ext', { principal: 'acme', constraints: ['仅读'] });
    const gov = createAiNodeGovernance({ dataDir: dir, registry: new AiNodeRegistry(), bus: newBus(dir) });
    gov.registry.register({
      identity: id,
      stack: 'langgraph',
      eventEndpoint: { kind: 'inline' },
      capabilities: { egressHosts: ['api.github.com'] },
    });

    const res = await executeNode(
      {
        agentName: `ai-node:${id.agentId}`,
        agentConfig: { name: id.agentId, systemPrompt: 'p', description: 'd' },
        node: { id: 'n1', agent: `ai-node:${id.agentId}`, task: 'task' },
        dataDir: dir,
        projectRoot: process.cwd(),
      },
      { resolveModel: async () => null, aiNodeGovernance: gov },
    );

    expect(res.success).toBe(true);
    // ② 三类事件：出站（1）+ 工具调用（1）+ 任务完成（1）
    expect(gov.tap.handled).toBe(3);
    expect(gov.tap.recent.map((e) => e.type).sort()).toEqual([
      'ai-node.egress',
      'ai-node.task-completed',
      'ai-node.tool-call',
    ]);
    // ③ 出站裁决留痕（声明 host 命中白名单 → Allow）
    const dl = join(dir, 'audit', 'decision-log.jsonl');
    const lines = readFileSync(dl, 'utf8').trim().split('\n');
    expect(lines.some((l) => JSON.parse(l).kind === 'TOOL_GATE')).toBe(true);

    gov.dispose();
  });

  it('🔴 零行为变化：普通企业节点（非 ai-node 引用）不建治理面、零 events 落盘', async () => {
    const dir = join(ISO_DIR, `plain-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const res = await executeNode(
      {
        agentName: 'enterprise',
        agentConfig: { name: 'e', systemPrompt: 'p', description: 'd' },
        node: { id: 'n2', agent: 'enterprise', task: 't' },
        dataDir: dir,
        projectRoot: process.cwd(),
      },
      { resolveModel: async () => null },
    );

    expect(res.success).toBe(true);
    expect(existsSync(join(dir, 'events'))).toBe(false);
    expect(existsSync(join(dir, 'audit', 'decision-log.jsonl'))).toBe(false);
  });
});
