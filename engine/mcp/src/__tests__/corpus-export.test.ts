/**
 * corpus-export.test.ts — @sofagent/mcp corpus_export tool 协议面测试
 * 覆盖：JSON-RPC tools/call 全链路（initialize → dispatch → @sofagent/audit 真实导出面）
 * 验收：CLI + MCP 双入口（changelog 第一章验收第 6 条的 MCP 半边）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 动态读取 package.json 版本号（在 mock 之前读取真实 fs）──
const pkgVersion = (() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realFs = require('fs');
  const realPath = require('path');
  return JSON.parse(realFs.readFileSync(realPath.join(__dirname, '../../package.json'), 'utf-8')).version;
})();

// ── 仓库根（方法论段走真实 FDE/GUIDE.md 锚点解析——vitest cwd 是 engine/mcp，
//    不设 SOFAGENT_REPO_ROOT 则 GUIDE 找不到、sections 恒空。
//    __tests__ → src → mcp → engine → 仓库根，共四级）──
const REPO_ROOT = require('path').join(__dirname, '..', '..', '..', '..');

// ── 真实 fs/promises（'fs' 已 mock——临时 HMAC 密钥写入须走未 mock 通道）──
const realFsp = require('fs/promises');

// ── Mock fs（只 mock mcp-server 侧依赖的表面方法；导出内部用 audit 包真实现）──
vi.mock('fs', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
  };
});

// ── Mock @sofagent/audit 的常规面（corpus 导出面留真实实现）──
vi.mock('@sofagent/audit', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    parseDiff: vi.fn(() => []),
    checkLogs: vi.fn(() => []),
    runRules: vi.fn(() => ({ exitCode: 0, rules: [] })),
    loadConfig: vi.fn(() => ({})),
    loadHistory: vi.fn(() => []),
    VERSION: pkgVersion,
  };
});

vi.mock('@sofagent/think', () => ({
  generateThinkEntry: vi.fn(() => ''),
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

  send({ jsonrpc: '2.0', id: 1, method: 'initialize' });

  // 异步 handler 排空用：等 stdout 写入稳定（tools/call 异步导出后写响应）
  const flush = () => new Promise<void>((r) => setTimeout(r, 50));

  return { send, lastResponse, flush };
}

describe('MCP corpus_export — 训练语料导出三件套（协议面）', () => {
  let savedKeyPath: string | undefined;

  beforeEach(async () => {
    vi.restoreAllMocks();
    // 方法论段走真实 GUIDE 锚点解析（exportMethodology 读 SOFAGENT_REPO_ROOT）
    process.env.SOFAGENT_REPO_ROOT = REPO_ROOT;
    // 临时 HMAC 密钥（隔离真实密钥——train-audit.test 同款纪律。
    // CI 无 ~/.sofagent-key，不设则 hmac=null → .toMatch() 报 typeof null=object）
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const keyPath = require('path').join(require('os').tmpdir(), `sofagent-corpus-key-${process.pid}`);
    await realFsp.writeFile(keyPath, 'test-corpus-export-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterEach(async () => {
    delete process.env.SOFAGENT_REPO_ROOT;
    // 还原密钥路径并清理临时密钥（不动真实 ~/.sofagent-key）
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    await realFsp.rm(
      require('path').join(require('os').tmpdir(), `sofagent-corpus-key-${process.pid}`),
      { force: true },
    );
  });

  it('rules_only 模式：27 编号位 + verifiers 三桶经 JSON-RPC 返回', async () => {
    const { send, lastResponse, flush } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: 'corpus_export',
        arguments: { scope: 'all', rules_only: true },
      },
    });

    await flush();
    const res = lastResponse();
    expect(res.id).toBe(100);
    expect(res.error).toBeUndefined();

    // text = 人类可读摘要；结构化面在 _meta.data
    const text = res.result?.content?.[0]?.text ?? '';
    expect(text).toContain('编号位');
    const d = res.result?._meta?.data ?? {};
    expect(d.ok).toBe(true);
    // 27 编号位（24 实现 + 3 跳号占位）
    expect(d.rules.counts.totalSlots).toBe(27);
    expect(d.rules.counts.implemented).toBe(24);
    expect(d.rules.counts.mergedPlaceholders).toBe(3);
    // verifiers 三桶（机器可判 22 / 需人审 4 / 启发式 1）
    expect(d.verifiers.buckets.machine).toBe(22);
    expect(d.verifiers.buckets.human).toBe(4);
    expect(d.verifiers.buckets.heuristic).toBe(1);
    // HMAC 签名在场（32 位十六进制）
    expect(d.rules.hmac).toMatch(/^[0-9a-f]{32}$/);
  });

  it('完整三件套：五源样本 + 方法论一并返回（absentSources 显式登记）', async () => {
    const { send, lastResponse, flush } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'corpus_export',
        arguments: { scope: 'all' },
      },
    });

    await flush();
    const res = lastResponse();
    const d = res.result?._meta?.data ?? {};
    expect(d.ok).toBe(true);
    // 方法论三段（真实 GUIDE 锚点解析——未 mock fs 读，走真文件）
    expect(d.methodology?.sections?.length).toBeGreaterThanOrEqual(3);
    // 样本面：本机 data/ 无数据时五源全缺席但显式登记（非静默空）
    expect(d.samples).toBeTruthy();
    expect(Array.isArray(d.samples.absentSources)).toBe(true);
  });

  it('无参数调用：全可选参数缺省即全量导出', async () => {
    const { send, lastResponse, flush } = await startServer();
    send({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: { name: 'corpus_export', arguments: {} },
    });

    await flush();
    const res = lastResponse();
    const d = res.result?._meta?.data ?? {};
    expect(d.ok).toBe(true);
    expect(d.rules.counts.totalSlots).toBe(27);
  });
});
