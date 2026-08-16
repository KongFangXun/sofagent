// ============================================================
// team-state.regression.test.ts · automerge 升级回归保险（v1.3.5 交付 4b 前置）
//
// 目的：automerge 1.0.1-preview.7 → @automerge/automerge 3.x 是 major
// 升级（包名 + API 签名全变）。本测试在 1.x 上先跑绿，升级后跑同一套
// 测试验证行为不回归——init→change→save→load→merge 全链路 +
// 两设备并发修改→同步→验证无冲突。
//
// 🔒 隔离纪律（v1.3.5 铁律）：
//   - 纯内存 CRDT 操作，不落盘、不写 ~/.sofagent
//   - 不假设 HOME 形态或路径前缀
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  initTeamState,
  addMember,
  addTask,
  updateMemberStatus,
  setFileLock,
  appendFeedback,
  saveTeamState,
  loadTeamState,
  mergeTeamState,
} from '../team/team-state';
import type { MemberState, TaskState, FeedbackEntry } from '../team/team-state';

// ────────────────────────────────────────────────────────────
// 测试辅助
// ────────────────────────────────────────────────────────────

function makeMember(agentId: string, role: 'leader' | 'member', trust: number): MemberState {
  return {
    agentId,
    role,
    trust,
    status: 'idle',
    lastHeartbeat: new Date().toISOString(),
  };
}

function makeTask(taskId: string, assignee: string): TaskState {
  return {
    taskId,
    description: `任务 ${taskId}`,
    assignee,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  };
}

function makeFeedback(id: string, agentId: string): FeedbackEntry {
  return {
    id,
    agentId,
    type: 'correction',
    content: `反馈 ${id}`,
    ts: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────
// 1. init→change→save→load→merge 全链路
// ────────────────────────────────────────────────────────────

describe('team-state 回归 · init→change→save→load→merge 全链路', () => {
  it('init 创建带 meta 的空文档，初始集合为空', () => {
    const doc = initTeamState('team-reg-001', '回归测试团队');

    expect(doc.meta.teamId).toBe('team-reg-001');
    expect(doc.meta.name).toBe('回归测试团队');
    expect(typeof doc.meta.createdAt).toBe('string');
    expect(doc.meta.createdAt.length).toBeGreaterThan(0);
    expect(doc.members).toEqual({});
    expect(doc.tasks).toEqual({});
    expect(doc.fileLocks).toEqual({});
    expect(doc.feedback).toEqual([]);
  });

  it('change 全链路：成员/任务/状态/文件锁/反馈依次写入且可读回', () => {
    let doc = initTeamState('team-reg-002', '全链路团队');

    doc = addMember(doc, makeMember('agent-a', 'leader', 0.9));
    doc = addMember(doc, makeMember('agent-b', 'member', 0.7));
    doc = addTask(doc, makeTask('task-1', 'agent-a'));
    doc = updateMemberStatus(doc, 'agent-a', {
      status: 'busy',
      currentTask: 'task-1',
      lastHeartbeat: '2026-01-01T00:00:00.000Z',
    });
    doc = setFileLock(doc, 'reports/summary.md', 'agent-a');
    doc = appendFeedback(doc, makeFeedback('fb-1', 'agent-b'));

    expect(Object.keys(doc.members).sort()).toEqual(['agent-a', 'agent-b']);
    expect(doc.members['agent-a'].role).toBe('leader');
    expect(doc.members['agent-a'].trust).toBe(0.9);
    expect(doc.members['agent-b'].role).toBe('member');
    expect(doc.tasks['task-1'].assignee).toBe('agent-a');
    expect(doc.tasks['task-1'].status).toBe('pending');
    expect(doc.members['agent-a'].status).toBe('busy');
    expect(doc.members['agent-a'].currentTask).toBe('task-1');
    expect(doc.fileLocks['reports/summary.md'].holder).toBe('agent-a');
    expect(doc.feedback).toHaveLength(1);
    expect(doc.feedback[0].id).toBe('fb-1');

    // 文件锁释放后条目消失
    doc = setFileLock(doc, 'reports/summary.md', null);
    expect(doc.fileLocks['reports/summary.md']).toBeUndefined();
  });

  it('change 不可变性：修改操作返回新文档，原文档不被污染', () => {
    const base = initTeamState('team-reg-003', '不可变团队');
    const next = addMember(base, makeMember('agent-x', 'member', 0.5));

    expect(base.members).toEqual({});
    expect(next.members['agent-x']).toBeDefined();
  });

  it('save→load 往返：序列化二进制后反序列化，全部字段完整恢复', () => {
    let doc = initTeamState('team-reg-004', '往返团队');
    doc = addMember(doc, makeMember('agent-a', 'leader', 0.9));
    doc = addMember(doc, makeMember('agent-b', 'member', 0.7));
    doc = addTask(doc, makeTask('task-1', 'agent-a'));
    doc = updateMemberStatus(doc, 'agent-b', { status: 'blocked' });
    doc = setFileLock(doc, 'src/index.ts', 'agent-b');
    doc = appendFeedback(doc, makeFeedback('fb-1', 'agent-a'));
    doc = appendFeedback(doc, makeFeedback('fb-2', 'agent-b'));

    const binary = saveTeamState(doc);
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(binary.length).toBeGreaterThan(0);

    const loaded = loadTeamState(binary);
    expect(loaded.meta.teamId).toBe('team-reg-004');
    expect(loaded.meta.name).toBe('往返团队');
    expect(loaded.meta.createdAt).toBe(doc.meta.createdAt);
    expect(Object.keys(loaded.members).sort()).toEqual(['agent-a', 'agent-b']);
    expect(loaded.members['agent-a'].trust).toBe(0.9);
    expect(loaded.members['agent-b'].status).toBe('blocked');
    expect(loaded.tasks['task-1'].description).toBe('任务 task-1');
    expect(loaded.fileLocks['src/index.ts'].holder).toBe('agent-b');
    expect(loaded.feedback.map((f) => f.id)).toEqual(['fb-1', 'fb-2']);
  });

  it('save→load 后可继续 change：恢复的文档保持可编辑', () => {
    let doc = initTeamState('team-reg-005', '续写团队');
    doc = addMember(doc, makeMember('agent-a', 'leader', 0.9));

    const binary = saveTeamState(doc);
    let restored = loadTeamState(binary);
    restored = addTask(restored, makeTask('task-after-load', 'agent-a'));

    expect(restored.tasks['task-after-load']).toBeDefined();
    expect(restored.members['agent-a']).toBeDefined();
  });

  it('merge：load 本地持久化 + 合并远端增量，两边改动全部保留', () => {
    // 设备 A：初始化 + 成员 a
    let docA = initTeamState('team-reg-006', '合并团队');
    docA = addMember(docA, makeMember('agent-a', 'leader', 0.9));

    // 设备 B 从设备 A 的快照起步（save→load 模拟跨设备传输）
    let docB = loadTeamState(saveTeamState(docA));

    // 两边各自独立演进
    docA = addTask(docA, makeTask('task-by-a', 'agent-a'));
    docB = addMember(docB, makeMember('agent-b', 'member', 0.7));
    docB = appendFeedback(docB, makeFeedback('fb-by-b', 'agent-b'));

    // 会话重启：设备 A 从持久化二进制恢复，再合并远端增量
    const persistedA = loadTeamState(saveTeamState(docA));
    const merged = mergeTeamState(persistedA, docB);

    // 双方改动全部保留，无一丢失
    expect(Object.keys(merged.members).sort()).toEqual(['agent-a', 'agent-b']);
    expect(merged.tasks['task-by-a']).toBeDefined();
    expect(merged.tasks['task-by-a'].assignee).toBe('agent-a');
    expect(merged.feedback.map((f) => f.id)).toEqual(['fb-by-b']);
  });

  it('merge 幂等：同一文档重复合并不产生重复数据', () => {
    // ⚠️ automerge 1.x 语义：merge(local, remote) 返回新句柄并使旧 local 失效，
    // 重复合并必须基于返回值推进，remote 侧用 save→load 快照隔离（不可复用已失效句柄）
    let docA = initTeamState('team-reg-007', '幂等团队');
    docA = addMember(docA, makeMember('agent-a', 'leader', 0.9));
    docA = appendFeedback(docA, makeFeedback('fb-1', 'agent-a'));

    const snapshot = loadTeamState(saveTeamState(docA));
    const first = mergeTeamState(docA, snapshot);
    const second = mergeTeamState(first, loadTeamState(saveTeamState(snapshot)));

    expect(Object.keys(second.members)).toHaveLength(1);
    expect(second.feedback).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────
// 2. 两设备并发修改→同步→验证无冲突
// ────────────────────────────────────────────────────────────

describe('team-state 回归 · 两设备并发修改→同步→无冲突', () => {
  it('并发写不同 key：双向同步后双方视角一致且改动齐全', () => {
    // 共同起点
    let base = initTeamState('team-reg-101', '并发团队');
    base = addMember(base, makeMember('agent-a', 'leader', 0.9));
    base = addMember(base, makeMember('agent-b', 'member', 0.7));
    const snapshot = saveTeamState(base);

    // 设备 A / B 从同一快照独立并发修改（不同 key）
    let docA = loadTeamState(snapshot);
    docA = addTask(docA, makeTask('task-a-1', 'agent-a'));
    docA = updateMemberStatus(docA, 'agent-a', { status: 'busy' });

    let docB = loadTeamState(snapshot);
    docB = addTask(docB, makeTask('task-b-1', 'agent-b'));
    docB = appendFeedback(docB, makeFeedback('fb-b-1', 'agent-b'));

    // 先固化两份线上二进制（⚠️ merge 会使其 local 句柄失效，save 必须发生在 merge 之前）
    const wireA = saveTeamState(docA);
    const wireB = saveTeamState(docB);

    // 双向同步：各自合并对方的增量（save→load 模拟跨设备传输）
    const syncedA = mergeTeamState(docA, loadTeamState(wireB));
    const syncedB = mergeTeamState(docB, loadTeamState(wireA));

    // 双方视角收敛一致（CRDT 收敛保证）
    expect(Object.keys(syncedA.tasks).sort()).toEqual(['task-a-1', 'task-b-1']);
    expect(Object.keys(syncedB.tasks).sort()).toEqual(['task-a-1', 'task-b-1']);
    expect(syncedA.feedback.map((f) => f.id)).toEqual(['fb-b-1']);
    expect(syncedB.feedback.map((f) => f.id)).toEqual(['fb-b-1']);
    expect(syncedA.members['agent-a'].status).toBe('busy');
    expect(syncedB.members['agent-a'].status).toBe('busy');
    // 收敛性：双方再互相同步一次后完全一致（内容层面无冲突分叉）
    const wireSA = saveTeamState(syncedA);
    const wireSB = saveTeamState(syncedB);
    const finalA = mergeTeamState(syncedA, loadTeamState(wireSB));
    const finalB = mergeTeamState(syncedB, loadTeamState(wireSA));
    expect(Object.keys(finalA.tasks).sort()).toEqual(Object.keys(finalB.tasks).sort());
    expect(finalA.feedback.map((f) => f.id)).toEqual(finalB.feedback.map((f) => f.id));
  });

  it('并发写同一 Record 的不同条目：两个成员/两个锁同时写入全部保留', () => {
    const base = initTeamState('team-reg-102', '同集合并发团队');
    const snapshot = saveTeamState(base);

    let docA = loadTeamState(snapshot);
    docA = addMember(docA, makeMember('agent-a', 'leader', 0.9));
    docA = setFileLock(docA, 'docs/a.md', 'agent-a');

    let docB = loadTeamState(snapshot);
    docB = addMember(docB, makeMember('agent-b', 'member', 0.7));
    docB = setFileLock(docB, 'docs/b.md', 'agent-b');

    const merged = mergeTeamState(docA, docB);

    // 同一 members / fileLocks 集合的两个不同 key，合并后全部保留
    expect(Object.keys(merged.members).sort()).toEqual(['agent-a', 'agent-b']);
    expect(Object.keys(merged.fileLocks).sort()).toEqual(['docs/a.md', 'docs/b.md']);
  });

  it('并发追加 feedback：CRDT list 语义下两边条目都在（无丢失、无覆盖）', () => {
    const base = initTeamState('team-reg-103', '列表并发团队');
    const snapshot = saveTeamState(base);

    let docA = loadTeamState(snapshot);
    docA = appendFeedback(docA, makeFeedback('fb-a', 'agent-a'));

    let docB = loadTeamState(snapshot);
    docB = appendFeedback(docB, makeFeedback('fb-b', 'agent-b'));

    const merged = mergeTeamState(docA, docB);

    // 并发 push 的两条都要在（顺序不限，集合完整）
    const ids = merged.feedback.map((f) => f.id).sort();
    expect(ids).toEqual(['fb-a', 'fb-b']);
  });

  it('同步链路多跳：A→B→C 三设备级联同步后收敛一致', () => {
    const base = initTeamState('team-reg-104', '三设备团队');
    const snapshot = saveTeamState(base);

    let docA = loadTeamState(snapshot);
    docA = addMember(docA, makeMember('agent-a', 'leader', 0.9));
    let docB = loadTeamState(snapshot);
    docB = addMember(docB, makeMember('agent-b', 'member', 0.7));
    let docC = loadTeamState(snapshot);
    docC = addMember(docC, makeMember('agent-c', 'member', 0.5));

    // A→B：B 收到 A 的增量（merge 后 local 句柄失效，重赋值推进）
    const wireA0 = saveTeamState(docA);
    docB = mergeTeamState(docB, loadTeamState(wireA0));
    // B→C：C 收到 A+B 的合并态
    const wireB0 = saveTeamState(docB);
    docC = mergeTeamState(docC, loadTeamState(wireB0));
    // C→A：A 收到全量（闭环）
    const wireC0 = saveTeamState(docC);
    docA = mergeTeamState(docA, loadTeamState(wireC0));
    // A→B：B 补收 C 的增量（完成收敛闭环）
    const wireA1 = saveTeamState(docA);
    docB = mergeTeamState(docB, loadTeamState(wireA1));

    expect(Object.keys(docA.members).sort()).toEqual(['agent-a', 'agent-b', 'agent-c']);
    expect(Object.keys(docB.members).sort()).toEqual(['agent-a', 'agent-b', 'agent-c']);
    expect(Object.keys(docC.members).sort()).toEqual(['agent-a', 'agent-b', 'agent-c']);
  });
});
