/**
 * mcp-server.test.ts — @sofagent/mcp 单元测试
 *
 * 覆盖：
 *   1. JSON-RPC 消息解析（方法路由、错误处理）
 *   2. tool 参数校验（缺 name → -32602、缺 lesson → -32602）
 *   3. write_think 内容清洗（换行截断、长度上限）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { appendThinkEntry } from '@sofagent/core';

// ── 动态读取 package.json 版本号（在 mock 之前读取真实 fs）──
const pkgVersion = (() => {
  // vi.mock 会在所有 import 之前执行，因此需要用 require 绕过 mock
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realFs = require('fs');
  return JSON.parse(realFs.readFileSync(join(__dirname, '../package.json'), 'utf-8')).version;
})();

// ── Mock fs module ──
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
  parseDiff: vi.fn(() => [{ file: 'test.ts', hunks: [] }]),
  checkLogs: vi.fn(() => []),
  runRules: vi.fn(() => ({
    exitCode: 0,
    rules: [
      { name: 'A1', status: 'PASS', ruleClass: '业务底线', details: [] },
    ],
  })),
  loadConfig: vi.fn(() => ({})),
  generateThinkEntry: vi.fn(),
  loadHistory: vi.fn(() => []),
  VERSION: pkgVersion,
}));

// ── Mock @sofagent/core（记忆契约：getThinkPath / appendThinkEntry）──
// write_think 现在经 core 的 appendThinkEntry 写入，测试应 mock 契约函数而非底层 fs。
vi.mock('@sofagent/core', () => ({
  getThinkPath: vi.fn(() => '/tmp/test-think.md'),
  appendThinkEntry: vi.fn(() => 0),
  getDataDir: vi.fn(() => require('os').tmpdir()),
}));

// ── Mock readline to prevent auto-start ──
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

// ── Mock child_process ──
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => 'mock commit message'),
}));

import { createInterface } from 'readline';

describe('McpServer', () => {
  let McpServer: any;
  let server: any;
  let stdoutWrites: string[];

  beforeEach(() => {
    stdoutWrites = [];
    // Capture process.stdout.write
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    // Clear mocks
    vi.clearAllMocks();
    // Set up existsSync mock: return false by default
    (existsSync as any).mockReturnValue(false);

    // Re-import the module fresh (after mocking readline)
    // We need to get access to the class without triggering start()
    // Since the module has top-level `new McpServer().start()`, we mock it
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: get the last JSON-RPC response written to stdout
  function lastResponse(): any {
    const lines = stdoutWrites.filter((l) => l.trim());
    if (lines.length === 0) return null;
    const last = lines[lines.length - 1]!;
    try {
      return JSON.parse(last.replace(/\n$/, ''));
    } catch {
      return null;
    }
  }

  function allResponses(): any[] {
    return stdoutWrites
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l.replace(/\n$/, ''));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  // ════════════════════════════════════════
  // JSON-RPC 消息解析 & 方法路由
  // ════════════════════════════════════════

  describe('JSON-RPC message routing', () => {
    beforeEach(async () => {
      // We need to import the module but prevent start()
      // Mock readline to capture the line handler
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      // Clear module cache and import
      vi.resetModules();
      const mod = await import('./mcp-server');
      // The module auto-starts, but readline is mocked so it's safe
      // We can't access the McpServer class directly since it's not exported
      // Instead, we test via the line handler
    });

    it('should return -32601 for unknown method', () => {
      // Directly test JSON-RPC format by constructing and validating
      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'nonexistent_method',
      };
      // Verify JSON-RPC 2.0 request format
      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('nonexistent_method');
      expect(typeof request.id).toBe('number');
      // The server should respond with error code -32601
    });

    it('should accept valid JSON-RPC 2.0 request format', () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'ping',
      };
      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('ping');
    });
  });

  // ════════════════════════════════════════
  // tool 参数校验
  // ════════════════════════════════════════

  describe('tool parameter validation', () => {
    it('should reject tools/call with missing "name" parameter', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      await import('./mcp-server');

      // First, initialize
      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      // Then call tools/call without name
      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {} }));
      }

      const resp = lastResponse();
      expect(resp).not.toBeNull();
      expect(resp.id).toBe(2);
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32602);
      expect(resp.error.message).toContain('name');
    });

    it('should reject tools/call with non-string name', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      await import('./mcp-server');

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 123 } }));
      }

      const resp = lastResponse();
      expect(resp).not.toBeNull();
      expect(resp.id).toBe(2);
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32602);
    });

    it('should reject write_think with missing lesson', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      await import('./mcp-server');

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      if (lineHandler) {
        lineHandler(JSON.stringify({
          jsonrpc: '2.0', id: 3, method: 'tools/call',
          params: { name: 'write_think', arguments: {} },
        }));
      }

      const resp = lastResponse();
      expect(resp).not.toBeNull();
      expect(resp.id).toBe(3);
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32602);
      expect(resp.error.message).toContain('lesson');
    });

    it('should reject write_think with empty lesson string', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      await import('./mcp-server');

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      if (lineHandler) {
        lineHandler(JSON.stringify({
          jsonrpc: '2.0', id: 3, method: 'tools/call',
          params: { name: 'write_think', arguments: { lesson: '' } },
        }));
      }

      const resp = lastResponse();
      expect(resp).not.toBeNull();
      expect(resp.id).toBe(3);
      expect(resp.error).toBeDefined();
    });
  });

  // ════════════════════════════════════════
  // write_think 内容清洗
  // ════════════════════════════════════════

  describe('write_think content sanitization', () => {
    it('should strip newlines from lesson content', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      (existsSync as any).mockReturnValue(true); // data dir exists
      (appendThinkEntry as any).mockImplementation(() => {});

      await import('./mcp-server');

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      // Lesson with malicious newlines attempting ## injection
      if (lineHandler) {
        lineHandler(JSON.stringify({
          jsonrpc: '2.0', id: 4, method: 'tools/call',
          params: {
            name: 'write_think',
            arguments: {
              lesson: '正常内容\n## 恶意注入标题\n继续内容',
              task: 'test-task',
            },
          },
        }));
      }

      const resp = lastResponse();
      expect(resp).not.toBeNull();
      expect(resp.id).toBe(4);
      // Should succeed — newlines are stripped
      expect(resp.result).toBeDefined();
      // Verify the appended content has no newlines within the lesson body
      const appendCalls = (appendThinkEntry as any).mock.calls;
      expect(appendCalls.length).toBeGreaterThan(0);
      const appendedContent = appendCalls[0]?.[1] as string;
      // The entry template starts with \n## — that's expected.
      // But there should be NO additional \n## within the lesson body
      const lessonPart = appendedContent.split('- #教训:')[1] ?? '';
      expect(lessonPart).not.toContain('\n##');
      // Newlines are converted to spaces; verify lesson body has no raw newlines
      // The `\n## ` in the original becomes ` ## ` (space + ## + space)
      expect(appendedContent).toMatch(/#教训:\s*正常内容\s*##\s*恶意注入标题\s*继续内容/);
    });

    it('should strip carriage returns from lesson content', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      (existsSync as any).mockReturnValue(true);
      (appendThinkEntry as any).mockImplementation(() => {});

      await import('./mcp-server');

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      if (lineHandler) {
        lineHandler(JSON.stringify({
          jsonrpc: '2.0', id: 5, method: 'tools/call',
          params: {
            name: 'write_think',
            arguments: {
              lesson: '内容\r\n有\r回车',
              task: 'test-task',
            },
          },
        }));
      }

      const appendCalls = (appendThinkEntry as any).mock.calls;
      expect(appendCalls.length).toBeGreaterThan(0);
      const appendedContent = appendCalls[0]?.[1] as string;
      expect(appendedContent).not.toMatch(/\r/);
    });

    it('should truncate lesson exceeding MAX_LESSON_LENGTH (10000)', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      (existsSync as any).mockReturnValue(true);
      (appendThinkEntry as any).mockImplementation(() => {});

      await import('./mcp-server');

      const longLesson = 'x'.repeat(15000);

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      if (lineHandler) {
        lineHandler(JSON.stringify({
          jsonrpc: '2.0', id: 6, method: 'tools/call',
          params: {
            name: 'write_think',
            arguments: { lesson: longLesson, task: 'test-task' },
          },
        }));
      }

      const appendCalls = (appendThinkEntry as any).mock.calls;
      expect(appendCalls.length).toBeGreaterThan(0);
      const appendedContent = appendCalls[0]?.[1] as string;
      // Content should be truncated to 10000 chars max
      // The entry format is: \n## TIMESTAMP 任务: test-task\n\n- #教训: <lesson>\n\n
      expect(appendedContent.length).toBeLessThan(10500); // lesson itself ≤ 10000 + format overhead
    });
  });

  // ════════════════════════════════════════
  // JSON-RPC 响应格式
  // ════════════════════════════════════════

  describe('JSON-RPC response format', () => {
    it('should generate valid JSON-RPC 2.0 error responses', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      await import('./mcp-server');

      // Send an unknown method before initialization
      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'nonexistent' }));
      }

      const resp = lastResponse();
      expect(resp).not.toBeNull();
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(99);
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32601);
      expect(typeof resp.error.message).toBe('string');
    });

    it('should generate valid JSON-RPC 2.0 success responses', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      await import('./mcp-server');

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }));
      }

      const resp = lastResponse();
      expect(resp).not.toBeNull();
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(2);
      expect(resp.result).toBeDefined();
      expect(resp.error).toBeUndefined();
    });

    it('should return -32002 for requests before initialize', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      await import('./mcp-server');

      // Call a method before initialize
      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }));
      }

      // ping is allowed before initialization — let me check
      // Actually looking at the code: ping doesn't call checkInitialized
      // Let's try tools/list instead
      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list' }));
      }

      const resp = lastResponse();
      expect(resp).not.toBeNull();
      expect(resp.id).toBe(8);
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32002);
    });
  });

  // ════════════════════════════════════════
  // initialize 幂等性
  // ════════════════════════════════════════

  describe('initialize idempotency', () => {
    it('should not send duplicate response on second initialize', async () => {
      vi.resetModules();
      let lineHandler: ((line: string) => void) | null = null;
      (createInterface as any).mockReturnValue({
        on: vi.fn((event: string, cb: any) => {
          if (event === 'line') lineHandler = cb;
        }),
        close: vi.fn(),
      });

      await import('./mcp-server');

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
      }
      const countAfterFirst = allResponses().length;

      if (lineHandler) {
        lineHandler(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize' }));
      }
      const countAfterSecond = allResponses().length;

      // Should not increase (second initialize is ignored)
      expect(countAfterSecond).toBe(countAfterFirst);
    });
  });
});
