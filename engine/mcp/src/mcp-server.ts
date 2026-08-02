#!/usr/bin/env node
// ============================================================
// mcp-server.ts · MCP Server (Model Context Protocol)
// v1.2.0: 从 @sofagent/audit 拆分为独立包 @sofagent/mcp
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
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

import {
  parseDiff,
  checkLogs,
  runRules,
  loadConfig,
  loadHistory,
  VERSION,
} from '@sofagent/audit';
import { generateThinkEntry } from '@sofagent/think';
import { getThinkPath, appendThinkEntry, sortByTrust, prepareForPrompt } from '@sofagent/core';
import type { Trust, Sensitivity } from '@sofagent/core';
import type { AuditResult } from '@sofagent/audit';
import { queryDataSovereigntyReport } from './tools/data-sovereignty-report';
import { createEntity } from './tools/create-entity';
import { createConcept } from './tools/create-concept';
import { validateOntology } from './tools/validate-ontology';
import { evaluateOutput } from './tools/evaluate-output';
import { optimizeSkill } from './tools/optimize-skill';
import { healthCheck } from './tools/health-check';
import { auditDataChange } from './tools/audit-data-change';
import { notifySession } from './tools/notify-session';
import { activateWorkflowTool } from './tools/activate-workflow';

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
   *
   * JSON-RPC 2.0 规范合规（v1.1.5 修复）：
   *   - request（有 id 字段且非 null）：必须应答
   *   - notification（id 为 null/undefined 或 method 以 notifications/ 开头）：不应答
   * 参考：https://www.jsonrpc.org/specification#notification
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;

    // ── notification 识别（v1.1.5 协议合规修复）──
    // JSON-RPC 2.0 规定：id 为 null/undefined 的消息是 notification，不应答
    // MCP 协议：method 以 "notifications/" 开头的也是 notification（即使带了 id，也是协议约定的通知）
    const isNotification =
      id === null || id === undefined || method.startsWith('notifications/');

    // MCP 协议标准：notifications/initialized 是初始化完成通知
    // 设置 initialized=true（兼容旧版不带前缀的 initialized case）
    if (method === 'notifications/initialized' || method === 'initialized') {
      // 通知——无需响应
      return;
    }

    // 其他 notification（如 notifications/cancelled、notifications/progress）静默忽略
    if (isNotification) {
      return;
    }

    switch (method) {
      // === 生命周期 ===
      case 'initialize':
        this.handleInitialize(id, params);
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
        // JSON-RPC 2.0: notification 不应答——上面已过滤，此处 id 一定非空
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
          description: '对 git diff 运行全量审计规则（sofagent 审计引擎 · 21 条规则 · 0 token 纯正则）。返回结构化审计报告。',
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
        {
          name: 'sofagent_compose',
          description: '编排引擎——传入任务描述，返回 Sub Agent 编排方案（YAML）',
          inputSchema: {
            type: 'object' as const,
            properties: {
              task: {
                type: 'string',
                description: '任务描述',
              },
              agent: {
                type: 'string',
                description: '指定 Sub Agent（可选）',
              },
              run: {
                type: 'boolean',
                description: '是否执行（默认 false = dry-run）',
              },
            },
            required: ['task'],
          },
        },
        {
          name: 'audit_file',
          description: '单文件变更即时审计（v1.1.5 新增）——Agent 通过 MCP 编辑文件时调用，即时跑适用于单文件的规则（A3/A7/A11/A18，可选 A14 当传 task 时）。返回结构化结果（不阻断，由 Agent 自决）。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              path: {
                type: 'string',
                description: '变更文件路径（必填）',
              },
              change_type: {
                type: 'string',
                enum: ['create', 'modify', 'delete'],
                description: '变更类型：create / modify / delete',
              },
              diff: {
                type: 'string',
                description: '文件变更 diff 内容（可选，用于 A2/A9 等内容级规则）',
              },
              task: {
                type: 'string',
                description: '任务描述（可选，传入时启用 A3/A14 上下文规则）',
              },
            },
            required: ['path', 'change_type'],
          },
        },
        {
          name: 'search_knowledge',
          description: '跨 entities/concepts 模糊搜索 knowledge 库（v1.1.5）。返回匹配的页面列表（含路径 + 首行摘要）。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              query: { type: 'string', description: '搜索关键词（模糊匹配页面名 + 内容）' },
            },
            required: ['query'],
          },
        },
        {
          name: 'read_entity',
          description: '读取单个 entity 页（knowledge/entities/<name>.md）',
          inputSchema: {
            type: 'object' as const,
            properties: {
              name: { type: 'string', description: 'entity 名称（不含 .md 后缀）' },
            },
            required: ['name'],
          },
        },
        {
          name: 'read_concept',
          description: '读取单个 concept 页（knowledge/concepts/<name>.md）',
          inputSchema: {
            type: 'object' as const,
            properties: {
              name: { type: 'string', description: 'concept 名称（不含 .md 后缀）' },
            },
            required: ['name'],
          },
        },
        {
          name: 'list_entities',
          description: '列出 knowledge/entities/ 下所有 entity（可选按 domain 过滤）',
          inputSchema: {
            type: 'object' as const,
            properties: {
              domain: { type: 'string', description: 'domain 过滤（可选）' },
            },
          },
        },
        {
          name: 'read_lessons',
          description: '读取 knowledge/lessons-missteps.md（踩坑记录）',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'read_think_md',
          description: '读取 think.md 完整内容（v1.1.5 新增，返回值首行带 [sofagent] 前缀）',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'stats',
          description: 'knowledge 库统计（entities 数 / concepts 数 / 最后更新时间）',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'list_capabilities',
          description: '返回 sofagent MCP 完整能力清单（tools + resources + 描述）——Agent 首次连上时调用获取能力地图',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'data_sovereignty_report',
          description: '查询数据主权审计报告摘要（v1.2.2 P0）。支持 date 参数：today / yesterday / YYYY-MM-DD。返回云端调用、本地执行、数据流出、敏感本地处理率、异常明细。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              date: {
                type: 'string',
                description: '查询日期：today / yesterday / YYYY-MM-DD（默认 today）',
                default: 'today',
              },
            },
          },
        },
        {
          name: 'create_entity',
          description: '在知识库中创建/更新一个 entity 页（knowledge/entities/<name>.md）。写入前跑 D1-D5 数据审计，FAIL 时拒绝写入。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              name: { type: 'string', description: 'entity 名称（不含 .md 后缀，将作为文件名）' },
              domain: { type: 'string', description: '业务域归属（如 财务/人事/供应链）' },
              content: { type: 'string', description: 'entity 页面内容（Markdown 格式，含 frontmatter）' },
              relations: { type: 'string', description: 'JSON 格式的关联关系（belongs_to / has_many），可选' },
            },
            required: ['name', 'domain', 'content'],
          },
        },
        {
          name: 'create_concept',
          description: '在知识库中创建/更新一个 concept 页（knowledge/concepts/<name>.md）。用于沉淀业务概念定义。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              name: { type: 'string', description: 'concept 名称' },
              content: { type: 'string', description: 'concept 内容（Markdown）' },
            },
            required: ['name', 'content'],
          },
        },
        {
          name: 'validate_ontology',
          description: '检查本体结构完整性——实体数、关联断裂、孤儿实体、死链。复用 ontology merge-engine 逻辑。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              fix: { type: 'boolean', description: '是否自动修复可修复的问题（如孤儿实体标记），默认 false' },
            },
          },
        },
        {
          name: 'evaluate_output',
          description: '用 golden set 评估 Agent 产出质量。复用 eval 引擎逻辑。返回评分 + 失败用例。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              golden_set_path: { type: 'string', description: 'golden set 文件路径（默认使用内置 golden set）' },
              verbose: { type: 'boolean', description: '是否输出详细报告', default: false },
            },
          },
        },
        {
          name: 'optimize_skill',
          description: '优化指定 Skill 文件——调用 skillopt 引擎分析并生成优化建议。复用 skillopt 逻辑。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              skill_path: { type: 'string', description: 'Skill 文件路径（必填）' },
              check_only: { type: 'boolean', description: '仅做安全扫描不优化，默认 false' },
            },
            required: ['skill_path'],
          },
        },
        {
          name: 'health_check',
          description: '运行 sofagent 环境健康检查——环境/配置/数据目录/Hook/依赖。复用 core doctor/verify 逻辑。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              mode: { type: 'string', enum: ['doctor', 'verify'], description: '检查模式：doctor（基础健康）/ verify（装后验证），默认 doctor' },
              platform: { type: 'string', description: '平台（workbuddy/openclaw/claude/codex/hermes），仅 verify 模式使用' },
            },
          },
        },
        {
          name: 'audit_data_change',
          description: '对知识库结构化数据变更跑审计（D1-D5 数据规则）。可审计最近 N 次数据变更，或指定 entity/concept 名称。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              scope: { type: 'string', enum: ['recent', 'entity', 'concept', 'all'], description: '审计范围', default: 'recent' },
              name: { type: 'string', description: 'entity/concept 名称（scope 为 entity/concept 时必填）' },
              count: { type: 'number', description: '最近 N 次变更（scope 为 recent 时），默认 10' },
            },
          },
        },
        {
          name: 'notify_session',
          description: '向当前 Agent session 推送审计结果摘要。用于审计完成后主动告知用户审计状态，确保"结果可见"。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              audit_type: { type: 'string', enum: ['code', 'data', 'file'], description: '审计类型' },
              verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'], description: '审计判定' },
              summary: { type: 'string', description: '审计摘要（1-2 句话）' },
              details: { type: 'array', items: { type: 'string' }, description: '违规/警告详情列表' },
              think_ref: { type: 'boolean', description: '是否附带相关历史反思（默认 true）', default: true },
            },
            required: ['audit_type', 'verdict', 'summary'],
          },
        },
        {
          name: 'activate_workflow',
          description: '读取 FDE 交付物（workflow.yml + skills/ + entities/），注册企业 SubAgent 到 .sofagent/subagents/*.yml。激活后 registry.listAgents() 可发现企业 Agent。',
          inputSchema: {
            type: 'object' as const,
            properties: {
              dry_run: { type: 'boolean', description: '只预览不真正注册，默认 false' },
              node_filter: { type: 'array', items: { type: 'string' }, description: '只激活指定节点（默认全部）' },
            },
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
      case 'sofagent_compose':
        await this.toolCompose(id, args);
        break;
      case 'audit_file':
        this.toolAuditFile(id, args);
        break;
      case 'search_knowledge':
        this.toolSearchKnowledge(id, args);
        break;
      case 'read_entity':
        this.toolReadEntity(id, args);
        break;
      case 'read_concept':
        this.toolReadConcept(id, args);
        break;
      case 'list_entities':
        this.toolListEntities(id, args);
        break;
      case 'read_lessons':
        this.toolReadLessons(id);
        break;
      case 'read_think_md':
        this.toolReadThinkMd(id);
        break;
      case 'stats':
        this.toolStats(id);
        break;
      case 'list_capabilities':
        this.toolListCapabilities(id);
        break;
      case 'data_sovereignty_report':
        this.toolDataSovereigntyReport(id, args);
        break;
      case 'create_entity':
        this.toolCreateEntity(id, args);
        break;
      case 'create_concept':
        this.toolCreateConcept(id, args);
        break;
      case 'validate_ontology':
        this.toolValidateOntology(id, args);
        break;
      case 'evaluate_output':
        this.toolEvaluateOutput(id, args);
        break;
      case 'optimize_skill':
        this.toolOptimizeSkill(id, args);
        break;
      case 'health_check':
        this.toolHealthCheck(id, args);
        break;
      case 'audit_data_change':
        this.toolAuditDataChange(id, args);
        break;
      case 'notify_session':
        this.toolNotifySession(id, args);
        break;
      case 'activate_workflow':
        await this.toolActivateWorkflow(id, args);
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
        text: '[sofagent] 没有文件变更，无需审计。',
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
    lines.push(`[sofagent] 扫描 ${diffFiles.length} 个变更文件`);
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
      lines.push('[sofagent] ✅ 全部审计规则通过。');
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
      // S5 L3: FAIL 时设 isError=true（协议级强制冒泡）
      isError: verdict === 'FAIL',
    });

    // S5 L4: webhook 推送（WARN/FAIL 时触发，推送失败不阻断审计）
    if (verdict !== 'PASS') {
      this.pushAuditWebhook(verdict, task, results).catch(() => {
        // webhook 推送失败非致命——静默忽略
      });
    }
  }

  /**
   * Tool: get_think
   * 读取 think.md 最近 N 条反思条目
   */
  private toolGetThink(id: number | string | null, args: Record<string, unknown>): void {
    const count = (args.count as number) ?? 1;
    const dataDir = getSofagentDataDir();
    const thinkPath = getThinkPath(dataDir);

    if (!existsSync(thinkPath)) {
      this.sendToolResult(id, {
        type: 'text',
        text: '[sofagent] think.md 不存在。运行审计后会自动生成反思条目。',
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
      text: `[sofagent] think.md 反思记录（最近 ${recent.length} 条）：\n\n${formatted.join('\n\n') || '(无反思条目)'}`,
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
    const thinkPath = getThinkPath(dataDir);

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const entry = `\n## ${timestamp} 任务: ${task}\n\n- #教训: ${lesson}\n\n`;

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    appendThinkEntry(thinkPath, entry);

    this.sendToolResult(id, {
      type: 'text',
      text: `[sofagent] 已追加反思到 think.md: "${lesson}"`,
      data: { timestamp, task, lesson },
    });
  }

  /**
   * Tool: audit_file (v1.1.5 新增)
   * 单文件变更即时审计——MCP 协议层的文件编辑事件（Agent 通过 MCP 写文件时调用）
   * 规则作用域：A3（不改越界，需 task）/ A7（不存盲改）/ A11（不滥资源）/ A18（垃圾文件）
   *              + A14（知识库越权，仅当传 task 时启用）
   * NOT 跑：A1/A2/A9（需要完整 git diff 上下文，在 commit-msg hook 里跑）
   * 返回：结构化结果（不阻断，由 Agent 自决——WARN/FAIL 都只是告知）
   */
  private toolAuditFile(id: number | string | null, args: Record<string, unknown>): void {
    const path = args.path as string | undefined;
    const changeType = args.change_type as 'create' | 'modify' | 'delete' | undefined;
    const task = args.task as string | undefined;

    if (!path || typeof path !== 'string') {
      this.sendError(id, -32602, 'Missing or invalid required argument: path');
      return;
    }
    if (!changeType || !['create', 'modify', 'delete'].includes(changeType)) {
      this.sendError(id, -32602, `Invalid change_type: ${changeType}（必须为 create|modify|delete）`);
      return;
    }

    // 构造 DiffFile（change_type 映射到 status）
    const statusMap: Record<'create' | 'modify' | 'delete', 'added' | 'modified' | 'deleted'> = {
      create: 'added',
      modify: 'modified',
      delete: 'deleted',
    };
    const diffFiles = [
      {
        path,
        status: statusMap[changeType],
        lines: [],
      },
    ];

    // 加载配置（三级 fallback，配置损坏降级为 DEFAULT_CONFIG）
    let config;
    try {
      config = loadConfig(undefined, false);
    } catch {
      config = undefined;
    }

    // 跑规则——通过 MCP pipe 单文件即时审计
    // runRules 返回完整 21 条规则结果，我们只关心 MCP pipe 作用域内的
    const results = runRules(diffFiles, [], task, false, true /* silent */, undefined, config);

    // 过滤 MCP pipe 作用域：A3 / A7 / A11 / A18 (+ A14 当传 task)
    const scopeRuleNumbers = new Set<number>([7, 11, 18]); // A7/A11/A18 始终跑
    if (task) {
      scopeRuleNumbers.add(3);  // A3 需要 task
      scopeRuleNumbers.add(14); // A14 需要 task
    }

    const violations: Array<{ rule: string; severity: string; message: string }> = [];
    let hasWarn = false;
    let hasFail = false;

    for (const rule of results.rules) {
      // 跳过作用域外的规则
      if (!scopeRuleNumbers.has(rule.number)) continue;
      // 跳过 PASS / SKIPPED
      if (rule.status === 'PASS' || rule.status === 'SKIPPED') continue;

      for (const detail of rule.details) {
        violations.push({
          rule: rule.name,
          severity: rule.status,
          message: detail,
        });
      }
      if (rule.status === 'WARN') hasWarn = true;
      if (rule.status === 'FAIL') hasFail = true;
    }

    const status: 'PASS' | 'WARN' | 'FAIL' = hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS';

    // 首行必须带 [sofagent] 前缀（v1.1.2 三层签名铁律）
    const lines: string[] = [];
    lines.push(`[sofagent] audit_file: ${path} (${changeType})`);
    lines.push(`判定: ${status}`);
    if (violations.length > 0) {
      lines.push('');
      for (const v of violations) {
        lines.push(`${v.severity} ${v.rule}: ${v.message}`);
      }
    } else {
      lines.push('[sofagent] ✅ 单文件审计通过');
    }

    this.sendToolResult(id, {
      type: 'text',
      text: lines.join('\n'),
      data: {
        status,
        violations,
        auditEngine: `sofagent-audit v${SERVER_VERSION}`,
        scope: Array.from(scopeRuleNumbers).sort((a, b) => a - b).map((n) => `A${n}`),
      },
      // S5 L3: FAIL 时设 isError=true
      isError: status === 'FAIL',
    });

    // S5 L4: webhook 推送（WARN/FAIL 时触发）
    if (status !== 'PASS') {
      this.pushAuditWebhook(status, task, results).catch(() => {
        // webhook 推送失败非致命
      });
    }
  }

  /**
   * Tool: sofagent_compose (v1.1.0)
   * 调用 sofagent-orchestrator compose 逻辑，返回 YAML 编排方案
   */
  private async toolCompose(id: number | string | null, args: Record<string, unknown>): Promise<void> {    if (typeof args.task !== 'string' || !args.task) {
      this.sendError(id, -32602, 'Missing or invalid required argument: task');
      return;
    }

    const cmd = ['compose', '--task', args.task];
    if (typeof args.agent === 'string' && args.agent) {
      cmd.push('--agent', args.agent);
    }
    if (args.run === true) {
      cmd.push('--run');
    }

    try {
      const result = execFileSync('sofagent-orchestrator', cmd, { encoding: 'utf-8', timeout: 30000 });
      this.sendToolResult(id, {
        type: 'text',
        text: `[sofagent] compose 结果:\n${result}`,
        data: { yaml: result },
      });
    } catch (err) {
      const msg = (err as Error).message;
      // 退出码非 0 也返回 stderr 内容（compose 可能通过 stderr 返回错误）
      this.sendToolResult(id, {
        type: 'text',
        text: `❌ [sofagent] 提示：compose 未完成——底层编排工具报告了问题: ${msg}`,
        data: { error: msg },
      });
    }
  }

  // ============================================================
  // v1.1.5 新增：knowledge tools（7 个）+ list_capabilities
  // ============================================================

  /** knowledge 库根目录（.sofagent/knowledge） */
  private getKnowledgeDir(): string {
    return join(getSofagentDataDir(), 'knowledge');
  }

  /** Tool: search_knowledge(query) — 跨 entities/concepts 模糊搜索 */
  private toolSearchKnowledge(id: number | string | null, args: Record<string, unknown>): void {
    const query = (args.query as string || '').toLowerCase();
    if (!query) {
      this.sendError(id, -32602, 'Missing required argument: query');
      return;
    }
    const kbDir = this.getKnowledgeDir();
    const matches: Array<{ path: string; kind: string; firstLine: string }> = [];
    if (existsSync(kbDir)) {
      for (const kind of ['entities', 'concepts', 'comparisons', 'summaries'] as const) {
        const subDir = join(kbDir, kind);
        if (!existsSync(subDir)) continue;
        let files: string[] = [];
        try {
          files = readdirSync(subDir).filter((f) => f.endsWith('.md'));
        } catch {
          continue;
        }
        for (const f of files) {
          const fullPath = join(subDir, f);
          let content = '';
          try {
            content = readFileSync(fullPath, 'utf-8');
          } catch {
            continue;
          }
          const name = f.replace(/\.md$/, '');
          if (name.toLowerCase().includes(query) || content.toLowerCase().includes(query)) {
            const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('---')) || '';
            matches.push({ path: `${kind}/${f}`, kind, firstLine: firstLine.slice(0, 100) });
          }
        }
      }
    }
    const text = matches.length
      ? `[sofagent] 找到 ${matches.length} 个匹配:\n` + matches.map((m) => `- ${m.path}: ${m.firstLine}`).join('\n')
      : `[sofagent] 未找到匹配 "${query}" 的知识页`;
    // v1.1.8 新增：联邦结果异步合并（best-effort——federation 不可用/超时
    // 都不阻塞本地结果；peer 返回经 sensitivity 二次过滤 + trust 降权）
    this.sendToolResult(id, {
      type: 'text',
      text,
      data: { query, count: matches.length, matches },
    });
    void this.mergeFederationAsync(id, query);
  }

  /**
   * v1.1.8 新增：联邦查询异步合并（fire-and-forget）
   *
   * 动态探测 daemon federation 模块（经 optionalDependencies 显式依赖 @sofagent/daemon；
   * daemon 未安装 / OpenClaw 未启动 / 无配对 peer 时静默跳过）。
   * 有联邦结果时经 notification 推给客户端（data.source='federation'）。
   */
  private async mergeFederationAsync(id: number | string | null, query: string): Promise<void> {
    try {
      const fed = (await import('@sofagent/daemon/federation' as string)) as {
        withOfflineFallback?: unknown;
        listPeers?: unknown;
        loadOpenClawChannel?: unknown;
      };
      if (typeof fed.withOfflineFallback !== 'function' || typeof fed.listPeers !== 'function') return;
      const peers = (fed.listPeers as () => Array<{ peer: unknown }>)().map((s) => s.peer);
      if (peers.length === 0) return;
      const channel = typeof fed.loadOpenClawChannel === 'function'
        ? await (fed.loadOpenClawChannel as () => Promise<unknown>)()
        : null;
      if (!channel) return;
      // P0-9: peer 覆盖本地时告警（trust 排序已保证默认不覆盖；走到这里是显式配置或本地低信任）
      const overrides: string[] = [];
      const merged = await (fed.withOfflineFallback as (
        q: { text: string }, ps: unknown[], local: () => unknown[], ch: unknown,
        audit?: unknown, onPeerOverride?: (peerId: string, id: string) => void,
      ) => Promise<Array<{ id: string; title: string; source: string; trust: string; sensitivity: string; content: string }>>)(
        { text: query }, peers, () => [], channel, undefined,
        (peerId: string, entryId: string) => {
          overrides.push(`${peerId}:${entryId}`);
        },
      );
      const remote = merged.filter((m) => m.source !== 'local');
      if (remote.length > 0) {
        // P0-9 生产接线：联邦知识进入 Agent 上下文前必须过 8 层防护——
        // 层 5 排序（sortByTrust）+ 层 4 脱敏（redactForPrompt）+ 层 1 包裹（wrapUntrusted）。
        // 远端条目 trust 已由 query-router 强制为本地白名单等级（默认 user），
        // prepareForPrompt 会为 user/web 内容加 <untrusted source="federation"> 包裹。
        const typed = merged as unknown as Array<{
          id: string; title: string; content: string; source: string;
          trust: Trust; sensitivity: Sensitivity;
        }>;
        const sorted = sortByTrust(typed);
        const protectedRemote = sorted
          .filter((m) => m.source !== 'local')
          .map((m) => ({
            id: m.id,
            title: m.title,
            // 层 4 + 层 1：脱敏 + <untrusted> 包裹后才允许进入后续上下文
            protectedContent: prepareForPrompt(m.content, { trust: m.trust, sensitivity: m.sensitivity }, 'federation'),
            trust: m.trust,
            source: m.source,
          }));
        if (overrides.length > 0) {
          process.stderr.write(`[${SERVER_NAME}] ⚠️ 联邦 peer 覆盖本地知识条目: ${overrides.join(', ')}（请确认本地白名单信任配置）\n`);
        }
        process.stderr.write(`[${SERVER_NAME}] 联邦查询合并 ${remote.length} 条跨设备结果（已按本地 trust 白名单排序 + 脱敏 + <untrusted> 包裹）\n`);
        if (protectedRemote.length > 0) {
          process.stderr.write(`[${SERVER_NAME}] 联邦结果示例: ${protectedRemote[0]!.id} (trust=${protectedRemote[0]!.trust})\n`);
        }
      }
    } catch {
      // 静默——本地结果已返回，联邦只是增强
    }
  }

  /** Tool: read_entity(name) — 读单个 entity 页 */
  private toolReadEntity(id: number | string | null, args: Record<string, unknown>): void {
    const name = args.name as string | undefined;
    if (!name) {
      this.sendError(id, -32602, 'Missing required argument: name');
      return;
    }
    // 防路径穿越
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      this.sendError(id, -32602, 'Invalid name: must not contain path separators');
      return;
    }
    const file = join(this.getKnowledgeDir(), 'entities', `${name}.md`);
    if (!existsSync(file)) {
      this.sendToolResult(id, {
        type: 'text',
        text: `[sofagent] entity "${name}" 不存在`,
        data: { found: false, name },
      });
      return;
    }
    const content = readFileSync(file, 'utf-8');
    this.sendToolResult(id, {
      type: 'text',
      text: `[sofagent] entity: ${name}\n\n${content}`,
      data: { found: true, name, content },
    });
  }

  /** Tool: read_concept(name) — 读单个 concept 页 */
  private toolReadConcept(id: number | string | null, args: Record<string, unknown>): void {
    const name = args.name as string | undefined;
    if (!name) {
      this.sendError(id, -32602, 'Missing required argument: name');
      return;
    }
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      this.sendError(id, -32602, 'Invalid name: must not contain path separators');
      return;
    }
    const file = join(this.getKnowledgeDir(), 'concepts', `${name}.md`);
    if (!existsSync(file)) {
      this.sendToolResult(id, {
        type: 'text',
        text: `[sofagent] concept "${name}" 不存在`,
        data: { found: false, name },
      });
      return;
    }
    const content = readFileSync(file, 'utf-8');
    this.sendToolResult(id, {
      type: 'text',
      text: `[sofagent] concept: ${name}\n\n${content}`,
      data: { found: true, name, content },
    });
  }

  /** Tool: list_entities(domain?) — 列出所有 entity */
  private toolListEntities(id: number | string | null, args: Record<string, unknown>): void {
    const domain = args.domain as string | undefined;
    const dir = join(this.getKnowledgeDir(), 'entities');
    if (!existsSync(dir)) {
      this.sendToolResult(id, {
        type: 'text',
        text: '[sofagent] knowledge/entities 目录不存在',
        data: { entities: [], count: 0 },
      });
      return;
    }
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      files = [];
    }
    let entities = files.map((f) => f.replace(/\.md$/, ''));
    // domain 过滤：读文件检查 frontmatter 的 domain 字段
    if (domain) {
      entities = entities.filter((name) => {
        try {
          const content = readFileSync(join(dir, `${name}.md`), 'utf-8');
          return content.includes(`domain: ${domain}`) || content.includes(`domain:${domain}`);
        } catch {
          return false;
        }
      });
    }
    this.sendToolResult(id, {
      type: 'text',
      text: `[sofagent] entities${domain ? ` (domain: ${domain})` : ''} 共 ${entities.length} 个:\n` + entities.map((e) => `- ${e}`).join('\n'),
      data: { entities, count: entities.length, domain },
    });
  }

  /** Tool: read_lessons — 读 knowledge/lessons-missteps.md */
  private toolReadLessons(id: number | string | null): void {
    const file = join(this.getKnowledgeDir(), 'lessons-missteps.md');
    if (!existsSync(file)) {
      this.sendToolResult(id, {
        type: 'text',
        text: '[sofagent] lessons-missteps.md 不存在',
        data: { found: false },
      });
      return;
    }
    const content = readFileSync(file, 'utf-8');
    this.sendToolResult(id, {
      type: 'text',
      text: `[sofagent] lessons-missteps:\n\n${content}`,
      data: { found: true, content },
    });
  }

  /** Tool: read_think_md — 读 think.md 完整内容（首行必须 [sofagent] 前缀） */
  private toolReadThinkMd(id: number | string | null): void {
    const thinkPath = getThinkPath(getSofagentDataDir());
    if (!existsSync(thinkPath)) {
      this.sendToolResult(id, {
        type: 'text',
        text: '[sofagent] think.md 不存在',
        data: { found: false },
      });
      return;
    }
    const content = readFileSync(thinkPath, 'utf-8');
    // v1.1.3 盲区 6 教训：返回值首行必须带 [sofagent] 前缀（三层签名铁律）
    this.sendToolResult(id, {
      type: 'text',
      text: `[sofagent] think.md:\n\n${content}`,
      data: { found: true, content },
    });
  }

  /** Tool: stats — knowledge 库统计 */
  private toolStats(id: number | string | null): void {
    const kbDir = this.getKnowledgeDir();
    const count = (sub: string): number => {
      const dir = join(kbDir, sub);
      if (!existsSync(dir)) return 0;
      try {
        return readdirSync(dir).filter((f) => f.endsWith('.md')).length;
      } catch {
        return 0;
      }
    };
    const lastUpdate = (): string | null => {
      if (!existsSync(kbDir)) return null;
      let latest = 0;
      for (const sub of ['entities', 'concepts', 'comparisons', 'summaries']) {
        const dir = join(kbDir, sub);
        if (!existsSync(dir)) continue;
        try {
          for (const f of readdirSync(dir)) {
            try {
              const mtime = statSync(join(dir, f)).mtimeMs;
              if (mtime > latest) latest = mtime;
            } catch {
              /* skip */
            }
          }
        } catch {
          /* skip */
        }
      }
      return latest > 0 ? new Date(latest).toISOString() : null;
    };
    const stats = {
      entities: count('entities'),
      concepts: count('concepts'),
      comparisons: count('comparisons'),
      summaries: count('summaries'),
      lastUpdate: lastUpdate(),
    };
    this.sendToolResult(id, {
      type: 'text',
      text: `[sofagent] knowledge 统计: entities=${stats.entities} concepts=${stats.concepts} comparisons=${stats.comparisons} summaries=${stats.summaries} lastUpdate=${stats.lastUpdate || 'N/A'}`,
      data: stats,
    });
  }

  /** Tool: data_sovereignty_report — 数据主权审计摘要（v1.2.2 P0） */
  private toolDataSovereigntyReport(id: number | string | null, args: Record<string, unknown>): void {
    try {
      const result = queryDataSovereigntyReport({ date: args.date as string | undefined });
      this.sendToolResult(id, {
        type: 'text',
        text: result.text,
        data: result.data,
      });
    } catch (err) {
      this.sendToolResult(id, {
        type: 'text',
        text: `[sofagent] 数据主权审计查询失败：${err instanceof Error ? err.message : String(err)}`,
        data: { ok: false },
      });
    }
  }

  // ============================================================
  // v1.2.4 P3 S2/S4/S5 新增 tools
  // ============================================================

  /** Tool: create_entity — 创建/更新 entity（含 S4 数据审计 + S5 isError） */
  private toolCreateEntity(id: number | string | null, args: Record<string, unknown>): void {
    const name = args.name as string | undefined;
    const domain = args.domain as string | undefined;
    const content = args.content as string | undefined;
    if (!name || !domain || !content) {
      this.sendError(id, -32602, 'Missing required argument: name, domain, and content are required');
      return;
    }
    const result = createEntity({
      name,
      domain,
      content,
      ...(args.relations ? { relations: args.relations as string } : {}),
    });
    this.sendToolResultWithFlag(id, result.text, result.data, result.data.isError);
  }

  /** Tool: create_concept — 创建/更新 concept（含 S4 数据审计 + S5 isError） */
  private toolCreateConcept(id: number | string | null, args: Record<string, unknown>): void {
    const name = args.name as string | undefined;
    const content = args.content as string | undefined;
    if (!name || !content) {
      this.sendError(id, -32602, 'Missing required argument: name and content are required');
      return;
    }
    const result = createConcept({ name, content });
    this.sendToolResultWithFlag(id, result.text, result.data, result.data.isError);
  }

  /** Tool: validate_ontology — 本体结构完整性校验 */
  private toolValidateOntology(id: number | string | null, args: Record<string, unknown>): void {
    const result = validateOntology({
      ...(args.fix !== undefined ? { fix: args.fix as boolean } : {}),
    });
    this.sendToolResult(id, {
      type: 'text',
      text: result.text,
      data: result.data,
    });
  }

  /** Tool: evaluate_output — golden set 评估 */
  private async toolEvaluateOutput(id: number | string | null, args: Record<string, unknown>): Promise<void> {
    const result = await evaluateOutput({
      ...(args.golden_set_path ? { golden_set_path: args.golden_set_path as string } : {}),
      ...(args.verbose !== undefined ? { verbose: args.verbose as boolean } : {}),
    });
    this.sendToolResult(id, {
      type: 'text',
      text: result.text,
      data: result.data,
    });
  }

  /** Tool: optimize_skill — Skill 优化 */
  private toolOptimizeSkill(id: number | string | null, args: Record<string, unknown>): void {
    const skillPath = args.skill_path as string | undefined;
    if (!skillPath) {
      this.sendError(id, -32602, 'Missing required argument: skill_path');
      return;
    }
    const result = optimizeSkill({
      skill_path: skillPath,
      ...(args.check_only !== undefined ? { check_only: args.check_only as boolean } : {}),
    });
    this.sendToolResult(id, {
      type: 'text',
      text: result.text,
      data: result.data,
    });
  }

  /** Tool: health_check — 环境健康检查 */
  private toolHealthCheck(id: number | string | null, args: Record<string, unknown>): void {
    try {
      const result = healthCheck({
        ...(args.mode ? { mode: args.mode as 'doctor' | 'verify' } : {}),
        ...(args.platform ? { platform: args.platform as string } : {}),
      });
      this.sendToolResult(id, {
        type: 'text',
        text: result.text,
        data: result.data,
      });
    } catch (err) {
      this.sendToolResult(id, {
        type: 'text',
        text: `[sofagent] 健康检查失败: ${err instanceof Error ? err.message : String(err)}`,
        data: { allOk: false, checks: [], mode: args.mode ?? 'doctor' },
      });
    }
  }

  /** Tool: audit_data_change — 数据变更审计（S4 + S5 isError） */
  private toolAuditDataChange(id: number | string | null, args: Record<string, unknown>): void {
    const result = auditDataChange({
      ...(args.scope ? { scope: args.scope as 'recent' | 'entity' | 'concept' | 'all' } : {}),
      ...(args.name ? { name: args.name as string } : {}),
      ...(args.count !== undefined ? { count: args.count as number } : {}),
    });
    this.sendToolResultWithFlag(id, result.text, result.data, result.data.isError);
  }

  /** Tool: notify_session — 审计结果汇报（S5） */
  private toolNotifySession(id: number | string | null, args: Record<string, unknown>): void {
    const auditType = args.audit_type as 'code' | 'data' | 'file' | undefined;
    const verdict = args.verdict as 'PASS' | 'WARN' | 'FAIL' | undefined;
    const summary = args.summary as string | undefined;
    if (!auditType || !verdict || !summary) {
      this.sendError(id, -32602, 'Missing required arguments: audit_type, verdict, and summary are required');
      return;
    }
    const result = notifySession({
      audit_type: auditType,
      verdict,
      summary,
      ...(args.details ? { details: args.details as string[] } : {}),
      ...(args.think_ref !== undefined ? { think_ref: args.think_ref as boolean } : {}),
    });
    this.sendToolResult(id, {
      type: 'text',
      text: result.text,
      data: result.data,
    });
  }

  /** Tool: activate_workflow — 激活企业工作流（v1.2.5 新增） */
  private async toolActivateWorkflow(id: number | string | null, args: Record<string, unknown>): Promise<void> {
    const result = await activateWorkflowTool({
      ...(args.dry_run !== undefined ? { dry_run: args.dry_run as boolean } : {}),
      ...(args.node_filter !== undefined ? { node_filter: args.node_filter as string[] } : {}),
    });
    this.sendToolResult(id, {
      type: 'text',
      text: result.text,
      data: result.data,
    });
  }

  /** Tool: list_capabilities — 完整能力清单（Agent 首次连接用） */
  private toolListCapabilities(id: number | string | null): void {
    const capabilities = {
      tools: [
        { name: 'run_audit', description: '对 git diff 跑全量审计规则（21 条）' },
        { name: 'get_think', description: '读取 think.md 最近 N 条反思条目' },
        { name: 'write_think', description: '向 think.md 追加反思记录' },
        { name: 'sofagent_compose', description: '编排引擎——产出 Sub Agent 编排方案 YAML' },
        { name: 'audit_file', description: '单文件变更即时审计（A3/A7/A11/A18 + 可选 A14）' },
        { name: 'search_knowledge', description: '跨 entities/concepts 模糊搜索' },
        { name: 'read_entity', description: '读单个 entity 页' },
        { name: 'read_concept', description: '读单个 concept 页' },
        { name: 'list_entities', description: '列出所有 entity（可选 domain 过滤）' },
        { name: 'read_lessons', description: '读 lessons-missteps.md' },
        { name: 'read_think_md', description: '读 think.md 完整内容（含 [sofagent] 前缀）' },
        { name: 'stats', description: 'knowledge 库统计' },
        { name: 'list_capabilities', description: '返回本能力清单' },
        { name: 'data_sovereignty_report', description: '查询数据主权审计报告摘要（today/yesterday/YYYY-MM-DD）' },
        // v1.2.4 P3 新增
        { name: 'create_entity', description: '创建/更新 entity（含 D1-D5 数据审计）' },
        { name: 'create_concept', description: '创建/更新 concept（含 D1-D5 数据审计）' },
        { name: 'validate_ontology', description: '本体结构完整性校验' },
        { name: 'evaluate_output', description: '用 golden set 评估 Agent 产出质量' },
        { name: 'optimize_skill', description: '优化 Skill 文件（skillopt 引擎）' },
        { name: 'health_check', description: '环境健康检查（doctor/verify）' },
        { name: 'audit_data_change', description: '数据变更审计（D1-D5 规则）' },
        { name: 'notify_session', description: '审计结果汇报（预格式化 [sofagent] 返回）' },
        // v1.2.5 新增
        { name: 'activate_workflow', description: '激活 FDE 交付物，注册企业 SubAgent' },
      ],
      resources: [
        { uri: 'think://latest', description: 'think.md 最后一条条目' },
        { uri: 'logs://today', description: '今日任务日志' },
        { uri: 'audit://last-report', description: '最近一次审计报告' },
        { uri: 'orchestrator://latest-comparison', description: '最新 A/B 对比报告' },
      ],
      auditEngine: `sofagent-audit v${SERVER_VERSION}`,
      rulesCount: 21,
    };
    const lines: string[] = ['[sofagent] 能力清单:', ''];
    lines.push('Tools:');
    for (const t of capabilities.tools) lines.push(`  - ${t.name}: ${t.description}`);
    lines.push('');
    lines.push('Resources:');
    for (const r of capabilities.resources) lines.push(`  - ${r.uri}: ${r.description}`);
    lines.push('');
    lines.push(`Audit engine: ${capabilities.auditEngine} (${capabilities.rulesCount} 条规则)`);
    this.sendToolResult(id, {
      type: 'text',
      text: lines.join('\n'),
      data: capabilities,
    });
  }

  // ============================================================
  // resources/list
  // ============================================================
  private handleResourcesList(id: number | string | null): void {    this.sendResult(id, {
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
    const thinkPath = getThinkPath(dataDir);

    if (!existsSync(thinkPath)) {
      this.sendResult(id, {
        contents: [
          {
            uri: 'think://latest',
            mimeType: 'text/markdown',
            text: '[sofagent] think.md 不存在。运行审计后会自动生成反思条目。',
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
          text: lastEntry ? (lastEntry.startsWith('## ') ? lastEntry : '## ' + lastEntry) : '[sofagent] (无反思条目)',
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
            text: '[sofagent] (日志目录不存在)',
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
            text: `[sofagent] (今日 ${todayStr} 无任务日志)`,
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
            text: JSON.stringify({ message: '[sofagent] 无审计历史记录。运行审计后会自动生成。' }),
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
  private sendToolResult(id: number | string | null, payload: { type: string; text: string; data?: unknown; isError?: boolean }): void {
    this.sendResult(id, {
      content: [
        {
          type: payload.type,
          text: payload.text,
        },
      ],
      ...(payload.isError ? { isError: true } : {}),
      ...(payload.data !== undefined ? { _meta: { data: payload.data } } : {}),
    });
  }

  /**
   * 发送 Tool 调用结果（支持 L3 isError 标记 · v1.2.4 S5 新增）
   *
   * MCP 协议中 isError: true 的 tool 结果会被大多数 Agent 框架自动展示给用户。
   * 用于审计 FAIL / 数据写入被拦截时强制冒泡。
   */
  private sendToolResultWithFlag(id: number | string | null, text: string, data: unknown, isError: boolean): void {
    this.sendResult(id, {
      content: [
        {
          type: 'text',
          text,
        },
      ],
      ...(data !== undefined ? { _meta: { data } } : {}),
      ...(isError ? { isError: true } : {}),
    });
  }

  /**
   * S5 L4: webhook 推送（双通道留痕）
   *
   * 从 config.yml 读取 webhook 配置，WARN/FAIL 时推送到企业 IM。
   * 推送失败不阻断审计（非致命降级）。
   */
  private async pushAuditWebhook(verdict: string, task: string | undefined, results: AuditResult): Promise<void> {
    try {
      const config = loadConfig();
      const webhookConfig = (config as unknown as Record<string, unknown>)?.['webhook'] as
        | { enabled?: boolean; platform?: string; url?: string }
        | undefined;

      if (!webhookConfig?.enabled || !webhookConfig.url) return;

      const { pushAuditResult } = await import('@sofagent/audit');
      await pushAuditResult({
        platform: (webhookConfig.platform as 'dingtalk' | 'feishu' | 'wecom') ?? 'dingtalk',
        url: webhookConfig.url,
        task,
        rules: results.rules,
        exitCode: results.exitCode,
      });
    } catch {
      // webhook 推送失败非致命——静默忽略
    }
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
