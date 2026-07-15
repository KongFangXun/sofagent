/**
 * smoke.test.ts — @sofagent/mcp smoke 测试
 * v1.1.2 P1-4: 覆盖 MCP 工具调用主链路（run_audit / get_think / write_think）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, statSync } from 'fs';
import { appendThinkEntry } from '@sofagent/core';

// ── Mock fs ──
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

// ── Mock @sofagent/audit ──
vi.mock('@sofagent/audit', () => ({
  parseDiff: vi.fn(() => [{ file: 'src/test.ts', hunks: [{ header: '@@ -1,0 +1,5 @@', lines: [] }] }]),
  checkLogs: vi.fn(() => []),
  runRules: vi.fn(() => ({
    exitCode: 0,
    rules: [
      { name: 'A1', status: 'PASS', ruleClass: '业务底线', details: [] },
      { name: 'A2', status: 'PASS', ruleClass: '业务底线', details: [] },
    ],
  })),
  loadConfig: vi.fn(() => ({ rules: {} })),
  loadHistory: vi.fn(() => []),
  VERSION: '1.1.0',
}));

// ── Mock @sofagent/think ──
vi.mock('@sofagent/think', () => ({
  generateThinkEntry: vi.fn(() => '## 2026-01-01 12:00:00 任务: test\n\n- #教训: test entry\n\n'),
}));

// ── Mock @sofagent/core（记忆契约：getThinkPath / appendThinkEntry）──
vi.mock('@sofagent/core', () => ({
  getThinkPath: vi.fn(() => '/tmp/test-think.md'),
  appendThinkEntry: vi.fn(() => 0),
}));

// ── Mock child_process ──
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => Buffer.from('mock diff output')),
}));

// ── Mock readline ──
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

// ════════════════════════════════════════
// 工具列表 smoke
// ════════════════════════════════════════

describe('MCP smoke — 工具列表', () => {
  it('tools/list 返回 run_audit / get_think / write_think 三个工具', async () => {
    vi.resetModules();
    const { createInterface } = await import('readline');
    let lineHandler: ((line: string) => void) | null = null;
    (createInterface as any).mockReturnValue({
      on: vi.fn((event: string, cb: any) => {
        if (event === 'line') lineHandler = cb;
      }),
      close: vi.fn(),
    });

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    await import('../mcp-server');

    // initialize
    lineHandler!(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    // tools/list
    lineHandler!(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));

    const lastLine = writes.filter(l => l.trim()).pop() || '';
    const resp = JSON.parse(lastLine.replace(/\n$/, ''));
    expect(resp.result.tools).toBeDefined();
    const toolNames = resp.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('run_audit');
    expect(toolNames).toContain('get_think');
    expect(toolNames).toContain('write_think');
  });
});

// ════════════════════════════════════════
// run_audit smoke
// ════════════════════════════════════════

describe('MCP smoke — run_audit', () => {
  it('run_audit 返回结构化审计结果', async () => {
    vi.resetModules();
    const { createInterface } = await import('readline');
    let lineHandler: ((line: string) => void) | null = null;
    (createInterface as any).mockReturnValue({
      on: vi.fn((event: string, cb: any) => {
        if (event === 'line') lineHandler = cb;
      }),
      close: vi.fn(),
    });

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    // 需要 execFileSync 返回有效的 diff 内容
    const { execFileSync } = await import('child_process');
    (execFileSync as any).mockReturnValue(Buffer.from('diff --git a/test.ts b/test.ts\n'));

    await import('../mcp-server');

    lineHandler!(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    lineHandler!(JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'run_audit', arguments: { diff: 'HEAD~1..HEAD' } },
    }));

    const lastLine = writes.filter(l => l.trim()).pop() || '';
    const resp = JSON.parse(lastLine.replace(/\n$/, ''));
    expect(resp.id).toBe(3);
    expect(resp.result).toBeDefined();
    expect(resp.error).toBeUndefined();
    // 审计结果应包含结构化字段
    expect(resp.result.content).toBeDefined();
  });
});

// ════════════════════════════════════════
// get_think smoke
// ════════════════════════════════════════

describe('MCP smoke — get_think', () => {
  it('get_think think.md 不存在时返回提示', async () => {
    vi.resetModules();
    const { createInterface } = await import('readline');
    let lineHandler: ((line: string) => void) | null = null;
    (createInterface as any).mockReturnValue({
      on: vi.fn((event: string, cb: any) => {
        if (event === 'line') lineHandler = cb;
      }),
      close: vi.fn(),
    });

    (existsSync as any).mockReturnValue(false);

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    await import('../mcp-server');

    lineHandler!(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    lineHandler!(JSON.stringify({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_think', arguments: {} },
    }));

    const lastLine = writes.filter(l => l.trim()).pop() || '';
    const resp = JSON.parse(lastLine.replace(/\n$/, ''));
    expect(resp.id).toBe(4);
    expect(resp.result).toBeDefined();
    // 文件不存在时返回友好提示
    expect(resp.result.content[0].text).toContain('think.md');
  });

  it('get_think think.md 存在时返回最新条目', async () => {
    vi.resetModules();
    const { createInterface } = await import('readline');
    let lineHandler: ((line: string) => void) | null = null;
    (createInterface as any).mockReturnValue({
      on: vi.fn((event: string, cb: any) => {
        if (event === 'line') lineHandler = cb;
      }),
      close: vi.fn(),
    });

    (existsSync as any).mockReturnValue(true);
    (readFileSync as any).mockReturnValue('## 2026-01-01 任务: test\n\n- #教训: learned something\n\n');

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    await import('../mcp-server');

    lineHandler!(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    lineHandler!(JSON.stringify({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'get_think', arguments: {} },
    }));

    const lastLine = writes.filter(l => l.trim()).pop() || '';
    const resp = JSON.parse(lastLine.replace(/\n$/, ''));
    expect(resp.id).toBe(5);
    expect(resp.result).toBeDefined();
    expect(resp.result.content[0].text).toContain('learned something');
  });
});

// ════════════════════════════════════════
// write_think smoke
// ════════════════════════════════════════

describe('MCP smoke — write_think', () => {
  it('write_think 追加后返回成功确认', async () => {
    vi.resetModules();
    const { createInterface } = await import('readline');
    let lineHandler: ((line: string) => void) | null = null;
    (createInterface as any).mockReturnValue({
      on: vi.fn((event: string, cb: any) => {
        if (event === 'line') lineHandler = cb;
      }),
      close: vi.fn(),
    });

    (existsSync as any).mockReturnValue(true);
    (appendThinkEntry as any).mockImplementation(() => 0);

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    await import('../mcp-server');

    lineHandler!(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    lineHandler!(JSON.stringify({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: {
        name: 'write_think',
        arguments: { lesson: 'smoke test entry', task: 'smoke-test' },
      },
    }));

    const lastLine = writes.filter(l => l.trim()).pop() || '';
    const resp = JSON.parse(lastLine.replace(/\n$/, ''));
    expect(resp.id).toBe(6);
    expect(resp.result).toBeDefined();
    expect(resp.result.content[0].text).toContain('已追加');
  });

  it('write_think 缺少 lesson 参数返回错误', async () => {
    vi.resetModules();
    const { createInterface } = await import('readline');
    let lineHandler: ((line: string) => void) | null = null;
    (createInterface as any).mockReturnValue({
      on: vi.fn((event: string, cb: any) => {
        if (event === 'line') lineHandler = cb;
      }),
      close: vi.fn(),
    });

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    await import('../mcp-server');

    lineHandler!(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    lineHandler!(JSON.stringify({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'write_think', arguments: {} },
    }));

    const lastLine = writes.filter(l => l.trim()).pop() || '';
    const resp = JSON.parse(lastLine.replace(/\n$/, ''));
    expect(resp.id).toBe(7);
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32602);
  });
});
