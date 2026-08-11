// ============================================================
// loop-debug.test.ts · MCP loop_debug tool 测试（v1.3.2 交付 8）
// ============================================================
//
// 覆盖：
// - 触发模式：传 task → 跑 Onboard L1 循环（注入 fake runner 不调 LLM）
// - 查询模式：无 task → 读调试记录（临时目录隔离）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { loopDebug, setLoopDebugTestRunner } from '../tools/loop-debug';

describe('loop_debug · Onboard L1 调试循环（v1.3.1 交付 8）', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-loopdbg-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    setLoopDebugTestRunner(null);
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('触发模式：fake runner 首轮失败 → 次轮通过 → finalState=passed', async () => {
    let callCount = 0;
    setLoopDebugTestRunner(async () => {
      callCount += 1;
      if (callCount === 1) return { exitCode: 1, stderr: 'startup crash', durationMs: 50 };
      return { exitCode: 0, durationMs: 50 };
    });

    const result = await loopDebug({ task: '测试节点任务', agent_id: 'agent-7', max_rounds: 3 });

    expect(result.data.isError).toBe(false);
    expect(result.data.mode).toBe('run');
    expect(result.data.finalState).toBe('passed');
    expect(result.data.agentId).toBe('agent-7');
    expect(result.data.rounds).toHaveLength(2);
    expect(result.text).toContain('[sofagent]');
    expect(result.text).toContain('passed');
  });

  it('触发模式：持续失败 → 达最大轮数 → finalState=error', async () => {
    setLoopDebugTestRunner(async () => ({ exitCode: 1, stderr: 'boom', durationMs: 10 }));
    const result = await loopDebug({ task: '坏节点', max_rounds: 2 });
    expect(result.data.finalState).toBe('error');
    expect(result.data.rounds).toHaveLength(2);
  });

  it('查询模式：无 task → 读最近调试记录（带 agentId）', async () => {
    // 先触发一轮（写入调试记录）
    setLoopDebugTestRunner(async () => ({ exitCode: 0, durationMs: 10 }));
    await loopDebug({ task: '记录任务', agent_id: 'agent-9' });

    // 查询模式
    const result = await loopDebug({ agent_id: 'agent-9' });
    expect(result.data.isError).toBe(false);
    expect(result.data.mode).toBe('query');
    expect(result.data.records?.length).toBeGreaterThan(0);
    // 记录带 agentId
    expect(result.data.records?.[0]?.agentId).toBe('agent-9');
    expect(result.text).toContain('[sofagent]');
  });

  it('查询模式：无记录时返回空列表不报错', async () => {
    const result = await loopDebug({});
    expect(result.data.isError).toBe(false);
    expect(result.data.mode).toBe('query');
    expect(result.data.records).toEqual([]);
  });
});
