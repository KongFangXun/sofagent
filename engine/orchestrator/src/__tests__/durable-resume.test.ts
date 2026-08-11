// ============================================================
// durable-resume.test.ts · Durable Execution L1/L2 测试（v1.3.2 交付 4）
// ============================================================
//
// 覆盖：
// - L1 状态恢复：scanPendingCheckpoints 找未完成 graph（running /
//   awaiting_human），已终态（completed/blocked/aborted）不算 pending
// - resumePendingLoops：最近一个 pending → resumeFn 被调用；无 pending
//   不调用；resumeFn 抛错不阻断（容错铁律）
// - checkpoint 清理：过期（> retentionDays）被清理，latest 指向的不清
// - L2 幂等联动：shouldExecute 查重跳过已执行动作（与登记簿配合）
//
// 全部使用临时目录隔离（mkdtemp）——不污染仓库。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { CheckpointManager, DEFAULT_CHECKPOINT_RETENTION_DAYS } from '../durable/checkpoint-manager';
import {
  scanPendingCheckpoints,
  resumePendingLoops,
  isPendingRecord,
} from '../durable/resume';
import { SideEffectLedger } from '../durable/side-effect-ledger';
import { shouldExecute, markExecuted } from '../durable/idempotency-check';
import { FileCheckpointer } from '../graph/checkpoint';

/** 构造一个最小 checkpoint 状态 */
function sampleState(overrides: Record<string, unknown> = {}) {
  return {
    finalStatus: 'running',
    checkpointId: 'loop-test-0001',
    retryCount: 0,
    currentNode: 'engineer',
    auditResult: null,
    resumeFrom: null,
    artifacts: { task: 'test' },
    ...overrides,
  } as unknown as import('../graph/checkpoint').CheckpointState;
}

/** 构造一个最小 CheckpointRecord（finalStatus 在 state 内） */
function sampleRecord(
  checkpointId: string,
  finalStatus: string,
  node = 'engineer',
  phase: 'before' | 'after' = 'before',
  /** 可选时间偏移（毫秒），用于保证两个 checkpoint 的 savedAt 有明确先后 */
  timeOffsetMs = 0,
): import('../graph/checkpoint').CheckpointRecord {
  const d = new Date();
  if (timeOffsetMs) d.setTime(d.getTime() + timeOffsetMs);
  return {
    schemaVersion: 'v1',
    checkpointId,
    phase,
    node,
    savedAt: d.toISOString(),
    state: sampleState({ checkpointId, finalStatus }),
  };
}

describe('Durable L1 · checkpoint 扫描与状态恢复（v1.3.1 交付 4）', () => {
  let tmpDir: string;
  let checkpointDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-resume-'));
    checkpointDir = path.join(tmpDir, 'checkpoint');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('isPendingRecord：running / awaiting_human 算未完成；终态不算', () => {
    const running = sampleRecord('running-1', 'running');
    const awaiting = sampleRecord('awaiting-1', 'awaiting_human');
    const completed = sampleRecord('done-1', 'completed');
    const blocked = sampleRecord('blocked-1', 'blocked');

    expect(isPendingRecord(running)).toBe(true);
    expect(isPendingRecord(awaiting)).toBe(true);
    expect(isPendingRecord(completed)).toBe(false);
    expect(isPendingRecord(blocked)).toBe(false);
  });

  it('scanPendingCheckpoints：只列未完成 checkpoint', () => {
    const cp = new FileCheckpointer(checkpointDir);
    cp.save(sampleState({ checkpointId: 'running-1', finalStatus: 'running' }), 'engineer', 'before');
    cp.save(sampleState({ checkpointId: 'done-1', finalStatus: 'completed' }), 'reviewer', 'after');
    cp.save(sampleState({ checkpointId: 'awaiting-1', finalStatus: 'awaiting_human' }), 'human_confirm', 'before');

    const pending = scanPendingCheckpoints(checkpointDir);
    const ids = pending.map((p) => p.record.checkpointId).sort();
    expect(ids).toEqual(['awaiting-1', 'running-1']);
    expect(pending.every((p) => p.node.length > 0)).toBe(true);
  });

  it('resumePendingLoops：有 pending → resumeFn 被调用一次（最近一个）', async () => {
    const cp = new FileCheckpointer(checkpointDir);
    // 🔴 savedAtOverride 保证明确时间序（CI 同毫秒排序问题）
    const olderTime = new Date(Date.now() - 1000).toISOString();
    const latestTime = new Date().toISOString();
    cp.save(sampleState({ checkpointId: 'older-running' }), 'engineer', 'before', { savedAtOverride: olderTime });
    cp.save(sampleState({ checkpointId: 'latest-running' }), 'audit', 'after', { savedAtOverride: latestTime });

    const resumeFn = vi.fn().mockResolvedValue({ finalStatus: 'completed', state: {}, checkpointId: 'latest-running', retryCount: 0 });
    const summary = await resumePendingLoops({ checkpointDir, resumeFn });

    expect(resumeFn).toHaveBeenCalledTimes(1);
    // 传给 resumeFn 的 checkpointDir 正确
    expect(resumeFn.mock.calls[0]?.[0]?.checkpointDir).toBe(checkpointDir);
    expect(summary.pending).toHaveLength(2);
    expect(summary.resumed).toBe(1);
    expect(summary.results[0]?.checkpointId).toBe('latest-running');
  });

  it('resumePendingLoops：无 pending → resumeFn 不调用', async () => {
    const cp = new FileCheckpointer(checkpointDir);
    cp.save(sampleState({ checkpointId: 'done', finalStatus: 'completed' }), 'reviewer', 'after');

    const resumeFn = vi.fn();
    const summary = await resumePendingLoops({ checkpointDir, resumeFn });

    expect(resumeFn).not.toHaveBeenCalled();
    expect(summary.pending).toHaveLength(0);
    expect(summary.resumed).toBe(0);
  });

  it('resumePendingLoops：resumeFn 抛错 → 记 skipped，不抛给 daemon（容错铁律）', async () => {
    const cp = new FileCheckpointer(checkpointDir);
    cp.save(sampleState({ checkpointId: 'boom-running' }), 'engineer', 'before');

    const resumeFn = vi.fn().mockRejectedValue(new Error('图恢复失败'));
    const summary = await resumePendingLoops({ checkpointDir, resumeFn });

    expect(summary.skipped).toContain('boom-running');
    expect(summary.resumed).toBe(0);
  });

  it('CheckpointManager.cleanupStale：过期清理 + latest 指向不清 + 保留期可配置', async () => {
    const mgr = new CheckpointManager({ checkpointDir, retentionDays: 7 });
    expect(mgr.dir).toBe(checkpointDir);

    // 写两个 checkpoint
    const path1 = mgr.write(sampleState({ checkpointId: 'fresh' }), 'engineer', 'before');
    mgr.write(sampleState({ checkpointId: 'latest' }), 'audit', 'after');
    const latestPath = mgr.checkpointer.resolveLatestPath();

    // 手动把第一个文件的 mtime 改到 8 天前（过期）
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.utimesSync(path1, new Date(old), new Date(old));

    const removed = mgr.cleanupStale();
    expect(removed).toContain(path.basename(path1));
    // latest 指向的文件不被清理
    expect(latestPath).not.toBeNull();
    expect(removed).not.toContain(path.basename(latestPath!));
  });

  it('DEFAULT_CHECKPOINT_RETENTION_DAYS = 7', () => {
    expect(DEFAULT_CHECKPOINT_RETENTION_DAYS).toBe(7);
  });
});

describe('Durable L2 · 幂等查重联动（v1.3.1 交付 4）', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-durable-'));
    ledgerPath = path.join(tmpDir, 'durable', 'side-effect-ledger.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('续跑场景：已登记的外部副作用跳过，未登记的继续执行', async () => {
    const ledger = new SideEffectLedger(ledgerPath);
    const executed: string[] = [];

    // 模拟第一轮执行：webhook.send 已登记
    ledger.record('task-42', 'webhook.send');

    // 模拟续跑：对每个动作查重
    for (const [action] of [['webhook.send'], ['pr.create']] as const) {
      const decision = shouldExecute(ledger, 'task-42', action);
      if (decision.execute) {
        executed.push(action);
        markExecuted(ledger, 'task-42', action);
      }
    }

    // 已登记的 webhook.send 被跳过；未登记的 pr.create 执行
    expect(executed).toEqual(['pr.create']);
    // pr.create 也被登记（下次续跑同样跳过）
    expect(shouldExecute(ledger, 'task-42', 'pr.create').execute).toBe(false);
  });

  it('markExecuted 幂等：同动作只登记一次', () => {
    const ledger = new SideEffectLedger(ledgerPath);
    expect(markExecuted(ledger, 'task-1', 'feishu.notify')).toBe(true);
    expect(markExecuted(ledger, 'task-1', 'feishu.notify')).toBe(false);
    expect(ledger.list('task-1')).toHaveLength(1);
  });
});
