// ============================================================
// team-protocol.test.ts · L2 团队协作协议单测（v1.3.3 交付 T02）
//
// 验收标准对应的 5 个场景：
//   1. 两个 Agent 组队后，A 广播意图 → B 收到并触发反应
//   2. 同时改同一文件时触发冲突消解（trust 高者胜）
//   3. 一次人工纠正 → 团队级 feedback 沉淀（反馈放大）
//   4. 团队会话重启后状态不丢（CRDT 合并恢复）
//   5. glob 订阅匹配规则
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import * as Automerge from 'automerge';

import {
  initTeamState,
  addMember,
  saveTeamState,
  loadTeamState,
  mergeTeamState,
  setFileLock,
  appendFeedback,
} from '../team/team-state';
import type { MemberState } from '../team/team-state';
import { matchIntent, IntentBus } from '../team/intent-bus';
import type { IntentEvent } from '../team/intent-bus';
import {
  resolveConflict,
  detectFileLockConflict,
  amplifyFeedback,
  getFeedback,
} from '../team/protocol';
import type { TeamConflictParty } from '../team/protocol';
import { createTeam, parseTeamYaml, TeamManager } from '../team/team-manager';

// ────────────────────────────────────────────────────────────
// 测试辅助
// ────────────────────────────────────────────────────────────

function tmpDataDir(): string {
  const dir = join(tmpdir(), `sofagent-team-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMember(agentId: string, role: 'leader' | 'member', trust: number): MemberState {
  return {
    agentId,
    role,
    trust,
    status: 'idle',
    lastHeartbeat: new Date().toISOString(),
  };
}

function makeTeamYamlText(): string {
  return `
name: 测试团队
team_id: team-test-001
members:
  - agent_id: agent-leader
    role: leader
    trust: 0.9
  - agent_id: agent-member
    role: member
    trust: 0.7
shared_state:
  - reports/
broadcast_channels:
  - name: 审批流
    subscribe: [agent-leader]
    trigger_on: ["intent.create.*"]
`;
}

// ────────────────────────────────────────────────────────────
// 1. glob 订阅匹配规则
// ────────────────────────────────────────────────────────────

describe('matchIntent · glob 订阅匹配', () => {
  it('通配符 * 匹配任意后缀', () => {
    expect(matchIntent('intent.create.*', 'intent.create.report')).toBe(true);
    expect(matchIntent('intent.create.*', 'intent.create.config')).toBe(true);
    expect(matchIntent('intent.create.*', 'intent.modify.config')).toBe(false);
  });

  it('全通配 intent.* 匹配所有 intent 类', () => {
    expect(matchIntent('intent.*', 'intent.create.report')).toBe(true);
    expect(matchIntent('intent.*', 'intent.modify.config')).toBe(true);
    expect(matchIntent('intent.*', 'intent.complete.task-1')).toBe(true);
  });

  it('精确匹配（无通配符）', () => {
    expect(matchIntent('intent.create.report', 'intent.create.report')).toBe(true);
    expect(matchIntent('intent.create.report', 'intent.create.config')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 2. 意图广播 → 订阅者触发反应（验收 1）
// ────────────────────────────────────────────────────────────

describe('IntentBus · 广播与订阅', () => {
  it('A 广播意图 → B 收到并触发反应', () => {
    const bus = new IntentBus('team-1', 100);
    const received: IntentEvent[] = [];

    // Agent B 订阅所有 create 类意图
    bus.subscribe({
      subscriber: 'agent-b',
      pattern: 'intent.create.*',
      onMatch: (event) => {
        received.push(event);
      },
    });

    // Agent A 广播
    bus.broadcast({
      id: 'evt-1',
      source: 'agent-a',
      intent: 'intent.create.report',
      target: 'reports/q4.md',
      ts: new Date().toISOString(),
      teamId: 'team-1',
    });

    expect(received.length).toBe(1);
    expect(received[0]!.source).toBe('agent-a');
    expect(received[0]!.intent).toBe('intent.create.report');

    bus.close();
  });

  it('不匹配的模式不触发', () => {
    const bus = new IntentBus('team-1', 100);
    const received: IntentEvent[] = [];

    bus.subscribe({
      subscriber: 'agent-b',
      pattern: 'intent.delete.*',
      onMatch: (event) => {
        received.push(event);
      },
    });

    bus.broadcast({
      id: 'evt-2',
      source: 'agent-a',
      intent: 'intent.create.report',
      target: 'reports/q4.md',
      ts: new Date().toISOString(),
      teamId: 'team-1',
    });

    expect(received.length).toBe(0);
    bus.close();
  });

  it('幂等去重——同一事件 ID 不重复处理', () => {
    const bus = new IntentBus('team-1', 100);
    const received: IntentEvent[] = [];

    bus.subscribe({
      subscriber: 'agent-b',
      pattern: 'intent.*',
      onMatch: (event) => {
        received.push(event);
      },
    });

    const event: IntentEvent = {
      id: 'evt-dup',
      source: 'agent-a',
      intent: 'intent.create.report',
      target: 'x',
      ts: new Date().toISOString(),
      teamId: 'team-1',
    };

    bus.broadcast(event);
    bus.broadcast(event); // 重复

    expect(received.length).toBe(1);
    bus.close();
  });
});

// ────────────────────────────────────────────────────────────
// 3. 冲突消解——trust 高者胜（验收 2）
// ────────────────────────────────────────────────────────────

describe('resolveConflict · 冲突消解', () => {
  it('trust 高者胜', () => {
    const parties: TeamConflictParty[] = [
      { agentId: 'agent-low', trust: 0.3, ts: '2025-01-01T00:00:00Z', role: 'member', change: 'version-a' },
      { agentId: 'agent-high', trust: 0.9, ts: '2025-01-01T00:00:01Z', role: 'member', change: 'version-b' },
    ];
    const result = resolveConflict(parties);
    expect(result.winner.agentId).toBe('agent-high');
    expect(result.losers.length).toBe(1);
    expect(result.losers[0]!.agentId).toBe('agent-low');
  });

  it('trust 相同时，时间戳早者胜', () => {
    const parties: TeamConflictParty[] = [
      { agentId: 'agent-late', trust: 0.5, ts: '2025-01-01T00:00:05Z', role: 'member', change: 'a' },
      { agentId: 'agent-early', trust: 0.5, ts: '2025-01-01T00:00:00Z', role: 'member', change: 'b' },
    ];
    const result = resolveConflict(parties);
    expect(result.winner.agentId).toBe('agent-early');
  });

  it('trust + 时间戳都相同时，leader 胜', () => {
    const parties: TeamConflictParty[] = [
      { agentId: 'agent-member', trust: 0.5, ts: '2025-01-01T00:00:00Z', role: 'member', change: 'a' },
      { agentId: 'agent-leader', trust: 0.5, ts: '2025-01-01T00:00:00Z', role: 'leader', change: 'b' },
    ];
    const result = resolveConflict(parties);
    expect(result.winner.agentId).toBe('agent-leader');
  });

  it('全部相同时，agentId 字典序小者胜（确定性兜底）', () => {
    const parties: TeamConflictParty[] = [
      { agentId: 'agent-zzz', trust: 0.5, ts: '2025-01-01T00:00:00Z', role: 'member', change: 'a' },
      { agentId: 'agent-aaa', trust: 0.5, ts: '2025-01-01T00:00:00Z', role: 'member', change: 'b' },
    ];
    const result = resolveConflict(parties);
    expect(result.winner.agentId).toBe('agent-aaa');
  });

  it('少于 2 方抛错', () => {
    expect(() => resolveConflict([{ agentId: 'a', trust: 0.5, ts: 't', role: 'member', change: 'x' }])).toThrow();
  });
});

// ────────────────────────────────────────────────────────────
// 4. 文件锁冲突检测
// ────────────────────────────────────────────────────────────

describe('detectFileLockConflict · 文件锁', () => {
  it('其他 Agent 持有锁 → 返回持有者', () => {
    let doc = initTeamState('t1', 'test');
    doc = addMember(doc, makeMember('agent-a', 'member', 0.5));
    doc = addMember(doc, makeMember('agent-b', 'member', 0.5));
    doc = setFileLock(doc, 'reports/q4.md', 'agent-a');

    const conflict = detectFileLockConflict(doc, 'reports/q4.md', 'agent-b');
    expect(conflict).not.toBeNull();
    expect(conflict!.agentId).toBe('agent-a');
  });

  it('自己持有锁 → 无冲突', () => {
    let doc = initTeamState('t1', 'test');
    doc = addMember(doc, makeMember('agent-a', 'member', 0.5));
    doc = setFileLock(doc, 'reports/q4.md', 'agent-a');

    const conflict = detectFileLockConflict(doc, 'reports/q4.md', 'agent-a');
    expect(conflict).toBeNull();
  });

  it('无锁 → 无冲突', () => {
    let doc = initTeamState('t1', 'test');
    doc = addMember(doc, makeMember('agent-a', 'member', 0.5));

    const conflict = detectFileLockConflict(doc, 'reports/q4.md', 'agent-b');
    expect(conflict).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// 5. 反馈放大（验收 3）
// ────────────────────────────────────────────────────────────

describe('amplifyFeedback · 反馈放大', () => {
  it('人工纠正 → 写入 team-state.feedback[]', () => {
    let doc = initTeamState('t1', 'test');
    doc = amplifyFeedback(doc, {
      agentId: 'agent-a',
      type: 'correction',
      content: '报告标题应包含日期',
    });

    const feedback = getFeedback(doc);
    expect(feedback.length).toBe(1);
    expect(feedback[0]!.agentId).toBe('agent-a');
    expect(feedback[0]!.type).toBe('correction');
    expect(feedback[0]!.content).toBe('报告标题应包含日期');
  });

  it('quality_rule 反馈可按类型筛选（Refine Agent 用）', () => {
    let doc = initTeamState('t1', 'test');
    doc = amplifyFeedback(doc, { agentId: 'a', type: 'correction', content: '纠错1' });
    doc = amplifyFeedback(doc, { agentId: 'b', type: 'quality_rule', content: '工具描述必须带 example' });
    doc = amplifyFeedback(doc, { agentId: 'c', type: 'quality_rule', content: '输出不超 500 字' });

    const rules = getFeedback(doc).filter((f) => f.type === 'quality_rule');
    expect(rules.length).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────
// 6. CRDT 持久化 + 会话重启恢复（验收 4）
// ────────────────────────────────────────────────────────────

describe('TeamState CRDT · 持久化与恢复', () => {
  it('save → load 状态不丢', () => {
    let doc = initTeamState('team-1', '测试团队');
    doc = addMember(doc, makeMember('agent-a', 'leader', 0.9));
    doc = addMember(doc, makeMember('agent-b', 'member', 0.7));
    doc = appendFeedback(doc, {
      id: 'fb-1',
      agentId: 'agent-a',
      type: 'correction',
      content: '测试反馈',
      ts: new Date().toISOString(),
    });

    const binary = saveTeamState(doc);
    const restored = loadTeamState(binary);

    expect(Object.keys(restored.members).length).toBe(2);
    expect(restored.members['agent-a']!.trust).toBe(0.9);
    expect(restored.feedback.length).toBe(1);
    expect(restored.feedback[0]!.content).toBe('测试反馈');
  });

  it('merge 后状态收敛不丢', () => {
    // automerge CRDT 合并需要共同祖先——用 clone 分叉再 merge（对齐 federation.ts 模式）
    let docA = initTeamState('team-1', '测试');
    docA = addMember(docA, makeMember('agent-a', 'leader', 0.9));

    // 从 docA clone 出 docB，分叉写入不同成员
    const docB = Automerge.clone(docA);
    const docBUpdated = addMember(docB, makeMember('agent-b', 'member', 0.7));

    const merged = mergeTeamState(docA, docBUpdated);
    expect(Object.keys(merged.members).length).toBe(2);
    expect(merged.members['agent-a']).toBeDefined();
    expect(merged.members['agent-b']).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────
// 7. TeamManager 集成（建队 + 广播 + 持久化）
// ────────────────────────────────────────────────────────────

describe('TeamManager · 建队与编排', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = tmpDataDir();
  });

  afterEach(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('parseTeamYaml 正确解析 team.yml', () => {
    const parsed = parseTeamYaml(makeTeamYamlText());
    expect(parsed.name).toBe('测试团队');
    expect(parsed.team_id).toBe('team-test-001');
    expect(parsed.members.length).toBe(2);
    expect(parsed.members[0]!.agent_id).toBe('agent-leader');
    expect(parsed.members[0]!.trust).toBe(0.9);
    expect(parsed.broadcast_channels.length).toBe(1);
    expect(parsed.broadcast_channels[0]!.trigger_on).toContain('intent.create.*');
  });

  it('createTeam 建队后成员全部入列（offline 状态）', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    const state = tm.getState();
    expect(Object.keys(state.members).length).toBe(2);
    expect(state.members['agent-leader']).toBeDefined();
    expect(state.members['agent-member']).toBeDefined();
    tm.close();
  });

  it('join 后成员状态变 idle', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    tm.join('agent-leader', 'leader', 0.9);
    expect(tm.getState().members['agent-leader']!.status).toBe('idle');
    tm.close();
  });

  it('enqueueSubAgent 自动入队 sub-agent', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    const before = Object.keys(tm.getState().members).length;
    tm.enqueueSubAgent({ agentId: 'sub-agent-1', trust: 0.5 });
    const after = Object.keys(tm.getState().members).length;
    expect(after).toBe(before + 1);
    expect(tm.getState().members['sub-agent-1']).toBeDefined();
    tm.close();
  });

  it('广播意图 + 订阅触发反应', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    const received: IntentEvent[] = [];

    tm.intentBus.subscribe({
      subscriber: 'agent-member',
      pattern: 'intent.create.*',
      onMatch: (e) => received.push(e),
    });

    tm.broadcastIntent('agent-leader', 'intent.create.report', 'reports/q4.md');
    expect(received.length).toBe(1);
    expect(received[0]!.source).toBe('agent-leader');
    tm.close();
  });

  it('持久化后重新创建 TeamManager 状态不丢', () => {
    const tm1 = createTeam(makeTeamYamlText(), { dataDir });
    tm1.join('agent-leader', 'leader', 0.9);
    tm1.enqueueSubAgent({ agentId: 'sub-1' });
    tm1.persist();
    tm1.close();

    // 重新创建——从持久化恢复
    const tm2 = createTeam(makeTeamYamlText(), { dataDir });
    const state = tm2.getState();
    // 原始 2 成员 + enqueueSubAgent 的 sub-1 = 3
    expect(Object.keys(state.members).length).toBe(3);
    expect(state.members['sub-1']).toBeDefined();
    tm2.close();
  });

  it('非法 team.yml 抛 TeamYamlError', () => {
    expect(() => parseTeamYaml('name: x')).toThrow(/team_id/);
    expect(() => parseTeamYaml('name: x\nteam_id: t1\nmembers: []')).toThrow(/members/);
  });

  // ── T03：主 agent 编排（dispatchTask / collectResult / relayMessage）──

  it('dispatchTask 分发任务 → sub-agent 状态变 busy + 任务入看板', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    tm.join('agent-leader', 'leader', 0.9);
    tm.join('agent-member', 'member', 0.7);

    tm.dispatchTask('task-1', 'agent-member', '撰写财务报告');

    const state = tm.getState();
    expect(state.tasks['task-1']).toBeDefined();
    expect(state.tasks['task-1']!.status).toBe('running');
    expect(state.members['agent-member']!.status).toBe('busy');
    expect(state.members['agent-member']!.currentTask).toBe('task-1');
    tm.close();
  });

  it('collectResult 收集结果 → task 状态变 done + sub-agent 恢复 idle', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    tm.join('agent-leader', 'leader', 0.9);
    tm.join('agent-member', 'member', 0.7);
    tm.dispatchTask('task-2', 'agent-member', '编写测试');

    tm.collectResult('task-2', '测试全部通过', true);

    const state = tm.getState();
    expect(state.tasks['task-2']!.status).toBe('done');
    expect(state.tasks['task-2']!.result).toBe('测试全部通过');
    expect(state.members['agent-member']!.status).toBe('idle');
    tm.close();
  });

  it('collectResult 失败结果 → task 状态变 failed', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    tm.join('agent-leader', 'leader', 0.9);
    tm.join('agent-member', 'member', 0.7);
    tm.dispatchTask('task-3', 'agent-member', '部署到生产');

    tm.collectResult('task-3', '部署超时', false);

    expect(tm.getState().tasks['task-3']!.status).toBe('failed');
    tm.close();
  });

  it('relayMessage sub-agent 间通讯经主 agent 中转（不直连）', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    tm.join('agent-a', 'member', 0.5);
    tm.join('agent-b', 'member', 0.5);

    const received: string[] = [];
    tm.intentBus.subscribe({
      subscriber: 'agent-b',
      pattern: 'intent.notify.*',
      onMatch: (e) => received.push(e.payload && typeof e.payload === 'object' ? (e.payload as { message: string }).message : ''),
    });

    tm.relayMessage('agent-a', 'intent.notify.agent-b', '请完成后通知我', 'task-x');
    expect(received.length).toBe(1);
    expect(received[0]).toBe('请完成后通知我');
    tm.close();
  });

  it('getTeamDashboard 返回任务看板 + 成员摘要', () => {
    const tm = createTeam(makeTeamYamlText(), { dataDir });
    tm.join('agent-leader', 'leader', 0.9);
    tm.dispatchTask('task-dash', 'agent-leader', '测试任务');

    const dashboard = tm.getTeamDashboard();
    expect(dashboard.tasks.length).toBeGreaterThanOrEqual(1);
    expect(dashboard.members.length).toBeGreaterThanOrEqual(1);
    tm.close();
  });
});
