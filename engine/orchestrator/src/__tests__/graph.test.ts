// ============================================================
// graph.test.ts · StateGraph 核心逻辑测试
// v1.1.3 新增
//
// 覆盖：
// - 状态定义 & emptyArtifacts
// - Checkpoint 读写（schemaVersion、latest 指针、迁移、锁）
// - 路由函数（routeAfterAudit、routeAfterHuman）
// - 恢复入口解析（resolveResumeNode）
// - 完整流转：happy path / audit FAIL 重试 / blocked 终态 / HITL 驳回 /
//   HITL 中断 abort / WARN 直通 reviewer
// - resume 从不同节点恢复
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

import { emptyArtifacts } from '../loop/state';
import type { LoopGraphState, LoopArtifacts } from '../loop/state';

import {
  FileCheckpointer,
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  type CheckpointRecord,
} from '../graph/checkpoint';

import {
  routeAfterAudit,
  routeAfterHuman,
  resolveResumeNode,
  runLoopGraph,
  resumeLoopGraph,
  type LoopGraphDeps,
  type AuditOutcome,
  type HumanDecision,
} from '../loop/graph';

import { END } from '@langchain/langgraph';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-graph-'));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 构造一个初始 state 快照 */
function sampleState(overrides: Partial<LoopGraphState> = {}): LoopGraphState {
  return {
    currentNode: 'engineer',
    auditResult: null,
    retryCount: 0,
    checkpointId: `test-${randomBytes(4).toString('hex')}`,
    artifacts: emptyArtifacts('测试任务'),
    finalStatus: 'running',
    resumeFrom: null,
    ...overrides,
  };
}

// ════════════════════════════════════════
// State
// ════════════════════════════════════════

describe('emptyArtifacts', () => {
  it('以 task 初始化，其余字段为空', () => {
    const a = emptyArtifacts('修复 bug');
    expect(a.task).toBe('修复 bug');
    expect(a.engineerOutput).toBe('');
    expect(a.engineerOutputs).toEqual([]);
    expect(a.auditReport).toBe('');
    expect(a.auditReports).toEqual([]);
    expect(a.reviewReport).toBe('');
    expect(a.reviewReports).toEqual([]);
    expect(a.humanFeedback).toBe('');
  });
});

// ════════════════════════════════════════
// Checkpoint
// ════════════════════════════════════════

describe('FileCheckpointer', () => {
  let dir: string;
  let cp: FileCheckpointer;

  beforeEach(() => {
    dir = tmpDir();
    cp = new FileCheckpointer(dir);
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('newCheckpointId 包含 loop- 前缀', () => {
    const id = FileCheckpointer.newCheckpointId();
    expect(id.startsWith('loop-')).toBe(true);
    expect(id.length).toBeGreaterThan(10);
  });

  it('save 创建 checkpoint 文件且 latest 可读', () => {
    const state = sampleState({ checkpointId: cp.checkpointId ?? 'test-01' });
    // 使用 cp 自己的 checkpointId（newCheckpointId 是静态方法）
    const id = FileCheckpointer.newCheckpointId();
    const s = sampleState({ checkpointId: id });
    cp.save(s, 'engineer', 'after');

    const rec = cp.loadLatest();
    expect(rec).not.toBeNull();
    expect(rec!.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(rec!.checkpointId).toBe(id);
    expect(rec!.node).toBe('engineer');
    expect(rec!.phase).toBe('after');
    expect(rec!.state.currentNode).toBe('engineer');

    // latest 指针可解析
    const latestPath = cp.resolveLatestPath();
    expect(latestPath).not.toBeNull();
    expect(fs.existsSync(latestPath!)).toBe(true);
  });

  it('两次 save 各自独立文件，latest 指向最新', () => {
    const s1 = sampleState({ checkpointId: 'test-multi' });
    const s2 = sampleState({ checkpointId: 'test-multi', currentNode: 'audit' });
    const f1 = cp.save(s1, 'engineer', 'after');
    const f2 = cp.save(s2, 'audit', 'after');

    expect(f1).not.toBe(f2);
    expect(fs.existsSync(f1)).toBe(true);
    expect(fs.existsSync(f2)).toBe(true);

    const rec = cp.loadLatest();
    expect(rec!.node).toBe('audit');
  });

  it('schemaVersion 为 JSON 第一字段', () => {
    const s = sampleState();
    cp.save(s, 'engineer', 'after');
    const raw = fs.readFileSync(cp.resolveLatestPath()!, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed)[0]).toBe('schemaVersion');
    expect(parsed.schemaVersion).toBe('v1');
  });

  it('loadLatest 无文件返回 null', () => {
    expect(cp.loadLatest()).toBeNull();
  });

  it('list 按名称排序', () => {
    cp.save(sampleState({ checkpointId: 'b1' }), 'engineer', 'after');
    cp.save(sampleState({ checkpointId: 'b2' }), 'audit', 'after');
    const files = cp.list();
    expect(files.length).toBeGreaterThanOrEqual(2);
    // 名称 lexicographic 排序即时间顺序（ISO 前缀）
    for (let i = 1; i < files.length; i++) {
      expect(files[i - 1]! <= files[i]!).toBe(true);
    }
  });

  it('文件名永不覆盖（并发安全第 1 条）', () => {
    // 连续 save 5 次——每个文件不同
    const paths = new Set<string>();
    for (let i = 0; i < 5; i++) {
      paths.add(cp.save(sampleState({ checkpointId: 'no-overwrite' }), `node-${i}`, 'after'));
    }
    expect(paths.size).toBe(5);
  });

  it('save 内部有锁——同一 checkpointId 顺序写不冲突', () => {
    // 不测实际并发（单进程），只测 acquireLock / releaseLock 无抛错
    cp.acquireLock('lock-test');
    cp.releaseLock('lock-test');
    // 再次获取应成功
    cp.acquireLock('lock-test');
    cp.releaseLock('lock-test');
  });

  it('残留锁（stale lock）被回收', () => {
    const lockPath = path.join(dir, 'locks', 'stale.lock');
    fs.mkdirSync(path.join(dir, 'locks'), { recursive: true });
    fs.writeFileSync(lockPath, '99999', 'utf-8');
    // 回溯 mtime 到 60s 前
    const oldTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, oldTime, oldTime);

    // 应成功获取（残留锁被清）
    cp.acquireLock('stale');
    expect(() => cp.releaseLock('stale')).not.toThrow();
  });
});

describe('migrateCheckpoint', () => {
  it('v1 正常返回', () => {
    const state = sampleState({ checkpointId: 'ck-mig' });
    const rec: CheckpointRecord = {
      schemaVersion: 'v1',
      checkpointId: 'ck-mig',
      phase: 'after',
      node: 'engineer',
      savedAt: new Date().toISOString(),
      state,
    };
    const result = migrateCheckpoint(rec);
    expect(result).not.toBeNull();
    expect(result!.checkpointId).toBe('ck-mig');
  });

  it('未知 schema 版本返回 null', () => {
    const result = migrateCheckpoint({ schemaVersion: 'v99', checkpointId: 'x', state: {} });
    expect(result).toBeNull();
  });

  it('非法输入返回 null', () => {
    expect(migrateCheckpoint(null)).toBeNull();
    expect(migrateCheckpoint({})).toBeNull();
    expect(migrateCheckpoint({ schemaVersion: 'v1' })).toBeNull();
    expect(migrateCheckpoint({ schemaVersion: 'v1', checkpointId: 'x' })).toBeNull();
  });
});

// ════════════════════════════════════════
// Routing
// ════════════════════════════════════════

describe('routeAfterAudit', () => {
  it('blocked → END', () => {
    expect(routeAfterAudit(sampleState({ finalStatus: 'blocked', auditResult: 'FAIL' }))).toBe(END);
  });

  it('FAIL（running）→ engineer', () => {
    expect(routeAfterAudit(sampleState({ auditResult: 'FAIL', finalStatus: 'running' }))).toBe('engineer');
  });

  it('PASS → reviewer', () => {
    expect(routeAfterAudit(sampleState({ auditResult: 'PASS' }))).toBe('reviewer');
  });

  it('WARN → reviewer', () => {
    expect(routeAfterAudit(sampleState({ auditResult: 'WARN' }))).toBe('reviewer');
  });
});

describe('routeAfterHuman', () => {
  it('completed → END', () => {
    expect(routeAfterHuman(sampleState({ finalStatus: 'completed' }))).toBe(END);
  });

  it('blocked → END', () => {
    expect(routeAfterHuman(sampleState({ finalStatus: 'blocked' }))).toBe(END);
  });

  it('aborted → END', () => {
    expect(routeAfterHuman(sampleState({ finalStatus: 'aborted' }))).toBe(END);
  });

  it('running → engineer', () => {
    expect(routeAfterHuman(sampleState({ finalStatus: 'running' }))).toBe('engineer');
  });
});

// ════════════════════════════════════════
// resolveResumeNode
// ════════════════════════════════════════

describe('resolveResumeNode', () => {
  function record(node: string, phase: 'before' | 'after', overrides: Partial<LoopGraphState> = {}) {
    return {
      schemaVersion: 'v1',
      checkpointId: 'test',
      phase,
      node,
      savedAt: new Date().toISOString(),
      state: sampleState({ currentNode: node as any, ...overrides }),
    } as CheckpointRecord;
  }

  it('engineer before → engineer', () => {
    expect(resolveResumeNode(record('engineer', 'before'))).toBe('engineer');
  });

  it('engineer after → audit', () => {
    expect(resolveResumeNode(record('engineer', 'after'))).toBe('audit');
  });

  it('audit before → audit', () => {
    expect(resolveResumeNode(record('audit', 'before'))).toBe('audit');
  });

  it('audit after PASS → reviewer', () => {
    expect(resolveResumeNode(record('audit', 'after', { auditResult: 'PASS' }))).toBe('reviewer');
  });

  it('audit after FAIL → engineer', () => {
    expect(resolveResumeNode(record('audit', 'after', { auditResult: 'FAIL', finalStatus: 'running' }))).toBe('engineer');
  });

  it('audit after FAIL blocked → null', () => {
    expect(resolveResumeNode(record('audit', 'after', { auditResult: 'FAIL', finalStatus: 'blocked' }))).toBeNull();
  });

  it('reviewer before → reviewer', () => {
    expect(resolveResumeNode(record('reviewer', 'before'))).toBe('reviewer');
  });

  it('reviewer after → human_confirm', () => {
    expect(resolveResumeNode(record('reviewer', 'after'))).toBe('human_confirm');
  });

  it('human_confirm after completed → null', () => {
    expect(resolveResumeNode(record('human_confirm', 'after', { finalStatus: 'completed' }))).toBeNull();
  });

  it('human_confirm after running → engineer', () => {
    expect(resolveResumeNode(record('human_confirm', 'after', { finalStatus: 'running' }))).toBe('engineer');
  });
});

// ════════════════════════════════════════
// 集成——完整流转（mock 所有依赖）
// ════════════════════════════════════════

interface MockCall {
  type: string;
  [k: string]: unknown;
}

function mockDeps(
  callLog: MockCall[],
  overrides: Partial<{
    engineerOutputs: string[];
    auditOutcomes: AuditOutcome[];
    reviewerOutputs: string[];
    humanDecisions: HumanDecision[];
  }> = {}
): LoopGraphDeps {
  const eo = overrides.engineerOutputs ?? ['## engineer diff output'];
  const ao = overrides.auditOutcomes ?? [{ verdict: 'PASS', report: 'audit PASS' }];
  const ro = overrides.reviewerOutputs ?? ['IS_PASS: YES —— reviewer 通过'];
  const hd = overrides.humanDecisions ?? ['y'];

  let ei = 0;
  let ai = 0;
  let ri = 0;
  let hi = 0;

  const dir = tmpDir();
  return {
    runEngineer: async (_task: string, _fb: string) => {
      callLog.push({ type: 'engineer', idx: ei, task: _task.slice(0, 40) });
      return eo[ei++] ?? eo[eo.length - 1]!;
    },
    runAudit: async (_a: LoopArtifacts) => {
      callLog.push({ type: 'audit', idx: ai });
      return ao[ai++] ?? ao[ao.length - 1]!;
    },
    runReviewer: async (_a: LoopArtifacts) => {
      callLog.push({ type: 'reviewer', idx: ri });
      return ro[ri++] ?? ro[ro.length - 1]!;
    },
    confirmHuman: async (_r: string) => {
      callLog.push({ type: 'human_confirm', idx: hi });
      return hd[hi++] ?? hd[hd.length - 1]!;
    },
    recordBlocked: async (_s: LoopGraphState) => {
      callLog.push({ type: 'blocked' });
    },
    checkpointer: new FileCheckpointer(dir) as any,
    maxRetries: 3,
    log: () => {},
  };
}

function cleanupMockDeps(deps: LoopGraphDeps): void {
  try { fs.rmSync(deps.checkpointer.dir, { recursive: true, force: true }); } catch { /* */ }
}

describe('runLoopGraph — 集成', () => {
  it('happy path: engineer → audit(PASS) → reviewer → human(y) → completed', async () => {
    const log: MockCall[] = [];
    const deps = mockDeps(log);
    try {
      const result = await runLoopGraph('修复 login bug', { deps, silent: true });
      expect(result.finalStatus).toBe('completed');
      expect(result.retryCount).toBe(0);

      const types = log.map((c) => c.type);
      expect(types).toEqual(['engineer', 'audit', 'reviewer', 'human_confirm']);
    } finally {
      cleanupMockDeps(deps);
    }
  });

  it('audit FAIL 一次 → 回 engineer 重试（retryCount=1）→ PASS → completed', async () => {
    const log: MockCall[] = [];
    const deps = mockDeps(log, {
      engineerOutputs: ['e1', 'e2-fixed'],
      auditOutcomes: [{ verdict: 'FAIL', report: 'FAIL' }, { verdict: 'PASS', report: 'PASS' }],
    });
    try {
      const result = await runLoopGraph('修复', { deps, silent: true });
      expect(result.finalStatus).toBe('completed');
      expect(result.retryCount).toBe(1);

      // engineer 调用了两次
      expect(log.filter((c) => c.type === 'engineer').length).toBe(2);
      expect(log.filter((c) => c.type === 'audit').length).toBe(2);
    } finally {
      cleanupMockDeps(deps);
    }
  });

  // v1.2.2 P4：降级链开启（runLoopGraph 默认）后，audit 连续 FAIL 不再直接 blocked——
  // 按 0→1→2 推进 degradationLevel，L2 低可信放行 reviewer → human_confirm → completed。
  // 旧「FAIL×4 → blocked」语义在 degradationChainEnabled=false 时保留（见下一个用例）。
  it('audit 连续 FAIL ×4（降级链开启）→ 0→1→2 推进，L2 放行 reviewer → completed', async () => {
    const log: MockCall[] = [];
    const deps = mockDeps(log, {
      engineerOutputs: ['e1', 'e2', 'e3'],
      auditOutcomes: [
        { verdict: 'FAIL', report: 'fail1' },
        { verdict: 'FAIL', report: 'fail2' },
        { verdict: 'FAIL', report: 'fail3' },
      ],
    });
    try {
      const result = await runLoopGraph('修复', { deps, silent: true });
      // P4 降级链：第3次 FAIL → degradationLevel=2 → reviewer → human_confirm(y) → completed
      expect(result.finalStatus).toBe('completed');
      expect(result.state.degradationLevel).toBe(2);
      // engineer 3 次（初始 + 2 次重试），audit 3 次，reviewer/human 各 1 次
      expect(log.filter((c) => c.type === 'engineer').length).toBe(3);
      expect(log.filter((c) => c.type === 'audit').length).toBe(3);
      expect(log.some((c) => c.type === 'reviewer')).toBe(true);
      // blocked 不触发
      expect(log.some((c) => c.type === 'blocked')).toBe(false);
    } finally {
      cleanupMockDeps(deps);
    }
  });

  it('audit 连续 FAIL ×4（降级链关闭 degradationChainEnabled=false）→ 保留 v1.2.1 blocked 语义', async () => {
    const log: MockCall[] = [];
    const deps = mockDeps(log, {
      engineerOutputs: ['e1', 'e2', 'e3', 'e4'],
      auditOutcomes: [
        { verdict: 'FAIL', report: 'fail1' },
        { verdict: 'FAIL', report: 'fail2' },
        { verdict: 'FAIL', report: 'fail3' },
        { verdict: 'FAIL', report: 'fail4' },
      ],
    });
    try {
      const result = await runLoopGraph('修复', {
        deps: { ...deps, degradationChainEnabled: false },
        silent: true,
      });
      expect(result.finalStatus).toBe('blocked');
      expect(log.filter((c) => c.type === 'engineer').length).toBe(4);
      expect(log.filter((c) => c.type === 'audit').length).toBe(4);
      expect(log.some((c) => c.type === 'blocked')).toBe(true);
    } finally {
      cleanupMockDeps(deps);
    }
  });

  it('HITL 驳回 → 回 engineer（第 2 轮 human 通过）', async () => {
    const log: MockCall[] = [];
    const deps = mockDeps(log, {
      engineerOutputs: ['e1', 'e2'],
      auditOutcomes: [{ verdict: 'PASS', report: 'ok1' }, { verdict: 'PASS', report: 'ok2' }],
      reviewerOutputs: ['r1', 'r2'],
      humanDecisions: ['n', 'y'],
    });
    try {
      const result = await runLoopGraph('修复', { deps, silent: true });
      expect(result.finalStatus).toBe('completed');
      expect(log.filter((c) => c.type === 'engineer').length).toBe(2);
      expect(log.filter((c) => c.type === 'human_confirm').length).toBe(2);
    } finally {
      cleanupMockDeps(deps);
    }
  });

  it('HITL 多次驳回最终 blocked', async () => {
    const log: MockCall[] = [];
    const deps = mockDeps(log, {
      humanDecisions: ['n', 'n', 'n', 'n'], // 4 次驳回 → 第 4 次触发 blocked（retryCount 从 0 开始，最多 3 次递增）
    });
    try {
      const result = await runLoopGraph('修复', { deps, silent: true });
      // 最终应是 blocked（第 4 轮 human_confirm 已触发 blocked）
      expect(result.finalStatus).toBe('blocked');
      expect(log.some((c) => c.type === 'blocked')).toBe(true);
    } finally {
      cleanupMockDeps(deps);
    }
  });

  it('audit WARN → 直通 reviewer（不触发 retry）', async () => {
    const log: MockCall[] = [];
    const deps = mockDeps(log, {
      auditOutcomes: [{ verdict: 'WARN', report: 'warn' }],
    });
    try {
      const result = await runLoopGraph('修复', { deps, silent: true });
      expect(result.finalStatus).toBe('completed');
      expect(result.retryCount).toBe(0);
      expect(log.filter((c) => c.type === 'audit').length).toBe(1);
      expect(log.some((c) => c.type === 'reviewer')).toBe(true);
    } finally {
      cleanupMockDeps(deps);
    }
  });
});

describe('resumeLoopGraph', () => {
  it('无 checkpoint 返回 null', async () => {
    const dir = tmpDir();
    try {
      const result = await resumeLoopGraph({ checkpointDir: dir, silent: true });
      expect(result).toBeNull();
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('从 engineer-after checkpoint 恢复 → 进 audit', async () => {
    const dir = tmpDir();
    const cp = new FileCheckpointer(dir);
    const id = FileCheckpointer.newCheckpointId();
    const state = sampleState({
      checkpointId: id,
      currentNode: 'engineer',
      finalStatus: 'running',
      artifacts: { ...emptyArtifacts('resume-task'), engineerOutput: 'after-engineer-work' },
    });
    cp.save(state, 'engineer', 'after');

    const log: MockCall[] = [];
    const deps = mockDeps(log, {
      engineerOutputs: ['should-not-run'],
      auditOutcomes: [{ verdict: 'PASS', report: 'resume-audit-pass' }],
    });

    try {
      const result = await resumeLoopGraph({
        checkpointDir: dir,
        silent: true,
        deps: { ...deps, checkpointer: cp },
      });
      expect(result).not.toBeNull();
      expect(result!.finalStatus).toBe('completed');
      // engineer 不应被调用（从 audit 入口开始）
      expect(log.filter((c) => c.type === 'engineer').length).toBe(0);
      expect(log.filter((c) => c.type === 'audit').length).toBe(1);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
      cleanupMockDeps(deps);
    }
  });
});
