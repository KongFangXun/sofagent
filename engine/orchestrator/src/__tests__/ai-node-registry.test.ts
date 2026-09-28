// ============================================================
// ai-node-registry.test.ts · v1.5.4 第五章 · AI 节点治理接入单测
// ============================================================
//
// 覆盖面（对齐验收标准 ①-④）：
//   1. 治理面注册可用：合法 Ed25519 身份登记成功（fail-closed 验签）
//   2. 伪造/篡改拒绝：签名伪造、公钥篡改、绑定信息篡改、同 id 换身份、字段非法
//   3. workflow 引用契约：未注册节点可引用但告警留痕（引用不阻断）
//   4. 节点事件进审计链：三类节点事件经 tapAiNodeEvents 进观测面（解包信封）
//
// 隔离：SOFAGENT_DATA / SOFAGENT_KEY_PATH 全部指向临时目录（不污染仓库/真实数据面）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateAgentIdentity, type AgentIdentity } from '@sofagent/core';
import {
  AiNodeRegistry,
  getDefaultAiNodeRegistry,
  resetDefaultAiNodeRegistry,
  type RegisterAiNodeInput,
} from '../ai-node-registry';
import {
  tapAiNodeEvents,
  publishAiNodeToolCall,
  publishAiNodeEgress,
  publishAiNodeTaskCompleted,
} from '../ai-node-events';
import { EventBus } from '../events/bus';
import { EVENT_TYPES } from '../events/types';
import {
  workflowCreate,
  workflowNodeAdd,
  isAiNodeAgentRef,
  aiNodeRefToId,
  scanAiNodeReferences,
  AI_NODE_AGENT_PREFIX,
} from '../crud/workflow-store';

// ── 隔离数据面（临时目录 + 临时 HMAC 密钥）──
const ISO_DIR = join(tmpdir(), `sofagent-ai-node-registry-${process.pid}`);
const KEY_PATH = join(ISO_DIR, 'test-hmac-key');
mkdirSync(ISO_DIR, { recursive: true });
// 16+ 字节高熵 hex（过 validateHmacKey 的熵门，确保 appendChained 有真实 key）
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

// ── 夹具 ──

/** 合法身份码（Ed25519 真实签发） */
function makeIdentity(name = 'ext-node'): AgentIdentity {
  return generateAgentIdentity(name, {
    principal: 'acme-corp',
    constraints: ['仅读'],
  });
}

/** 组装可登记的 ai-node 输入 */
function regInput(identity: AgentIdentity, over: Partial<RegisterAiNodeInput> = {}): RegisterAiNodeInput {
  return {
    identity,
    stack: 'langgraph',
    eventEndpoint: { kind: 'inline' },
    ...over,
  };
}

/** 翻转 hex 串末位（造篡改） */
function flipLastHex(hex: string): string {
  const last = hex.slice(-1);
  return hex.slice(0, -1) + (last === '0' ? '1' : '0');
}

// ════════════════════════════════════════════════════════════
// 1. 治理面注册（验签 + fail-closed）
// ════════════════════════════════════════════════════════════

describe('治理面注册：Ed25519 验签（fail-closed）', () => {
  afterEach(() => resetDefaultAiNodeRegistry());

  it('合法身份登记成功且可查（lookup/isRegistered/size）', () => {
    const reg = new AiNodeRegistry();
    const id = makeIdentity('node-ok');
    const res = reg.register(regInput(id));

    expect(res.ok).toBe(true);
    expect(res.reason).toBeUndefined();
    expect(res.node?.nodeId).toBe(id.agentId);
    expect(res.node?.stack).toBe('langgraph');
    expect(res.node?.eventEndpoint).toEqual({ kind: 'inline' });
    expect(res.node?.capabilities).toEqual({});
    expect(res.node?.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(reg.isRegistered(id.agentId)).toBe(true);
    expect(reg.lookup(id.agentId)).toBe(res.node);
    expect(reg.size).toBe(1);
    expect(reg.list()).toHaveLength(1);
  });

  it('能力面 / 事件端点声明随登记保存（webhook 形态）', () => {
    const reg = new AiNodeRegistry();
    const id = makeIdentity();
    const res = reg.register(
      regInput(id, {
        eventEndpoint: { kind: 'webhook', url: 'https://node.example/hook' },
        capabilities: { tools: ['web-search'], egressHosts: ['api.github.com'] },
      }),
    );
    expect(res.ok).toBe(true);
    expect(res.node?.eventEndpoint).toEqual({ kind: 'webhook', url: 'https://node.example/hook' });
    expect(res.node?.capabilities.tools).toEqual(['web-search']);
  });

  it('伪造签名被拒（invalid-identity）', () => {
    const reg = new AiNodeRegistry();
    const id = makeIdentity();
    const forged: AgentIdentity = { ...id, signature: flipLastHex(id.signature as string) };
    const res = reg.register(regInput(forged));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid-identity');
    expect(reg.size).toBe(0);
  });

  it('公钥被篡改被拒（invalid-identity）', () => {
    const reg = new AiNodeRegistry();
    const id = makeIdentity();
    const forged: AgentIdentity = { ...id, publicKey: flipLastHex(id.publicKey as string) };
    const res = reg.register(regInput(forged));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid-identity');
  });

  it('绑定信息被篡改（改 principal）被拒（invalid-identity）', () => {
    const reg = new AiNodeRegistry();
    const id = makeIdentity();
    const forged: AgentIdentity = { ...id, principal: 'evil-corp' };
    const res = reg.register(regInput(forged));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid-identity');
  });

  it('身份字段缺失（agentId 为空 / identity 缺席）→ malformed', () => {
    const reg = new AiNodeRegistry();
    const id = makeIdentity();
    expect(reg.register(regInput({ ...id, agentId: '' })).reason).toBe('malformed');
    // @ts-expect-error 故意传非法形态（identity 缺席）
    expect(reg.register({ stack: 'langgraph', eventEndpoint: { kind: 'inline' } }).reason).toBe('malformed');
  });

  it('声明字段非法（stack 空 / kind 非法 / webhook 缺 url）→ malformed', () => {
    const reg = new AiNodeRegistry();
    const id = makeIdentity();
    expect(reg.register(regInput(id, { stack: '' })).reason).toBe('malformed');
    expect(
      reg.register(regInput(id, { eventEndpoint: { kind: 'smtp' as unknown as 'inline' } })).reason,
    ).toBe('malformed');
    expect(reg.register(regInput(id, { eventEndpoint: { kind: 'webhook' } })).reason).toBe('malformed');
  });

  it('同 id 换身份 = 冒名（duplicate-key fail-closed）', () => {
    const reg = new AiNodeRegistry();
    const a = makeIdentity('node-a');
    expect(reg.register(regInput(a)).ok).toBe(true);
    // b 自带合法签名（其自身绑定），但 agentId 与 a 相同、密钥不同 → 冒名
    const b: AgentIdentity = { ...makeIdentity('node-b'), agentId: a.agentId };
    const res = reg.register(regInput(b));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('duplicate-key');
    expect(reg.size).toBe(1);
  });

  it('同身份码幂等重放（返回既有登记，不新增）', () => {
    const reg = new AiNodeRegistry();
    const id = makeIdentity();
    const first = reg.register(regInput(id));
    const second = reg.register(regInput(id));
    expect(second.ok).toBe(true);
    expect(second.node).toBe(first.node);
    expect(reg.size).toBe(1);
  });

  it('默认注册表为显式单例（getDefaultAiNodeRegistry 同引用；reset 后重建）', () => {
    const r1 = getDefaultAiNodeRegistry();
    const r2 = getDefaultAiNodeRegistry();
    expect(r2).toBe(r1);
    resetDefaultAiNodeRegistry();
    expect(getDefaultAiNodeRegistry()).not.toBe(r1);
  });
});

// ════════════════════════════════════════════════════════════
// 2. workflow 引用契约（未注册告警留痕·引用不阻断）
// ════════════════════════════════════════════════════════════

describe('workflow 引用契约：ai-node:<id> 治理状态前置检查', () => {
  let currentWfId = '';

  beforeEach(async () => {
    const created = await workflowCreate(
      {
        workflow: { name: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, nodes: [{ id: 'dev', agent: 'developer', task: '开发' }] },
        owner: 'owner-1',
      },
      ISO_DIR,
    );
    expect(created.data.isError).toBe(false);
    currentWfId = created.data.workflowId;
  });

  it('isAiNodeAgentRef / aiNodeRefToId 判定（前缀命名空间）', () => {
    expect(AI_NODE_AGENT_PREFIX).toBe('ai-node:');
    expect(isAiNodeAgentRef('ai-node:ghost')).toBe(true);
    expect(isAiNodeAgentRef('developer')).toBe(false);
    expect(aiNodeRefToId('ai-node:ghost')).toBe('ghost');
    expect(aiNodeRefToId('ai-node:')).toBeNull();
    expect(aiNodeRefToId('developer')).toBeNull();
  });

  it('scanAiNodeReferences：无 probe 零告警 / probe 未注册 → 告警', () => {
    const nodes = [
      { id: 'n1', agent: 'ai-node:ghost' },
      { id: 'n2', agent: 'developer' },
    ];
    expect(scanAiNodeReferences(nodes)).toEqual([]);
    const warnings = scanAiNodeReferences(nodes, () => ({ registered: false }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ nodeId: 'ghost', workflowNodeId: 'n1', registered: false });
  });

  it('引用未注册节点 → data.aiNodeWarning + 引用仍成功（不阻断）', async () => {
    const res = await workflowNodeAdd(
      { workflow_id: currentWfId, node: { id: 'n9', agent: 'ai-node:ghost', task: 't' }, actor: 'owner-1' },
      ISO_DIR,
      { aiNodeProbe: () => ({ registered: false }) },
    );
    expect(res.data.isError).toBe(false);
    expect(res.data.aiNodeWarning).toBeDefined();
    expect(res.data.aiNodeWarning).toContain('未在治理面注册');
    expect(res.data.aiNodeRef).toBe('ghost');
    expect(res.data.aiNodeRegistered).toBe(false);
    expect(res.text).toContain('ghost');
  });

  it('引用已注册节点 → 无告警', async () => {
    const res = await workflowNodeAdd(
      { workflow_id: currentWfId, node: { id: 'n10', agent: 'ai-node:known', task: 't' }, actor: 'owner-1' },
      ISO_DIR,
      { aiNodeProbe: () => ({ registered: true, stack: 'langgraph' }) },
    );
    expect(res.data.isError).toBe(false);
    expect(res.data.aiNodeWarning).toBeUndefined();
    expect(res.data.aiNodeRef).toBeUndefined();
  });

  it('无治理面注入（缺省 options）→ 引用照常零告警（宿主未启用治理面，行为零变化）', async () => {
    const res = await workflowNodeAdd(
      { workflow_id: currentWfId, node: { id: 'n11', agent: 'ai-node:ghost', task: 't' }, actor: 'owner-1' },
      ISO_DIR,
    );
    expect(res.data.isError).toBe(false);
    expect(res.data.aiNodeWarning).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════
// 3. 事件进审计链（复用事件总线·解包信封）
// ════════════════════════════════════════════════════════════

describe('节点事件进审计链（tapAiNodeEvents）', () => {
  function newBus(): EventBus {
    return new EventBus({ dataDir: ISO_DIR, decisionContext: false, sleep: async () => {} });
  }

  it('三类节点事件进观测面（事件信封被解包为 payload）', async () => {
    const bus = newBus();
    const registry = new AiNodeRegistry();
    const nodeId = makeIdentity('evt-node').agentId;
    registry.register(regInput(makeIdentity('evt-node')));

    const tap = tapAiNodeEvents(bus, registry);
    expect(tap.handled).toBe(0);

    await publishAiNodeToolCall(bus, { nodeId, tool: 'web-search', argsDigest: 'sha256:aa', outcome: 'ok' });
    await publishAiNodeEgress(bus, { nodeId, host: 'api.github.com', verdict: 'Allow', reason: 'allowed' });
    await publishAiNodeTaskCompleted(bus, { nodeId, taskId: 'run-1', outcome: 'done' });

    expect(tap.handled).toBe(3);
    expect(tap.recent.map((e) => e.type)).toEqual([
      EVENT_TYPES.AI_NODE_TOOL_CALL,
      EVENT_TYPES.AI_NODE_EGRESS,
      EVENT_TYPES.AI_NODE_TASK_COMPLETED,
    ]);
    // 解包：payload 是节点事件载荷本体（非事件信封）
    expect((tap.recent[0]!.payload as { tool: string }).tool).toBe('web-search');
    expect((tap.recent[1]!.payload as { host: string }).host).toBe('api.github.com');
    expect((tap.recent[2]!.payload as { taskId: string }).taskId).toBe('run-1');
  });

  it('未注册节点产异常 → 标 anomaly.reported:unregistered（可对账，不静默）', async () => {
    const bus = newBus();
    const registry = new AiNodeRegistry();
    const tap = tapAiNodeEvents(bus, registry);

    await bus.publish({
      type: EVENT_TYPES.ANOMALY_REPORTED,
      source: 'ai-node',
      payload: { nodeId: 'ghost-node', message: 'boom' },
    });
    expect(tap.handled).toBe(1);
    expect(tap.recent[0]!.type).toBe('anomaly.reported:unregistered');
  });

  it('已注册节点产异常 → 原类型进观测面', async () => {
    const bus = newBus();
    const registry = new AiNodeRegistry();
    const id = makeIdentity('known-node');
    registry.register(regInput(id));
    const tap = tapAiNodeEvents(bus, registry);

    await bus.publish({
      type: EVENT_TYPES.ANOMALY_REPORTED,
      source: 'ai-node',
      payload: { nodeId: id.agentId, message: 'oops' },
    });
    expect(tap.recent[0]!.type).toBe(EVENT_TYPES.ANOMALY_REPORTED);
  });

  it('dispose 后停止捕获（订阅卸载）', async () => {
    const bus = newBus();
    const tap = tapAiNodeEvents(bus);
    await publishAiNodeTaskCompleted(bus, { nodeId: 'n', taskId: 't', outcome: 'done' });
    expect(tap.handled).toBe(1);
    tap.dispose();
    await publishAiNodeTaskCompleted(bus, { nodeId: 'n', taskId: 't2', outcome: 'done' });
    expect(tap.handled).toBe(1);
  });

  it('未登记事件类型 publish 被落盘 kind 门拒绝（fail-closed）', async () => {
    const bus = newBus();
    await expect(
      bus.publish({ type: 'ai-node.not-registered', source: 'ai-node', payload: {} }),
    ).rejects.toThrow();
  });

  it('环形缓冲有界（超过上界丢弃最旧——观测面非存储面）', async () => {
    const bus = newBus();
    const tap = tapAiNodeEvents(bus);
    for (let i = 0; i < 300; i++) {
      await publishAiNodeTaskCompleted(bus, { nodeId: 'n', taskId: `t-${i}`, outcome: 'done' });
    }
    expect(tap.handled).toBe(300);
    expect(tap.recent.length).toBe(256);
    // 保最近 256 条：最旧留下的是第 44 条
    expect((tap.recent[0]!.payload as { taskId: string }).taskId).toBe('t-44');
  });
});
