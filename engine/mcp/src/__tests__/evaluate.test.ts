// ============================================================
// evaluate.test.ts · MCP evaluate tool 测试（v1.3.1 交付 9）
// ============================================================
//
// 覆盖：
// - 触发模式：有题库布局 → 隔离评测（fake agent）→ 写 HMAC 链日志
// - 查询模式：query:true → 读评测日志
// - benchmark 不存在 → isError
//
// 全部临时目录隔离（SOFAGENT_DATA + overrideHome）；fake agent 不调 LLM。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { evaluate, setEvaluateTestAgent } from '../tools/evaluate';
// 直接用 orchestrator 建题库布局（测试 fixture——不是文档）
import {
  createBenchmark,
  addCase,
  freezeBenchmark,
  writeBenchmarkLayout,
  benchmarksRoot,
} from '@sofagent/orchestrator';
import { loadEnvConfig } from '@sofagent/core';

describe('evaluate · Benchmark 评测（v1.3.1 交付 9）', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-eval-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    vi.clearAllMocks();
    setEvaluateTestAgent(null);
  });

  afterEach(() => {
    setEvaluateTestAgent(null);
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('触发模式：建题库布局 → 评测全部 cases → 写 HMAC 链日志', async () => {
    // 建题库布局（fixture）
    const root = benchmarksRoot(loadEnvConfig().dataDir);
    const def = createBenchmark('bench-mcp', { title: 'MCP 评测', description: '单测' });
    addCase(def, { name: 'a', statement: '任务 A', rubric: '标准 A' });
    addCase(def, { name: 'b', statement: '任务 B', rubric: '标准 B' });
    freezeBenchmark(def);
    writeBenchmarkLayout(def, root);

    // fake agent：返回产出（read-only 工具面放行读，拦截写）
    setEvaluateTestAgent(async (ctx) => {
      expect(fs.existsSync(path.join(ctx.workspace, 'statement.md'))).toBe(true);
      return 'agent 产出';
    });

    const result = await evaluate({ benchmark_id: 'bench-mcp' });

    expect(result.data.isError).toBe(false);
    expect(result.data.mode).toBe('run');
    expect(result.data.evaluations).toHaveLength(2);
    expect(result.data.evaluations?.[0]?.score).toBe(100);
    expect(result.text).toContain('[sofagent]');

    // HMAC 链日志已写
    const logPath = path.join(root, 'bench-mcp', 'evaluation-log.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('查询模式：query:true 读评测日志', async () => {
    const root = benchmarksRoot(loadEnvConfig().dataDir);
    const def = createBenchmark('bench-q', { title: '查询', description: '' });
    addCase(def, { name: 'a', statement: '任务', rubric: '标准' });
    writeBenchmarkLayout(def, root);

    setEvaluateTestAgent(async () => '产出');
    await evaluate({ benchmark_id: 'bench-q' });

    const q = await evaluate({ benchmark_id: 'bench-q', query: true });
    expect(q.data.isError).toBe(false);
    expect(q.data.mode).toBe('query');
    expect(q.data.records?.length).toBe(1);
    expect(q.data.records?.[0]?.caseId).toContain('CASE-001');
  });

  it('benchmark 不存在 → isError（不崩溃）', async () => {
    const result = await evaluate({ benchmark_id: 'bench-nonexistent' });
    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('不存在');
  });

  it('缺 benchmark_id → isError', async () => {
    const result = await evaluate({ benchmark_id: '' });
    expect(result.data.isError).toBe(true);
  });
});
