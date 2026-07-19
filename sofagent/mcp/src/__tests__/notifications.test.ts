/**
 * notifications.test.ts — MCP server JSON-RPC 协议合规测试（v1.1.5 新增）
 *
 * 防御：v1.1.5 fresh-eyes-review 子项 29 暴露的 bug——
 *   旧实现对 notification（id=null）也回 error response，违反 JSON-RPC 2.0 规范。
 *   JSON-RPC 2.0 规定 notification（无 id 字段或 id === null）不应答。
 *   参考：https://www.jsonrpc.org/specification#notification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs ──
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
}));

// ── Mock @sofagent/audit ──
vi.mock('@sofagent/audit', () => ({
  parseDiff: vi.fn(() => []),
  checkLogs: vi.fn(() => []),
  runRules: vi.fn(() => ({ exitCode: 0, rules: [] })),
  loadConfig: vi.fn(() => ({})),
  loadHistory: vi.fn(() => []),
  VERSION: '1.1.5',
}));

vi.mock('@sofagent/think', () => ({
  generateThinkEntry: vi.fn(() => ''),
}));

vi.mock('@sofagent/core', () => ({
  getThinkPath: vi.fn(() => '/tmp/think.md'),
  appendThinkEntry: vi.fn(() => 0),
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => Buffer.from('')),
}));

vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

/**
 * 启动 MCP server，返回注入 JSON-RPC 消息的函数 + 收集 stdout 的函数。
 * 不预先 initialize——测试 notification 协议本身。
 */
async function startServerRaw() {
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

  const send = (msg: object) => lineHandler!(JSON.stringify(msg));

  // 返回所有响应（每行一个 JSON-RPC response）
  const responses = () =>
    writes
      .join('')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r) => r !== null);

  return { send, responses, writeCount: () => writes.length };
}

describe('JSON-RPC notification 协议合规（v1.1.5 fresh-eyes 子项 29）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notification 消息（id=null）→ 不应答（stdout 无输出）', async () => {
    const { send, responses } = await startServerRaw();
    // 未知 method + id=null → 应视为 notification 静默忽略
    send({ jsonrpc: '2.0', id: null, method: 'some/unknown/method' });

    const resp = responses();
    expect(resp).toEqual([]);
  });

  it('notifications/initialized → 不应答（即使带 id，前缀判定优先）', async () => {
    const { send, responses } = await startServerRaw();
    // MCP 协议标准：method 以 "notifications/" 开头的是 notification
    // 即使客户端误带了 id（非标准用法），仍按 notification 处理不答
    send({ jsonrpc: '2.0', id: 99, method: 'notifications/initialized' });

    const resp = responses();
    expect(resp).toEqual([]);
  });

  it('notifications/initialized（无 id）→ 标准用法不应答', async () => {
    const { send, responses } = await startServerRaw();
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const resp = responses();
    expect(resp).toEqual([]);
  });

  it('未知 method + id 非空 → 返回 -32601 error（保持原行为）', async () => {
    const { send, responses } = await startServerRaw();
    send({ jsonrpc: '2.0', id: 42, method: 'totally/unknown' });

    const resp = responses();
    expect(resp).toHaveLength(1);
    expect(resp[0].id).toBe(42);
    expect(resp[0].error).toBeDefined();
    expect(resp[0].error.code).toBe(-32601);
    expect(resp[0].error.message).toContain('totally/unknown');
  });

  it('未知 method + id=null → 不应答（notification 静默）', async () => {
    const { send, responses } = await startServerRaw();
    send({ jsonrpc: '2.0', id: null, method: 'another/unknown' });

    const resp = responses();
    expect(resp).toEqual([]);
  });

  it('未知 method + 缺 id 字段 → 不应答（notification 静默）', async () => {
    const { send, responses } = await startServerRaw();
    // 完全省略 id 字段
    send({ jsonrpc: '2.0', method: 'missing/id-field' });

    const resp = responses();
    expect(resp).toEqual([]);
  });

  it('未知 method + 字符串 id → 返回 -32601 error（字符串 id 也是 request）', async () => {
    const { send, responses } = await startServerRaw();
    send({ jsonrpc: '2.0', id: 'req-abc', method: 'unknown/string-id' });

    const resp = responses();
    expect(resp).toHaveLength(1);
    expect(resp[0].id).toBe('req-abc');
    expect(resp[0].error.code).toBe(-32601);
  });

  it('其他 notifications/ 前缀消息（如 notifications/cancelled）→ 不应答', async () => {
    const { send, responses } = await startServerRaw();
    // MCP 协议其他 notification 类型也应静默
    send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
    send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 50 } });

    const resp = responses();
    expect(resp).toEqual([]);
  });

  it('initialize + 未知 method 序列：notification 不污染后续 request 响应', async () => {
    const { send, responses } = await startServerRaw();
    // 先 initialize
    send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    // 再发 notification（不应答）
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    // 再发 ping（应答）
    send({ jsonrpc: '2.0', id: 2, method: 'ping' });

    const resp = responses();
    // 期望 2 个响应（initialize + ping），notification 无响应
    expect(resp).toHaveLength(2);
    expect(resp[0].id).toBe(1);
    expect(resp[0].result).toBeDefined();
    expect(resp[1].id).toBe(2);
    expect(resp[1].result).toEqual({});
  });
});
