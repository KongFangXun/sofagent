/**
 * alias-rewrite.test.ts · MCP tool 更名别名路由测试（v1.5.2 A-4）
 *
 * 背景：'sofagent_compose' 更名 'compose'（全量 tool 中唯一带前缀项的命名收口）。
 * 旧名经 mcp-server.ts tools/call 分派层别名路由兼容一版——本文件断言：
 *   ① 规名 'compose' 正常分发（走到 handler）；
 *   ② 旧名 'sofagent_compose' 路由到同一 handler 且结果 text 追加更名提示；
 *   ③ 未知名仍走 Unknown tool 错误路径（别名不为其他名字放行）。
 *
 * 驱动方式：对齐 smoke.test.ts 形态——mock readline 拿 line handler，
 * initialize 后发 tools/call，断言 stdout 末行 JSON-RPC 响应。
 */

import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';

// ── Mock fs ──
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false })),
}));

// ── Mock @sofagent/audit ──
vi.mock('@sofagent/audit', () => ({
  parseDiff: vi.fn(() => []),
  checkLogs: vi.fn(() => []),
  runRules: vi.fn(() => ({ exitCode: 0, rules: [] })),
  loadConfig: vi.fn(() => ({})),
  loadHistory: vi.fn(() => []),
  VERSION: '1.5.2',
}));

// ── Mock @sofagent/core ──
vi.mock('@sofagent/core', () => ({
  getThinkPath: vi.fn(() => '/tmp/test-think.md'),
  appendThinkEntry: vi.fn(() => 0),
  getDataDir: vi.fn(() => require('os').tmpdir()),
}));

// ── Mock @sofagent/think ──
vi.mock('@sofagent/think', () => ({
  generateThinkEntry: vi.fn(() => '## 2026-01-01 12:00:00 任务: test\n\n- #教训: test\n\n'),
}));

// ── Mock child_process（compose 走 execFileSync sofagent-orchestrator）──
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => '# 编排方案：用户注册模块\nagents: []'),
}));

// ── Mock readline（拿 line handler 驱动 JSON-RPC）──
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

// compose 走 fde 角色——角色分层默认全量（未设 SOFAGENT_MCP_ROLES），无需特判

/** 通用驱动器：initialize → tools/call(name, args) → 取 stdout 末行解析 */
async function driveCall(name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
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
  // initialize 响应先行落盘——取「本请求 id」的响应需按 id 过滤（writes 含两条响应）
  lineHandler!(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }));

  await new Promise((r) => setTimeout(r, 30)); // 异步 handler 落盘（compose 为 async handler）
  const mine = writes.filter((l) => l.trim() && (JSON.parse(l).id === 2));
  const lastLine = mine.pop() || '';
  return JSON.parse(lastLine.replace(/\n$/, ''));
}

describe('MCP 别名路由 — sofagent_compose → compose（A-4）', () => {
  it('TOOLS 注册表：规名 compose 在位、旧名不在注册表', async () => {
    vi.resetModules();
    const { TOOLS } = await import('../tool-registry');
    expect(TOOLS.some((t) => t.name === 'compose')).toBe(true);
    expect(TOOLS.some((t) => t.name === 'sofagent_compose')).toBe(false);
  });

  it('旧名 sofagent_compose 路由到 compose handler，结果 text 追加更名提示', async () => {
    const resp = await driveCall('sofagent_compose', { task: '实现用户注册模块' });
    expect(resp.id).toBe(2);
    expect(resp.result).toBeDefined();
    expect(resp.error).toBeUndefined();
    expect(resp.result.content[0].text).toContain('编排方案');
    expect(resp.result.content[0].text).toContain('sofagent_compose 已更名 compose（别名兼容一版）');
  });

  it('规名 compose 调用结果不追更名提示', async () => {
    const resp = await driveCall('compose', { task: '实现用户注册模块' });
    expect(resp.id).toBe(2);
    expect(resp.result).toBeDefined();
    expect(resp.result.content[0].text).toContain('编排方案');
    expect(resp.result.content[0].text).not.toContain('已更名');
  });

  it('未知名仍走 Unknown tool 错误路径（别名不放行其他名字）', async () => {
    const resp = await driveCall('sofagent_nonexistent', {});
    expect(resp.id).toBe(2);
    expect(resp.error).toBeDefined();
    expect(resp.error.message).toContain('Unknown tool');
  });
});
