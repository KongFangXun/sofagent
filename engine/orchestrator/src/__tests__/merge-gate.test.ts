// ============================================================
// merge-gate.test.ts · 波次审计卡关测试（v1.3.2 交付 3）
// ============================================================
//
// 覆盖：
// - 全 PASS 合并：所有 worktree merged → allMerged=true
// - 任一 FAIL 丢弃：rejected → allMerged=false（审计 FAIL 丢弃对应 worktree）
// - 卡关异常收敛：mergeFn 抛错 → 按 rejected 处理（不静默吞掉）
// - isMergeGatePass 判定（merged / conflict-resolved / noop 通过）
//
// 全部注入 mock mergeFn——不跑真实 git。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  runWaveMergeGate,
  isMergeGatePass,
  type WaveWorktree,
} from '../loop/merge-gate';
import type { MergeGateResult } from '../worktree-merge-gate';
import type { WorktreeHandle } from '../worktree-isolation';

/** fake worktree 句柄 */
function makeHandle(agentId: string): WorktreeHandle {
  return {
    path: `/tmp/wt-${agentId}`,
    branch: `sofagent/wt-${agentId}`,
    agentId,
    async create() {},
    async cleanup() {},
    async diff() {
      return '';
    },
  };
}

function gateResult(status: MergeGateResult['status'], extra: Partial<MergeGateResult> = {}): MergeGateResult {
  return { status, ...extra } as MergeGateResult;
}

describe('runWaveMergeGate · 波次审计卡关（v1.3.1 交付 3）', () => {
  it('全 PASS → allMerged=true（全部 merged）', async () => {
    const wave = await runWaveMergeGate(
      'wave-1',
      [
        { taskId: 't1', handle: makeHandle('engineer-1') },
        { taskId: 't2', handle: makeHandle('engineer-2') },
        { taskId: 't3', handle: makeHandle('engineer-3') },
      ],
      {
        repoRoot: '/tmp/repo',
        mergeFn: async (handle) => gateResult('merged', { mergeCommitSha: `sha-${handle.agentId}`, auditVerdict: 'PASS' }),
      },
    );

    expect(wave.allMerged).toBe(true);
    expect(wave.merged).toHaveLength(3);
    expect(wave.rejected).toHaveLength(0);
    expect(wave.summary).toContain('全 PASS');
  });

  it('noop / conflict-resolved 也计为通过（波次不因空提交误判失败）', async () => {
    const wave = await runWaveMergeGate(
      'wave-2',
      [
        { taskId: 't1', handle: makeHandle('engineer-1') },
        { taskId: 't2', handle: makeHandle('engineer-2') },
      ],
      {
        repoRoot: '/tmp/repo',
        mergeFn: async (handle, opts) => {
          if (handle.agentId === 'engineer-1') return gateResult('noop');
          return gateResult('conflict-resolved', { conflict: { resolution: 'incoming-wins' } as never });
        },
      },
    );

    expect(wave.allMerged).toBe(true);
    expect(wave.merged).toHaveLength(2);
  });

  it('任一 FAIL → allMerged=false（审计 FAIL 丢弃对应 worktree）', async () => {
    const wave = await runWaveMergeGate(
      'wave-3',
      [
        { taskId: 't1', handle: makeHandle('engineer-1') },
        { taskId: 't2', handle: makeHandle('engineer-2') },
      ],
      {
        repoRoot: '/tmp/repo',
        mergeFn: async (handle) => {
          if (handle.agentId === 'engineer-2') {
            return gateResult('rejected', { rejectionReason: '审计未通过：A1 拦截' });
          }
          return gateResult('merged');
        },
      },
    );

    expect(wave.allMerged).toBe(false);
    expect(wave.merged).toHaveLength(1);
    expect(wave.rejected).toHaveLength(1);
    expect(wave.rejected[0]?.status).toBe('rejected');
    expect(wave.summary).toContain('有 FAIL');
  });

  it('error 卡关也计为失败（rejected 收敛）', async () => {
    const wave = await runWaveMergeGate(
      'wave-4',
      [{ taskId: 't1', handle: makeHandle('engineer-1') }],
      {
        repoRoot: '/tmp/repo',
        mergeFn: async () => gateResult('error', { rejectionReason: 'git 不可用' }),
      },
    );

    expect(wave.allMerged).toBe(false);
    expect(wave.rejected).toHaveLength(1);
    expect(wave.rejected[0]?.status).toBe('error');
  });

  it('mergeFn 抛异常 → 按 rejected 处理（不静默吞掉）', async () => {
    const wave = await runWaveMergeGate(
      'wave-5',
      [{ taskId: 't1', handle: makeHandle('engineer-1') }],
      {
        repoRoot: '/tmp/repo',
        mergeFn: async () => {
          throw new Error('boom');
        },
      },
    );

    expect(wave.allMerged).toBe(false);
    expect(wave.rejected).toHaveLength(1);
    expect(wave.rejected[0]?.status).toBe('error');
    expect(wave.rejected[0]?.rejectionReason).toContain('boom');
  });

  it('空波次（无 worktree）→ 显式 NO-OP（allMerged=false——v1.8.0 改判：0===0 不再算全过）', async () => {
    const wave = await runWaveMergeGate('wave-6', [], { repoRoot: '/tmp/repo' });
    expect(wave.allMerged).toBe(false);
    expect(wave.merged).toHaveLength(0);
    expect(wave.rejected).toHaveLength(0);
    expect(wave.summary).toContain('NO-OP');
  });
});

// ============================================================
// v1.8.0 · 波次假 PASS 修复行为锁（totalTasks 分母）
// 旧实现：handles 是调度侧排除失败任务后的子集，allMerged=merged.length===handles.length
// ⇒「一败一成」报「全 PASS：1/1」、「全败」报「全 PASS：0/0」——失败被包装成成功
// ============================================================
describe('runWaveMergeGate · totalTasks 分母（v1.8.0 波次假 PASS 修复）', () => {
  it('一败一成（失败未进卡关）→ allMerged=false 且 summary 含 FAIL 与未进卡关数', async () => {
    // 复现报告场景：2 任务，1 个执行失败未进卡关（handles 只剩 1 个），该个 merged
    const wave = await runWaveMergeGate(
      'wave-p1',
      [{ taskId: 't2', handle: makeHandle('engineer-2') }],
      {
        repoRoot: '/tmp/repo',
        totalTasks: 2, // parallel-scheduler 传 results.length
        mergeFn: async () => gateResult('merged', { mergeCommitSha: 'sha-x', auditVerdict: 'PASS' }),
      },
    );
    expect(wave.allMerged).toBe(false); // 旧实现此处为 true（1===1）
    expect(wave.summary).toContain('FAIL');
    expect(wave.summary).toContain('0/2'); // rejected 0 个 / 原始 2 任务（卡关内全过但分母含失败者）
    expect(wave.summary).toContain('未进卡关');
    expect(wave.merged).toHaveLength(1); // 成功那 1 个仍在 merged 清单（供诊断）
  });

  it('全败（0 个进卡关）→ allMerged=false（旧实现 0===0 报全 PASS）', async () => {
    const wave = await runWaveMergeGate('wave-p2', [], {
      repoRoot: '/tmp/repo',
      totalTasks: 2,
      mergeFn: async () => gateResult('merged'),
    });
    expect(wave.allMerged).toBe(false); // 旧实现此处为 true（0===0）
    expect(wave.summary).toContain('FAIL');
    expect(wave.summary).toContain('0/2');
  });

  it('全成（totalTasks=handles 数）→ allMerged=true 不回归', async () => {
    const wave = await runWaveMergeGate(
      'wave-p3',
      [
        { taskId: 't1', handle: makeHandle('engineer-1') },
        { taskId: 't2', handle: makeHandle('engineer-2') },
      ],
      {
        repoRoot: '/tmp/repo',
        totalTasks: 2,
        mergeFn: async (handle) => gateResult('merged', { mergeCommitSha: `sha-${handle.agentId}`, auditVerdict: 'PASS' }),
      },
    );
    expect(wave.allMerged).toBe(true);
    expect(wave.summary).toContain('全 PASS');
    expect(wave.summary).toContain('2/2');
  });
});

describe('isMergeGatePass · 单结果通过判定', () => {
  it('merged / conflict-resolved / noop 通过', () => {
    expect(isMergeGatePass(gateResult('merged'))).toBe(true);
    expect(isMergeGatePass(gateResult('conflict-resolved'))).toBe(true);
    expect(isMergeGatePass(gateResult('noop'))).toBe(true);
  });

  it('rejected / conflict-hitl / error 不通过', () => {
    expect(isMergeGatePass(gateResult('rejected'))).toBe(false);
    expect(isMergeGatePass(gateResult('conflict-hitl'))).toBe(false);
    expect(isMergeGatePass(gateResult('error'))).toBe(false);
  });
});

// ============================================================
// v1.8.0 · incumbent-wins 不计已合并（假成功修复行为锁）
// 旧实现：isMergeGatePass 对任何 conflict-resolved 都算通过——
// incumbent 赢时 incoming 产出被丢弃（abort+cleanup+notifyRetry）却计入已合并
// ============================================================
describe('isMergeGatePass · resolution 判定矩阵（v1.8.0）', () => {
  it('incumbent-wins → 不通过（incoming 被丢弃 = 未合并），波次 allMerged=false', async () => {
    const single = isMergeGatePass(
      gateResult('conflict-resolved', {
        conflict: { resolution: 'incumbent-wins', reason: 'scope', status: 'resolved', files: ['a.ts'] } as never,
      }),
    );
    expect(single).toBe(false); // 旧实现此处为 true

    const wave = await runWaveMergeGate(
      'wave-inc1',
      [{ taskId: 't1', handle: makeHandle('engineer-1') }],
      {
        repoRoot: '/tmp/repo',
        mergeFn: async () =>
          gateResult('conflict-resolved', {
            conflict: { resolution: 'incumbent-wins', reason: 'scope', status: 'resolved', files: ['a.ts'] } as never,
          }),
      },
    );
    expect(wave.allMerged).toBe(false); // 报告注入场景复测改判
    expect(wave.summary).toContain('FAIL');
  });

  it('incoming-wins / merged / noop → 通过（不回归）', () => {
    expect(isMergeGatePass(
      gateResult('conflict-resolved', {
        conflict: { resolution: 'incoming-wins', reason: '', status: 'resolved', files: [] } as never,
      }),
    )).toBe(true);
    expect(isMergeGatePass(gateResult('merged'))).toBe(true);
    expect(isMergeGatePass(gateResult('noop'))).toBe(true);
  });
});
