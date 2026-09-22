#!/usr/bin/env node
// ============================================================
// mcp-server.ts · MCP Server (Model Context Protocol)
// v1.5.1: 拆分为精简主文件（300+ 行，含工具注册/传输/错误处理）+ tools/ 子目录按功能分组
// v1.5.1: 从 @sofagent/audit 拆分为独立包 @sofagent/mcp
//
// 协议：https://spec.modelcontextprotocol.io/
// 传输：stdio（stdin/stdout，每行一个 JSON-RPC 消息）
// ============================================================
import * as readline from 'readline';
import { VERSION, loadConfig } from '@sofagent/audit';
import type { AuditResult } from '@sofagent/audit';

// tool registry (schemas)
import { TOOLS } from './tool-registry';
// v1.4.0: 工具角色分层
import { getActiveRoles, filterToolsByRoles, isToolExposed } from './tool-roles';

// resources
import { listResources, readResource } from './resources';
// dynamic tools（memory_backends 注册——运行时合并，不污染静态 TOOLS）
import { getDynamicTools, getDynamicTool, registerMemoryBackends } from './tools/memory-backend';
// L4 进化工具动态面桥（orchestrator 台账 → 动态面——启动时接线）
import { registerEvolvedTools } from './tools/evolution-dynamic-bridge';
// v1.5.0 TASK-26：tools/call 前置权限守卫（opt-in——SOFAGENT_PERMISSION_GUARD=1）
import { guardToolCall, isPermissionGuardEnabled } from './tools/permission-guard';
// 工具结果类型（sendTool 消费面）
import { type ToolResult } from './tools/audit-tools';

// ============================================================
// 常量
// ============================================================

const SERVER_NAME = 'sofagent-mcp';
const SERVER_VERSION = VERSION;
const PROTOCOL_VERSION = '2024-11-05';
const MAX_LINE_LENGTH = 10 * 1024 * 1024;

// ============================================================
// 类型
// ============================================================

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

type ToolError = { error: string };
type ToolOutcome = ToolResult | ToolError;
function isToolError(r: unknown): r is ToolError {
  return typeof r === 'object' && r !== null && 'error' in r && !('text' in r);
}

// ============================================================
// MCP Server
// ============================================================

class McpServer {
  private initialized = false;

  start(): void {
    // v1.3.0 (交付 10 MA1)：启动时读 memory_backends 注册动态工具——优雅降级不 crash
    void registerMemoryBackends().catch((err) => {
      process.stderr.write(`[${SERVER_NAME}] memory_backends 注册失败（不影响主流程）: ${err instanceof Error ? err.message : String(err)}\n`);
    });

    // v1.5.0：L4 进化工具接线——启动时读 orchestrator 台账注册动态面
    // （台账空则零注册、幂等；动态 import 避免编译期强耦合，失败降级不 crash）
    void import('@sofagent/orchestrator')
      .then(({ getApprovedEvolvedTools }) => {
        const registered = registerEvolvedTools({
          getTools: () => getApprovedEvolvedTools(),
          loadGenerator: (p) => require(p),
        });
        if (registered.length > 0) {
          process.stderr.write(`[${SERVER_NAME}] L4 进化工具注册 ${registered.length} 个: ${registered.join(', ')}\n`);
        }
      })
      .catch((err) => {
        process.stderr.write(`[${SERVER_NAME}] L4 进化工具注册失败（不影响主流程）: ${err instanceof Error ? err.message : String(err)}\n`);
      });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false, crlfDelay: Infinity });
    process.stderr.write(`[${SERVER_NAME}] v${SERVER_VERSION} started\n`);
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > MAX_LINE_LENGTH) {
        if (trimmed.length > MAX_LINE_LENGTH) process.stderr.write(`[${SERVER_NAME}] Line too long, skipping\n`);
        return;
      }
      try {
        const request = JSON.parse(trimmed) as JsonRpcRequest;
        this.handleRequest(request).catch((err) => {
          this.sendError(request.id, -32603, 'Internal error', err.message);
        });
      } catch {
        process.stderr.write(`[${SERVER_NAME}] Invalid JSON: ${trimmed.slice(0, 100)}\n`);
      }
    });
    rl.on('close', () => { process.stderr.write(`[${SERVER_NAME}] shutting down\n`); process.exit(0); });
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;
    const isNotification = id === null || id === undefined || method.startsWith('notifications/');
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (isNotification) return;

    switch (method) {
      case 'initialize': this.handleInitialize(id); break;
      case 'shutdown': this.sendResult(id, null); break;
      case 'exit': process.exit(0); break;
      case 'tools/list': if (this.checkInit(id)) {
        // v1.3.0 (交付 10 MA1)：动态工具合并——不污染静态 TOOLS 清单
        // v1.4.0：角色分层过滤——默认全量（未配置/all），SOFAGENT_MCP_ROLES 显式收窄专职面
        const activeRoles = getActiveRoles();
        this.sendResult(id, { tools: filterToolsByRoles([...TOOLS, ...getDynamicTools()], activeRoles) });
      } break;
      case 'tools/call': if (this.checkInit(id)) await this.handleToolsCall(id, params); break;
      case 'resources/list': if (this.checkInit(id)) this.sendResult(id, listResources()); break;
      case 'resources/read': if (this.checkInit(id)) this.handleResourcesRead(id, params); break;
      case 'ping': this.sendResult(id, {}); break;
      default: this.sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  private checkInit(id: number | string | null): boolean {
    if (!this.initialized) { if (id !== null) this.sendError(id, -32002, 'Server not initialized. Call "initialize" first.'); return false; }
    return true;
  }

  private handleInitialize(id: number | string | null): void {
    if (this.initialized) { process.stderr.write(`[${SERVER_NAME}] Already initialized\n`); return; }
    this.initialized = true;
    this.sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
    });
    process.stderr.write(`[${SERVER_NAME}] Initialized\n`);
  }

  // ── tools/call ──

  private async handleToolsCall(id: number | string | null, params?: Record<string, unknown>): Promise<void> {
    if (typeof params?.name !== 'string') { this.sendError(id, -32602, 'Invalid params: missing or non-string "name"'); return; }
    const toolName = params.name;
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    try {
      // v1.5.0 TASK-26：权限守卫前置判定（opt-in）——risk 定级 → policy 判定 →
      // deny/human-approval 拦截（守卫先于事件分发；未启用时直通零开销）
      if (isPermissionGuardEnabled()) {
        const verdict = await guardToolCall(toolName);
        if (!verdict.allowed) {
          this.sendError(id, -32602, verdict.blockReason ?? '权限守卫拦截');
          return;
        }
      }

      // v1.3.0 (交付 10 MA1)：动态工具优先路由（memory_backends 注册的工具）
      const dynamicTool = getDynamicTool(toolName);
      if (dynamicTool) {
        const r = await dynamicTool.handler(args);
        this.sendTool(id, { text: `[sofagent] ${toolName} 调用完成`, data: r });
        return;
      }

      // v1.4.0：角色分层拦截——静态工具不在当前角色集时明确拒绝（防模型猜到隐藏工具名硬调）
      const activeRoles = getActiveRoles();
      const staticTool = TOOLS.find((t) => t.name === toolName);
      if (staticTool && activeRoles !== null && !isToolExposed(staticTool.roles, activeRoles)) {
        this.sendError(id, -32602, `工具 ${toolName} 未在当前角色集（${activeRoles.join(',')}）暴露——设 ${'SOFAGENT_MCP_ROLES'}=all 恢复全量`);
        return;
      }

      // v1.4.8 深模块条目 5：查表分发——registry handler 为唯一分发源（原 switch 已退场）
      // 同步 handler 不经 await（保持原 switch 的同步时序——smoke/mcp-server 测试断言响应即时落盘）
      if (staticTool?.handler) {
        const r = staticTool.handler(args, { pushAuditWebhook: this.pushAuditWebhook.bind(this) });
        if (r instanceof Promise) {
          const rr = await r;
          this.sendTool(id, rr, 'error' in rr ? undefined : rr.isError);
        } else {
          this.sendTool(id, r, 'error' in r ? undefined : r.isError);
        }
        return;
      }
      this.sendError(id, -32602, `Unknown tool: ${toolName}`);
    } catch (err) {
      this.sendTool(id, { text: `[sofagent] 工具执行出错: ${err instanceof Error ? err.message : String(err)}`, data: { error: true } });
    }
  }

  // ── resources/read ──

  private handleResourcesRead(id: number | string | null, params?: Record<string, unknown>): void {
    const uri = params?.uri as string;
    if (!uri) { this.sendError(id, -32602, 'Missing required parameter: uri'); return; }
    const result = readResource(uri);
    if ('error' in result) { this.sendError(id, -32602, result.error); return; }
    this.sendResult(id, { contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }] });
  }

  // ── JSON-RPC helpers ──

  private sendResult(id: number | string | null, result: unknown): void {
    this.writeLine(JSON.stringify({ jsonrpc: '2.0', id, result } as JsonRpcResponse));
  }

  private sendError(id: number | string | null, code: number, message: string, data?: unknown): void {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
    this.writeLine(JSON.stringify(response));
  }

  private sendTool(id: number | string | null, result: ToolOutcome, isError?: boolean): void {
    if (isToolError(result)) { this.sendError(id, -32602, result.error); return; }
    this.sendResult(id, {
      content: [{ type: 'text', text: result.text }],
      ...((isError ?? result.isError) ? { isError: true } : {}),
      ...(result.data !== undefined ? { _meta: { data: result.data } } : {}),
    });
  }

  private async pushAuditWebhook(verdict: string, task: string | undefined, results: AuditResult): Promise<void> {
    try {
      const config = loadConfig();
      const webhookConfig = (config as unknown as Record<string, unknown>)?.['webhook'] as { enabled?: boolean; platform?: string; url?: string } | undefined;
      if (!webhookConfig?.enabled || !webhookConfig.url) return;
      const { pushAuditResult } = await import('@sofagent/audit');
      await pushAuditResult({ platform: (webhookConfig.platform as 'dingtalk' | 'feishu' | 'wecom') ?? 'dingtalk', url: webhookConfig.url, task, rules: results.rules, exitCode: results.exitCode });
    } catch { /* non-fatal */ }
  }

  private writeLine(line: string): void { process.stdout.write(line + '\n'); }
}

// ============================================================
// 启动
// ============================================================

const server = new McpServer();
server.start();
