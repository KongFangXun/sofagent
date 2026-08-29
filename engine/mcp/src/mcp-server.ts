#!/usr/bin/env node
// ============================================================
// mcp-server.ts · MCP Server (Model Context Protocol)
// v1.4.2: 拆分为精简主文件（300+ 行，含工具注册/传输/错误处理）+ tools/ 子目录按功能分组
// v1.4.2: 从 @sofagent/audit 拆分为独立包 @sofagent/mcp
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
import { worklogQuery } from './tools/worklog-query';
import { costQuery } from './tools/cost-query';
import { listAgentsTool } from './tools/list-agents';import { listConcepts } from './tools/list-concepts';
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
// v1.3.4 交付 1：L3 组织能力公地
import { commonsPublish } from './tools/commons-publish';
import { commonsSearch } from './tools/commons-search';
import { commonsInvoke } from './tools/commons-invoke';
import { commonsRate } from './tools/commons-rate';
import { commonsRetire } from './tools/commons-retire';
import { commonsHarvestRule } from './tools/commons-harvest-rule';
// v1.3.5 交付 1+2：MCP 自进化闭环（ab-test ×2）+ 运维闭环（snapshot ×2）
import { runAbTest } from './tools/run-ab-test';
import { promoteAb } from './tools/promote-ab';
import { snapshotList } from './tools/snapshot-list';
import { snapshotRestore } from './tools/snapshot-restore';
import { workflowSubmit } from './tools/workflow-submit';
import { ontologyImport } from './tools/ontology-import';
import { modelRegister, type ModelRegisterArgs } from './tools/model-register';
import { modelSwitch } from './tools/model-switch';
import { modelUnregister } from './tools/model-unregister';
import { trainBudget } from './tools/train-budget';
import { trainSubmit } from './tools/train-submit';
import { trainDoctorTool } from './tools/train-doctor';
import { trainDryrunTool, type TrainDryrunArgs } from './tools/train-dryrun';
import { trainReportTool, type TrainReportArgs } from './tools/train-report';
// v1.4.3 第一章：训练监控查询侧（train_status / train_list）
import { trainStatusTool } from './tools/train-status';
import { trainListTool } from './tools/train-list';
// v1.4.3 第二章：训练失败诊断（train_diagnose）
import { trainDiagnoseTool } from './tools/train-diagnose';
import { fdeInterviewTool, type FdeInterviewArgs } from './tools/fde-interview';
import { fdeClassifyTool, type FdeClassifyArgs } from './tools/fde-classify';
import { fdeQuantifyTool, type FdeQuantifyArgs } from './tools/fde-quantify';
import { fdeDeriveTool, type FdeDeriveArgs } from './tools/fde-derive';
import { fdeDistillTool, type FdeDistillArgs } from './tools/fde-distill';
import { fdeDeployTool, type FdeDeployArgs } from './tools/fde-deploy';
import { defineAcceptance, checkAcceptance } from './tools/acceptance';

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

// ── v1.4.0 交付十：Agentic Browser MCP 适配（Playwright 惰性加载 + 视觉降级）──
// browser-tools 的 BrowserSession 需要 Playwright driver——MCP 侧动态加载，
// Playwright 不可用时返回降级结果（不抛），对齐「视觉降级路径可用」验收。
type BrowserToolResult = ToolResult;

async function lazyBrowserSession(): Promise<{ session: { playwrightNavigate(u: string): Promise<unknown>; playwrightClick(s: string): Promise<unknown>; playwrightScreenshot(name?: string): Promise<unknown>; playwrightAssert(c: string): Promise<unknown> } } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserSession } = require('@sofagent/orchestrator');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chromium } = require('playwright');
    if (!chromium) return null;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const driver = {
      navigate: async (url: string) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        return { url: page.url(), title: await page.title(), status: 200 };
      },
      click: async (selector: string) => {
        await page.click(selector, { timeout: 5000 });
        return { clicked: true };
      },
      screenshot: async (name?: string) => {
        const p = `/tmp/sofagent-browser-${name ?? Date.now()}.png`;
        await page.screenshot({ path: p });
        return { imagePath: p, bytes: 0 };
      },
      assert: async (condition: string) => {
        const passed = await page.locator(condition).count().then((count: number) => count > 0).catch(() => false);
        return { passed, detail: passed ? `找到 ${condition}` : `未找到 ${condition}` };
      },
    };
    const session = new BrowserSession(driver, () => { /* MCP 场景审计留痕可后续接 decision-log */ });
    return { session };
  } catch {
    return null; // Playwright 未安装 → 降级
  }
}

async function browserNavigate(url: string): Promise<BrowserToolResult> {
  const s = await lazyBrowserSession();
  if (!s) return { text: '[sofagent] 浏览器导航不可用——需安装 Playwright（npm i playwright && npx playwright install chromium）。已返回降级结果。', data: { degraded: true, tool: 'playwright_navigate' } };
  try { return { text: '[sofagent] 浏览器导航（Playwright）', data: await s.session.playwrightNavigate(url) as Record<string, unknown> }; }
  catch (err) { return { text: `[sofagent] 浏览器导航失败：${err instanceof Error ? err.message : String(err)}`, data: { error: true } }; }
}
async function browserClick(selector: string): Promise<BrowserToolResult> {
  const s = await lazyBrowserSession();
  if (!s) return { text: '[sofagent] 浏览器点击不可用——需安装 Playwright。已返回降级结果。', data: { degraded: true, tool: 'playwright_click' } };
  try { return { text: '[sofagent] 浏览器点击（Playwright）', data: await s.session.playwrightClick(selector) as Record<string, unknown> }; }
  catch (err) { return { text: `[sofagent] 浏览器点击失败：${err instanceof Error ? err.message : String(err)}`, data: { error: true } }; }
}
async function browserScreenshot(name?: string): Promise<BrowserToolResult> {
  const s = await lazyBrowserSession();
  if (!s) return { text: '[sofagent] 浏览器截图不可用——需安装 Playwright。已返回降级结果。', data: { degraded: true, tool: 'playwright_screenshot' } };
  try { return { text: '[sofagent] 浏览器截图（Playwright）', data: await s.session.playwrightScreenshot(name) as Record<string, unknown> }; }
  catch (err) { return { text: `[sofagent] 浏览器截图失败：${err instanceof Error ? err.message : String(err)}`, data: { error: true } }; }
}
async function browserAssert(condition: string): Promise<BrowserToolResult> {
  const s = await lazyBrowserSession();
  if (!s) return { text: '[sofagent] 浏览器断言不可用——需安装 Playwright。已返回降级结果。', data: { degraded: true, tool: 'playwright_assert' } };
  try { return { text: '[sofagent] 浏览器断言（Playwright）', data: await s.session.playwrightAssert(condition) as Record<string, unknown> }; }
  catch (err) { return { text: `[sofagent] 浏览器断言失败：${err instanceof Error ? err.message : String(err)}`, data: { error: true } }; }
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
        case 'worklog_query': { this.sendTool(id, await worklogQuery({ ...(args.agentId ? { agentId: args.agentId as string } : {}), ...(args.workflowId ? { workflowId: args.workflowId as string } : {}), ...(args.weeklyTrend !== undefined ? { weeklyTrend: args.weeklyTrend as boolean } : {}), ...(args.evolution !== undefined ? { evolution: args.evolution as boolean } : {}) })); break; }
        case 'cost_query': { this.sendTool(id, await costQuery({ ...(args.maxTokensPerRun !== undefined ? { budget: { maxTokensPerRun: args.maxTokensPerRun as number, ...(args.maxCostPerDay !== undefined ? { maxCostPerDay: args.maxCostPerDay as number } : {}) } } : {}) })); break; }
        case 'playwright_navigate': { this.sendTool(id, await browserNavigate(args.url as string)); break; }
        case 'playwright_click': { this.sendTool(id, await browserClick(args.selector as string)); break; }
        case 'playwright_screenshot': { this.sendTool(id, await browserScreenshot(args.name as string | undefined)); break; }
        case 'playwright_assert': { this.sendTool(id, await browserAssert(args.condition as string)); break; }
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
        // v1.3.4 新增 tool（交付 1：L3 能力公地）
        case 'commons_publish': { if (!args.metadata) { this.sendError(id, -32602, 'Missing required argument: metadata'); break; } const mpr = commonsPublish({ metadata: args.metadata as any }); this.sendTool(id, mpr, mpr.isError); break; }
        case 'commons_search': { const msr = commonsSearch({ ...(typeof args.query === 'string' ? { query: args.query } : {}), ...(typeof args.tag === 'string' ? { tag: args.tag } : {}), ...(typeof args.kind === 'string' ? { kind: args.kind as 'skill' | 'agent' | 'flow' } : {}) }); this.sendTool(id, msr); break; }
        // v1.3.4 新增 tool（交付 2/3/5：L3 能力公地调用/评价/退役/规则提炼）
        case 'commons_invoke': { if (!args.capability_id || !args.caller_agent_id) { this.sendError(id, -32602, 'Missing required arguments: capability_id and caller_agent_id'); break; } const mir = await commonsInvoke({ capability_id: args.capability_id as string, caller_agent_id: args.caller_agent_id as string, ...(args.input !== undefined ? { input: args.input } : {}) }); this.sendTool(id, mir, mir.isError); break; }
        case 'commons_rate': { if (!args.capability_id || !args.rater_id || !args.owner_agent_id || typeof args.score !== 'number') { this.sendError(id, -32602, 'Missing required arguments: capability_id, rater_id, score, owner_agent_id'); break; } const mrr = await commonsRate({ capability_id: args.capability_id as string, rater_id: args.rater_id as string, score: args.score as number, owner_agent_id: args.owner_agent_id as string, ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); this.sendTool(id, mrr, mrr.isError); break; }
        case 'commons_retire': { if (!args.capability_id || !args.action) { this.sendError(id, -32602, 'Missing required arguments: capability_id and action'); break; } const mtr = await commonsRetire({ capability_id: args.capability_id as string, action: args.action as 'retire' | 'restore' | 'scan', ...(args.reason ? { reason: args.reason as 'owner_request' | 'low_invoke' | 'low_rating' | 'manual' } : {}), ...(args.confirmed !== undefined ? { confirmed: args.confirmed as boolean } : {}) }); this.sendTool(id, mtr, mtr.isError); break; }
        case 'commons_harvest_rule': { const mhr = await commonsHarvestRule({ ...(args.action ? { action: args.action as 'harvest' | 'full' } : {}), ...(args.case_texts ? { case_texts: args.case_texts as string[] } : {}) }); this.sendTool(id, mhr, mhr.isError); break; }
        // v1.3.5 交付 1+2：MCP 自进化闭环 + 运维闭环
        case 'run_ab_test': { if (!args.current || !args.candidate) { this.sendError(id, -32602, 'Missing required arguments: current and candidate'); break; } const abr = await runAbTest({ current: args.current as string, candidate: args.candidate as string, ...(typeof args.eval_set === 'string' ? { eval_set: args.eval_set } : {}), ...(typeof args.promote_threshold === 'number' ? { promote_threshold: args.promote_threshold } : {}), ...(typeof args.previous_wins === 'number' ? { previous_wins: args.previous_wins } : {}) }); this.sendTool(id, abr, abr.data.isError); break; }
        case 'promote_ab': { if (!args.current || !args.candidate) { this.sendError(id, -32602, 'Missing required arguments: current and candidate'); break; } const pbr = await promoteAb({ current: args.current as string, candidate: args.candidate as string, ...(args.human_confirmed !== undefined ? { human_confirmed: args.human_confirmed === true } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); this.sendTool(id, pbr, pbr.data.isError); break; }
        case 'snapshot_list': { const slr = snapshotList({ ...(typeof args.project_dir === 'string' ? { project_dir: args.project_dir } : {}), ...(typeof args.limit === 'number' ? { limit: args.limit } : {}) }); this.sendTool(id, slr, slr.data.isError); break; }
        case 'snapshot_restore': { if (!args.sha) { this.sendError(id, -32602, 'Missing required argument: sha'); break; } const srr = await snapshotRestore({ sha: args.sha as string, ...(typeof args.project_dir === 'string' ? { project_dir: args.project_dir } : {}), ...(args.human_confirmed !== undefined ? { human_confirmed: args.human_confirmed === true } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); this.sendTool(id, srr, srr.data.isError); break; }
        case 'workflow_submit': { if (!args.workflow) { this.sendError(id, -32602, 'Missing required argument: workflow'); break; } const wsr = await workflowSubmit({ workflow: args.workflow as string, ...(args.mode === 'run' ? { mode: 'run' as const } : {}), ...(typeof args.task === 'string' ? { task: args.task } : {}) }); this.sendTool(id, wsr, wsr.data.isError); break; }
        case 'ontology_import': { if (!args.payload) { this.sendError(id, -32602, 'Missing required argument: payload'); break; } const oir = await ontologyImport({ payload: args.payload as string, ...(typeof args.agent_id === 'string' ? { agent_id: args.agent_id } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); this.sendTool(id, oir, oir.data.isError); break; }
        case 'model_register': { if (!args.name) { this.sendError(id, -32602, 'Missing required argument: name'); break; } const mrr = await modelRegister({ name: args.name as string, endpoint: (args.endpoint as string) ?? '', model: (args.model as string) ?? '', ...(args.client_type === 'openai-compatible' || args.client_type === 'ollama' ? { client_type: args.client_type } : {}), ...(args.source === 'endpoint' || args.source === 'local-path' ? { source: args.source } : {}), ...(typeof args.eval_score === 'number' ? { eval_score: args.eval_score } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}), ...(args.profile !== undefined ? { profile: args.profile as ModelRegisterArgs['profile'] } : {}) }); this.sendTool(id, mrr, mrr.data.isError); break; }
        case 'model_switch': { const msr = await modelSwitch({ ...(typeof args.name === 'string' ? { name: args.name } : {}), lane: args.lane === 'pipeline' ? 'pipeline' : 'executor', ...(typeof args.percent === 'number' ? { percent: args.percent } : {}), action: args.action === 'rollback' ? 'rollback' : 'switch', ...(args.human_confirmed !== undefined ? { human_confirmed: args.human_confirmed === true } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); this.sendTool(id, msr, msr.data.isError); break; }
        case 'model_unregister': { if (!args.name) { this.sendError(id, -32602, 'Missing required argument: name'); break; } const mur = await modelUnregister({ name: args.name as string, action: args.action === 'restore' ? 'restore' : 'retire', ...(args.human_confirmed !== undefined ? { human_confirmed: args.human_confirmed === true } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); this.sendTool(id, mur, mur.data.isError); break; }
        case 'train_budget': { if (!args.action) { this.sendError(id, -32602, 'Missing required argument: action'); break; } if (!args.job_id) { this.sendError(id, -32602, 'Missing required argument: job_id'); break; } const tbr = await trainBudget({ action: args.action as 'status' | 'resolve', job_id: args.job_id as string, ...(args.decision === 'resume' || args.decision === 'terminate' ? { decision: args.decision } : {}) }); this.sendTool(id, tbr, tbr.data.isError); break; }
        // v1.4.1 块二：训练任务提交（train-scheduler 接管 spawn）
        case 'train_submit': { if (!args.data_path) { this.sendError(id, -32602, 'Missing required argument: data_path'); break; } if (!args.base_model) { this.sendError(id, -32602, 'Missing required argument: base_model'); break; } if (!args.algorithm) { this.sendError(id, -32602, 'Missing required argument: algorithm'); break; } if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } const tsr = await trainSubmit({ data_path: args.data_path as string, base_model: args.base_model as string, algorithm: args.algorithm as 'sft' | 'dpo' | 'grpo', ...(args.hyperparams !== undefined && typeof args.hyperparams === 'object' ? { hyperparams: args.hyperparams as Record<string, unknown> } : {}), ...(args.budget !== undefined && typeof args.budget === 'object' ? { budget: args.budget as { max_minutes?: number; max_steps?: number; max_cost?: number } } : {}), enterprise_id: args.enterprise_id as string, ...(typeof args.train_job_id === 'string' ? { train_job_id: args.train_job_id } : {}) }); this.sendTool(id, tsr, tsr.data.isError); break; }
        // v1.4.2 章四：训练环境体检（CUDA/显存/框架/基座缓存四项——只查不装）
        case 'train_doctor': { if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } const tdr = await trainDoctorTool({ enterprise_id: args.enterprise_id as string }); this.sendTool(id, tdr, tdr.data.isError); break; }
        // v1.4.2 章五：训练 dry-run（管线连通/数据抽样/显存/算力外推——失败前预防）
        case 'train_dryrun': { if (!args.data_path) { this.sendError(id, -32602, 'Missing required argument: data_path'); break; } if (!args.algorithm) { this.sendError(id, -32602, 'Missing required argument: algorithm'); break; } const dyr = await trainDryrunTool({ data_path: args.data_path as string, algorithm: args.algorithm as 'sft' | 'dpo' | 'grpo', ...(args.column_mapping !== undefined && typeof args.column_mapping === 'object' ? { column_mapping: args.column_mapping as Record<string, string> } : {}), ...(args.vram !== undefined && typeof args.vram === 'object' ? { vram: args.vram as TrainDryrunArgs['vram'] } : {}), ...(args.extrapolate !== undefined && typeof args.extrapolate === 'object' ? { extrapolate: args.extrapolate as TrainDryrunArgs['extrapolate'] } : {}) }); this.sendTool(id, dyr, dyr.data.isError); break; }
        // v1.4.2 章六：训练报告（客户可读交付物——归档 data/dashboard/train-reports/）
        case 'train_report': { if (!args.train_job_id) { this.sendError(id, -32602, 'Missing required argument: train_job_id'); break; } if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } const trr = await trainReportTool({ train_job_id: args.train_job_id as string, enterprise_id: args.enterprise_id as string, ...(args.baseline_eval !== undefined && typeof args.baseline_eval === 'object' ? { baseline_eval: args.baseline_eval as Record<string, unknown> } : {}), ...(args.after_eval !== undefined && typeof args.after_eval === 'object' ? { after_eval: args.after_eval as Record<string, unknown> } : {}), ...(args.dataset_version !== undefined && typeof args.dataset_version === 'object' ? { dataset_version: args.dataset_version as Record<string, unknown> } : {}), ...(args.quantification !== undefined && typeof args.quantification === 'object' ? { quantification: args.quantification as NonNullable<TrainReportArgs['quantification']> } : {}), ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts as string[] } : {}) }); this.sendTool(id, trr, trr.data.isError); break; }
        // v1.4.3 第一章：训练监控查询侧（train_status / train_list）
        case 'train_status': { if (!args.train_job_id) { this.sendError(id, -32602, 'Missing required argument: train_job_id'); break; } if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } const tsr = await trainStatusTool({ train_job_id: args.train_job_id as string, enterprise_id: args.enterprise_id as string, ...(typeof args.last_n === 'number' ? { last_n: args.last_n } : {}) }); this.sendTool(id, tsr, tsr.data.isError); break; }
        case 'train_list': { if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } const tlr = await trainListTool({ enterprise_id: args.enterprise_id as string, ...(typeof args.status === 'string' ? { status: args.status } : {}), ...(typeof args.base_model === 'string' ? { base_model: args.base_model } : {}), ...(typeof args.last_days === 'number' ? { last_days: args.last_days } : {}), ...(typeof args.limit === 'number' ? { limit: args.limit } : {}) }); this.sendTool(id, tlr, tlr.data.isError); break; }
        // v1.4.3 第二章：训练失败诊断（train_diagnose）
        case 'train_diagnose': { if (!args.train_job_id) { this.sendError(id, -32602, 'Missing required argument: train_job_id'); break; } if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } const tdr2 = await trainDiagnoseTool({ train_job_id: args.train_job_id as string, enterprise_id: args.enterprise_id as string, ...(typeof args.save === 'boolean' ? { save: args.save } : {}) }); this.sendTool(id, tdr2, tdr2.data.isError); break; }
        // v1.4.2 章八：FDE 六引擎（interview/classify/quantify/derive/distill/deploy）
        case 'fde_interview': { if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } if (!args.prompts_only && (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0)) { this.sendError(id, -32602, 'Missing required argument: nodes'); break; } const fir = await fdeInterviewTool({ enterprise_id: args.enterprise_id as string, ...(args.prompts_only === true ? { prompts_only: true } : {}), ...(Array.isArray(args.nodes) ? { nodes: args.nodes as NonNullable<FdeInterviewArgs['nodes']> } : {}) }); this.sendTool(id, fir, fir.data.isError); break; }
        case 'fde_classify': { if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { this.sendError(id, -32602, 'Missing or empty required argument: nodes'); break; } const fcr = await fdeClassifyTool({ enterprise_id: args.enterprise_id as string, nodes: args.nodes as NonNullable<FdeClassifyArgs['nodes']> }); this.sendTool(id, fcr, fcr.data.isError); break; }
        case 'fde_quantify': { if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { this.sendError(id, -32602, 'Missing or empty required argument: nodes'); break; } const fqr = await fdeQuantifyTool({ enterprise_id: args.enterprise_id as string, nodes: args.nodes as NonNullable<FdeQuantifyArgs['nodes']> }); this.sendTool(id, fqr, fqr.data.isError); break; }
        case 'fde_derive': { if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } if (!args.workflow_name) { this.sendError(id, -32602, 'Missing required argument: workflow_name'); break; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { this.sendError(id, -32602, 'Missing or empty required argument: nodes'); break; } const fdr = await fdeDeriveTool({ enterprise_id: args.enterprise_id as string, workflow_name: args.workflow_name as string, ...(typeof args.workflow_description === 'string' ? { workflow_description: args.workflow_description } : {}), nodes: args.nodes as NonNullable<FdeDeriveArgs['nodes']> }); this.sendTool(id, fdr, fdr.data.isError); break; }
        case 'fde_distill': { if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { this.sendError(id, -32602, 'Missing or empty required argument: nodes'); break; } const fdsr = await fdeDistillTool({ enterprise_id: args.enterprise_id as string, nodes: args.nodes as NonNullable<FdeDistillArgs['nodes']> }); this.sendTool(id, fdsr, fdsr.data.isError); break; }
        case 'fde_deploy': { if (!args.enterprise_id) { this.sendError(id, -32602, 'Missing required argument: enterprise_id'); break; } if (!args.workflow_name) { this.sendError(id, -32602, 'Missing required argument: workflow_name'); break; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { this.sendError(id, -32602, 'Missing or empty required argument: nodes'); break; } const fdpr = await fdeDeployTool({ enterprise_id: args.enterprise_id as string, workflow_name: args.workflow_name as string, ...(typeof args.workflow_description === 'string' ? { workflow_description: args.workflow_description } : {}), nodes: args.nodes as NonNullable<FdeDeployArgs['nodes']> }); this.sendTool(id, fdpr, fdpr.data.isError); break; }
        case 'define_acceptance': { if (!args.task_id) { this.sendError(id, -32602, 'Missing required argument: task_id'); break; } if (!Array.isArray(args.criteria) || (args.criteria as unknown[]).length === 0) { this.sendError(id, -32602, 'Missing or empty required argument: criteria'); break; } const dar = await defineAcceptance({ task_id: args.task_id as string, criteria: args.criteria as Array<Record<string, unknown>>, ...(typeof args.notes === 'string' ? { notes: args.notes } : {}) }); this.sendTool(id, dar, dar.data.isError); break; }
        case 'check_acceptance': { if (!args.task_id) { this.sendError(id, -32602, 'Missing required argument: task_id'); break; } const car = await checkAcceptance({ task_id: args.task_id as string, ...(typeof args.project_root === 'string' ? { project_root: args.project_root } : {}) }); this.sendTool(id, car, car.data.isError); break; }
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
