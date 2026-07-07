#!/usr/bin/env node
// ============================================================
// mcp-server.ts · MCP Server (Model Context Protocol)
// v0.99.8: 从 @sofagent/audit 拆分为独立包 @sofagent/mcp
//
// 协议：https://spec.modelcontextprotocol.io/
// 传输：stdio（stdin/stdout，每行一个 JSON-RPC 消息）
//
// 暴露能力：
//   Tools（可调用）:
//     1. run_audit   — 对 git diff 跑全量审计规则
//     2. get_think   — 读取 think.md 最新反思条目
//     3. write_think — 追加一条反思到 think.md
//
//   Resources（可读取）:
//     1. think://latest       — think.md 最后一条条目
//     2. logs://today         — 今日任务日志
//     3. audit://last-report  — 最近一次审计报告
//
// 用法：
//   直接启动:  sofagent-mcp
//   MCP Client 配置:
//     {
//       "mcpServers": {
//         "sofagent": {
//           "command": "node",
//           "args": ["/path/to/dist/mcp-server.js"]
//         }
//       }
//     }
// ============================================================

import * as readline from 'readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

import {
  parseDiff,
  checkLogs,
  runRules,
  loadConfig,
  generateThinkEntry,
  loadHistory,
  VERSION,
} from '@sofagent/audit';
import type { AuditResult } from '@sofagent/audit';

// ============================================================
// 类型定义
// ============================================================

const SERVER_NAME = 'sofagent-mcp';
const SERVER_VERSION = VERSION; // 从 @sofagent/audit 共享 SSOT
const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ============================================================
// MCP Server 核心
// ============================================================

class McpServer {
  private initialized = false;

  /**
   * 启动 MCP Server — 监听 stdin，输出到 stdout
   */
  start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
      crlfDelay: Infinity,
    });

    // 重要：MCP Server 的日志不能写到 stdout（会污染 JSON-RPC 流）
    // 所有日志输出到 stderr
    process.stderr.write(`[${SERVER_NAME}] v${SERVER_VERSION} started\n`);
    process.stderr.write(`[${SERVER_NAME}] Waiting for JSON-RPC messages on stdin...\n`);

    // 防止超大输入导致 OOM（单行上限 10MB）
    const MAX_LINE_LENGTH = 10 * 1024 * 1024;
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.length > MAX_LINE_LENGTH) {
        process.stderr.write(`[${SERVER_NAME}] Line too long (${trimmed.length} chars), skipping\n`);
        return;
      }

      try {
        const request = JSON.parse(trimmed) as JsonRpcRequest;
        this.handleRequest(request).catch((err) => {
          this.sendError(request.id, -32603, 'Internal error', err.message);
        });
      } catch {
        // JSON 解析失败——不发送 response（id 未知）
        process.stderr.write(`[${SERVER_NAME}] Invalid JSON: ${trimmed.slice(0, 100)}\n`);
      }
    });

    rl.on('close', () => {
      process.stderr.write(`[${SERVER_NAME}] stdin closed, shutting down\n`);
      process.exit(0);
    });
  }

  /**
   * 处理单个 JSON-RPC 请求
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;

    switch (method) {
      // === 生命周期 ===
      case 'initialize':
        this.handleInitialize(id, params);
        break;
      case 'initialized':
        // 通知——无需响应
        break;
      case 'shutdown':
        this.sendResult(id, null);
        break;
      case 'exit':
        process.exit(0);
        break;

      // === 工具 ===
      case 'tools/list':
        if (!this.checkInitialized(id)) break;
        this.handleToolsList(id);
        break;
      case 'tools/call':
        if (!this.checkInitialized(id)) break;
        await this.handleToolsCall(id, params);
        break;

      // === 资源 ===
      case 'resources/list':
        if (!this.checkInitialized(id)) break;
        this.handleResourcesList(id);
        break;
      case 'resources/read':
        if (!this.checkInitialized(id)) break;
        this.handleResourcesRead(id, params);
        break;

      // === Ping ===
      case 'ping':
        this.sendResult(id, {});
        break;

      default:
        this.sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  private checkInitialized(id: number | string | null): boolean {
    if (!this.initialized) {
      // JSON-RPC 2.0: 通知消息（id 为 null）不应收到响应
      if (id !== null) {
        this.sendError(id, -32002, 'Server not initialized. Call "initialize" first.');
      }
      return false;
    }
    return true;
  }

  // ============================================================
  // initialize
  // ============================================================
  private handleInitialize(id: number | string | null, _params: unknown): void {
    // 幂等守卫：如果已经初始化过，不发送重复响应
    if (this.initialized) {
      process.stderr.write(`[${SERVER_NAME}] Already initialized, ignoring duplicate initialize request\n`);
      return;
    }
    this.initialized = true;
    this.sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
    });
    process.stderr.write(`[${SERVER_NAME}] Initialized\n`);
  }

  // ============================================================
  // tools/list
  // ============================================================
  private handleToolsList(id: number | string | null): void {
    this.sendResult(id, {
      tools: [
        {
          name: 'run_audit',
          description: '对 git diff 范围运行 sofagent 全量审计规则（A1-A11 + E1-E4）。返回结构化审计报告。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              diff: {
                type: 'string',
                description: 'git diff 范围（如 HEAD~1..HEAD）。默认 HEAD~1..HEAD',
                default: 'HEAD~1..HEAD',
              },
              task: {
                type: 'string',
                description: '任务描述（用于 A3 不改越界检查）',
              },
              strict: {
                type: 'boolean',
                description: '严格模式：无日志时 A7/A8 返回 FAIL 而非 WARN',
                default: false,
              },
              silent: {
                type: 'boolean',
                description: '沉默模式：跳过日志依赖规则，走 diff 启发式回退',
                default: false,
              },
            },
          },
        },
        {
          name: 'get_think',
          description: '读取 think.md 的最新反思条目。返回最后一条 ## 开头的反思记录，含审计结果、教训、改动范围。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              count: {
                type: 'number',
                description: '返回最近 N 条反思条目（默认 1）',
                default: 1,
              },
            },
          },
        },
        {
          name: 'write_think',
          description: '向 think.md 追加一条手动反思记录。用于 Agent 主动记录经验教训。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              lesson: {
                type: 'string',
                description: '反思内容 / 教训描述',
              },
              task: {
                type: 'string',
                description: '关联的任务名称（可选）',
              },
            },
            required: ['lesson'],
          },
        },
      ],
    });
  }

  // ============================================================
  // tools/call
  // ============================================================
  private async handleToolsCall(id: number | string | null, params?: Record<string, unknown>): Promise<void> {
    if (typeof params?.name !== 'string') {
      this.sendError(id, -32602, 'Invalid params: missing or non-string "name"');
      return;
    }
    const toolName = params.name;
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    switch (toolName) {
      case 'run_audit':
        await this.toolRunAudit(id, args);
        break;
      case 'get_think':
        this.toolGetThink(id, args);
        break;
      case 'write_think':
        this.toolWriteThink(id, args);
        break;
      default:
        this.sendError(id, -32602, `Unknown tool: ${toolName}`);
    }
  }

  /**
   * Tool: run_audit
   * 复用 parseDiff → checkLogs → runRules 全链路
   */
  private async toolRunAudit(id: number | string | null, args: Record<string, unknown>): Promise<void> {
    const diffRange = (args.diff as string) || 'HEAD~1..HEAD';
    const task = args.task as string | undefined;
    const strict = (args.strict as boolean) ?? false;
    const silent = (args.silent as boolean) ?? false;

    // 1. 解析 git diff
    const diffFiles = parseDiff(diffRange);
    if (diffFiles.length === 0) {
      this.sendToolResult(id, {
        type: 'text',
        text: '没有文件变更，无需审计。',
        data: { exitCode: 0, rules: [], fileCount: 0 },
      });
      return;
    }

    // 2. 读取任务日志
    const logEntries = checkLogs();

    // 3. commit message（用于 E2/A5 回退）
    let commitMsg = '';
    try {
      commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf-8' }).trim();
    } catch {
      // 非 git 仓库或无提交记录——正常情况，不报错
    }

    // 4. 加载审计配置
    const config = loadConfig();

    // 5. 运行规则
    const results = runRules(diffFiles, logEntries, task, strict, silent, commitMsg, config);

    // 6. 自动生成 think.md 条目
    try {
      generateThinkEntry(diffFiles, results, task);
    } catch {
      // think 生成失败不影响审计结果
      process.stderr.write(`[${SERVER_NAME}] 警告: think.md 反思生成失败，跳过\n`);
    }

    // 7. 格式化输出
    const triggeredRules = results.rules.filter((r: AuditResult['rules'][number]) => r.status !== 'PASS');
    const verdict = results.exitCode === 0 ? 'PASS' : results.exitCode === 1 ? 'WARN' : 'FAIL';

    const lines: string[] = [];
    lines.push(`[sofagent-audit] 扫描 ${diffFiles.length} 个变更文件`);
    lines.push(`判定: ${verdict}（exit code ${results.exitCode}）`);
    lines.push('');

    for (const rule of triggeredRules) {
      const icon = rule.status === 'WARN' ? 'WARN' : 'FAIL';
      const classTag = rule.ruleClass === '业务底线' ? '[底线]' : '[拐杖]';
      for (const detail of rule.details) {
        lines.push(`${icon} ${rule.name} ${classTag}: ${detail}`);
      }
    }

    if (triggeredRules.length === 0) {
      lines.push('全部审计规则通过。');
    }

    this.sendToolResult(id, {
      type: 'text',
      text: lines.join('\n'),
      data: {
        exitCode: results.exitCode,
        verdict,
        fileCount: diffFiles.length,
        triggeredRules: triggeredRules.map((r: AuditResult['rules'][number]) => ({
          name: r.name,
          status: r.status,
          ruleClass: r.ruleClass,
        })),
        allRules: results.rules.map((r: AuditResult['rules'][number]) => ({
          name: r.name,
          status: r.status,
        })),
      },
    });
  }

  /**
   * Tool: get_think
   * 读取 think.md 最近 N 条反思条目
   */
  private toolGetThink(id: number | string | null, args: Record<string, unknown>): void {
    const count = (args.count as number) ?? 1;
    const dataDir = getSofagentDataDir();
    const thinkPath = join(dataDir, 'think.md');

    if (!existsSync(thinkPath)) {
      this.sendToolResult(id, {
        type: 'text',
        text: 'think.md 不存在。运行审计后会自动生成反思条目。',
        data: { entries: [] },
      });
      return;
    }

    const content = readFileSync(thinkPath, 'utf-8');
    const entries = content.split('\n## ').filter((s) => s.trim());

    // 取最近 count 条
    const recent = entries.slice(-count);

    // 补回 ## 前缀
    const formatted = recent.map((e) => (e.startsWith('## ') ? e : '## ' + e));

    this.sendToolResult(id, {
      type: 'text',
      text: formatted.join('\n\n') || '(无反思条目)',
      data: {
        totalEntries: entries.length,
        returned: recent.length,
      },
    });
  }

  /**
   * Tool: write_think
   * 向 think.md 追加一条手动反思
   */
  private toolWriteThink(id: number | string | null, args: Record<string, unknown>): void {
    if (typeof args.lesson !== 'string' || !args.lesson) {
      this.sendError(id, -32602, 'Missing or invalid required argument: lesson');
      return;
    }
    // 清洗 lesson 内容——防止注入 think.md 结构（截断 ## 标题注入 + 长度上限）
    const MAX_LESSON_LENGTH = 10000;
    let lesson = args.lesson;
    if (lesson.length > MAX_LESSON_LENGTH) {
      lesson = lesson.slice(0, MAX_LESSON_LENGTH);
    }
    // 去除换行——防止 lesson 内容注入新的 ## 条目标题
    lesson = lesson.replace(/[\r\n]+/g, ' ').trim();

    const task = (args.task as string) || '(手动记录)';
    const dataDir = getSofagentDataDir();
    const thinkPath = join(dataDir, 'think.md');

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const entry = `\n## ${timestamp} 任务: ${task}\n\n- #教训: ${lesson}\n\n`;

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    appendFileSync(thinkPath, entry, 'utf-8');

    this.sendToolResult(id, {
      type: 'text',
      text: `已追加反思到 think.md: "${lesson}"`,
      data: { timestamp, task, lesson },
    });
  }

  // ============================================================
  // resources/list
  // ============================================================
  private handleResourcesList(id: number | string | null): void {
    this.sendResult(id, {
      resources: [
        {
          uri: 'think://latest',
          name: '最新反思',
          description: 'think.md 最后一条反思条目',
          mimeType: 'text/markdown',
        },
        {
          uri: 'logs://today',
          name: '今日日志',
          description: '今日任务日志文件列表',
          mimeType: 'text/plain',
        },
        {
          uri: 'audit://last-report',
          name: '最近审计报告',
          description: '.sofagent/ 下最近一次审计历史记录',
          mimeType: 'application/json',
        },
        {
          uri: 'orchestrator://latest-comparison',
          name: 'Latest A/B Comparison',
          description: '最近一次编排 A/B 对比报告',
          mimeType: 'text/markdown',
        },
      ],
    });
  }

  // ============================================================
  // resources/read
  // ============================================================
  private handleResourcesRead(id: number | string | null, params?: Record<string, unknown>): void {
    const uri = params?.uri as string;
    if (!uri) {
      this.sendError(id, -32602, 'Missing required parameter: uri');
      return;
    }

    switch (uri) {
      case 'think://latest':
        this.resourceReadThinkLatest(id);
        break;
      case 'logs://today':
        this.resourceReadLogsToday(id);
        break;
      case 'audit://last-report':
        this.resourceReadAuditHistory(id);
        break;
      case 'orchestrator://latest-comparison':
        this.resourceReadLatestComparison(id);
        break;
      default:
        this.sendError(id, -32602, `Unknown resource URI: ${uri}`);
    }
  }

  /**
   * Resource: think://latest — 读取 think.md 最后一条条目
   */
  private resourceReadThinkLatest(id: number | string | null): void {
    const dataDir = getSofagentDataDir();
    const thinkPath = join(dataDir, 'think.md');

    if (!existsSync(thinkPath)) {
      this.sendResult(id, {
        contents: [
          {
            uri: 'think://latest',
            mimeType: 'text/markdown',
            text: '(think.md 不存在)',
          },
        ],
      });
      return;
    }

    const content = readFileSync(thinkPath, 'utf-8');
    const entries = content.split('\n## ').filter((s) => s.trim());
    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

    this.sendResult(id, {
      contents: [
        {
          uri: 'think://latest',
          mimeType: 'text/markdown',
          text: lastEntry ? (lastEntry.startsWith('## ') ? lastEntry : '## ' + lastEntry) : '(无条目)',
        },
      ],
    });
  }

  /**
   * Resource: logs://today — 今日任务日志文件列表
   */
  private resourceReadLogsToday(id: number | string | null): void {
    const dataDir = getSofagentDataDir();
    const logsDir = join(dataDir, 'task', 'logs');

    if (!existsSync(logsDir)) {
      this.sendResult(id, {
        contents: [
          {
            uri: 'logs://today',
            mimeType: 'text/plain',
            text: '(日志目录不存在)',
          },
        ],
      });
      return;
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    let files: string[];
    try {
      files = readdirSync(logsDir).filter((f) => {
        if (!f.endsWith('.md') && !f.endsWith('.jsonl')) return false;
        try {
          const stat = statSync(join(logsDir, f));
          const fileDate = `${stat.mtime.getFullYear()}-${String(stat.mtime.getMonth() + 1).padStart(2, '0')}-${String(stat.mtime.getDate()).padStart(2, '0')}`;
          return fileDate === todayStr;
        } catch {
          return false;
        }
      });
    } catch {
      files = [];
    }

    if (files.length === 0) {
      this.sendResult(id, {
        contents: [
          {
            uri: 'logs://today',
            mimeType: 'text/plain',
            text: `(今日 ${todayStr} 无任务日志)`,
          },
        ],
      });
      return;
    }

    // 合并今日所有日志内容
    const parts: string[] = [`=== 今日任务日志 (${todayStr}) ===\n`];
    for (const file of files) {
      try {
        const content = readFileSync(join(logsDir, file), 'utf-8');
        parts.push(`--- ${file} ---\n${content}\n`);
      } catch {
        // 跳过
      }
    }

    this.sendResult(id, {
      contents: [
        {
          uri: 'logs://today',
          mimeType: 'text/plain',
          text: parts.join('\n'),
        },
      ],
    });
  }

  /**
   * Resource: audit://last-report — 最近审计历史记录
   * 通过 @sofagent/audit 的 loadHistory() 读取 audit/history.jsonl
   */
  private resourceReadAuditHistory(id: number | string | null): void {
    const entries = loadHistory(1);

    if (entries.length === 0) {
      this.sendResult(id, {
        contents: [
          {
            uri: 'audit://last-report',
            mimeType: 'application/json',
            text: JSON.stringify({ message: '无审计历史记录。运行审计后会自动生成。' }),
          },
        ],
      });
      return;
    }

    this.sendResult(id, {
      contents: [
        {
          uri: 'audit://last-report',
          mimeType: 'application/json',
          text: JSON.stringify(entries[0], null, 2),
        },
      ],
    });
  }

  /**
   * Resource: orchestrator://latest-comparison — 最新 A/B 对比报告
   */
  private resourceReadLatestComparison(id: number | string | null): void {
    const dataDir = getSofagentDataDir();
    const compDir = join(dataDir, 'orchestrator', 'comparisons');

    if (!existsSync(compDir)) {
      this.sendResult(id, { contents: [{ uri: 'orchestrator://latest-comparison', mimeType: 'text/markdown', text: 'No comparison data yet.' }] });
      return;
    }
    let files: string[];
    try { files = readdirSync(compDir).filter((f) => f.endsWith('.md')).sort(); } catch {
      this.sendResult(id, { contents: [{ uri: 'orchestrator://latest-comparison', mimeType: 'text/markdown', text: 'No comparison data yet.' }] });
      return;
    }
    if (files.length === 0) {
      this.sendResult(id, { contents: [{ uri: 'orchestrator://latest-comparison', mimeType: 'text/markdown', text: 'No comparison data yet.' }] });
      return;
    }
    const content = readFileSync(join(compDir, files[files.length - 1]!), 'utf-8');
    this.sendResult(id, { contents: [{ uri: 'orchestrator://latest-comparison', mimeType: 'text/markdown', text: content }] });
  }

  // ============================================================
  // JSON-RPC 工具方法
  // ============================================================

  /**
   * 发送成功响应
   */
  private sendResult(id: number | string | null, result: unknown): void {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, result };
    this.writeLine(JSON.stringify(response));
  }

  /**
   * 发送错误响应
   */
  private sendError(id: number | string | null, code: number, message: string, data?: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    };
    this.writeLine(JSON.stringify(response));
  }

  /**
   * 发送 Tool 调用结果
   */
  private sendToolResult(id: number | string | null, payload: { type: string; text: string; data?: unknown }): void {
    this.sendResult(id, {
      content: [
        {
          type: payload.type,
          text: payload.text,
        },
      ],
      ...(payload.data !== undefined ? { _meta: { data: payload.data } } : {}),
    });
  }

  /**
   * 写一行到 stdout（JSON-RPC 传输层）
   */
  private writeLine(line: string): void {
    process.stdout.write(line + '\n');
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取 {SOFAGENT_DATA} 目录
 * 与 think-generator.ts 中的 getSofagentDataDir 保持一致
 */
function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), '.sofagent');
}

// ============================================================
// 启动
// ============================================================

const server = new McpServer();
server.start();
