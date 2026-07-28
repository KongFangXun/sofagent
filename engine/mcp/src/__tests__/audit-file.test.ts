/**
 * audit-file.test.ts — @sofagent/mcp audit_file tool 测试（v1.1.5 新增）
 * 覆盖：PASS / WARN / FAIL 三态 + 无 task 时跳过 A3/A14 分支
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 动态读取 package.json 版本号（在 mock 之前读取真实 fs）──
const pkgVersion = (() => {
  // vi.mock 会在所有 import 之前执行，因此需要用 require 绕过 mock
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realFs = require('fs');
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

// ── Mock @sofagent/audit（runRules 行为按场景注入）──
const mockRunRules = vi.fn();
vi.mock('@sofagent/audit', () => ({
  parseDiff: vi.fn(() => []),
  checkLogs: vi.fn(() => []),
  runRules: mockRunRules,
  loadConfig: vi.fn(() => ({})),
  loadHistory: vi.fn(() => []),
  VERSION: pkgVersion,
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

interface AuditResult {
  exitCode: number;
  rules: Array<{
    name: string;
    number: number;
    status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
    ruleClass?: string;
    details: string[];
  }>;
}

/** 启动 MCP server，返回注入 JSON-RPC 消息的函数 + 收集 stdout 的函数 */
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

describe('MCP audit_file — PASS 分支', () => {
  it('全部规则 PASS 时返回 status=PASS 且 violations 为空', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 0,
      rules: [
        { name: 'A7 不存盲改', number: 7, status: 'PASS', ruleClass: '能力拐杖', details: [] },
        { name: 'A11 不滥资源', number: 11, status: 'PASS', ruleClass: '业务底线', details: [] },
        { name: 'A18 垃圾文件', number: 18, status: 'PASS', ruleClass: '能力拐杖', details: [] },
      ],
    } satisfies AuditResult);

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: 'audit_file',
        arguments: { path: 'src/foo.ts', change_type: 'modify' },
      },
    });

    const resp = lastResponse();
    expect(resp.id).toBe(100);
    expect(resp.error).toBeUndefined();
    expect(resp.result._meta.data.status).toBe('PASS');
    expect(resp.result._meta.data.violations).toEqual([]);
    expect(resp.result._meta.data.auditEngine).toContain('sofagent-audit');
    expect(resp.result.content[0].text).toContain('[sofagent]');
  });
});

describe('MCP audit_file — WARN 分支', () => {
  it('A11 触发 WARN 时返回 status=WARN', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 1,
      rules: [
        { name: 'A7 不存盲改', number: 7, status: 'PASS', ruleClass: '能力拐杖', details: [] },
        { name: 'A11 不滥资源', number: 11, status: 'WARN', ruleClass: '业务底线', details: ['文件超过 5000 行'] },
        { name: 'A18 垃圾文件', number: 18, status: 'PASS', ruleClass: '能力拐杖', details: [] },
      ],
    } satisfies AuditResult);

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'audit_file',
        arguments: { path: 'src/big.ts', change_type: 'modify' },
      },
    });

    const resp = lastResponse();
    expect(resp.result._meta.data.status).toBe('WARN');
    expect(resp.result._meta.data.violations).toHaveLength(1);
    expect(resp.result._meta.data.violations[0].severity).toBe('WARN');
    expect(resp.result._meta.data.violations[0].rule).toContain('A11');
  });
});

describe('MCP audit_file — FAIL 分支', () => {
  it('A18 触发 FAIL 时返回 status=FAIL', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 2,
      rules: [
        { name: 'A7 不存盲改', number: 7, status: 'PASS', ruleClass: '能力拐杖', details: [] },
        { name: 'A11 不滥资源', number: 11, status: 'PASS', ruleClass: '业务底线', details: [] },
        { name: 'A18 垃圾文件', number: 18, status: 'FAIL', ruleClass: '能力拐杖', details: ['a.txt 为垃圾文件'] },
      ],
    } satisfies AuditResult);

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
    expect(resp.result._meta.data.status).toBe('FAIL');
    expect(resp.result._meta.data.violations).toHaveLength(1);
    expect(resp.result._meta.data.violations[0].severity).toBe('FAIL');
    expect(resp.result._meta.data.violations[0].rule).toContain('A18');
  });
});

describe('MCP audit_file — task 上下文分支', () => {
  it('不传 task 时 A3/A14 不进入 scope', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 1,
      rules: [
        // A3 返回 WARN，但因无 task 应被过滤
        { name: 'A3 不改越界', number: 3, status: 'WARN', ruleClass: '业务底线', details: ['越界修改'] },
        { name: 'A14 知识库越权', number: 14, status: 'WARN', ruleClass: '能力拐杖', details: ['KB 越权'] },
        { name: 'A7 不存盲改', number: 7, status: 'PASS', ruleClass: '能力拐杖', details: [] },
        { name: 'A11 不滥资源', number: 11, status: 'PASS', ruleClass: '业务底线', details: [] },
        { name: 'A18 垃圾文件', number: 18, status: 'PASS', ruleClass: '能力拐杖', details: [] },
      ],
    } satisfies AuditResult);

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: {
        name: 'audit_file',
        arguments: { path: 'src/foo.ts', change_type: 'modify' }, // 不传 task
      },
    });

    const resp = lastResponse();
    // 应跳过 A3/A14，只剩 A7/A11/A18 全 PASS → status=PASS
    expect(resp.result._meta.data.status).toBe('PASS');
    expect(resp.result._meta.data.violations).toEqual([]);
    expect(resp.result._meta.data.scope).toEqual(['A7', 'A11', 'A18']);
  });

  it('传 task 时 A3/A14 进入 scope 并参与判定', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 1,
      rules: [
        { name: 'A3 不改越界', number: 3, status: 'WARN', ruleClass: '业务底线', details: ['越界修改 README.md'] },
        { name: 'A14 知识库越权', number: 14, status: 'PASS', ruleClass: '能力拐杖', details: [] },
        { name: 'A7 不存盲改', number: 7, status: 'PASS', ruleClass: '能力拐杖', details: [] },
        { name: 'A11 不滥资源', number: 11, status: 'PASS', ruleClass: '业务底线', details: [] },
        { name: 'A18 垃圾文件', number: 18, status: 'PASS', ruleClass: '能力拐杖', details: [] },
      ],
    } satisfies AuditResult);

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 104,
      method: 'tools/call',
      params: {
        name: 'audit_file',
        arguments: { path: 'README.md', change_type: 'modify', task: '修复 src/foo.ts bug' },
      },
    });

    const resp = lastResponse();
    expect(resp.result._meta.data.status).toBe('WARN');
    expect(resp.result._meta.data.violations).toHaveLength(1);
    expect(resp.result._meta.data.violations[0].rule).toContain('A3');
    expect(resp.result._meta.data.scope).toEqual(['A3', 'A7', 'A11', 'A14', 'A18']);
  });
});

describe('MCP audit_file — 参数校验', () => {
  it('缺 path 返回 -32602', async () => {
    mockRunRules.mockReturnValue({ exitCode: 0, rules: [] });
    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 105,
      method: 'tools/call',
      params: { name: 'audit_file', arguments: { change_type: 'modify' } },
    });
    const resp = lastResponse();
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32602);
  });

  it('非法 change_type 返回 -32602', async () => {
    mockRunRules.mockReturnValue({ exitCode: 0, rules: [] });
    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 106,
      method: 'tools/call',
      params: { name: 'audit_file', arguments: { path: 'a.ts', change_type: 'rename' } },
    });
    const resp = lastResponse();
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32602);
  });
});

describe('MCP audit_file — list_capabilities', () => {
  it('tools/list 包含 audit_file', async () => {
    mockRunRules.mockReturnValue({ exitCode: 0, rules: [] });
    const { send, lastResponse } = await startServer();
    send({ jsonrpc: '2.0', id: 107, method: 'tools/list' });
    const resp = lastResponse();
    const toolNames = resp.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('audit_file');
  });
});
