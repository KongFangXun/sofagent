#!/usr/bin/env node
// ============================================================
// mcp-server.ts · MCP Server (Model Context Protocol)
// v1.3.3: 拆分为 ≤300 行主文件 + tools/ 子目录按功能分组
// v1.3.3: 从 @sofagent/audit 拆分为独立包 @sofagent/mcp
//
// 协议：https://spec.modelcontextprotocol.io/
// 传输：stdio（stdin/stdout，每行一个 JSON-RPC 消息）
// ============================================================
import * as readline from 'readline';
import { VERSION, loadConfig } from '@sofagent/audit';
import type { AuditResult } from '@sofagent/audit';

// tool registry (schemas)
import { TOOLS } from './tool-registry';

// resources
import { listResources, readResource } from './resources';

// audit tools
import { runAudit, type ToolResult } from './tools/audit-tools';
import { auditFile } from './tools/audit-file';
// think tools
import { getThink, writeThink, readThinkMd, readLessons } from './tools/think-tools';
// knowledge tools
import { searchKnowledge, mergeFederationAsync, readEntity, readConcept, listEntities, stats } from './tools/knowledge-tools';
// orchestrator tools
import { compose } from './tools/orchestrator-tools';
// report tools
import { listCapabilities } from './tools/report-tools';
// already-extracted tools (v1.2.4~v1.2.9)
import { queryDataSovereigntyReport } from './tools/data-sovereignty-report';
import { createEntity } from './tools/create-entity';
import { createConcept } from './tools/create-concept';
import { updateEntity } from './tools/update-entity';
import { deleteEntity } from './tools/delete-entity';
import { deleteConcept } from './tools/delete-concept';
import { validateOntology } from './tools/validate-ontology';
import { evaluateOutput } from './tools/evaluate-output';
import { optimizeSkill } from './tools/optimize-skill';
import { healthCheck } from './tools/health-check';
import { auditDataChange } from './tools/audit-data-change';
import { notifySession } from './tools/notify-session';
import { activateWorkflowTool } from './tools/activate-workflow';
import { daemonStatus } from './tools/daemon-status';
import { listAgentsTool } from './tools/list-agents';
import { listConcepts } from './tools/list-concepts';
import { hitlResolve } from './tools/hitl-resolve';
import { listRules } from './tools/list-rules';
import { agentIdentityTool } from './tools/agent-identity';
import { loopDebug } from './tools/loop-debug';
import { evaluate } from './tools/evaluate';
import { auditTrail } from './tools/audit-trail';
import { createAgent } from './tools/create-agent';
import { evalSuite } from './tools/eval-suite';
import { fdeCompose } from './tools/fde-compose';
import { routeWorkflowTool } from './tools/route-workflow';
import { teamCreate } from './tools/team-create';
import { teamBroadcast } from './tools/team-broadcast';
import { refine } from './tools/refine';
import { getDynamicTools, getDynamicTool, registerMemoryBackends } from './tools/memory-backend';
// v1.3.4 交付 1：L3 组织能力市场
import { marketPublish } from './tools/market-publish';
import { marketSearch } from './tools/market-search';
import { marketInvoke } from './tools/market-invoke';
import { marketRate } from './tools/market-rate';
import { marketRetire } from './tools/market-retire';
import { marketHarvestRule } from './tools/market-harvest-rule';

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
        this.sendResult(id, { tools: [...TOOLS, ...getDynamicTools()] });
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
      // v1.3.0 (交付 10 MA1)：动态工具优先路由（memory_backends 注册的工具）
      const dynamicTool = getDynamicTool(toolName);
      if (dynamicTool) {
        const r = await dynamicTool.handler(args);
        this.sendTool(id, { text: `[sofagent] ${toolName} 调用完成`, data: r });
        return;
      }

      switch (toolName) {
        case 'run_audit': { const r = runAudit(args, this.pushAuditWebhook.bind(this)); this.sendTool(id, r); break; }
        case 'get_think': { const r = getThink(args); this.sendTool(id, r); break; }
        case 'write_think': { const r = writeThink(args); this.sendTool(id, r); break; }
        case 'sofagent_compose': { const r = await compose(args); this.sendTool(id, r); break; }
        case 'audit_file': { const r = auditFile(args, this.pushAuditWebhook.bind(this)); this.sendTool(id, r); break; }
        case 'search_knowledge': { const r = searchKnowledge(args); this.sendTool(id, r); void mergeFederationAsync(args.query as string); break; }
        case 'read_entity': { const r = readEntity(args); this.sendTool(id, r); break; }
        case 'read_concept': { const r = readConcept(args); this.sendTool(id, r); break; }
        case 'list_entities': { const r = listEntities(args); this.sendTool(id, r); break; }
        case 'read_lessons': { this.sendTool(id, readLessons()); break; }
        case 'read_think_md': { this.sendTool(id, readThinkMd()); break; }
        case 'stats': { this.sendTool(id, stats()); break; }
        case 'list_capabilities': { this.sendTool(id, listCapabilities()); break; }
        case 'data_sovereignty_report': { try { const r = queryDataSovereigntyReport({ date: args.date as string | undefined }); this.sendTool(id, r); } catch (e) { this.sendTool(id, { text: `[sofagent] 数据主权审计查询失败：${e instanceof Error ? e.message : String(e)}`, data: { ok: false } }); } break; }
        case 'create_entity': { if (!args.name || !args.domain || !args.content) { this.sendError(id, -32602, 'Missing required argument: name, domain, and content are required'); break; } const r = createEntity({ name: args.name as string, domain: args.domain as string, content: args.content as string, ...(args.relations ? { relations: args.relations as string } : {}) }); this.sendTool(id, r, r.data.isError); break; }
        case 'create_concept': { if (!args.name || !args.content) { this.sendError(id, -32602, 'Missing required argument: name and content are required'); break; } const r = createConcept({ name: args.name as string, content: args.content as string }); this.sendTool(id, r, r.data.isError); break; }
        case 'update_entity': { if (!args.name) { this.sendError(id, -32602, 'Missing required argument: name is required'); break; } const ur = updateEntity({ name: args.name as string, ...(args.newName ? { newName: args.newName as string } : {}), ...(args.domain !== undefined ? { domain: args.domain as string } : {}), ...(args.description !== undefined ? { description: args.description as string } : {}), ...(args.relations !== undefined ? { relations: args.relations as string } : {}), ...(args.content !== undefined ? { content: args.content as string } : {}) }); this.sendTool(id, ur, ur.data.isError); break; }
        case 'delete_entity': { if (!args.name) { this.sendError(id, -32602, 'Missing required argument: name is required'); break; } const dr = deleteEntity({ name: args.name as string, confirmed: args.confirmed === true }); this.sendTool(id, dr, dr.data.isError); break; }
        case 'delete_concept': { if (!args.name) { this.sendError(id, -32602, 'Missing required argument: name is required'); break; } const cr = deleteConcept({ name: args.name as string, confirmed: args.confirmed === true }); this.sendTool(id, cr, cr.data.isError); break; }
        case 'validate_ontology': { this.sendTool(id, validateOntology({ ...(args.fix !== undefined ? { fix: args.fix as boolean } : {}) })); break; }
        case 'evaluate_output': { this.sendTool(id, await evaluateOutput({ ...(args.golden_set_path ? { golden_set_path: args.golden_set_path as string } : {}), ...(args.verbose !== undefined ? { verbose: args.verbose as boolean } : {}) })); break; }
        case 'optimize_skill': { if (!args.skill_path) { this.sendError(id, -32602, 'Missing required argument: skill_path'); break; } this.sendTool(id, optimizeSkill({ skill_path: args.skill_path as string, ...(args.check_only !== undefined ? { check_only: args.check_only as boolean } : {}) })); break; }
        case 'health_check': { try { this.sendTool(id, healthCheck({ ...(args.mode ? { mode: args.mode as 'doctor' | 'verify' } : {}), ...(args.platform ? { platform: args.platform as string } : {}) })); } catch (e) { this.sendTool(id, { text: `[sofagent] 健康检查失败: ${e instanceof Error ? e.message : String(e)}`, data: { allOk: false, checks: [], mode: args.mode ?? 'doctor' } }); } break; }
        case 'audit_data_change': { const r = auditDataChange({ ...(args.scope ? { scope: args.scope as 'recent' | 'entity' | 'concept' | 'all' } : {}), ...(args.name ? { name: args.name as string } : {}), ...(args.count !== undefined ? { count: args.count as number } : {}) }); this.sendTool(id, r, r.data.isError); break; }
        case 'notify_session': { if (!args.audit_type || !args.verdict || !args.summary) { this.sendError(id, -32602, 'Missing required arguments: audit_type, verdict, and summary are required'); break; } this.sendTool(id, notifySession({ audit_type: args.audit_type as 'code' | 'data' | 'file', verdict: args.verdict as 'PASS' | 'WARN' | 'FAIL', summary: args.summary as string, ...(args.details ? { details: args.details as string[] } : {}), ...(args.think_ref !== undefined ? { think_ref: args.think_ref as boolean } : {}) })); break; }
        case 'activate_workflow': { this.sendTool(id, await activateWorkflowTool({ ...(args.dry_run !== undefined ? { dry_run: args.dry_run as boolean } : {}), ...(args.node_filter !== undefined ? { node_filter: args.node_filter as string[] } : {}) })); break; }
        case 'daemon_status': { this.sendTool(id, await daemonStatus()); break; }
        case 'list_agents': { this.sendTool(id, await listAgentsTool()); break; }
        case 'list_concepts': { this.sendTool(id, listConcepts()); break; }
        case 'hitl_resolve': { this.sendTool(id, await hitlResolve({ checkpoint_id: args.checkpoint_id as string, decision: args.decision as 'approve' | 'reject' | 'aborted', ...(args.comment ? { comment: args.comment as string } : {}) })); break; }
        case 'list_rules': { const r = listRules({ type: args.type as 'tool' | 'diff' | 'all' | undefined }); this.sendTool(id, r); break; }
        case 'agent_identity': { const r = agentIdentityTool({ ...(args.agent_id ? { agentId: args.agent_id as string } : {}) }); this.sendTool(id, r); break; }
        case 'loop_debug': { const r = await loopDebug({ ...(typeof args.task === 'string' ? { task: args.task } : {}), ...(typeof args.agent_id === 'string' ? { agent_id: args.agent_id } : {}), ...(typeof args.max_rounds === 'number' ? { max_rounds: args.max_rounds } : {}), ...(typeof args.timeout_ms === 'number' ? { timeout_ms: args.timeout_ms } : {}) }); this.sendTool(id, r, r.data.isError); break; }
        case 'evaluate': { if (!args.benchmark_id) { this.sendError(id, -32602, 'Missing required argument: benchmark_id'); break; } const r = await evaluate({ benchmark_id: args.benchmark_id as string, ...(typeof args.case_id === 'string' ? { case_id: args.case_id } : {}), ...(args.query === true ? { query: true } : {}) }); this.sendTool(id, r, r.data.isError); break; }
        case 'audit_trail': { const r = await auditTrail({ ...(typeof args.agent_id === 'string' ? { agent_id: args.agent_id } : {}), ...(args.include_peers === true ? { include_peers: true } : {}) }); this.sendTool(id, r, r.data.isError); break; }
        // v1.3.2 新增 tool（交付 5/6/7右）
        case 'create_agent': { if (!args.requirement) { this.sendError(id, -32602, 'Missing required argument: requirement'); break; } const r = await createAgent({ requirement: args.requirement as string, ...(typeof args.target_dir === 'string' ? { targetDir: args.target_dir } : {}) }); this.sendTool(id, r, r.data?.isError); break; }
        case 'eval_suite': { if (!args.action || !args.enterprise_id) { this.sendError(id, -32602, 'Missing required arguments: action and enterprise_id'); break; } const er = await evalSuite({ action: args.action as 'instantiate' | 'freeze' | 'run' | 'query', enterprise_id: args.enterprise_id as string, ...(args.industry ? { industry: args.industry as 'finance' | 'manufacturing' | 'supplychain' | 'customerservice' | 'generic' } : {}), ...(args.custom_cases ? { custom_cases: args.custom_cases as any } : {}) }); this.sendTool(id, er, er.data?.isError); break; }
        case 'fde_compose': { if (!args.action || !args.session) { this.sendError(id, -32602, 'Missing required arguments: action and session'); break; } const fr = await fdeCompose({ action: args.action as 'workflow' | 'ontology', session: args.session as any }); this.sendTool(id, fr, fr.data?.isError); break; }
        // v1.3.3 新增 tool（交付 T01）
        case 'route_workflow': { if (!args.task || !args.workflow) { this.sendError(id, -32602, 'Missing required arguments: task and workflow'); break; } const rr = routeWorkflowTool({ task: args.task as string, workflow: args.workflow as any }); this.sendTool(id, rr, rr.isError); break; }
        // v1.3.3 新增 tool（交付 T02）
        case 'team_create': { if (!args.team_yaml) { this.sendError(id, -32602, 'Missing required argument: team_yaml'); break; } const tcr = teamCreate({ teamYaml: args.team_yaml as string }); this.sendTool(id, tcr, tcr.isError); break; }
        case 'team_broadcast': { if (!args.team_id || !args.source || !args.intent || !args.target) { this.sendError(id, -32602, 'Missing required arguments: team_id, source, intent, and target'); break; } const tbr = teamBroadcast({ teamId: args.team_id as string, source: args.source as string, intent: args.intent as string, target: args.target as string, ...(typeof args.payload === 'string' ? { payload: args.payload } : {}) }); this.sendTool(id, tbr, tbr.isError); break; }
        // v1.3.3 新增 tool（交付 T03/T04）
        case 'refine': { if (!args.action) { this.sendError(id, -32602, 'Missing required argument: action'); break; } const rfr = await refine({ action: args.action as 'trigger' | 'query', ...(typeof args.agent_id === 'string' ? { agentId: args.agent_id } : {}), ...(typeof args.task === 'string' ? { task: args.task } : {}), ...(typeof args.team_id === 'string' ? { teamId: args.team_id } : {}) }); this.sendTool(id, rfr, rfr.isError); break; }
        // v1.3.4 新增 tool（交付 1：L3 能力市场）
        case 'market_publish': { if (!args.metadata) { this.sendError(id, -32602, 'Missing required argument: metadata'); break; } const mpr = marketPublish({ metadata: args.metadata as any }); this.sendTool(id, mpr, mpr.isError); break; }
        case 'market_search': { const msr = marketSearch({ ...(typeof args.query === 'string' ? { query: args.query } : {}), ...(typeof args.tag === 'string' ? { tag: args.tag } : {}), ...(typeof args.kind === 'string' ? { kind: args.kind as 'skill' | 'agent' | 'flow' } : {}) }); this.sendTool(id, msr); break; }
        // v1.3.4 新增 tool（交付 2/3/5：L3 能力市场调用/评价/退役/规则提炼）
        case 'market_invoke': { if (!args.capability_id || !args.caller_agent_id) { this.sendError(id, -32602, 'Missing required arguments: capability_id and caller_agent_id'); break; } const mir = await marketInvoke({ capability_id: args.capability_id as string, caller_agent_id: args.caller_agent_id as string, ...(args.input !== undefined ? { input: args.input } : {}) }); this.sendTool(id, mir, mir.isError); break; }
        case 'market_rate': { if (!args.capability_id || !args.rater_id || !args.owner_agent_id || typeof args.score !== 'number') { this.sendError(id, -32602, 'Missing required arguments: capability_id, rater_id, score, owner_agent_id'); break; } const mrr = await marketRate({ capability_id: args.capability_id as string, rater_id: args.rater_id as string, score: args.score as number, owner_agent_id: args.owner_agent_id as string, ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); this.sendTool(id, mrr, mrr.isError); break; }
        case 'market_retire': { if (!args.capability_id || !args.action) { this.sendError(id, -32602, 'Missing required arguments: capability_id and action'); break; } const mtr = await marketRetire({ capability_id: args.capability_id as string, action: args.action as 'retire' | 'restore' | 'scan', ...(args.reason ? { reason: args.reason as 'owner_request' | 'low_invoke' | 'low_rating' | 'manual' } : {}), ...(args.confirmed !== undefined ? { confirmed: args.confirmed as boolean } : {}) }); this.sendTool(id, mtr, mtr.isError); break; }
        case 'market_harvest_rule': { const mhr = await marketHarvestRule({ ...(args.action ? { action: args.action as 'harvest' | 'full' } : {}), ...(args.case_texts ? { case_texts: args.case_texts as string[] } : {}) }); this.sendTool(id, mhr, mhr.isError); break; }
        default: this.sendError(id, -32602, `Unknown tool: ${toolName}`);
      }
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
