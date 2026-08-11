// ============================================================
// loop-agent-driver.test.ts · Onboard L1 循环驱动测试（v1.3.2 交付 8）
// ============================================================
//
// 覆盖：
// - activate → run → judge → fix → re-run 循环（首轮失败 → 修复 → 次轮通过）
// - 工具失败收敛：runner 抛异常 → 收敛为 error 判定，不中断循环（交付 12 联动）
// - 达最大轮数仍失败 → 循环停止（finalState=error）
// - 调试记录带 agentId（交付 6/7 协同）+ taskId 过滤查询
//
// 全部注入 mock runner/judge/fixer——不调真实 LLM/进程；临时目录隔离。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runOnboardLoop, readLoopDebugRecords } from '../loop-agent/driver';
import { judgeRunResult } from '../loop-agent/judge';

describe('loop-agent driver · Onboard L1 循环（v1.3.1 交付 8）', () => {
  let tmpDir: string;
  let debugLogPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-onboard-'));
    debugLogPath = path.join(tmpDir, 'loop-debug.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('循环驱动：首轮失败 → fix → re-run → 次轮通过（passed）', async () => {
    let callCount = 0;
    const fixer = vi.fn().mockResolvedValue('修复后的任务描述');
    const result = await runOnboardLoop('初始任务', {
      taskId: 'task-fix-1',
      agentId: 'agent-01',
      debugLogPath,
      maxRounds: 3,
      runner: async (task, round) => {
        callCount += 1;
        if (round === 1) return { exitCode: 1, stderr: 'crash at startup', durationMs: 100 };
        return { exitCode: 0, stdout: 'ok', durationMs: 100 };
      },
      fixer,
    });

    // 2 轮：run→judge(error)→fix→re-run→judge(passed)
    expect(callCount).toBe(2);
    expect(fixer).toHaveBeenCalledTimes(1);
    expect(result.finalState).toBe('passed');
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]?.verdict.state).toBe('error');
    expect(result.rounds[1]?.verdict.state).toBe('passed');
    expect(result.rounds[0]?.fixFeedback).toBe('修复后的任务描述');
    // 第二轮任务带修复反馈前缀
    expect(result.rounds[1]?.task).toContain('修复后的任务描述');
    // agentId 透传
    expect(result.agentId).toBe('agent-01');
  });

  it('工具失败收敛：runner 抛异常 → error 判定（不中断循环，交付 12 联动）', async () => {
    let callCount = 0;
    const result = await runOnboardLoop('任务', {
      taskId: 'task-converge-1',
      debugLogPath,
      maxRounds: 2,
      runner: async () => {
        callCount += 1;
        throw new Error('EACCES: permission denied');
      },
    });

    // runner 抛错被 convergeToolError 收敛——不中断循环
    expect(callCount).toBe(2); // 两轮都跑（错误收敛后 fix 再跑）
    expect(result.finalState).toBe('error'); // 达最大轮数仍失败
    expect(result.rounds[0]?.outcome.stderr).toContain('tool_error');
    expect(result.rounds[0]?.outcome.stderr).toContain('EACCES');
  });

  it('达最大轮数仍失败 → 循环停止（finalState=error）', async () => {
    const result = await runOnboardLoop('任务', {
      taskId: 'task-exhaust-1',
      debugLogPath,
      maxRounds: 3,
      runner: async () => ({ exitCode: 2, stderr: 'persistent failure', durationMs: 50 }),
    });

    expect(result.rounds).toHaveLength(3);
    expect(result.finalState).toBe('error');
    // 最后一轮没有 fixFeedback（不再 fix）
    expect(result.rounds[2]?.fixFeedback).toBeUndefined();
  });

  it('超时判定：runner 耗时超阈值 → timeout → fix → re-run', async () => {
    let callCount = 0;
    const result = await runOnboardLoop('任务', {
      taskId: 'task-timeout-1',
      debugLogPath,
      maxRounds: 2,
      timeoutMs: 100,
      runner: async () => {
        callCount += 1;
        // 第一轮模拟超时（durationMs > 阈值），第二轮通过
        if (callCount === 1) return { exitCode: null, durationMs: 5000 };
        return { exitCode: 0, durationMs: 10 };
      },
    });

    expect(callCount).toBe(2);
    expect(result.rounds[0]?.verdict.state).toBe('timeout');
    expect(result.finalState).toBe('passed');
  });

  it('首轮即通过：单轮结束，无 fix 调用', async () => {
    const fixer = vi.fn();
    const result = await runOnboardLoop('任务', {
      taskId: 'task-pass-1',
      debugLogPath,
      runner: async () => ({ exitCode: 0, durationMs: 50 }),
      fixer,
    });

    expect(result.rounds).toHaveLength(1);
    expect(result.finalState).toBe('passed');
    expect(fixer).not.toHaveBeenCalled();
  });

  it('调试记录带 agentId（交付 6/7 协同）+ taskId 过滤查询', async () => {
    await runOnboardLoop('任务', {
      taskId: 'task-debug-1',
      agentId: 'agent-42',
      debugLogPath,
      runner: async () => ({ exitCode: 0, durationMs: 50 }),
    });

    // 记录含 activate（round=0）+ 1 轮
    const records = readLoopDebugRecords(debugLogPath);
    expect(records.length).toBe(2);
    // 轮记录带 agentId
    expect(records[1]?.agentId).toBe('agent-42');
    expect(records[1]?.taskId).toBe('task-debug-1');
    expect(records[1]?.state).toBe('passed');

    // taskId 过滤
    expect(readLoopDebugRecords(debugLogPath, { taskId: 'task-debug-1' })).toHaveLength(2);
    expect(readLoopDebugRecords(debugLogPath, { taskId: 'other' })).toHaveLength(0);
    // agentId 过滤
    expect(readLoopDebugRecords(debugLogPath, { agentId: 'agent-42' })).toHaveLength(2);
  });

  it('judge 可注入 mock（判定逻辑可替换）', async () => {
    const mockJudge = vi.fn().mockReturnValue({ state: 'crash' as const, detail: 'mock 判定' });
    const result = await runOnboardLoop('任务', {
      taskId: 'task-mock-judge-1',
      debugLogPath,
      maxRounds: 1,
      runner: async () => ({ exitCode: 0, durationMs: 10 }),
      judge: mockJudge,
    });

    expect(mockJudge).toHaveBeenCalled();
    expect(result.finalState).toBe('crash');
  });
});
