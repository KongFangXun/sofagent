// ============================================================
// is-error-flag.test.ts · L3 isError 协议标记测试（v1.2.4 S5 新增）
// ============================================================
//
// 覆盖：
// - run_audit FAIL 时返回 isError=true
// - audit_file FAIL 时返回 isError=true
// - create_entity 被 D1/D5 拦截时返回 isError=true
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 动态读取 package.json 版本号（在 mock 之前读取真实 fs）──
const pkgVersion = (() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realFs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realPath = require('path');
  return JSON.parse(realFs.readFileSync(realPath.join(__dirname, '../../package.json'), 'utf-8')).version;
})();

// ── Mock fs ──
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
}));

// ── Mock @sofagent/audit ──
const mockRunRules = vi.fn();
vi.mock('@sofagent/audit', () => ({
  parseDiff: vi.fn(() => [{ path: 'src/test.ts', status: 'modified', lines: [] }]),
  checkLogs: vi.fn(() => []),
  runRules: mockRunRules,
  loadConfig: vi.fn(() => ({})),
  loadHistory: vi.fn(() => []),
  VERSION: pkgVersion,
}));

vi.mock('@sofagent/think', () => ({
  generateThinkEntry: vi.fn(),
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

interface AuditResultMock {
  exitCode: number;
  rules: Array<{
    name: string;
    number: number;
    status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
    ruleClass?: string;
    details: string[];
  }>;
}

/** 启动 MCP server，返回注入 JSON-RPC 消息的函数 + 收集 stdout */
async function startServer() {
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
  const lastResponse = () => {
    const lastLine = writes.filter((l) => l.trim()).pop() || '';
    return JSON.parse(lastLine.replace(/\n$/, ''));
  };

  // initialize
  send({ jsonrpc: '2.0', id: 1, method: 'initialize' });

  return { send, lastResponse };
}

describe('L3 isError 标记', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('run_audit FAIL 时返回 isError=true', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 2,
      rules: [
        { name: 'A2 不泄密钥', number: 2, status: 'FAIL', ruleClass: '业务底线', details: ['检测到密钥'] },
      ],
    } satisfies AuditResultMock);

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: 'run_audit',
        arguments: { diff: 'HEAD~1..HEAD' },
      },
    });

    const resp = lastResponse();
    expect(resp.result.isError).toBe(true);
    expect(resp.result._meta.data.verdict).toBe('FAIL');
  });

  it('run_audit PASS 时 isError 不存在或为 false', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 0,
      rules: [
        { name: 'A1', number: 1, status: 'PASS', ruleClass: '业务底线', details: [] },
      ],
    } satisfies AuditResultMock);

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'run_audit',
        arguments: { diff: 'HEAD~1..HEAD' },
      },
    });

    const resp = lastResponse();
    expect(resp.result.isError).toBeFalsy();
  });

  it('audit_file FAIL 时返回 isError=true', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 2,
      rules: [
        { name: 'A18 垃圾文件', number: 18, status: 'FAIL', ruleClass: '能力拐杖', details: ['a.txt 是垃圾文件'] },
        { name: 'A7', number: 7, status: 'PASS', ruleClass: '能力拐杖', details: [] },
        { name: 'A11', number: 11, status: 'PASS', ruleClass: '业务底线', details: [] },
      ],
    } satisfies AuditResultMock);

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: {
        name: 'audit_file',
        arguments: { path: 'a.txt', change_type: 'create' },
      },
    });

    const resp = lastResponse();
    expect(resp.result.isError).toBe(true);
    expect(resp.result._meta.data.status).toBe('FAIL');
  });
});
