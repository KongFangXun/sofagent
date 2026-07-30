// ============================================================
// workspace-summary.test.ts · Workspace 变更摘要测试（v1.2.3 · 交付五）
//
// 覆盖：
// - collectWorkspaceChanges：created/modified/deleted 三类准确
// - runWorkspaceSummary：新 checkpoint 触发记录（runId = checkpointId）
// - 幂等：同一 checkpointId 不重复记录
// - 保留最近 100 条
// - 非 git 环境 / 无 checkpoint / 损坏 checkpoint 不 throw
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  runWorkspaceSummary,
  collectWorkspaceChanges,
  appendWorkspaceChange,
  readWorkspaceChanges,
  readLatestCheckpointId,
  WORKSPACE_CHANGES_MAX_ENTRIES,
  type WorkspaceChangeRecord,
} from '../workspace-summary';

let tmpDir: string;
let repoDir: string;
let checkpointDir: string;
let outputPath: string;
let statePath: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

/** 写一个最小 checkpoint 文件（文件名时间戳决定"最新"） */
function writeCheckpoint(checkpointId: string, savedAt: string): void {
  const fileTs = savedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(checkpointDir, `checkpoint-${fileTs}-abc123.json`),
    JSON.stringify({
      schemaVersion: 'v1',
      checkpointId,
      phase: 'after',
      node: 'engineer',
      savedAt,
      state: {},
    }),
  );
}

function runWithTmpPaths(projectDir = repoDir) {
  return runWorkspaceSummary({ projectDir, checkpointDir, outputPath, statePath });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ws-'));
  // git 仓库（workspace 变更采集对象）
  repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  git(['init'], repoDir);
  git(['config', 'user.email', 't@t.com'], repoDir);
  git(['config', 'user.name', 'T'], repoDir);
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test\n');
  fs.writeFileSync(path.join(repoDir, 'to-delete.ts'), 'export const gone = 1;\n');
  git(['add', '.'], repoDir);
  git(['commit', '-m', 'init'], repoDir);
  // checkpoint 目录 + 输出/状态路径（全部隔离在 tmp）
  checkpointDir = path.join(tmpDir, 'checkpoint');
  fs.mkdirSync(checkpointDir, { recursive: true });
  outputPath = path.join(tmpDir, 'data', 'dashboard', 'workspace-changes.jsonl');
  statePath = path.join(tmpDir, 'data', 'dashboard', 'workspace-summary-state.json');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // 临时目录由 OS 回收
  }
});

// ════════════════════════════════════════
// collectWorkspaceChanges
// ════════════════════════════════════════

describe('collectWorkspaceChanges — 三类变更准确', () => {
  it('新建/修改/删除/重命名正确分类（去重排序）', () => {
    // created：未跟踪新文件
    fs.writeFileSync(path.join(repoDir, 'new-file.ts'), 'export const x = 1;\n');
    // modified：已跟踪文件改动
    fs.appendFileSync(path.join(repoDir, 'README.md'), 'extra\n');
    // deleted：已跟踪文件删除
    fs.rmSync(path.join(repoDir, 'to-delete.ts'));

    const changes = collectWorkspaceChanges(repoDir);
    expect(changes.created).toEqual(['new-file.ts']);
    expect(changes.modified).toEqual(['README.md']);
    expect(changes.deleted).toEqual(['to-delete.ts']);
  });

  it('暂存区新增也算 created；重命名 = 源 deleted + 目标 created', () => {
    fs.writeFileSync(path.join(repoDir, 'staged-new.ts'), 'export const y = 2;\n');
    git(['add', 'staged-new.ts'], repoDir);
    git(['mv', 'README.md', 'README-renamed.md'], repoDir);

    const changes = collectWorkspaceChanges(repoDir);
    expect(changes.created).toContain('staged-new.ts');
    expect(changes.created).toContain('README-renamed.md');
    expect(changes.deleted).toContain('README.md');
  });

  it('干净工作区 → 三个空数组', () => {
    const changes = collectWorkspaceChanges(repoDir);
    expect(changes).toEqual({ created: [], modified: [], deleted: [] });
  });
});

// ════════════════════════════════════════
// runWorkspaceSummary — checkpoint 联动（AD-6）
// ════════════════════════════════════════

describe('runWorkspaceSummary — checkpoint 联动', () => {
  it('发现新 checkpoint → 记录一条，runId = checkpointId，jsonl 落盘', () => {
    fs.writeFileSync(path.join(repoDir, 'feature.ts'), 'export const f = 1;\n');
    writeCheckpoint('loop-2026-07-29-001', '2026-07-29T14:30:00.000Z');

    const record = runWithTmpPaths();
    expect(record).not.toBeNull();
    expect(record!.runId).toBe('loop-2026-07-29-001');
    expect(record!.created).toContain('feature.ts');
    expect(Number.isNaN(Date.parse(record!.timestamp))).toBe(false);

    // jsonl 落盘且只有一条
    const records = readWorkspaceChanges(outputPath);
    expect(records).toHaveLength(1);
    expect(records[0]!.runId).toBe('loop-2026-07-29-001');
  });

  it('幂等：同一 checkpointId 重复巡检不重复记录', () => {
    writeCheckpoint('loop-001', '2026-07-29T14:30:00.000Z');
    expect(runWithTmpPaths()).not.toBeNull();
    // 同一 checkpoint 再跑 → null，jsonl 仍一条
    expect(runWithTmpPaths()).toBeNull();
    expect(readWorkspaceChanges(outputPath)).toHaveLength(1);
  });

  it('更新的 checkpoint 出现 → 再记一条（两条 runId 各自独立）', () => {
    writeCheckpoint('loop-001', '2026-07-29T14:30:00.000Z');
    expect(runWithTmpPaths()!.runId).toBe('loop-001');

    // 新一轮 LOOP：更新的 checkpoint 文件（时间戳更晚）
    fs.appendFileSync(path.join(repoDir, 'README.md'), 'round 2\n');
    writeCheckpoint('loop-002', '2026-07-29T15:00:00.000Z');
    const record = runWithTmpPaths();
    expect(record).not.toBeNull();
    expect(record!.runId).toBe('loop-002');
    expect(record!.modified).toContain('README.md');

    expect(readWorkspaceChanges(outputPath)).toHaveLength(2);
  });

  it('无 checkpoint → null 且不写文件', () => {
    expect(runWithTmpPaths()).toBeNull();
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('最新 checkpoint 文件损坏 → null（不 throw）', () => {
    fs.writeFileSync(path.join(checkpointDir, 'checkpoint-2026-07-29T14-30-00-000Z-bad.json'), '{broken');
    expect(runWithTmpPaths()).toBeNull();
  });

  it('非 git 环境 → 记录空清单（runId 追溯性保留），不 throw', () => {
    const plainDir = path.join(tmpDir, 'plain');
    fs.mkdirSync(plainDir);
    writeCheckpoint('loop-nogit', '2026-07-29T14:30:00.000Z');

    const record = runWithTmpPaths(plainDir);
    expect(record).not.toBeNull();
    expect(record!.runId).toBe('loop-nogit');
    expect(record!.created).toEqual([]);
    expect(record!.modified).toEqual([]);
    expect(record!.deleted).toEqual([]);
  });
});

// ════════════════════════════════════════
// readLatestCheckpointId
// ════════════════════════════════════════

describe('readLatestCheckpointId', () => {
  it('按文件名时间戳取最新；目录不存在返回 null', () => {
    expect(readLatestCheckpointId(path.join(tmpDir, 'nonexistent'))).toBeNull();

    writeCheckpoint('old-run', '2026-07-29T10:00:00.000Z');
    writeCheckpoint('new-run', '2026-07-29T12:00:00.000Z');
    expect(readLatestCheckpointId(checkpointDir)).toBe('new-run');
  });
});

// ════════════════════════════════════════
// 100 条保留策略
// ════════════════════════════════════════

describe('100 条保留策略', () => {
  it('追加超过 100 条 → 截断保留最近 100 条', () => {
    const total = WORKSPACE_CHANGES_MAX_ENTRIES + 5;
    for (let i = 1; i <= total; i++) {
      const record: WorkspaceChangeRecord = {
        timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
        runId: `run-${String(i).padStart(3, '0')}`,
        created: [],
        modified: [],
        deleted: [],
      };
      appendWorkspaceChange(record, outputPath);
    }

    const records = readWorkspaceChanges(outputPath);
    expect(records).toHaveLength(WORKSPACE_CHANGES_MAX_ENTRIES);
    // 最旧 5 条被截掉，第一条是第 6 条；最新一条保留
    expect(records[0]!.runId).toBe('run-006');
    expect(records[records.length - 1]!.runId).toBe(`run-${total}`);
  });
});
