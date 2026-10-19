// ============================================================
// run-audit-skipped.test.ts · run_audit SKIPPED 渲染语义测试
// ============================================================
//
// 覆盖（对齐 CLI index.ts:1953-1989 的 C8+L10 语义）：
// - SKIPPED 规则不再逐条渲染为「FAIL ... 跳过后续层规则」
// - 末尾输出「本批未检查」汇总行（含被跳过规则码清单与「未检查 ≠ 通过」）
// - 机器可读面 status: 'SKIPPED' 原样保留在 _meta.data.allRules
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
  getDataDir: vi.fn(() => require('os').tmpdir()),
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

  send({ jsonrpc: '2.0', id: 1, method: 'initialize' });

  return { send, lastResponse };
}

describe('run_audit SKIPPED 渲染语义（对齐 CLI）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SKIPPED 不渲染为 FAIL 逐条行，末尾含「本批未检查」汇总', async () => {
    // critical 层 1 条 FAIL + fail-fast 跳过 3 条（A/E/R 系列与无编号插件条目各一）
    mockRunRules.mockReturnValue({
      exitCode: 2,
      rules: [
        { name: 'A2 不泄密钥', number: 2, status: 'FAIL', ruleClass: '业务底线', details: ['检测到密钥'] },
        { name: 'A7 零散实现', number: 7, status: 'SKIPPED', ruleClass: '能力拐杖', details: ['critical 层 1 条规则命中 FAIL，跳过后续层规则'] },
        { name: 'E1 大文件误伤', number: 201, status: 'SKIPPED', ruleClass: '能力拐杖', details: ['critical 层 1 条规则命中 FAIL，跳过后续层规则'] },
        { name: '插件规则X', number: 0, status: 'SKIPPED', ruleClass: '能力拐杖', details: ['critical 层 1 条规则命中 FAIL，跳过后续层规则'] },
      ],
    });

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 200,
      method: 'tools/call',
      params: {
        name: 'run_audit',
        arguments: { diff: 'HEAD~1..HEAD' },
      },
    });

    const resp = lastResponse();
    const text: string = resp.result.content[0].text;

    // 逐条详情面：SKIPPED 不再渲染成 FAIL 行
    expect(text).not.toContain('FAIL A7 零散实现');
    expect(text).not.toContain('FAIL E1 大文件误伤');
    expect(text).not.toContain('FAIL 插件规则X');
    expect(text).not.toContain('跳过后续层规则');

    // 汇总行：被跳过规则码清单 + 「本批未检查」+「未检查 ≠ 通过」
    expect(text).toContain('⏭️ [sofagent] fail-fast：critical 层已有 FAIL，以下 3 条规则本批未检查');
    expect(text).toContain('A7 E1 插件规则X');
    expect(text).toContain('未检查 ≠ 通过');

    // 真实 FAIL 仍逐条渲染
    expect(text).toContain('FAIL A2 不泄密钥');

    // 机器可读面：status 取值原样保留
    expect(resp.result._meta.data.exitCode).toBe(2);
    expect(resp.result._meta.data.verdict).toBe('FAIL');
    expect(resp.result._meta.data.allRules.filter((r: { status: string }) => r.status === 'SKIPPED')).toHaveLength(3);
    // triggeredRules 只含 FAIL/WARN——SKIPPED 不进逐条详情数据面
    expect(resp.result._meta.data.triggeredRules).toHaveLength(1);
  });

  it('无 SKIPPED 时输出「全部审计规则通过」且无 fail-fast 汇总行', async () => {
    mockRunRules.mockReturnValue({
      exitCode: 0,
      rules: [
        { name: 'A1', number: 1, status: 'PASS', ruleClass: '业务底线', details: [] },
        { name: 'A2 不泄密钥', number: 2, status: 'PASS', ruleClass: '业务底线', details: [] },
      ],
    });

    const { send, lastResponse } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 201,
      method: 'tools/call',
      params: {
        name: 'run_audit',
        arguments: { diff: 'HEAD~1..HEAD' },
      },
    });

    const resp = lastResponse();
    const text: string = resp.result.content[0].text;
    expect(text).toContain('全部审计规则通过');
    expect(text).not.toContain('本批未检查');
  });
});
