// ============================================================
// conflict-resolver.test.ts · merge 文本冲突仲裁测试（v1.2.8）
//
// 覆盖仲裁三场景（优先级从高到低）：
// 1. scope 内者赢（写自己 scope → 赢；声明 scope 越界写 → 让步）
// 2. 无 scope 声明 → 先到先得（后提交者让步）
// 3. scope 重叠 → 标记 conflict + HITL
// 以及：多文件赢家不一致 → HITL；冲突记录 jsonl 写入
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveWorktreeConflict,
  fileInScope,
  appendConflictRecord,
  readConflictRecords,
  resolveConflictsPath,
  type ConflictParty,
  type ConflictRecord,
} from '../conflict-resolver';

/** 构造冲突一方（测试默认值：2026-01-01 提交） */
function mkParty(over: Partial<ConflictParty>): ConflictParty {
  return {
    agentId: 'agent-x',
    branch: 'sofagent/wt-x',
    committedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** 主分支侧（先提交者） */
const MAIN = mkParty({
  agentId: 'main',
  branch: 'main',
  committedAt: '2026-01-01T00:00:00.000Z',
});

// ════════════════════════════════════════
// fileInScope
// ════════════════════════════════════════

describe('fileInScope — scope 前缀匹配', () => {
  it('目录前缀（带尾斜杠）覆盖其下文件', () => {
    expect(fileInScope('engine/orchestrator/src/a.ts', ['engine/orchestrator/'])).toBe(true);
    expect(fileInScope('engine/audit/src/a.ts', ['engine/orchestrator/'])).toBe(false);
  });

  it('无尾斜杠条目按目录处理；全等条目精确匹配文件', () => {
    expect(fileInScope('src/a.ts', ['src'])).toBe(true);
    expect(fileInScope('README.md', ['README.md'])).toBe(true);
    expect(fileInScope('README.md.bak', ['README.md'])).toBe(false);
  });

  it('空 scope / 未声明 scope → false', () => {
    expect(fileInScope('src/a.ts', [])).toBe(false);
    expect(fileInScope('src/a.ts', undefined)).toBe(false);
  });
});

// ════════════════════════════════════════
// 场景 1：节点职责域优先
// ════════════════════════════════════════

describe('场景 1 · 节点职责域优先', () => {
  it('incoming 写到自己 scope 内 → incoming 赢（即使是后提交者）', () => {
    const r = resolveWorktreeConflict({
      files: ['engine/orchestrator/src/a.ts'],
      incoming: mkParty({
        agentId: 'eng',
        responsibilityScope: ['engine/orchestrator/'],
        committedAt: '2026-01-02T00:00:00.000Z', // 后提交
      }),
      incumbent: MAIN,
    });
    expect(r.resolution).toBe('incoming-wins');
    expect(r.perFile[0]!.winner).toBe('incoming');
    expect(r.perFile[0]!.rule).toBe('scope-incoming');
  });

  it('incoming 声明 scope 却写到 scope 外 → 让步（incumbent 赢）', () => {
    const r = resolveWorktreeConflict({
      files: ['engine/audit/src/b.ts'],
      incoming: mkParty({
        agentId: 'eng',
        responsibilityScope: ['engine/orchestrator/'],
        committedAt: '2026-01-02T00:00:00.000Z',
      }),
      incumbent: MAIN, // main 无 scope 声明
    });
    expect(r.resolution).toBe('incumbent-wins');
    expect(r.perFile[0]!.rule).toBe('out-of-scope-incoming');
  });

  it('文件在 incumbent scope 内（incoming 无 scope）→ incumbent 赢', () => {
    const r = resolveWorktreeConflict({
      files: ['engine/audit/src/b.ts'],
      incoming: mkParty({ agentId: 'eng', committedAt: '2026-01-02T00:00:00.000Z' }),
      incumbent: mkParty({
        agentId: 'audit-agent',
        branch: 'sofagent/wt-audit',
        responsibilityScope: ['engine/audit/'],
        committedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(r.resolution).toBe('incumbent-wins');
    expect(r.perFile[0]!.rule).toBe('scope-incumbent');
  });
});

// ════════════════════════════════════════
// 场景 2：无 scope 声明 → 先到先得
// ════════════════════════════════════════

describe('场景 2 · 无 scope 声明，先到先得', () => {
  it('双方都无 scope：后提交者让步（incumbent 先提交 → incumbent 赢）', () => {
    const r = resolveWorktreeConflict({
      files: ['docs/note.md'],
      incoming: mkParty({ agentId: 'eng-late', committedAt: '2026-01-02T00:00:00.000Z' }),
      incumbent: MAIN, // 2026-01-01 先提交
    });
    expect(r.resolution).toBe('incumbent-wins');
    expect(r.perFile[0]!.rule).toBe('first-commit');
  });

  it('双方都无 scope：incoming 先提交 → incoming 赢', () => {
    const r = resolveWorktreeConflict({
      files: ['docs/note.md'],
      incoming: mkParty({ agentId: 'eng-early', committedAt: '2025-12-31T00:00:00.000Z' }),
      incumbent: MAIN, // 2026-01-01 后提交
    });
    expect(r.resolution).toBe('incoming-wins');
    expect(r.perFile[0]!.rule).toBe('first-commit');
  });
});

// ════════════════════════════════════════
// 场景 3：scope 重叠 → conflict + HITL
// ════════════════════════════════════════

describe('场景 3 · scope 重叠 → HITL', () => {
  it('双方 scope 都覆盖同一文件 → hitl（标记 conflict，走人工确认）', () => {
    const r = resolveWorktreeConflict({
      files: ['shared/config.ts'],
      incoming: mkParty({
        agentId: 'eng',
        responsibilityScope: ['shared/'],
        committedAt: '2026-01-02T00:00:00.000Z',
      }),
      incumbent: mkParty({
        agentId: 'reviewer',
        branch: 'sofagent/wt-rev',
        responsibilityScope: ['shared/config.ts'],
        committedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(r.resolution).toBe('hitl');
    expect(r.perFile[0]!.winner).toBe('hitl');
    expect(r.perFile[0]!.rule).toBe('scope-overlap');
    expect(r.reason).toContain('重叠');
  });

  it('双方都声明 scope 但文件均不在各自域内 → hitl（保守升级人工）', () => {
    const r = resolveWorktreeConflict({
      files: ['third-party/lib.ts'],
      incoming: mkParty({
        agentId: 'eng',
        responsibilityScope: ['engine/orchestrator/'],
        committedAt: '2026-01-02T00:00:00.000Z',
      }),
      incumbent: mkParty({
        agentId: 'audit-agent',
        branch: 'sofagent/wt-audit',
        responsibilityScope: ['engine/audit/'],
        committedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(r.resolution).toBe('hitl');
    expect(r.perFile[0]!.rule).toBe('out-of-scope-both');
  });
});

// ════════════════════════════════════════
// 多文件收敛
// ════════════════════════════════════════

describe('多文件收敛', () => {
  it('多个冲突文件同一赢家 → 整体该方赢', () => {
    const r = resolveWorktreeConflict({
      files: ['engine/orchestrator/src/a.ts', 'engine/orchestrator/src/b.ts'],
      incoming: mkParty({
        agentId: 'eng',
        responsibilityScope: ['engine/orchestrator/'],
        committedAt: '2026-01-02T00:00:00.000Z',
      }),
      incumbent: MAIN,
    });
    expect(r.resolution).toBe('incoming-wins');
    expect(r.perFile).toHaveLength(2);
  });

  it('多个冲突文件分属不同赢家 → hitl（不拆 diff，保守升级人工）', () => {
    const r = resolveWorktreeConflict({
      files: ['engine/orchestrator/src/a.ts', 'engine/audit/src/b.ts'],
      incoming: mkParty({
        agentId: 'eng',
        responsibilityScope: ['engine/orchestrator/'],
        committedAt: '2026-01-02T00:00:00.000Z',
      }),
      incumbent: mkParty({
        agentId: 'audit-agent',
        branch: 'sofagent/wt-audit',
        responsibilityScope: ['engine/audit/'],
        committedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(r.resolution).toBe('hitl');
  });
});

// ════════════════════════════════════════
// 冲突记录 jsonl
// ════════════════════════════════════════

describe('冲突记录 jsonl', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-conflict-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 临时目录由 OS 回收
    }
  });

  it('appendConflictRecord 写入 data/audit/worktree-conflicts.jsonl 并可读回', () => {
    const conflictsPath = resolveConflictsPath(tmpDir);
    expect(conflictsPath).toContain(path.join('data', 'audit', 'worktree-conflicts.jsonl'));

    const record: ConflictRecord = {
      ts: new Date().toISOString(),
      files: ['shared/config.ts'],
      incoming: mkParty({ agentId: 'eng', responsibilityScope: ['shared/'] }),
      incumbent: mkParty({ agentId: 'main', branch: 'main', responsibilityScope: ['shared/'] }),
      resolution: 'hitl',
      reason: '职责域重叠，暂停走人工确认',
      status: 'pending-hitl',
    };
    appendConflictRecord(conflictsPath, record);

    expect(fs.existsSync(conflictsPath)).toBe(true);
    const records = readConflictRecords(conflictsPath);
    expect(records).toHaveLength(1);
    expect(records[0]!.resolution).toBe('hitl');
    expect(records[0]!.status).toBe('pending-hitl');
    expect(records[0]!.files).toEqual(['shared/config.ts']);
    expect(records[0]!.incoming.agentId).toBe('eng');
  });

  it('读取不存在的记录文件返回空数组', () => {
    expect(readConflictRecords(path.join(tmpDir, 'nonexistent.jsonl'))).toEqual([]);
  });
});
