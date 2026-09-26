// ============================================================
// tool-registry.ts · MCP tools/list schema definitions
// v1.5.2: 从 mcp-server.ts 提取
// ============================================================

import { VERSION } from '@sofagent/audit';
// v1.4.9 深模块条目 5：handler 实现 import（查表分发目标——原 mcp-server switch 分发迁入）
import { runAudit, type WebhookPushFn } from './tools/audit-tools';
import { auditFile } from './tools/audit-file';
import { getThink, writeThink, readThinkMd, readLessons } from './tools/think-tools';
import { searchKnowledge, mergeFederationAsync, readEntity, readConcept, listEntities, stats } from './tools/knowledge-tools';
import { compose } from './tools/orchestrator-tools';
import { listCapabilities } from './tools/report-tools';
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
// v1.4.9 G9（T1）：设备注册面两 tool——注册（fail-closed 验签）+ 清单（在线态）
import { deviceRegister } from './tools/device-register';
import { deviceList } from './tools/device-list';
import { deviceDataQuery } from './tools/device-data-query';
import { deviceDataPush } from './tools/device-data-push';
// v1.4.9 G5b/G1（T4/T5）：连接器注册面 + workflow 模板导出导入
import { connectorRegister, connectorList } from './tools/connector-list';
import { workflowExport } from './tools/workflow-export';
import { workflowImport } from './tools/workflow-import';
import { worklogQuery } from './tools/worklog-query';
import { costQuery } from './tools/cost-query';
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
import { commonsPublish } from './tools/commons-publish';
import { commonsSearch } from './tools/commons-search';
import { commonsInvoke } from './tools/commons-invoke';
import { commonsRate } from './tools/commons-rate';
import { commonsRetire } from './tools/commons-retire';
import { commonsHarvestRule } from './tools/commons-harvest-rule';
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
import { trainStatusTool } from './tools/train-status';
import { trainListTool } from './tools/train-list';
import { trainDiagnoseTool } from './tools/train-diagnose';
import { trainDeliverableTool } from './tools/train-deliverable';
import { fdeInterviewTool, type FdeInterviewArgs } from './tools/fde-interview';
import { fdeClassifyTool, type FdeClassifyArgs } from './tools/fde-classify';
import { fdeQuantifyTool, type FdeQuantifyArgs } from './tools/fde-quantify';
import { fdeDeriveTool, type FdeDeriveArgs } from './tools/fde-derive';
import { fdeDistillTool, type FdeDistillArgs } from './tools/fde-distill';
import { fdeDeployTool, type FdeDeployArgs } from './tools/fde-deploy';
import { corpusExport, type CorpusExportArgs } from './tools/corpus-export';
import { trainServeTool } from './tools/train-serve';
import { trainComplianceTool } from './tools/train-compliance';
import { trainCloud } from './tools/train-cloud';
import { defineAcceptance, checkAcceptance } from './tools/acceptance';
import {
  workflowCreate as workflowCreateTool,
  workflowUpdate as workflowUpdateTool,
  workflowNodeAdd as workflowNodeAddTool,
  workflowDiffPreview as workflowDiffPreviewTool,
} from './tools/workflow-crud';
import { workflowGaps } from './tools/workflow-gaps';
import { onboardPrompt } from './tools/onboard-prompt';
import { prSubmit, prReview, prMerge } from './tools/pr-tools';
import { contributionQuery } from './tools/contribution-query';
import { dataPush } from './tools/data-push-tool';
// v1.4.9 T7：router 过站 session 承接（伴生 exporter 推送入口——最后一个新 tool）
import { routerSessionPush } from './tools/router-session-push';
import { traceReconcileTool, type TraceReconcileArgs } from './tools/trace-reconcile';
// v1.5.2 章一/章二：审计对外两面——只读数据查询（audit_query）+ 规则集导出（ruleset_export）
import { auditQuery } from './tools/audit-query';
import { rulesetExport } from './tools/ruleset-export';

/**
 * 工具定义（MCP tools/list 返回的 schema）
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** v1.4.0：角色分层标签——工具所属角色面（一个工具可多面）。缺省 = 始终暴露（动态工具未打标）。 */
  roles?: string[];
  /**
   * v1.4.8 深模块条目 5：执行 handler（查表分发目标）。
   * 🔴 文本 SSOT 硬约束：check-version/check-storefront/check-docs/gen-api-tools
   * 四个解析器按「name → [roles] → description → inputSchema」正则读本文件，
   * handler 只能追加在此顺序之后，字段顺序不可变。
   * ctx 参数（pushAuditWebhook 等）经 rest 传递（需要 ctx 的工具声明双参）。批一骨架阶段可选——无 handler 的工具回退 mcp-server switch（零行为变化）；
   * 迁移完成后设必填并删除 switch。
   */
  handler?: ToolHandler;
}

/** 工具结果（handler 产出——与 mcp-server sendTool 消费面同构；data 形态对齐 tools/audit-tools 既有 ToolResult 的 unknown 宽面） */
export interface ToolResult {
  text: string;
  data: unknown;
  /** isError 标记（sendTool 第三参） */
  isError?: boolean;
}

/** 工具错误（handler 以 -32602 JSON-RPC error 形式返回——对齐 mcp-server sendTool 的 isToolError 通道） */
export interface ToolDispatchError {
  error: string;
}

/** 工具执行上下文（需要审计 webhook 的 handler 声明第二参消费） */
export interface ToolHandlerContext {
  pushAuditWebhook: WebhookPushFn;
}

/** 工具执行 handler 类型（v1.4.8 条目 5——ctx 可选：无副作用工具免声明） */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx?: ToolHandlerContext,
) => ToolResult | ToolDispatchError | Promise<ToolResult | ToolDispatchError>;

/**
 * 完整工具清单——103 个 tool（v2.0.0 §七 B 表裁定退役（registry 注销）：playwright_navigate/click/screenshot/assert 四件移出——107→103；v1.5.2 章一/章二：audit_query 新增——审计数据只读查询（history 三维过滤 + decision 因果链，严格只读不写链）；ruleset_export 新增——规则集导出（25 条默认规则 + 已加载扩展 → 标准 JSON，与 --ruleset-path 加载格式同构双向可逆 + 内容指纹 + 审计留痕）（105→107）；v1.5.0 章八：trace_reconcile 新增——跨层证据对账（104→105：DSH trace vs git diff vs logs 三源比对四态判定 + 模型层回溯链 + 对账结果入 decision-log kind=COVERAGE）；v1.4.9 T7：router_session_push 新增——session 承接面（103→104 终值：97→104 = 批 1 +2、批 2 +2、批 3 +4、批 5 +1；router 伴生 exporter 推送入口，schema 校验 + 本地落盘 + HMAC 挂链 + usage 入 cost 台账）；v1.4.9 G9：device_register/device_list 新增——设备注册面（95→97，T1 设备身份验签 fail-closed + 清单在线态）；v1.4.7：data_push 新增——标准数据推送入口（94→95 终值）；contribution_query 新增——G4 绩效数据导出（93→94）；pr_submit/pr_review/pr_merge 三 tool 新增——G13 PR 生命周期（90→93）；onboard_prompt 新增——上岗 prompt 生成器（89→90）；workflow_gaps 新增——G2 能力缺口查询（88→89）；workflow_create/workflow_update/workflow_node_add/workflow_diff_preview 四 tool 新增——G14 workflow 对象化 CRUD（84→88）；v1.4.6：train_cloud 新增——83→84，云 VM 执行面控制工具；v1.4.5：train_serve/train_compliance/train_deliverable 三件齐——80→83，SKILL.md/ARCHITECTURE 等九处 SSOT 同步收口；v1.4.4：corpus_export 新增；v1.4.3：train_status/train_list/train_diagnose 新增；v1.4.2：fde_interview/fde_classify/fde_quantify/fde_derive/fde_distill/fde_deploy 六引擎 + train_doctor/train_dryrun/train_report 新增；v1.4.1：train_submit 新增；v1.4.0：cost_query + browser 4 新增；v1.3.9：worklog_query 新增；v1.3.6：workflow_submit/ontology_import/model_register/model_switch/model_unregister/train_budget/define_acceptance/check_acceptance；v1.3.5：run_ab_test/promote_ab/snapshot_list/snapshot_restore；v1.3.4：commons_publish/search/invoke/rate/retire/harvest_rule；不含 4 个 resource shortcut）
 */
export const TOOLS: ToolDef[] = [
  {
    // v1.3.9（三）：AI 工作明细查询——三源聚合（审计+决策+LLM Trace）零新数据
    name: 'worklog_query',
    roles: ['ops'],
    description: '按 Agent / Workflow / 周趋势查询 AI 工作明细（任务/token/耗时/成本/人工介入），可附带进化四维趋势。',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: '按 Agent 过滤（缺省全量）' },
        workflowId: { type: 'string', description: '按 Workflow 过滤（缺省全量）' },
        weeklyTrend: { type: 'boolean', description: '附带周趋势（活跃度/成功率/成本）', default: false },
        evolution: { type: 'boolean', description: '附带进化四维趋势', default: false },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => worklogQuery({ ...(args.agentId ? { agentId: args.agentId as string } : {}), ...(args.workflowId ? { workflowId: args.workflowId as string } : {}), ...(args.weeklyTrend !== undefined ? { weeklyTrend: args.weeklyTrend as boolean } : {}), ...(args.evolution !== undefined ? { evolution: args.evolution as boolean } : {}) }),
  },
  {
    // v1.4.0（三）：成本审计查询——预算/实际消耗/超限记录（商业平台 G3 计量接口预留）
    name: 'cost_query',
    roles: ['ops'],
    description: '查询成本审计——预算配置 / 各 Agent 实际消耗（token/成本）/ 超限记录（WARN 级）。',
    inputSchema: {
      type: 'object',
      properties: {
        maxTokensPerRun: { type: 'number', description: '查询时临时指定单 run token 上限（不传则仅报实际消耗）' },
        maxCostPerDay: { type: 'number', description: '查询时临时指定每日成本上限（USD）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => costQuery({ ...(args.maxTokensPerRun !== undefined ? { budget: { maxTokensPerRun: args.maxTokensPerRun as number, ...(args.maxCostPerDay !== undefined ? { maxCostPerDay: args.maxCostPerDay as number } : {}) } } : {}) }),
  },
  {
    name: 'run_audit',
    roles: ['audit'],
    description: '对 git diff 运行全量审计（25 条规则），返回结构化审计报告。',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'git diff 范围（如 HEAD~1..HEAD）。默认 HEAD~1..HEAD', default: 'HEAD~1..HEAD' },
        task: { type: 'string', description: '任务描述（用于 A3 不改越界检查）' },
        strict: { type: 'boolean', description: '严格模式：无日志时 A7/A8 返回 FAIL 而非 WARN', default: false },
        silent: { type: 'boolean', description: '沉默模式：跳过日志依赖规则，走 diff 启发式回退', default: false },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args, ctx?) => runAudit(args, ctx?.pushAuditWebhook),
  },
  {
    name: 'get_think',
    roles: ['fde', 'eval'],
    description: '读取 think.md 的最新反思条目。',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '返回最近 N 条反思条目（默认 1）', default: 1 },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => getThink(args),
  },
  {
    name: 'write_think',
    roles: ['fde', 'eval'],
    description: '向 think.md 追加一条手动反思记录。',
    inputSchema: {
      type: 'object',
      properties: {
        lesson: { type: 'string', description: '反思内容 / 教训描述' },
        task: { type: 'string', description: '关联的任务名称（可选）' },
      },
      required: ['lesson'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => writeThink(args),
  },
  {
    // v1.5.2 A-4：由 'sofagent_compose' 统一为 'compose'（107 个 tool 中唯一带前缀项的命名收口）。
    // 旧名经 mcp-server.ts tools/call 分派层别名路由兼容一版。
    name: 'compose',
    roles: ['fde'],
    description: '编排模块——传入任务描述，返回 Sub Agent 编排方案（YAML）。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务描述' },
        agent: { type: 'string', description: '指定 Sub Agent（可选）' },
        run: { type: 'boolean', description: '是否执行（默认 false = dry-run）' },
      },
      required: ['task'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => compose(args),
  },
  {
    name: 'audit_file',
    roles: ['audit'],
    description: '单文件变更即时审计——Agent 编辑文件时调用，跑单文件适用规则，返回结构化结果（不阻断）。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '变更文件路径（必填）' },
        change_type: { type: 'string', enum: ['create', 'modify', 'delete'], description: '变更类型：create / modify / delete' },
        diff: { type: 'string', description: '文件变更 diff 内容（可选，用于 A2/A9 等内容级规则）' },
        task: { type: 'string', description: '任务描述（可选，传入时启用 A3/A14 上下文规则）' },
      },
      required: ['path', 'change_type'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args, ctx?) => auditFile(args, ctx?.pushAuditWebhook),
  },
  {
    name: 'search_knowledge',
    roles: ['fde', 'audit', 'eval'],
    description: '跨 entities/concepts 模糊搜索知识库。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（模糊匹配页面名 + 内容）' },
      },
      required: ['query'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { const r = searchKnowledge(args); void mergeFederationAsync(args.query as string); return r; },
  },
  {
    name: 'read_entity',
    roles: ['fde'],
    description: '读取单个 entity 页。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'entity 名称（不含 .md 后缀）' },
      },
      required: ['name'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => readEntity(args),
  },
  {
    name: 'read_concept',
    roles: ['fde'],
    description: '读取单个 concept 页。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'concept 名称（不含 .md 后缀）' },
      },
      required: ['name'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => readConcept(args),
  },
  {
    name: 'list_entities',
    roles: ['fde'],
    description: '列出所有 entity（可选按 domain 过滤）。',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'domain 过滤（可选）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => listEntities(args),
  },
  {
    name: 'read_lessons',
    roles: ['fde', 'eval', 'audit'],
    description: '读取踩坑记录（lessons-missteps.md）。',
    inputSchema: { type: 'object', properties: {} },
    // v1.4.8 条目 5 首批迁移：查表分发
    handler: (_args, _ctx?) => readLessons(),
  },
  {
    name: 'read_think_md',
    roles: ['fde', 'eval'],
    description: '读取 think.md 完整内容。',
    inputSchema: { type: 'object', properties: {} },
    // v1.4.8 条目 5 首批迁移：查表分发
    handler: (_args, _ctx?) => readThinkMd(),
  },
  {
    name: 'stats',
    roles: ['ops'],
    description: '知识库统计（entities/concepts 数 + 最后更新时间）。',
    inputSchema: { type: 'object', properties: {} },
    // v1.4.8 条目 5 首批迁移：查表分发
    handler: (_args, _ctx?) => stats(),
  },
  {
    name: 'list_capabilities',
    // v1.4.0 修正：能力发现元工具不归任何角色面（原 roles:['ops'] 致专职收窄时被过滤，
    // Agent 首次连接拿不到能力地图——S59 回归抓出）。未打标 = 始终暴露（同动态工具机制）。
    description: '返回完整能力清单（tools + resources）——Agent 首次连上时获取能力地图。',
    inputSchema: { type: 'object', properties: {} },
    // v1.4.8 条目 5 首批迁移：查表分发
    handler: (_args, _ctx?) => listCapabilities(),
  },
  {
    name: 'data_sovereignty_report',
    roles: ['audit'],
    description: '查询数据主权审计报告摘要（云端调用/本地执行/数据流出/敏感本地处理率）。',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '查询日期：today / yesterday / YYYY-MM-DD（默认 today）', default: 'today' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { try { return queryDataSovereigntyReport({ date: args.date as string | undefined }); } catch (e) { return { text: `[sofagent] 数据主权审计查询失败：${e instanceof Error ? e.message : String(e)}`, data: { ok: false } }; } },
  },
  {
    name: 'create_entity',
    roles: ['fde'],
    description: '创建/更新 entity 页。写入前跑数据审计，FAIL 拒绝写入。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'entity 名称（不含 .md 后缀，将作为文件名）' },
        domain: { type: 'string', description: '业务域归属（如 财务/人事/供应链）' },
        content: { type: 'string', description: 'entity 页面内容（Markdown 格式，含 frontmatter）' },
        relations: { type: 'string', description: 'JSON 格式的关联关系（belongs_to / has_many），可选' },
      },
      required: ['name', 'domain', 'content'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.name || !args.domain || !args.content) { return { error: 'Missing required argument: name, domain, and content are required' }; } const r = createEntity({ name: args.name as string, domain: args.domain as string, content: args.content as string, ...(args.relations ? { relations: args.relations as string } : {}) }); return { ...r, isError: r.data.isError }; },
  },
  {
    name: 'create_concept',
    roles: ['fde'],
    description: '创建/更新 concept 页。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'concept 名称' },
        content: { type: 'string', description: 'concept 内容（Markdown）' },
      },
      required: ['name', 'content'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.name || !args.content) { return { error: 'Missing required argument: name and content are required' }; } const r = createConcept({ name: args.name as string, content: args.content as string }); return { ...r, isError: r.data.isError }; },
  },
  {
    // v1.3.1 (交付 5)：Ontology CRUD 补全——字段级更新
    name: 'update_entity',
    roles: ['fde'],
    description: '字段级更新 entity 页（只改传入字段，保留其余）。写入前跑数据审计。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '现有 entity 名称（不含 .md 后缀，定位目标文件）' },
        newName: { type: 'string', description: '可选：改名（新名称，不含 .md 后缀）' },
        domain: { type: 'string', description: '可选：改业务域归属' },
        description: { type: 'string', description: '可选：改 entity 简述' },
        relations: { type: 'string', description: '可选：JSON 格式关联关系（belongs_to / has_many），整体替换 relations' },
        content: { type: 'string', description: '可选：正文内容（Markdown body，不含 frontmatter；省略 = 保留原正文）' },
      },
      required: ['name'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.name) { return { error: 'Missing required argument: name is required' }; } const ur = updateEntity({ name: args.name as string, ...(args.newName ? { newName: args.newName as string } : {}), ...(args.domain !== undefined ? { domain: args.domain as string } : {}), ...(args.description !== undefined ? { description: args.description as string } : {}), ...(args.relations !== undefined ? { relations: args.relations as string } : {}), ...(args.content !== undefined ? { content: args.content as string } : {}) }); return { ...ur, isError: ur.data.isError }; },
  },
  {
    // v1.3.1 (交付 5)：Ontology CRUD 补全——删除 entity，强制人审
    name: 'delete_entity',
    roles: ['fde'],
    description: '删除 entity 页。🔴 破坏性操作，必须 confirmed:true 才执行。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'entity 名称（不含 .md 后缀）' },
        confirmed: { type: 'boolean', description: '人工确认标志——必须显式 true 才执行删除' },
      },
      // v1.4.8 条目 5 勘误固化：confirmed 刻意保留在 required（破坏性操作的显式声明），
      // 但 dispatch 不强制它——confirmed !== true 走「需人工确认」提示的非错误路径（human-confirmed 语义）。
      required: ['name', 'confirmed'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.name) { return { error: 'Missing required argument: name is required' }; } const dr = deleteEntity({ name: args.name as string, confirmed: args.confirmed === true }); return { ...dr, isError: dr.data.isError }; },
  },
  {
    // v1.3.1 (交付 5)：Ontology CRUD 补全——删除 concept，强制人审
    name: 'delete_concept',
    roles: ['fde'],
    description: '删除 concept 页。🔴 破坏性操作，必须 confirmed:true 才执行。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'concept 名称（不含 .md 后缀）' },
        confirmed: { type: 'boolean', description: '人工确认标志——必须显式 true 才执行删除' },
      },
      // v1.4.8 条目 5 勘误固化：confirmed 刻意保留在 required（破坏性操作的显式声明），
      // 但 dispatch 不强制它——confirmed !== true 走「需人工确认」提示的非错误路径（human-confirmed 语义）。
      required: ['name', 'confirmed'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.name) { return { error: 'Missing required argument: name is required' }; } const cr = deleteConcept({ name: args.name as string, confirmed: args.confirmed === true }); return { ...cr, isError: cr.data.isError }; },
  },
  {
    name: 'validate_ontology',
    roles: ['fde'],
    description: '检查本体数据完整性——实体数/关联断裂/孤儿实体/死链。',
    inputSchema: {
      type: 'object',
      properties: {
        fix: { type: 'boolean', description: '是否自动修复可修复的问题（如孤儿实体标记），默认 false' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => validateOntology({ ...(args.fix !== undefined ? { fix: args.fix as boolean } : {}) }),
  },
  {
    name: 'evaluate_output',
    roles: ['eval'],
    description: '用 golden set 评估 Agent 产出质量，返回评分 + 失败用例。',
    inputSchema: {
      type: 'object',
      properties: {
        golden_set_path: { type: 'string', description: 'golden set 文件路径（默认使用内置 golden set）' },
        verbose: { type: 'boolean', description: '是否输出详细报告', default: false },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => evaluateOutput({ ...(args.golden_set_path ? { golden_set_path: args.golden_set_path as string } : {}), ...(args.verbose !== undefined ? { verbose: args.verbose as boolean } : {}) }),
  },
  {
    name: 'optimize_skill',
    roles: ['eval'],
    description: '优化指定 Skill 文件，生成优化建议。',
    inputSchema: {
      type: 'object',
      properties: {
        skill_path: { type: 'string', description: 'Skill 文件路径（必填）' },
        check_only: { type: 'boolean', description: '仅做安全扫描不优化，默认 false' },
      },
      required: ['skill_path'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.skill_path) { return { error: 'Missing required argument: skill_path' }; } return optimizeSkill({ skill_path: args.skill_path as string, ...(args.check_only !== undefined ? { check_only: args.check_only as boolean } : {}) }); },
  },
  {
    name: 'health_check',
    roles: ['ops'],
    description: '运行环境健康检查（环境/配置/数据目录/Hook/依赖）。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['doctor', 'verify'], description: '检查模式：doctor（基础健康）/ verify（装后验证），默认 doctor' },
        platform: { type: 'string', description: '平台（workbuddy/openclaw/claude/codex/hermes），仅 verify 模式使用' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { try { return healthCheck({ ...(args.mode ? { mode: args.mode as 'doctor' | 'verify' } : {}), ...(args.platform ? { platform: args.platform as string } : {}) }); } catch (e) { return { text: `[sofagent] 健康检查失败: ${e instanceof Error ? e.message : String(e)}`, data: { allOk: false, checks: [], mode: args.mode ?? 'doctor' } }; } },
  },
  {
    name: 'audit_data_change',
    roles: ['audit'],
    description: '对知识库结构化数据变更跑数据审计（D1-D5）。',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['recent', 'entity', 'concept', 'all'], description: '审计范围', default: 'recent' },
        name: { type: 'string', description: 'entity/concept 名称（scope 为 entity/concept 时必填）' },
        count: { type: 'number', description: '最近 N 次变更（scope 为 recent 时），默认 10' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { const r = auditDataChange({ ...(args.scope ? { scope: args.scope as 'recent' | 'entity' | 'concept' | 'all' } : {}), ...(args.name ? { name: args.name as string } : {}), ...(args.count !== undefined ? { count: args.count as number } : {}) }); return { ...r, isError: r.data.isError }; },
  },
  {
    name: 'notify_session',
    roles: ['audit'],
    description: '向当前 session 推送审计结果摘要（确保结果可见）。',
    inputSchema: {
      type: 'object',
      properties: {
        audit_type: { type: 'string', enum: ['code', 'data', 'file'], description: '审计类型' },
        verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'], description: '审计判定' },
        summary: { type: 'string', description: '审计摘要（1-2 句话）' },
        details: { type: 'array', items: { type: 'string' }, description: '违规/警告详情列表' },
        think_ref: { type: 'boolean', description: '是否附带相关历史反思（默认 true）', default: true },
      },
      required: ['audit_type', 'verdict', 'summary'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.audit_type || !args.verdict || !args.summary) { return { error: 'Missing required arguments: audit_type, verdict, and summary are required' }; } return notifySession({ audit_type: args.audit_type as 'code' | 'data' | 'file', verdict: args.verdict as 'PASS' | 'WARN' | 'FAIL', summary: args.summary as string, ...(args.details ? { details: args.details as string[] } : {}), ...(args.think_ref !== undefined ? { think_ref: args.think_ref as boolean } : {}) }); },
  },
  {
    name: 'activate_workflow',
    roles: ['agent', 'fde'],
    description: '读取 FDE 交付物，注册企业 SubAgent。',
    inputSchema: {
      type: 'object',
      properties: {
        dry_run: { type: 'boolean', description: '只预览不真正注册，默认 false' },
        node_filter: { type: 'array', items: { type: 'string' }, description: '只激活指定节点（默认全部）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => activateWorkflowTool({ ...(args.dry_run !== undefined ? { dry_run: args.dry_run as boolean } : {}), ...(args.node_filter !== undefined ? { node_filter: args.node_filter as string[] } : {}) }),
  },
  {
    name: 'daemon_status',
    roles: ['ops'],
    description: '查询 daemon 运行状态（PID/启动时间/心跳）。只读。',
    inputSchema: { type: 'object', properties: {} },
    // v1.4.8 条目 5 迁移：查表分发
    handler: () => daemonStatus(),
  },
  {
    name: 'list_agents',
    roles: ['fde', 'agent'],
    description: '列出已注册的 Agent（内置 + 企业 SubAgent）。',
    inputSchema: { type: 'object', properties: {} },
    // v1.4.8 条目 5 迁移：查表分发
    handler: () => listAgentsTool(),
  },
  {
    name: 'list_concepts',
    roles: ['fde'],
    description: '列出所有 concept。',
    inputSchema: { type: 'object', properties: {} },
    // v1.4.8 条目 5 迁移：查表分发
    handler: () => listConcepts(),
  },
  {
    name: 'hitl_resolve',
    roles: ['agent'],
    description: '对挂起等人工确认的 checkpoint 提交决策（approve/reject/aborted）。',
    inputSchema: {
      type: 'object',
      properties: {
        checkpoint_id: { type: 'string', description: 'HITL checkpoint ID（必填）' },
        decision: { type: 'string', enum: ['approve', 'reject', 'aborted'], description: '人工决策（必填）' },
        comment: { type: 'string', description: '可选备注（如驳回原因）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => hitlResolve({ checkpoint_id: args.checkpoint_id as string, decision: args.decision as 'approve' | 'reject' | 'aborted', ...(args.comment ? { comment: args.comment as string } : {}) }),
  },
  {
    // v1.3.0 (交付 4)：规则透明化——只读列出规则清单（不暴露实现逻辑）
    name: 'list_rules',
    roles: ['audit'],
    description: '列出所有审计规则清单（只读，不暴露实现）。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['tool', 'diff', 'all'], description: '规则类型：tool（运行时）/ diff（提交时）/ all（默认）', default: 'all' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => listRules({ type: args.type as 'tool' | 'diff' | 'all' | undefined }),
  },
  {
    // v1.3.1 (交付 6)：Agent 独立身份码查询（Ed25519 完整版）
    name: 'agent_identity',
    roles: ['agent', 'fde'],
    description: '查询 Agent 身份码（查自己或他人，不含私钥）。',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: '目标 Agent 身份码（缺省 = 查自己）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => agentIdentityTool({ ...(args.agent_id ? { agentId: args.agent_id as string } : {}) }),
  },
  {
    // v1.3.1 (交付 8)：Onboard Agent L1 调试循环
    name: 'loop_debug',
    roles: ['eval'],
    description: 'Onboard Agent 调试循环——传 task 触发 activate→run→judge→fix 循环；不传查记录。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务描述（缺省 = 查询模式，不触发新循环）' },
        agent_id: { type: 'string', description: 'Agent 身份码（写入调试记录，交付 6 协同）' },
        max_rounds: { type: 'number', description: '最大循环轮数（默认 3）' },
        timeout_ms: { type: 'number', description: '超时阈值 ms（默认 120000）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const r = await loopDebug({ ...(typeof args.task === 'string' ? { task: args.task } : {}), ...(typeof args.agent_id === 'string' ? { agent_id: args.agent_id } : {}), ...(typeof args.max_rounds === 'number' ? { max_rounds: args.max_rounds } : {}), ...(typeof args.timeout_ms === 'number' ? { timeout_ms: args.timeout_ms } : {}) }); return { ...r, isError: r.data.isError }; },
  },
  {
    // v1.3.1 (交付 9)：Benchmark 评测
    name: 'evaluate',
    roles: ['eval'],
    description: 'Benchmark 评测——传 benchmark_id 触发隔离评测（评分 0..100）；query 查日志。',
    inputSchema: {
      type: 'object',
      properties: {
        benchmark_id: { type: 'string', description: 'Benchmark ID（必填）' },
        case_id: { type: 'string', description: 'Case ID（缺省 = 评测全部 cases）' },
        query: { type: 'boolean', description: '查询模式（true = 只查日志不触发新评测）' },
      },
      required: ['benchmark_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.benchmark_id) { return { error: 'Missing required argument: benchmark_id' }; } const r = await evaluate({ benchmark_id: args.benchmark_id as string, ...(typeof args.case_id === 'string' ? { case_id: args.case_id } : {}), ...(args.query === true ? { query: true } : {}) }); return { ...r, isError: r.data.isError }; },
  },
  {
    // v1.3.1 (交付 7)：跨设备审计轨迹查询
    name: 'audit_trail',
    roles: ['audit'],
    description: '跨设备审计轨迹查询——按 agent_id 查完整轨迹（HMAC 验签）。',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent 身份码（缺省 = 列出全部有轨迹的 agent）' },
        include_peers: { type: 'boolean', description: '是否包含跨设备 peer 记录（缺省 false——仅本地）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const r = await auditTrail({ ...(typeof args.agent_id === 'string' ? { agent_id: args.agent_id } : {}), ...(args.include_peers === true ? { include_peers: true } : {}) }); return { ...r, isError: r.data.isError }; },
  },
  {
    // v1.3.2 (交付 5)：一句话需求 → 自动建节点
    name: 'create_agent',
    roles: ['fde'],
    description: '一句话需求自动推导 Agent 配置（角色+域规则+think+knowledge）。',
    inputSchema: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '一句话需求（必填，如「回答金融合规问题的专家」）' },
        target_dir: { type: 'string', description: '可选：落盘到指定 Agent 目录（默认不落盘，只返回配置）' },
      },
      required: ['requirement'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.requirement) { return { error: 'Missing required argument: requirement' }; } const r = await createAgent({ requirement: args.requirement as string, ...(typeof args.target_dir === 'string' ? { targetDir: args.target_dir } : {}) }); return { ...r, isError: r.data?.isError }; },
  },
  {
    // v1.3.2 (交付 6)：企业专属 eval 套件
    name: 'eval_suite',
    roles: ['eval'],
    description: '企业专属 eval 套件（模板加载/基线冻结/运行/查日志）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['instantiate', 'freeze', 'run', 'query'], description: '操作类型：instantiate=加载模板 / freeze=冻结基线 / run=运行评测 / query=查询日志' },
        enterprise_id: { type: 'string', description: '企业 ID（必填）' },
        industry: { type: 'string', enum: ['finance', 'manufacturing', 'supplychain', 'customerservice', 'generic'], description: '行业（instantiate 时选）' },
        custom_cases: { type: 'array', description: '自定义 case（instantiate 时可选）', items: { type: 'object' } },
      },
      required: ['action', 'enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.action || !args.enterprise_id) { return { error: 'Missing required arguments: action and enterprise_id' }; } const er = await evalSuite({ action: args.action as 'instantiate' | 'freeze' | 'run' | 'query', enterprise_id: args.enterprise_id as string, ...(args.industry ? { industry: args.industry as 'finance' | 'manufacturing' | 'supplychain' | 'customerservice' | 'generic' } : {}), ...(args.custom_cases ? { custom_cases: args.custom_cases as any } : {}) }); return { ...er, isError: er.data?.isError }; },
  },
  {
    // v1.3.2 (交付 7右)：FDE 梳理辅助 · v1.4.3 清扫任务三收窄 workflow-only
    name: 'fde_compose',
    roles: ['fde'],
    description: 'FDE 梳理辅助——五要素生成 workflow.yml 草稿（workflow-only；ontology 推导走 fde_derive 六引擎主入口）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['workflow', 'ontology'], description: '生成类型：workflow=workflow.yml 草稿（ontology 已收窄——传值返回 fde_derive 迁移提示）' },
        session: { type: 'object', description: '梳理会话 JSON（含 enterpriseId / nodes / workflowName 等，由 compose-interview 收集）' },
      },
      required: ['action', 'session'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.action || !args.session) { return { error: 'Missing required arguments: action and session' }; } const fr = await fdeCompose({ action: args.action as 'workflow' | 'ontology', session: args.session as any }); return { ...fr, isError: fr.data?.isError }; },
  },
  {
    // v1.3.3 (交付 T01)：入口路由
    name: 'route_workflow',
    roles: ['agent'],
    description: '入口路由——传 task + workflow 返回命中节点或 fallback。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '用户请求文本（自然语言，如「帮我写一份财报分析」）' },
        workflow: { type: 'object', description: '已解析的 workflow JSON（ParsedWorkflow 结构，含 nodes 数组）' },
      },
      required: ['task', 'workflow'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.task || !args.workflow) { return { error: 'Missing required arguments: task and workflow' }; } const rr = routeWorkflowTool({ task: args.task as string, workflow: args.workflow as any }); return { ...rr, isError: rr.isError }; },
  },
  {
    // v1.3.3 (交付 T02)：团队协作——建队
    name: 'team_create',
    roles: ['agent'],
    description: '创建团队——传 team.yml 文本，解析写入。',
    inputSchema: {
      type: 'object',
      properties: {
        team_yaml: { type: 'string', description: 'team.yml 文本内容（YAML 格式）' },
      },
      required: ['team_yaml'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.team_yaml) { return { error: 'Missing required argument: team_yaml' }; } const tcr = teamCreate({ teamYaml: args.team_yaml as string }); return { ...tcr, isError: tcr.isError }; },
  },
  {
    // v1.3.3 (交付 T02)：团队协作——意图广播
    name: 'team_broadcast',
    roles: ['agent'],
    description: '意图广播——Agent 广播「我要做什么」到团队意图总线。',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: '团队 ID' },
        source: { type: 'string', description: '发送者 agentId' },
        intent: { type: 'string', description: '意图类型（glob 可匹配：intent.create.report）' },
        target: { type: 'string', description: '意图目标（文件/实体/key）' },
        payload: { type: 'string', description: '意图载荷（可选）' },
      },
      required: ['team_id', 'source', 'intent', 'target'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.team_id || !args.source || !args.intent || !args.target) { return { error: 'Missing required arguments: team_id, source, intent, and target' }; } const tbr = teamBroadcast({ teamId: args.team_id as string, source: args.source as string, intent: args.intent as string, target: args.target as string, ...(typeof args.payload === 'string' ? { payload: args.payload } : {}) }); return { ...tbr, isError: tbr.isError }; },
  },
  {
    // v1.3.3 (交付 T03/T04)：Refine Agent 质量优化循环
    name: 'refine',
    roles: ['eval'],
    description: 'Refine 质量优化循环——针对 Agent 产出做质量优化。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['trigger', 'query'], description: '操作类型：trigger=触发质量循环 / query=查询结果' },
        agent_id: { type: 'string', description: '目标 Agent 身份码（trigger 时必填）' },
        task: { type: 'string', description: '任务描述（trigger 时必填——Refine 针对哪个产出）' },
        team_id: { type: 'string', description: '团队 ID（可选——加载团队质量规则）' },
      },
      required: ['action'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.action) { return { error: 'Missing required argument: action' }; } const rfr = await refine({ action: args.action as 'trigger' | 'query', ...(typeof args.agent_id === 'string' ? { agentId: args.agent_id } : {}), ...(typeof args.task === 'string' ? { task: args.task } : {}), ...(typeof args.team_id === 'string' ? { teamId: args.team_id } : {}) }); return { ...rfr, isError: rfr.isError }; },
  },
  {
    // v1.3.4 (交付 1)：能力发布
    name: 'commons_publish',
    roles: ['commons'],
    description: '能力发布——将 Skill/Agent/流程发布到企业能力公地（SkillScan 安全门）。',
    inputSchema: {
      type: 'object',
      properties: {
        metadata: {
          type: 'object',
          description: '能力元数据（含 id/kind/name/description/version/owner/tags/sourcePath）',
          properties: {
            id: { type: 'string', description: '能力唯一标识（slug）' },
            kind: { type: 'string', enum: ['skill', 'agent', 'flow'], description: '能力类型' },
            name: { type: 'string', description: '人类可读名称' },
            description: { type: 'string', description: '简短描述' },
            version: { type: 'string', description: '版本号（semver）' },
            owner: { type: 'string', description: '维护人 agentId（对接身份码，必填）' },
            tags: { type: 'array', items: { type: 'string' }, description: '标签（用于检索）' },
            sourcePath: { type: 'string', description: '源文件/目录路径' },
          },
        },
      },
      required: ['metadata'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { if (!args.metadata) { return { error: 'Missing required argument: metadata' }; } const mpr = commonsPublish({ metadata: args.metadata as any }); return { ...mpr, isError: mpr.isError }; },
  },
  {
    // v1.3.4 (交付 1)：能力检索
    name: 'commons_search',
    roles: ['commons'],
    description: '能力检索——按标签/关键词/类型检索能力公地。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词（模糊匹配名称/描述/标签）' },
        tag: { type: 'string', description: '按标签精确匹配（优先级高于 query）' },
        kind: { type: 'string', enum: ['skill', 'agent', 'flow'], description: '按类型过滤' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => commonsSearch({ ...(typeof args.query === 'string' ? { query: args.query } : {}), ...(typeof args.tag === 'string' ? { tag: args.tag } : {}), ...(typeof args.kind === 'string' ? { kind: args.kind as 'skill' | 'agent' | 'flow' } : {}) }),
  },
  {
    // v1.3.4 (交付 2)：能力调用
    name: 'commons_invoke',
    roles: ['commons'],
    description: '能力调用（dry-run 预检）——返回能力元数据与调用计划，不真实执行（SkillScan 拦截 + HITL 确认；真实执行由 Agent runtime 注入 executor）。',
    inputSchema: {
      type: 'object',
      properties: {
        capability_id: { type: 'string', description: '能力 ID（必填——先 commons_search 发现）' },
        caller_agent_id: { type: 'string', description: '调用者 agentId（必填）' },
        input: { description: '调用入参（透传给被调能力）' },
      },
      required: ['capability_id', 'caller_agent_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.capability_id || !args.caller_agent_id) { return { error: 'Missing required arguments: capability_id and caller_agent_id' }; } const mir = await commonsInvoke({ capability_id: args.capability_id as string, caller_agent_id: args.caller_agent_id as string, ...(args.input !== undefined ? { input: args.input } : {}) }); return { ...mir, isError: mir.isError }; },
  },
  {
    // v1.3.4 (交付 2)：能力评价
    name: 'commons_rate',
    roles: ['commons'],
    description: '能力评价——调用后累积评分（0.0~1.0），防刷。',
    inputSchema: {
      type: 'object',
      properties: {
        capability_id: { type: 'string', description: '能力 ID（必填）' },
        rater_id: { type: 'string', description: '评价者 agentId（必填）' },
        score: { type: 'number', description: '评分 0.0~1.0（必填）' },
        owner_agent_id: { type: 'string', description: '能力 owner agentId（必填——用于更新 trust）' },
        comment: { type: 'string', description: '可选评论' },
      },
      required: ['capability_id', 'rater_id', 'score', 'owner_agent_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.capability_id || !args.rater_id || !args.owner_agent_id || typeof args.score !== 'number') { return { error: 'Missing required arguments: capability_id, rater_id, score, owner_agent_id' }; } const mrr = await commonsRate({ capability_id: args.capability_id as string, rater_id: args.rater_id as string, score: args.score as number, owner_agent_id: args.owner_agent_id as string, ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); return { ...mrr, isError: mrr.isError }; },
  },
  {
    // v1.3.4 (交付 3)：能力退役
    name: 'commons_retire',
    roles: ['commons'],
    description: '能力退役/恢复——标记退役（不删除，可恢复），强制 owner 确认。',
    inputSchema: {
      type: 'object',
      properties: {
        capability_id: { type: 'string', description: '能力 ID（必填）' },
        action: { type: 'string', enum: ['retire', 'restore', 'scan'], description: '操作：retire=退役 / restore=恢复 / scan=扫描候选' },
        reason: { type: 'string', enum: ['owner_request', 'low_invoke', 'low_rating', 'manual'], description: '退役原因（retire 时）' },
        confirmed: { type: 'boolean', description: 'owner 确认（retire 时必须 true）' },
      },
      required: ['capability_id', 'action'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.capability_id || !args.action) { return { error: 'Missing required arguments: capability_id and action' }; } const mtr = await commonsRetire({ capability_id: args.capability_id as string, action: args.action as 'retire' | 'restore' | 'scan', ...(args.reason ? { reason: args.reason as 'owner_request' | 'low_invoke' | 'low_rating' | 'manual' } : {}), ...(args.confirmed !== undefined ? { confirmed: args.confirmed as boolean } : {}) }); return { ...mtr, isError: mtr.isError }; },
  },
  {
    // v1.3.4 (交付 5)：规则提炼
    name: 'commons_harvest_rule',
    roles: ['commons'],
    description: '从公地调用日志 + Refine 循环提炼质量规则候选。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['harvest', 'full'], description: '操作：harvest=仅提炼候选 / full=三步全跑（提炼→评审→晋升）', default: 'harvest' },
        case_texts: { type: 'array', items: { type: 'string' }, description: '可选：注入的案例文本（FDE delivery-report 格式）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const mhr = await commonsHarvestRule({ ...(args.action ? { action: args.action as 'harvest' | 'full' } : {}), ...(args.case_texts ? { case_texts: args.case_texts as string[] } : {}) }); return { ...mhr, isError: mhr.isError }; },
  },
  {
    // v1.3.5 (交付 1)：A/B 实验发起
    name: 'run_ab_test',
    roles: ['eval'],
    description: '发起 A/B 对比实验——current vs candidate 在 golden-set 上评测，返回胜出方。',
    inputSchema: {
      type: 'object',
      properties: {
        current: { type: 'string', description: '当前版本 Agent 定义（Skill 文件）路径' },
        candidate: { type: 'string', description: '候选版本 Agent 定义路径' },
        eval_set: { type: 'string', description: 'golden-set 路径（可选——缺省用 @sofagent/eval 内置 golden-set.yaml）' },
        promote_threshold: { type: 'number', description: '晋升阈值：candidate 连续胜出 N 次后可晋升（默认 2）', default: 2 },
        previous_wins: { type: 'number', description: '历史连续胜出次数（接续上一次实验计数，默认 0）', default: 0 },
      },
      required: ['current', 'candidate'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.current || !args.candidate) { return { error: 'Missing required arguments: current and candidate' }; } const abr = await runAbTest({ current: args.current as string, candidate: args.candidate as string, ...(typeof args.eval_set === 'string' ? { eval_set: args.eval_set } : {}), ...(typeof args.promote_threshold === 'number' ? { promote_threshold: args.promote_threshold } : {}), ...(typeof args.previous_wins === 'number' ? { previous_wins: args.previous_wins } : {}) }); return { ...abr, isError: abr.data.isError }; },
  },
  {
    // v1.3.5 (交付 1)：A/B 晋升（强制人审）
    name: 'promote_ab',
    roles: ['eval'],
    description: '晋升 candidate 为 current。🔴 破坏性，必须 human_confirmed:true。',
    inputSchema: {
      type: 'object',
      properties: {
        current: { type: 'string', description: '当前版本 Agent 定义路径（晋升目标——被覆写方）' },
        candidate: { type: 'string', description: '候选版本 Agent 定义路径（晋升来源）' },
        human_confirmed: { type: 'boolean', description: '🔴 人工确认：false/缺省=挂起等人审（默认）；true=执行晋升。破坏性操作不允许自动执行', default: false },
        comment: { type: 'string', description: '决策备注（写入 decision-log，如审批人/理由）' },
      },
      required: ['current', 'candidate'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.current || !args.candidate) { return { error: 'Missing required arguments: current and candidate' }; } const pbr = await promoteAb({ current: args.current as string, candidate: args.candidate as string, ...(args.human_confirmed !== undefined ? { human_confirmed: args.human_confirmed === true } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); return { ...pbr, isError: pbr.data.isError }; },
  },
  {
    // v1.3.5 (交付 2)：快照时间线（只读）
    name: 'snapshot_list',
    roles: ['ops'],
    description: '列出审计快照时间线。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        project_dir: { type: 'string', description: '项目根目录（可选——默认当前工作目录）' },
        limit: { type: 'number', description: '返回最近 N 条（默认 10，0 = 全量）', default: 10 },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => { const slr = snapshotList({ ...(typeof args.project_dir === 'string' ? { project_dir: args.project_dir } : {}), ...(typeof args.limit === 'number' ? { limit: args.limit } : {}) }); return { ...slr, isError: slr.data.isError }; },
  },
  {
    // v1.3.5 (交付 2)：快照恢复（强制人审）
    name: 'snapshot_restore',
    roles: ['ops'],
    description: '恢复工作区到指定快照。🔴 破坏性，必须 human_confirmed:true。',
    inputSchema: {
      type: 'object',
      properties: {
        sha: { type: 'string', description: '目标快照 SHA（完整或 ≥4 位短前缀——用 snapshot_list 查时间线）' },
        project_dir: { type: 'string', description: '项目根目录（可选——默认当前工作目录）' },
        human_confirmed: { type: 'boolean', description: '🔴 人工确认：false/缺省=挂起等人审（默认）；true=执行恢复。破坏性操作不允许自动执行', default: false },
        comment: { type: 'string', description: '决策备注（写入 decision-log）' },
      },
      required: ['sha'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.sha) { return { error: 'Missing required argument: sha' }; } const srr = await snapshotRestore({ sha: args.sha as string, ...(typeof args.project_dir === 'string' ? { project_dir: args.project_dir } : {}), ...(args.human_confirmed !== undefined ? { human_confirmed: args.human_confirmed === true } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); return { ...srr, isError: srr.data.isError }; },
  },
  {
    // v1.3.6 (交付 ①)：Workflow 外部提交通道——模型层生成的 workflow 从 MCP 进约束层
    name: 'workflow_submit',
    roles: ['agent'],
    description: 'Workflow 提交——schema 校验 + 解析（validate/run）。',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'workflow 文本（YAML 或 JSON——YAML 是 JSON 超集，统一走 YAML 解析）' },
        mode: { type: 'string', enum: ['validate', 'run'], description: '执行模式：validate=只校验（默认）/ run=校验后执行', default: 'validate' },
        task: { type: 'string', description: 'run 模式下的任务描述（供编排主 Agent 组装上下文）' },
      },
      required: ['workflow'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.workflow) { return { error: 'Missing required argument: workflow' }; } const wsr = await workflowSubmit({ workflow: args.workflow as string, ...(args.mode === 'run' ? { mode: 'run' as const } : {}), ...(typeof args.task === 'string' ? { task: args.task } : {}) }); return { ...wsr, isError: wsr.data.isError }; },
  },
  {
    // v1.3.6 (交付 ②)：Ontology 标准注入通道——模型层生成的 ontology 从 MCP 进约束层
    name: 'ontology_import',
    roles: ['fde'],
    description: 'Ontology 注入——提交 entity/concept/relations（JSON），校验+审计后注册。',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'string', description: 'ontology JSON 文本：{ entities?: [{name, domain, description?, relations?}], concepts?: [{name, description?}], relations?: [{source, target, relation}] }' },
        agent_id: { type: 'string', description: '注入者标识（decision-log 留痕——谁注入的；缺省 external-model-layer）' },
        comment: { type: 'string', description: '注入备注（写入 decision-log why）' },
      },
      required: ['payload'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.payload) { return { error: 'Missing required argument: payload' }; } const oir = await ontologyImport({ payload: args.payload as string, ...(typeof args.agent_id === 'string' ? { agent_id: args.agent_id } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); return { ...oir, isError: oir.data.isError }; },
  },
  {
    // v1.3.6 (交付 ④)：模型注册——评测→注册→灰度→晋升→退役闭环第一站
    name: 'model_register',
    roles: ['ops'],
    description: '模型注册——注册训练后模型 endpoint（name+endpoint+model）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '注册名（唯一标识——model_switch 按此切换）' },
        endpoint: { type: 'string', description: '服务地址（endpoint 型必填；local-path 型为权重目录占位）' },
        model: { type: 'string', description: '模型名（传给服务的 model 字段）' },
        client_type: { type: 'string', enum: ['ollama', 'openai-compatible'], description: '客户端协议（缺省 ollama；openai-compatible = vLLM/第三方 router）', default: 'ollama' },
        source: { type: 'string', enum: ['endpoint', 'local-path'], description: '来源类型', default: 'endpoint' },
        weights_dir: { type: 'string', description: '权重目录（source=local-path 必填——按 manifest.json 目录规范校验，校验通过才注册）' },
        verify_hash: { type: 'boolean', description: '注册时校验权重哈希（缺省 true——供应链完整性）', default: true },
        eval_score: { type: 'number', description: '评测分数' },
        comment: { type: 'string', description: '备注' },
        profile: {
          type: 'object',
          description: '端点能力画像——strengths 擅长能力 / modalities 模态 / maxContext 最大上下文 / costPerKToken 每千 token 成本 / latencyP50 延迟 P50',
          properties: {
            strengths: { type: 'array', items: { type: 'string' }, description: '擅长能力标签（如 ["code","long-context"]）' },
            modalities: { type: 'array', items: { type: 'string' }, description: '支持模态（如 ["text","image"]）' },
            maxContext: { type: 'number', description: '最大上下文 token 数' },
            costPerKToken: { type: 'number', description: '每千 token 成本' },
            latencyP50: { type: 'number', description: '延迟 P50（ms）' },
          },
        },
      },
      required: ['name'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.name) { return { error: 'Missing required argument: name' }; } const mrr = await modelRegister({ name: args.name as string, endpoint: (args.endpoint as string) ?? '', model: (args.model as string) ?? '', ...(args.client_type === 'openai-compatible' || args.client_type === 'ollama' ? { client_type: args.client_type } : {}), ...(args.source === 'endpoint' || args.source === 'local-path' ? { source: args.source } : {}), ...(typeof args.weights_dir === 'string' ? { weights_dir: args.weights_dir } : {}), ...(typeof args.verify_hash === 'boolean' ? { verify_hash: args.verify_hash } : {}), ...(typeof args.eval_score === 'number' ? { eval_score: args.eval_score } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}), ...(args.profile !== undefined ? { profile: args.profile as ModelRegisterArgs['profile'] } : {}) }); return { ...mrr, isError: mrr.data.isError }; },
  },
  {
    // v1.3.6 (交付 ④)：模型灰度切换/晋升/回滚——晋升强制人审（对齐 promote_ab）
    name: 'model_switch',
    roles: ['ops'],
    description: '模型灰度切换——按档位切换活动模型（percent<100 灰度，100 强制人审）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '目标模型名（action=rollback 可省略；rollback-weights 必填）' },
        lane: { type: 'string', enum: ['executor', 'pipeline'], description: '档位（缺省 executor）', default: 'executor' },
        percent: { type: 'number', description: '灰度比例 1-99；100/缺省 = 晋升全量（强制人审）' },
        action: { type: 'string', enum: ['switch', 'rollback', 'rollback-weights'], description: '动作：switch（默认）/ rollback（模型级）/ rollback-weights（权重版本级——local-path 模型）', default: 'switch' },
        target_version: { type: 'string', description: '权重版本回滚目标（rollback-weights 可选——缺省回拨上一版本）' },
        human_confirmed: { type: 'boolean', description: '🔴 人工确认（晋升 percent=100 时必填 true——false/缺省挂起等人审）', default: false },
        comment: { type: 'string', description: '备注（灰度依据 / 回滚原因，写入事件留痕）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const msr = await modelSwitch({ ...(typeof args.name === 'string' ? { name: args.name } : {}), lane: args.lane === 'pipeline' ? 'pipeline' : 'executor', ...(typeof args.percent === 'number' ? { percent: args.percent } : {}), action: args.action === 'rollback' ? 'rollback' : args.action === 'rollback-weights' ? 'rollback-weights' : 'switch', ...(typeof args.target_version === 'string' ? { target_version: args.target_version } : {}), ...(args.human_confirmed !== undefined ? { human_confirmed: args.human_confirmed === true } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); return { ...msr, isError: msr.data.isError }; },
  },
  {
    // v1.3.6 (交付 ④)：模型退役/恢复——强制人审，对齐 v1.3.4 养护环 + v1.3.5 promote_ab
    name: 'model_unregister',
    roles: ['ops'],
    description: '模型退役——标记退役（可恢复），强制人审。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '目标模型名' },
        action: { type: 'string', enum: ['retire', 'restore'], description: '动作：retire（默认退役）/ restore（恢复退役模型）', default: 'retire' },
        human_confirmed: { type: 'boolean', description: '🔴 人工确认（false/缺省 → 挂起等人审）', default: false },
        comment: { type: 'string', description: '备注（退役原因 / 恢复理由）' },
      },
      required: ['name'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.name) { return { error: 'Missing required argument: name' }; } const mur = await modelUnregister({ name: args.name as string, action: args.action === 'restore' ? 'restore' : 'retire', ...(args.human_confirmed !== undefined ? { human_confirmed: args.human_confirmed === true } : {}), ...(typeof args.comment === 'string' ? { comment: args.comment } : {}) }); return { ...mur, isError: mur.data.isError }; },
  },
  {
    // v1.3.6 (交付 ⑦)：训练预算控制——查预算 / 超预算人审续跑或终止
    name: 'train_budget',
    roles: ['eval', 'ops'],
    description: '训练预算控制——查预算状态 / 超预算人审续跑或终止。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'resolve'], description: '操作：status 查预算 / resolve 人审续跑或终止' },
        job_id: { type: 'string', description: '训练任务标识（job.json 的 jobId）' },
        decision: { type: 'string', enum: ['resume', 'terminate'], description: 'resolve 时的人审决策：resume 续跑 / terminate 终止' },
      },
      required: ['action', 'job_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.action) { return { error: 'Missing required argument: action' }; } if (!args.job_id) { return { error: 'Missing required argument: job_id' }; } const tbr = await trainBudget({ action: args.action as 'status' | 'resolve', job_id: args.job_id as string, ...(args.decision === 'resume' || args.decision === 'terminate' ? { decision: args.decision } : {}) }); return { ...tbr, isError: tbr.data.isError }; },
  },
  {
    // v1.4.1 (块二)：训练任务提交——生成 trainJobId（编排层 train-scheduler 接管 spawn）
    name: 'train_submit',
    roles: ['eval', 'ops'],
    description: '训练任务提交——数据+基座+算法(sft/dpo/grpo)+超参+预算 → 生成 trainJobId（同 id 重复提交幂等）。',
    inputSchema: {
      type: 'object',
      properties: {
        data_path: { type: 'string', description: '数据路径（训练集）' },
        base_model: { type: 'string', description: '基座模型（企业专属模型 / 开源基座）' },
        algorithm: { type: 'string', enum: ['sft', 'dpo', 'grpo'], description: '训练算法' },
        hyperparams: { type: 'object', description: '超参（透传训练框架，键值自定）', additionalProperties: true },
        budget: {
          type: 'object',
          description: '预算（可选——超限 SIGINT 暂停等人审，train_budget 衔接）',
          properties: {
            max_minutes: { type: 'number', description: '时间预算上限（分钟）' },
            max_steps: { type: 'number', description: '训练步数上限' },
            max_cost: { type: 'number', description: '估算算力成本上限' },
          },
        },
        enterprise_id: { type: 'string', description: '🔴 企业标识（必填——企业隔离分区依赖）' },
        train_job_id: { type: 'string', description: '训练任务标识（可选——同 id 重复提交幂等返回既有任务）' },
      },
      required: ['data_path', 'base_model', 'algorithm', 'enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.data_path) { return { error: 'Missing required argument: data_path' }; } if (!args.base_model) { return { error: 'Missing required argument: base_model' }; } if (!args.algorithm) { return { error: 'Missing required argument: algorithm' }; } if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } const tsr = await trainSubmit({ data_path: args.data_path as string, base_model: args.base_model as string, algorithm: args.algorithm as 'sft' | 'dpo' | 'grpo', ...(args.hyperparams !== undefined && typeof args.hyperparams === 'object' ? { hyperparams: args.hyperparams as Record<string, unknown> } : {}), ...(args.budget !== undefined && typeof args.budget === 'object' ? { budget: args.budget as { max_minutes?: number; max_steps?: number; max_cost?: number } } : {}), enterprise_id: args.enterprise_id as string, ...(typeof args.train_job_id === 'string' ? { train_job_id: args.train_job_id } : {}) }); return { ...tsr, isError: tsr.data.isError }; },
  },
  {
    // v1.4.2 (章四)：训练环境体检——CUDA/显存/框架/基座缓存四项只查不装
    name: 'train_doctor',
    roles: ['eval', 'ops'],
    description: '训练环境体检——CUDA/显存/框架版本/基座模型缓存四项 + 反作弊基线三项（git 禁用/.git 可见性/网络白名单）结构化报告（只查不装；装环境走 bash tools/train/train-env-init.sh，基座模型手动放置或推理服务拉取）。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识（必填——train-env.json 清单的企业分区）' },
        dataset_mount_path: { type: 'string', description: '数据集挂载点（可选——反作弊 .git 可见性探测；缺省该项报 fail 给指引）' },
      },
      required: ['enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } const tdr = await trainDoctorTool({ enterprise_id: args.enterprise_id as string, ...(typeof args.dataset_mount_path === 'string' ? { dataset_mount_path: args.dataset_mount_path } : {}) }); return { ...tdr, isError: tdr.data.isError }; },
  },
  {
    // v1.4.2 (章五)：训练 dry-run——失败前预防（管线连通/数据抽样/显存/算力外推）
    name: 'train_dryrun',
    roles: ['eval', 'ops'],
    description: '训练 dry-run——提交前预检：极小样本管线连通 + 数据质量抽样 + 显存估算（超限提前告警）+ 算力外推（sigmoid 缩放律外推成本，超预算提交前告警）。',
    inputSchema: {
      type: 'object',
      properties: {
        data_path: { type: 'string', description: '🔴 数据文件路径（CSV/Excel/JSON/文本——相对 data 目录或绝对路径）' },
        algorithm: { type: 'string', enum: ['sft', 'dpo', 'grpo'], description: '🔴 训练算法' },
        column_mapping: { type: 'object', description: '列映射（可选——缺省按常见命名约定推断；如 {"instruction":"问题","output":"答案"}）', additionalProperties: { type: 'string' } },
        vram: {
          type: 'object',
          description: '显存预检（可选——不填跳过该项）',
          properties: {
            params_billions: { type: 'number', description: '模型参数量（十亿为单位，如 8 = 8B）' },
            batch_size: { type: 'number', description: 'batch size' },
            sequence_length: { type: 'number', description: '序列长度（token 数）' },
            bytes_per_param: { type: 'number', description: '精度字节（fp32=4/bf16=2；缺省 2 混合精度）' },
            gradient_checkpointing: { type: 'boolean', description: '梯度检查点（开启省激活内存）' },
            gpu_vram_mib: { type: 'number', description: 'GPU 可用显存（MiB——估算超此值提前 fail）' },
          },
          required: ['params_billions', 'batch_size', 'sequence_length'],
        },
        extrapolate: {
          type: 'object',
          description: '算力外推（可选——ScaleRL sigmoid 缩放律；数据点不足明示置信低不硬报）',
          properties: {
            points: {
              type: 'array',
              description: 'pilot run 数据点（算力, 性能）',
              items: {
                type: 'object',
                properties: {
                  compute: { type: 'number', description: '算力投入（GPU 小时等同单位）' },
                  performance: { type: 'number', description: '性能（eval 分 0..100）' },
                },
                required: ['compute', 'performance'],
              },
            },
            target_compute: { type: 'number', description: '目标算力规模（外推目标）' },
            cost_per_unit: { type: 'number', description: '成本单价（元/GPU小时）' },
            budget_cap: { type: 'number', description: '预算上限（元——外推成本超限提交前告警）' },
          },
          required: ['points', 'target_compute'],
        },
      },
      required: ['data_path', 'algorithm'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.data_path) { return { error: 'Missing required argument: data_path' }; } if (!args.algorithm) { return { error: 'Missing required argument: algorithm' }; } const dyr = await trainDryrunTool({ data_path: args.data_path as string, algorithm: args.algorithm as 'sft' | 'dpo' | 'grpo', ...(args.column_mapping !== undefined && typeof args.column_mapping === 'object' ? { column_mapping: args.column_mapping as Record<string, string> } : {}), ...(args.vram !== undefined && typeof args.vram === 'object' ? { vram: args.vram as TrainDryrunArgs['vram'] } : {}), ...(args.extrapolate !== undefined && typeof args.extrapolate === 'object' ? { extrapolate: args.extrapolate as TrainDryrunArgs['extrapolate'] } : {}) }); return { ...dyr, isError: dyr.data.isError }; },
  },
  {
    // v1.4.2 (章六)：训练报告——客户可读交付物（量化四字段 + 归档 dashboard）
    name: 'train_report',
    roles: ['eval', 'ops'],
    description: '训练报告生成——数据概况+配置+eval对比+产物清单+量化四字段（GUIDE §4.3：年节省=岗位年薪×AI接管工时占比），markdown+JSON 归档 data/dashboard/train-reports/。',
    inputSchema: {
      type: 'object',
      properties: {
        train_job_id: { type: 'string', description: '🔴 训练任务标识' },
        enterprise_id: { type: 'string', description: '🔴 企业标识' },
        baseline_eval: { type: 'object', description: '基线 eval 报告（训练前——章三 runTrainEval 产出；缺省该段降级）', additionalProperties: true },
        after_eval: { type: 'object', description: '训后 eval 报告（章三 runTrainEval 产出）', additionalProperties: true },
        dataset_version: { type: 'object', description: '训练集版本记录（章二 dataset_version——数据概况段）', additionalProperties: true },
        quantification: {
          type: 'object',
          description: '量化四字段输入（GUIDE §4.3 岗位口径——供绩效量化引擎消费）',
          properties: {
            annual_salary: { type: 'number', description: '岗位真实市场年薪（元/年）' },
            takeover_ratio: { type: 'number', description: 'AI 接管工时占比（0..1，如 0.33）' },
            ai_annual_cost: { type: 'number', description: 'AI 方案年运行成本（元/年）' },
            one_time_investment: { type: 'number', description: '一次性投入（元——回本周期用）' },
          },
          required: ['annual_salary', 'takeover_ratio', 'ai_annual_cost'],
        },
        artifacts: { type: 'array', description: '产物清单（可选——缺省从 job record 推导）', items: { type: 'string' } },
      },
      required: ['train_job_id', 'enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.train_job_id) { return { error: 'Missing required argument: train_job_id' }; } if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } const trr = await trainReportTool({ train_job_id: args.train_job_id as string, enterprise_id: args.enterprise_id as string, ...(args.baseline_eval !== undefined && typeof args.baseline_eval === 'object' ? { baseline_eval: args.baseline_eval as Record<string, unknown> } : {}), ...(args.after_eval !== undefined && typeof args.after_eval === 'object' ? { after_eval: args.after_eval as Record<string, unknown> } : {}), ...(args.dataset_version !== undefined && typeof args.dataset_version === 'object' ? { dataset_version: args.dataset_version as Record<string, unknown> } : {}), ...(args.quantification !== undefined && typeof args.quantification === 'object' ? { quantification: args.quantification as NonNullable<TrainReportArgs['quantification']> } : {}), ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts as string[] } : {}) }); return { ...trr, isError: trr.data.isError }; },
  },
  {
    // v1.4.3 (第一章)：训练进度查询——MCP 客户端长任务轮询入口
    name: 'train_status',
    roles: ['eval', 'ops'],
    description: '训练进度查询——status/step/loss/reward 曲线/断点/用量快照（长任务轮询入口）。',
    inputSchema: {
      type: 'object',
      properties: {
        train_job_id: { type: 'string', description: '🔴 训练任务标识' },
        enterprise_id: { type: 'string', description: '🔴 企业标识（隔离分区依赖）' },
        last_n: { type: 'number', description: '曲线窗口（可选——尾部 N 条 progress 事件，缺省全量）' },
      },
      required: ['train_job_id', 'enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.train_job_id) { return { error: 'Missing required argument: train_job_id' }; } if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } const tsr = await trainStatusTool({ train_job_id: args.train_job_id as string, enterprise_id: args.enterprise_id as string, ...(typeof args.last_n === 'number' ? { last_n: args.last_n } : {}) }); return { ...tsr, isError: tsr.data.isError }; },
  },
  {
    // v1.4.3 (第一章)：历史任务列表——FDE 交付复盘、多任务管理
    name: 'train_list',
    roles: ['eval', 'ops'],
    description: '训练任务列表——按时间/状态/模型过滤（历史复盘与多任务管理；只列本企业分区任务）。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识（隔离分区——只列本企业任务）' },
        status: { type: 'string', enum: ['queued', 'running', 'checkpointing', 'completed', 'failed', 'cancelled', 'interrupted'], description: '状态过滤（可选）' },
        base_model: { type: 'string', description: '基座模型过滤（可选——子串匹配，如 Qwen3）' },
        last_days: { type: 'number', description: '时间过滤（可选——最近 N 天）' },
        limit: { type: 'number', description: '返回上限（可选——缺省 50）' },
      },
      required: ['enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } const tlr = await trainListTool({ enterprise_id: args.enterprise_id as string, ...(typeof args.status === 'string' ? { status: args.status } : {}), ...(typeof args.base_model === 'string' ? { base_model: args.base_model } : {}), ...(typeof args.last_days === 'number' ? { last_days: args.last_days } : {}), ...(typeof args.limit === 'number' ? { limit: args.limit } : {}) }); return { ...tlr, isError: tlr.data.isError }; },
  },
  {
    // v1.4.3 (第二章)：训练失败诊断——七类分类 + 上下文 + 处方
    name: 'train_diagnose',
    roles: ['eval', 'ops'],
    description: '训练失败诊断——七类分类（OOM/数据格式/超参发散/框架/环境/重复坍塌/精度异常）+ 上下文四源（日志尾部+环境清单+checkpoint+超参）+ 修复处方，报告落盘 diagnose.json。',
    inputSchema: {
      type: 'object',
      properties: {
        train_job_id: { type: 'string', description: '🔴 训练任务标识（failed/cancelled 等有失败上下文的任务）' },
        enterprise_id: { type: 'string', description: '🔴 企业标识（隔离分区依赖）' },
        save: { type: 'boolean', description: '是否落盘报告（可选——缺省 true，data/train/<企业>/<jobId>/diagnose.json）' },
      },
      required: ['train_job_id', 'enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.train_job_id) { return { error: 'Missing required argument: train_job_id' }; } if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } const tdr2 = await trainDiagnoseTool({ train_job_id: args.train_job_id as string, enterprise_id: args.enterprise_id as string, ...(typeof args.save === 'boolean' ? { save: args.save } : {}) }); return { ...tdr2, isError: tdr2.data.isError }; },
  },
  {
    // v1.4.5 (第四章)：FDE 训练交付包——五件聚合 + manifest + HMAC 签名
    name: 'train_deliverable',
    roles: ['eval', 'ops'],
    description: 'FDE 训练交付包——generate 聚合五件（训练配置模板+数据管道配置+eval基线冻结+运维手册+权重清单含回滚点）打 zip + manifest + HMAC 签名；verify 逐项核对完整性 + 环境兼容性（企业收包侧体检）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['generate', 'verify'], description: '🔴 动作：generate 生成交付包 / verify 校验既有包' },
        enterprise_id: { type: 'string', description: '🔴 企业标识（隔离分区依赖）' },
        train_job_id: { type: 'string', description: '血缘任务标识（可选——缺省取最新 completed job）' },
        dataset_id: { type: 'string', description: '数据集标识（可选——缺省取版本台账最新）' },
        contact: { type: 'string', description: 'FDE 联系方式（可选——写入运维手册联系方式段）' },
        zip_path: { type: 'string', description: '待校验交付包路径（verify 必填）' },
      },
      required: ['enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } const tdl = await trainDeliverableTool({ action: args.action === 'verify' ? 'verify' : 'generate', enterprise_id: args.enterprise_id as string, ...(typeof args.train_job_id === 'string' ? { train_job_id: args.train_job_id } : {}), ...(typeof args.dataset_id === 'string' ? { dataset_id: args.dataset_id } : {}), ...(typeof args.contact === 'string' ? { contact: args.contact } : {}), ...(typeof args.zip_path === 'string' ? { zip_path: args.zip_path } : {}) }); return { ...tdl, isError: tdl.data.isError }; },
  },
  {
    // v1.4.5 (第一章)：推理服务生命周期——从权重目录拉起 vLLM/Ollama/OpenAI 兼容端点
    name: 'train_serve',
    roles: ['eval', 'ops'],
    description: '推理服务生命周期——从权重目录拉起 vLLM/Ollama/OpenAI 兼容端点（/health 就绪探测 + 指数退避重试）+ 启停重启状态四操作；每次启停记 train_serve 审计事件（谁启的/哪个模型/哪个节点）。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识（serve 状态分区 + 审计隔离依赖）' },
        model_name: { type: 'string', description: '🔴 注册模型名（定位服务）' },
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'status'], description: '操作（缺省 status）', default: 'status' },
        weights_dir: { type: 'string', description: '权重目录（start/restart 必填——weights-manifest 目录规范）' },
        backend: { type: 'string', enum: ['vllm', 'ollama', 'openai-compatible'], description: '拉起后端（缺省 vllm——三者都暴露 OpenAI 兼容端点）', default: 'vllm' },
        host: { type: 'string', description: '监听地址（缺省 127.0.0.1）' },
        port: { type: 'number', description: '端口（缺省 8000）' },
        model_id: { type: 'string', description: '服务端模型标识（缺省同 model_name）' },
        extra_args: { type: 'array', items: { type: 'string' }, description: '后端附加参数（透传）' },
        actor: { type: 'string', description: '操作者（审计留痕——缺省 mcp-train-serve）' },
      },
      required: ['enterprise_id', 'model_name'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } if (!args.model_name) { return { error: 'Missing required argument: model_name' }; } const action = args.action === 'start' || args.action === 'stop' || args.action === 'restart' ? args.action : 'status'; if ((action === 'start' || action === 'restart') && typeof args.weights_dir !== 'string') { return { error: `Missing required argument: weights_dir (action=${action})` }; } const tvr = await trainServeTool({ enterprise_id: args.enterprise_id as string, model_name: args.model_name as string, action, ...(typeof args.weights_dir === 'string' ? { weights_dir: args.weights_dir } : {}), ...(args.backend === 'vllm' || args.backend === 'ollama' || args.backend === 'openai-compatible' ? { backend: args.backend } : {}), ...(typeof args.host === 'string' ? { host: args.host } : {}), ...(typeof args.port === 'number' ? { port: args.port } : {}), ...(typeof args.model_id === 'string' ? { model_id: args.model_id } : {}), ...(Array.isArray(args.extra_args) ? { extra_args: args.extra_args as string[] } : {}), ...(typeof args.actor === 'string' ? { actor: args.actor } : {}) }); return { ...tvr, isError: tvr.data.isError }; },
  },
  {
    // v1.4.6 (章二)：云 VM 执行面——注册/列表/状态/注销云 VM（控制面本地 / 执行面云上）
    name: 'train_cloud',
    roles: ['eval', 'ops'],
    description: '云 VM 执行面——注册云 VM（endpoint + 凭据引用走虚拟 key 边界，真实凭据不落明文）/ 列出 / 查状态 / 注销；远程 spawn 训练走 ssh 通道（stdout JSON 回流）+ 分拣闸（敏感档拦上云，依据入审计链）+ 失联止损 + 成本入预算。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'list', 'status', 'remove'], description: '操作（缺省 list）', default: 'list' },
        name: { type: 'string', description: '云 VM 注册名（add/status/remove 必填）' },
        endpoint: { type: 'string', description: 'endpoint（add 必填——ssh user@host 或云 API endpoint）' },
        credential_ref: { type: 'string', description: '凭据引用（虚拟 key 引用——真实凭据不落明文）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const tcAction = args.action === 'add' || args.action === 'status' || args.action === 'remove' ? args.action : 'list'; if ((tcAction === 'add' || tcAction === 'status' || tcAction === 'remove') && typeof args.name !== 'string') { return { error: `Missing required argument: name (action=${tcAction})` }; } if (tcAction === 'add' && typeof args.endpoint !== 'string') { return { error: 'Missing required argument: endpoint (action=add)' }; } const tcr = await trainCloud({ action: tcAction, ...(typeof args.name === 'string' ? { name: args.name } : {}), ...(typeof args.endpoint === 'string' ? { endpoint: args.endpoint } : {}), ...(typeof args.credential_ref === 'string' ? { credential_ref: args.credential_ref } : {}) }); return { ...tcr, isError: tcr.data.isError }; },
  },
  {
    // v1.4.5 (第三章)：训练数据合规扫描——合规红线代码化（训练闸）
    name: 'train_compliance',
    roles: ['eval', 'ops'],
    description: '训练数据合规扫描——PII（姓名/手机号/身份证）+ 敏感字段（健康/财务）+ 企业专有名词三类风险项（复用 v1.4.4 redactor 红名单检测）；报告（发现项+严重度+处置建议）写训练集版本；严重级发现阻断训练提交；数据来源标记（企业提供/合成/公开语料）。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识（隔离分区依赖）' },
        dataset_id: { type: 'string', description: '🔴 数据集标识' },
        version: { type: 'string', description: '🔴 数据集版本（versions.jsonl 的 version）' },
        action: { type: 'string', enum: ['scan', 'gate', 'mark'], description: '操作（缺省 scan）：scan 扫描+写版本 / gate 只断言 / mark 来源标记', default: 'scan' },
        provenance: { type: 'string', enum: ['enterprise', 'synthetic', 'public'], description: '数据来源标记（mark 必填；scan 可选同扫同标）' },
      },
      required: ['enterprise_id', 'dataset_id', 'version'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } if (!args.dataset_id) { return { error: 'Missing required argument: dataset_id' }; } if (!args.version) { return { error: 'Missing required argument: version' }; } const cAction = args.action === 'gate' || args.action === 'mark' ? args.action : 'scan'; if (cAction === 'mark' && !args.provenance) { return { error: 'Missing required argument: provenance (action=mark)' }; } const tcr = await trainComplianceTool({ enterprise_id: args.enterprise_id as string, dataset_id: args.dataset_id as string, version: args.version as string, action: cAction, ...(args.provenance === 'enterprise' || args.provenance === 'synthetic' || args.provenance === 'public' ? { provenance: args.provenance } : {}) }); return { ...tcr, isError: tcr.data.isError }; },
  },
  {
    // v1.3.6 (交付 ⑨)：验收条件定义——任务创建时附机器可判定验收条件
    name: 'define_acceptance',
    roles: ['eval'],
    description: '验收条件定义——任务附机器可判定验收条件（test/build/grep-absent/schema）。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '任务标识（同一 task_id 重复定义 = 覆盖更新）' },
        criteria: {
          type: 'array',
          description: '验收条件列表（至少一条，机器可判定）',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['test', 'build', 'grep-absent', 'schema'], description: '条件类型' },
              command: { type: 'string', description: 'test/build 的执行命令（缺省 npm test / npm run build）' },
              pattern: { type: 'string', description: 'grep-absent 的搜索模式（零命中才通过）' },
              path: { type: 'string', description: 'grep-absent 的搜索路径（缺省项目根）' },
              file: { type: 'string', description: 'schema 的待校验 JSON 文件路径' },
              requiredFields: { type: 'array', items: { type: 'string' }, description: 'schema 的必需字段列表' },
              description: { type: 'string', description: '条件说明（人读）' },
            },
            required: ['type'],
          },
        },
        notes: { type: 'string', description: '备注（验收意图说明，审计可读）' },
      },
      required: ['task_id', 'criteria'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.task_id) { return { error: 'Missing required argument: task_id' }; } if (!Array.isArray(args.criteria) || (args.criteria as unknown[]).length === 0) { return { error: 'Missing or empty required argument: criteria' }; } const dar = await defineAcceptance({ task_id: args.task_id as string, criteria: args.criteria as Array<Record<string, unknown>>, ...(typeof args.notes === 'string' ? { notes: args.notes } : {}) }); return { ...dar, isError: dar.data.isError }; },
  },
  {
    // v1.3.6 (交付 ⑨)：验收执行——修改后跑验收返回结构化结果
    name: 'check_acceptance',
    roles: ['eval'],
    description: '验收执行——跑 define_acceptance 登记的条件，返回结构化结果。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '任务标识' },
        project_root: { type: 'string', description: '项目根（验收命令执行工作目录；缺省 cwd）' },
      },
      required: ['task_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.task_id) { return { error: 'Missing required argument: task_id' }; } const car = await checkAcceptance({ task_id: args.task_id as string, ...(typeof args.project_root === 'string' ? { project_root: args.project_root } : {}) }); return { ...car, isError: car.data.isError }; },
  },
  {
    // v1.4.7 (章三 G14)：workflow 对象化 CRUD——LUI Agent 读写入口（四 tool 之一）
    name: 'workflow_create',
    roles: ['agent'],
    description: '新建 workflow 对象——schema-gate 校验（结构 + cron 语法）后落库 version=1，owner 持有 trunk 直改权；每次落库挂 decision-log 审计。',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: {
          type: 'object',
          description: 'workflow 文档（name/nodes 必填；节点支持 trigger.schedule 定时触发 + visibility 三级可见性）',
          properties: {
            name: { type: 'string', description: 'workflow 名称（兼作存储主键 id）' },
            description: { type: 'string', description: 'workflow 描述' },
            nodes: {
              type: 'array',
              description: '节点列表（至少 1 个）',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '节点唯一标识' },
                  agent: { type: 'string', description: 'Agent 类型（内置 4 类 / registry / agent-creation 兜底）' },
                  task: { type: 'string', description: '节点任务描述' },
                  depends_on: { type: 'array', items: { type: 'string' }, description: '上游节点 id' },
                  type: { type: 'string', enum: ['loop', 'auto', 'manual'], description: '节点类型（缺省 auto）' },
                  hitl: { type: 'boolean', description: '是否人工确认' },
                  trigger: {
                    type: 'object',
                    properties: { schedule: { type: 'string', description: '定时触发周期——糖宏（@daily/@weekly/@monthly）或五段 cron；非法 cron 拒绝' } },
                  },
                  visibility: { type: 'string', enum: ['open', 'private', 'result-only'], description: '节点可见性（缺省 open）' },
                },
                required: ['id', 'agent', 'task'],
              },
            },
            merge_criteria: { type: 'array', items: { type: 'object' }, description: '审阅协议：可叠加验收条件' },
            approver: { type: 'object', description: '审阅协议：审阅批准者' },
          },
          required: ['name', 'nodes'],
        },
        owner: { type: 'string', description: '创建者标识（trunk 直改权持有人）' },
        description: { type: 'string', description: 'workflow 描述（可选）' },
        data_dir: { type: 'string', description: '数据根目录（缺省走 getDataDir 解析链）' },
      },
      required: ['workflow', 'owner'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.workflow || !args.owner) { return { error: 'Missing required arguments: workflow and owner' }; } const wcr = await workflowCreateTool(args); return { ...wcr, isError: wcr.data.isError }; },
  },
  {
    // v1.4.7 (章三 G14)：workflow 全量更新——owner 直改 trunk / 非 owner 开 branch
    name: 'workflow_update',
    roles: ['agent'],
    description: '全量替换 workflow 文档——owner 直改 trunk（version+1）；非 owner 写 branch-{actor}（trunk 不动，等审阅合并）。',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'workflow 标识' },
        workflow: { type: 'object', description: 'workflow 文档（与 workflow_create 同构，name 必填）' },
        actor: { type: 'string', description: '操作者（=owner 直改 trunk；否则开 branch）' },
        data_dir: { type: 'string', description: '数据根目录（缺省走 getDataDir 解析链）' },
      },
      required: ['workflow_id', 'workflow', 'actor'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.workflow_id || !args.workflow || !args.actor) { return { error: 'Missing required arguments: workflow_id, workflow, and actor' }; } const wur = await workflowUpdateTool(args); return { ...wur, isError: wur.data.isError }; },
  },
  {
    // v1.4.7 (章三 G14)：workflow 追加单节点——上岗 prompt 产物落点（与 onboard_prompt 闭环）
    name: 'workflow_node_add',
    roles: ['agent'],
    description: '向既有 workflow 追加单节点（增量改）——节点 id 重复/depends_on 悬空/cron 非法拒绝；owner 直改 trunk，非 owner 写 branch。',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'workflow 标识' },
        node: {
          type: 'object',
          description: '追加节点（id/agent/task 必填；可选 trigger.schedule / visibility）',
          properties: {
            id: { type: 'string', description: '节点唯一标识' },
            agent: { type: 'string', description: 'Agent 类型' },
            task: { type: 'string', description: '节点任务描述' },
            depends_on: { type: 'array', items: { type: 'string' }, description: '上游节点 id（须已存在）' },
            type: { type: 'string', enum: ['loop', 'auto', 'manual'], description: '节点类型（缺省 auto）' },
            hitl: { type: 'boolean', description: '是否人工确认' },
            trigger: {
              type: 'object',
              properties: { schedule: { type: 'string', description: '定时触发周期（糖宏或五段 cron）' } },
            },
            visibility: { type: 'string', enum: ['open', 'private', 'result-only'], description: '节点可见性（缺省 open）' },
          },
          required: ['id', 'agent', 'task'],
        },
        actor: { type: 'string', description: '操作者（=owner 直改 trunk；否则开 branch）' },
        data_dir: { type: 'string', description: '数据根目录（缺省走 getDataDir 解析链）' },
      },
      required: ['workflow_id', 'node', 'actor'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.workflow_id || !args.node || !args.actor) { return { error: 'Missing required arguments: workflow_id, node, and actor' }; } const wnr = await workflowNodeAddTool(args); return { ...wnr, isError: wnr.data.isError }; },
  },
  {
    // v1.4.7 (章三 G14)：workflow 变更预览——只读零副作用
    name: 'workflow_diff_preview',
    roles: ['agent'],
    description: '对比传入文档与 trunk 当前的行级差异（unified 风格 + 增删行数）——只读零副作用，落库前先预览。',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'workflow 标识' },
        workflow: { type: 'object', description: '待对比 workflow 文档（与 workflow_create 同构）' },
        actor: { type: 'string', description: '操作者' },
        data_dir: { type: 'string', description: '数据根目录（缺省走 getDataDir 解析链）' },
      },
      required: ['workflow_id', 'workflow', 'actor'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.workflow_id || !args.workflow || !args.actor) { return { error: 'Missing required arguments: workflow_id, workflow, and actor' }; } const wdr = await workflowDiffPreviewTool(args); return { ...wdr, isError: wdr.data.isError }; },
  },
  {
    // v1.4.7 (章五 G2)：能力缺口查询——商业平台悬赏数据源
    name: 'workflow_gaps',
    roles: ['ops'],
    description: 'workflow 能力缺口分析——扫描 workflow-store 声明节点 vs worklog 实际执行，产出三类缺口清单（缺人/缺能力/待升级），可被商业平台消费转悬赏。纯读零写入。',
    inputSchema: {
      type: 'object',
      properties: {
        window_days: { type: 'number', description: '统计窗口天数（缺省 30）' },
        data_dir: { type: 'string', description: '数据根目录（缺省走 getDataDir 解析链）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const wgr = await workflowGaps(args); return { ...wgr, isError: wgr.data.isError }; },
  },
  {
    // v1.4.7 (章七 G13)：PR 生命周期——提交（open 态 + 贡献者登记 + triggerBinding 两态）
    name: 'pr_submit',
    roles: ['agent'],
    description: '提交 workflow 变更提案（PR）——open 态入库 + 贡献者登记（人/数字员工同标准权重，weight 须 0-1 数值、声明 ≤10 条）+ 可选 triggerBinding（启发式=suggested / 显式=confirmed，显式不被启发式覆盖）。',
    inputSchema: {
      type: 'object',
      properties: {
        pr_id: { type: 'string', description: 'PR 标识' },
        workflow_id: { type: 'string', description: '目标 workflow' },
        title: { type: 'string', description: '变更描述' },
        submitter: { type: 'string', description: '提交者（贡献者之一，权重 1.0）' },
        contributors: { type: 'array', items: { type: 'object' }, description: '额外贡献者（[{contributor_id, weight}]，weight 0-1，≤10 条）' },
        merge_criteria: { type: 'array', items: { type: 'object' }, description: '验收条件（内置 kind：approver-review / confidence-min(如 detail:"gte:0.7")；未知 kind 判不过走 HITL）' },
        trigger: { type: 'object', description: '触发绑定 {source, confidence: suggested|confirmed}' },
        data_dir: { type: 'string', description: '数据根目录（缺省走 getDataDir 解析链）' },
      },
      required: ['pr_id', 'workflow_id', 'title', 'submitter'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.pr_id || !args.workflow_id || !args.title || !args.submitter) { return { error: 'Missing required arguments: pr_id, workflow_id, title, and submitter' }; } const psr = await prSubmit(args); return { ...psr, isError: psr.data.isError }; },
  },
  {
    // v1.4.7 (章七 G13)：PR 审阅（approve → reviewed / reject → rejected + 负样本留痕）
    name: 'pr_review',
    roles: ['agent'],
    description: '审阅 PR——approve 进 reviewed（可合并）；reject 终态 rejected（拒因进 decision-log 负样本训练信号）。提交者不可自审（利益冲突拒绝）；verdict 精确匹配 approve/reject（大小写敏感）。',
    inputSchema: {
      type: 'object',
      properties: {
        pr_id: { type: 'string', description: 'PR 标识' },
        reviewer: { type: 'string', description: '审阅者（不可为 submitter）' },
        verdict: { type: 'string', enum: ['approve', 'reject'], description: '审阅结论（精确匹配，区分大小写）' },
        note: { type: 'string', description: '审阅意见（reject 时即拒因）' },
        data_dir: { type: 'string', description: '数据根目录' },
      },
      required: ['pr_id', 'reviewer', 'verdict'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.pr_id || !args.reviewer || !args.verdict) { return { error: 'Missing required arguments: pr_id, reviewer, and verdict' }; } const prr = await prReview(args); return { ...prr, isError: prr.data.isError }; },
  },
  {
    // v1.4.7 (章七 G13)：PR 合并（criteria 真判定 fail-closed / 未过 HITL 人审门 / branch→trunk 写回）
    name: 'pr_merge',
    roles: ['agent'],
    description: '合并 PR——merge_criteria 真判定（approver-review：reviewer 非 submitter；confidence-min：confirmed=1.0/suggested=0.5/无=0 ≥ detail 阈值；未知 kind 或 detail 畸形判不过）fail-closed，未过挂起 HITL（human_confirmed=true 强制合并）。PR 的 workflow 存在 branch-{submitter} 时联动写回 trunk（version+1+删 branch，mergedVersion 回填；写回失败 PR 回退 open）。',
    inputSchema: {
      type: 'object',
      properties: {
        pr_id: { type: 'string', description: 'PR 标识' },
        actor: { type: 'string', description: '操作者' },
        human_confirmed: { type: 'boolean', description: 'HITL 人审确认（criteria 未过时须显式 true 才合并）' },
        data_dir: { type: 'string', description: '数据根目录' },
      },
      required: ['pr_id', 'actor'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.pr_id || !args.actor) { return { error: 'Missing required arguments: pr_id and actor' }; } const pmr = await prMerge(args); return { ...pmr, isError: pmr.data.isError }; },
  },
  {
    // v1.4.7 (章八)：上岗 prompt 生成器——岗位描述 → 职责/边界/工具面三段
    name: 'onboard_prompt',
    roles: ['agent'],
    description: '上岗 prompt 生成器——岗位描述 → 三段结构（职责/边界/工具面），产物经 workflow_node_add 落进节点配置（与 workflow CRUD 闭环）。',
    inputSchema: {
      type: 'object',
      properties: {
        role_description: { type: 'string', description: '岗位描述（自由文本，如「负责每日数据报表生成与异常告警」）' },
        agent_name: { type: 'string', description: 'Agent 名（可选——缺省从岗位描述推导）' },
        role: { type: 'string', enum: ['ops', 'agent', 'fde', 'audit', 'eval'], description: '工具角色面（可选——缺省 ops，决定工具面清单口径）' },
      },
      required: ['role_description'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.role_description) { return { error: 'Missing required argument: role_description' }; } const opr = await onboardPrompt({ role_description: args.role_description as string, ...(typeof args.agent_name === 'string' ? { agent_name: args.agent_name } : {}), ...(typeof args.role === 'string' ? { role: args.role } : {}) }); return { ...opr, isError: opr.data.isError }; },
  },
  {
    // v1.4.7 (章六 G4)：绩效数据导出——人/数字员工同标准贡献度聚合
    name: 'contribution_query',
    roles: ['ops'],
    description: '贡献度报表——人/数字员工同标准聚合（PR 权重分 + 决策留痕 + 审计变更规模 → 综合贡献分），按人/按 workflow 两维度输出，org_id 跨租户过滤（G7 联动）。纯读零写入。',
    inputSchema: {
      type: 'object',
      properties: {
        window_days: { type: 'number', description: '统计窗口天数（缺省 30）' },
        org_id: { type: 'string', description: '组织/租户标识（可选——缺省 default；经 resolveTenantDataDir 分区隔离）' },
        data_dir: { type: 'string', description: '数据根目录（缺省走租户解析链）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const cqr = await contributionQuery(args); return { ...cqr, isError: cqr.data.isError }; },
  },
  {
    // v1.4.7 (章十三)：标准数据推送入口——消费 v1.4.6 gateDataPush 双闸（终值 95）
    name: 'data_push',
    roles: ['ops'],
    description: '标准数据推送入口——企业存储按约定 schema 推送训练语料/知识数据，经分拣闸（敏感档标记）+ 合规闸（拦截违规）双闸入库，拒绝留痕进审计链。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['training_corpus', 'knowledge'], description: '数据类型' },
        enterprise_id: { type: 'string', description: '企业标识（租户隔离键）' },
        source: { type: 'string', description: '来源系统（审计可追溯）' },
        samples: { type: 'array', items: { type: 'string' }, description: '样本（训练语料行 / 知识片段）' },
      },
      required: ['kind', 'enterprise_id', 'source', 'samples'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.kind || !args.enterprise_id || !args.source || !args.samples) { return { error: 'Missing required arguments: kind, enterprise_id, source, and samples' }; } const dpr = await dataPush(args); return { ...dpr, isError: dpr.data.isError }; },
  },
  {
    // v1.4.2 (章八·引擎一)：FDE 访谈结构化——多轮追加 + nodeId 幂等合并 + profile 重算
    name: 'fde_interview',
    roles: ['fde'],
    description: 'FDE 访谈结构化落盘（引擎一）——五要素逐节点收集，多轮追加按 nodeId 幂等合并，自动重算企业画像（节点数/岗位分布/高频痛点）；prompts_only=true 返回六条追问话术（五要素 + 实际流程）。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识（data/fde/<id>/ 工作台分区）' },
        prompts_only: { type: 'boolean', description: '只取五要素追问话术（不落盘——访谈前引导）' },
        nodes: {
          type: 'array',
          description: '本轮访谈节点（五要素 + 三问）',
          items: {
            type: 'object',
            properties: {
              node_id: { type: 'string', description: '节点 ID（幂等键——重访谈覆盖旧记录）' },
              description: { type: 'string', description: '节点描述（做什么）' },
              elements: {
                type: 'object',
                description: '五要素（GUIDE 第二章）',
                properties: {
                  input: { type: 'string', description: '输入（从哪来）' },
                  output: { type: 'string', description: '输出（给谁用）' },
                  owner: { type: 'string', description: '负责人（岗位）' },
                  duration: { type: 'string', description: '耗时（多久做一次/每次多久）' },
                  bottleneck: { type: 'string', description: '最卡的地方（痛点——必填）' },
                },
                required: ['input', 'output', 'owner', 'duration', 'bottleneck'],
              },
              questions: {
                type: 'object',
                description: '三问判定（AI 节点识别）',
                properties: {
                  input_automatable: { type: 'boolean', description: 'Q1 输入能自动取？' },
                  rules_codifiable: { type: 'boolean', description: 'Q2 规则能写清？' },
                  output_predictable: { type: 'boolean', description: 'Q3 输出能自动推？' },
                },
                required: ['input_automatable', 'rules_codifiable', 'output_predictable'],
              },
              depends_on: { type: 'array', items: { type: 'string' }, description: '依赖节点 ID' },
            },
            required: ['node_id', 'description', 'elements', 'questions'],
          },
        },
      },
      required: ['enterprise_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } if (!args.prompts_only && (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0)) { return { error: 'Missing required argument: nodes' }; } const fir = await fdeInterviewTool({ enterprise_id: args.enterprise_id as string, ...(args.prompts_only === true ? { prompts_only: true } : {}), ...(Array.isArray(args.nodes) ? { nodes: args.nodes as NonNullable<FdeInterviewArgs['nodes']> } : {}) }); return { ...fir, isError: fir.data.isError }; },
  },
  {
    // v1.4.2 (章八·引擎二)：三问判定 → 节点方案（SSOT classifyAutomation + 六步分解）
    name: 'fde_classify',
    roles: ['fde'],
    description: 'FDE 三问判定 → 节点方案（引擎二）——classifyAutomation SSOT 判定（🔄自动/⚡强化/👤暂不动）+ 六步分解最小工作单元（GUIDE §3.2）+ executor 映射，落 nodes.json。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识' },
        nodes: {
          type: 'array',
          description: '待判定节点（与 fde_interview 同构）',
          items: {
            type: 'object',
            properties: {
              node_id: { type: 'string', description: '节点 ID' },
              description: { type: 'string', description: '节点描述' },
              elements: {
                type: 'object',
                description: '五要素',
                properties: {
                  input: { type: 'string', description: '输入' },
                  output: { type: 'string', description: '输出' },
                  owner: { type: 'string', description: '负责人' },
                  duration: { type: 'string', description: '耗时' },
                  bottleneck: { type: 'string', description: '最卡的地方' },
                },
                required: ['input', 'output', 'owner', 'duration', 'bottleneck'],
              },
              questions: {
                type: 'object',
                description: '三问',
                properties: {
                  input_automatable: { type: 'boolean', description: 'Q1 输入能自动取？' },
                  rules_codifiable: { type: 'boolean', description: 'Q2 规则能写清？' },
                  output_predictable: { type: 'boolean', description: 'Q3 输出能自动推？' },
                },
                required: ['input_automatable', 'rules_codifiable', 'output_predictable'],
              },
              depends_on: { type: 'array', items: { type: 'string' }, description: '依赖节点' },
            },
            required: ['node_id', 'description', 'elements', 'questions'],
          },
        },
      },
      required: ['enterprise_id', 'nodes'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { return { error: 'Missing or empty required argument: nodes' }; } const fcr = await fdeClassifyTool({ enterprise_id: args.enterprise_id as string, nodes: args.nodes as NonNullable<FdeClassifyArgs['nodes']> }); return { ...fcr, isError: fcr.data.isError }; },
  },
  {
    // v1.4.2 (章八·引擎三)：量化四字段 + ROI 排序（同公式同源 train-report）
    name: 'fde_quantify',
    roles: ['fde'],
    description: 'FDE 量化四字段 + ROI 排序（引擎三）——年节省=岗位年薪×AI接管工时占比（GUIDE §4.3，与 train_report 同公式同源）；ROI=年节省÷(投入+1) 降序，落 quantification.json（若引擎二已跑自动关联判定标签）。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识' },
        nodes: {
          type: 'array',
          description: '量化入参（岗位口径）',
          items: {
            type: 'object',
            properties: {
              node_id: { type: 'string', description: '节点 ID' },
              annual_salary: { type: 'number', description: '岗位真实市场年薪（元/年——追问真实数）' },
              takeover_ratio: { type: 'number', description: 'AI 接管工时占比（0..1）' },
              ai_annual_cost: { type: 'number', description: 'AI 方案年运行成本（元/年）' },
              one_time_investment: { type: 'number', description: '一次性投入（元——回本周期用）' },
            },
            required: ['node_id', 'annual_salary', 'takeover_ratio', 'ai_annual_cost'],
          },
        },
      },
      required: ['enterprise_id', 'nodes'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { return { error: 'Missing or empty required argument: nodes' }; } const fqr = await fdeQuantifyTool({ enterprise_id: args.enterprise_id as string, nodes: args.nodes as NonNullable<FdeQuantifyArgs['nodes']> }); return { ...fqr, isError: fqr.data.isError }; },
  },
  {
    // v1.4.2 (章八·引擎四)：本体推导——五要素 → ontology YAML 草稿
    name: 'fde_derive',
    roles: ['fde'],
    description: 'FDE 本体推导（引擎四）——五要素+访谈 → 实体/概念/关系 YAML 草稿；机器初稿人工确认后经 ontology_import 导入；超 10 实体或 5 节点提示 needsFullOntology。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识' },
        workflow_name: { type: 'string', description: '🔴 工作流名称（草稿命名）' },
        workflow_description: { type: 'string', description: '工作流描述' },
        nodes: {
          type: 'array',
          description: '访谈节点（与 fde_interview 同构）',
          items: {
            type: 'object',
            properties: {
              node_id: { type: 'string', description: '节点 ID' },
              description: { type: 'string', description: '节点描述' },
              elements: {
                type: 'object',
                description: '五要素',
                properties: {
                  input: { type: 'string', description: '输入' },
                  output: { type: 'string', description: '输出' },
                  owner: { type: 'string', description: '负责人' },
                  duration: { type: 'string', description: '耗时' },
                  bottleneck: { type: 'string', description: '最卡的地方' },
                },
                required: ['input', 'output', 'owner', 'duration', 'bottleneck'],
              },
              questions: {
                type: 'object',
                description: '三问',
                properties: {
                  input_automatable: { type: 'boolean', description: 'Q1' },
                  rules_codifiable: { type: 'boolean', description: 'Q2' },
                  output_predictable: { type: 'boolean', description: 'Q3' },
                },
                required: ['input_automatable', 'rules_codifiable', 'output_predictable'],
              },
              depends_on: { type: 'array', items: { type: 'string' }, description: '依赖节点' },
            },
            required: ['node_id', 'description', 'elements', 'questions'],
          },
        },
      },
      required: ['enterprise_id', 'workflow_name', 'nodes'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } if (!args.workflow_name) { return { error: 'Missing required argument: workflow_name' }; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { return { error: 'Missing or empty required argument: nodes' }; } const fdr = await fdeDeriveTool({ enterprise_id: args.enterprise_id as string, workflow_name: args.workflow_name as string, ...(typeof args.workflow_description === 'string' ? { workflow_description: args.workflow_description } : {}), nodes: args.nodes as NonNullable<FdeDeriveArgs['nodes']> }); return { ...fdr, isError: fdr.data.isError }; },
  },
  {
    // v1.4.2 (章八·引擎五)：三层交付物——文档/Skill/运行（GUIDE 第五章）
    name: 'fde_distill',
    roles: ['fde'],
    description: 'FDE 三层交付物生成（引擎五）——跑通过程沉淀：文档层手册（人读：现状/六步/验收/回滚）+ Skill 层模板（Agent 可执行）+ 运行层 yaml 片段（引擎六组装用），归档 deliverables/ 带 README 索引。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识' },
        nodes: {
          type: 'array',
          description: '沉淀节点（与 fde_interview 同构）',
          items: {
            type: 'object',
            properties: {
              node_id: { type: 'string', description: '节点 ID' },
              description: { type: 'string', description: '节点描述' },
              elements: {
                type: 'object',
                description: '五要素',
                properties: {
                  input: { type: 'string', description: '输入' },
                  output: { type: 'string', description: '输出' },
                  owner: { type: 'string', description: '负责人' },
                  duration: { type: 'string', description: '耗时' },
                  bottleneck: { type: 'string', description: '最卡的地方' },
                },
                required: ['input', 'output', 'owner', 'duration', 'bottleneck'],
              },
              questions: {
                type: 'object',
                description: '三问',
                properties: {
                  input_automatable: { type: 'boolean', description: 'Q1' },
                  rules_codifiable: { type: 'boolean', description: 'Q2' },
                  output_predictable: { type: 'boolean', description: 'Q3' },
                },
                required: ['input_automatable', 'rules_codifiable', 'output_predictable'],
              },
              depends_on: { type: 'array', items: { type: 'string' }, description: '依赖节点' },
            },
            required: ['node_id', 'description', 'elements', 'questions'],
          },
        },
      },
      required: ['enterprise_id', 'nodes'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { return { error: 'Missing or empty required argument: nodes' }; } const fdsr = await fdeDistillTool({ enterprise_id: args.enterprise_id as string, nodes: args.nodes as NonNullable<FdeDistillArgs['nodes']> }); return { ...fdsr, isError: fdsr.data.isError }; },
  },
  {
    // v1.4.2 (章八·引擎六)：workflow 组装部署——产物走 submit+activate 现有链路
    name: 'fde_deploy',
    roles: ['fde'],
    description: 'FDE workflow 组装部署（引擎六）——三层交付物 → deployments/<name>.yml（与 fde_compose 同格式）；只产出工件不代激活——激活走 workflow_submit + activate_workflow（人审闸门保留）。',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_id: { type: 'string', description: '🔴 企业标识' },
        workflow_name: { type: 'string', description: '🔴 工作流名称（yml 文件名）' },
        workflow_description: { type: 'string', description: '工作流描述' },
        nodes: {
          type: 'array',
          description: '组装节点（与 fde_interview 同构）',
          items: {
            type: 'object',
            properties: {
              node_id: { type: 'string', description: '节点 ID' },
              description: { type: 'string', description: '节点描述' },
              elements: {
                type: 'object',
                description: '五要素',
                properties: {
                  input: { type: 'string', description: '输入' },
                  output: { type: 'string', description: '输出' },
                  owner: { type: 'string', description: '负责人' },
                  duration: { type: 'string', description: '耗时' },
                  bottleneck: { type: 'string', description: '最卡的地方' },
                },
                required: ['input', 'output', 'owner', 'duration', 'bottleneck'],
              },
              questions: {
                type: 'object',
                description: '三问',
                properties: {
                  input_automatable: { type: 'boolean', description: 'Q1' },
                  rules_codifiable: { type: 'boolean', description: 'Q2' },
                  output_predictable: { type: 'boolean', description: 'Q3' },
                },
                required: ['input_automatable', 'rules_codifiable', 'output_predictable'],
              },
              depends_on: { type: 'array', items: { type: 'string' }, description: '依赖节点' },
            },
            required: ['node_id', 'description', 'elements', 'questions'],
          },
        },
      },
      required: ['enterprise_id', 'workflow_name', 'nodes'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.enterprise_id) { return { error: 'Missing required argument: enterprise_id' }; } if (!args.workflow_name) { return { error: 'Missing required argument: workflow_name' }; } if (!Array.isArray(args.nodes) || (args.nodes as unknown[]).length === 0) { return { error: 'Missing or empty required argument: nodes' }; } const fdpr = await fdeDeployTool({ enterprise_id: args.enterprise_id as string, workflow_name: args.workflow_name as string, ...(typeof args.workflow_description === 'string' ? { workflow_description: args.workflow_description } : {}), nodes: args.nodes as NonNullable<FdeDeployArgs['nodes']> }); return { ...fdpr, isError: fdpr.data.isError }; },
  },
  {
    // 训练语料导出三件套（规则 + 方法论 + 样本）——训练信号机器可读化
    name: 'corpus_export',
    roles: ['ops'],
    description: '训练语料导出三件套——规则（28 编号位含跳号占位 + reward_hint 骨架 + verifiers 三桶清单）+ FDE 方法论（锚点解析）+ 带标签审计样本（六源聚合 + 脱敏）。导出带版本号 + HMAC 签名，导出行为记 corpus_export 审计事件。',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['default', 'extended', 'all'], description: '规则导出范围（缺省 all = 28 编号位）' },
        out_dir: { type: 'string', description: '输出目录（缺省 data/export/corpus/）' },
        data_dir: { type: 'string', description: '数据根目录（样本聚合源）' },
        rules_only: { type: 'boolean', description: '只导规则面（跳过样本/方法论）' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const cer = await corpusExport({ ...(typeof args.scope === 'string' ? { scope: args.scope as CorpusExportArgs['scope'] } : {}), ...(typeof args.out_dir === 'string' ? { outDir: args.out_dir as string } : {}), ...(typeof args.data_dir === 'string' ? { dataDir: args.data_dir as string } : {}), ...(args.rules_only === true ? { rulesOnly: true } : {}) }); return { ...cer, isError: cer.data.isError }; },
  },
  {
    // v1.4.9 G9（T1）：设备上线注册——Ed25519 身份码验签 fail-closed + 设备类型 + 能力声明
    name: 'device_register',
    roles: ['ops'],
    description: '设备上线注册（G9）：Ed25519 身份码验签 fail-closed（伪造签名拒绝且留审计）+ 设备类型（pc/node/appliance）+ 能力声明（派单方按能力匹配设备）。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'object', description: '设备身份码（AgentIdentity JSON——须含 publicKey + signature）' },
        kind: { type: 'string', enum: ['pc', 'node', 'appliance'], description: '设备类型' },
        capabilities: { type: 'array', items: { type: 'string' }, description: '能力标签清单（挂载的 MCP / skill / 数据源）' },
        tenant: { type: 'string', description: '租户（缺省 default）' },
      },
      required: ['identity', 'kind'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.identity || typeof args.identity !== 'object') { return { error: 'Missing required argument: identity' }; } if (!args.kind || (args.kind !== 'pc' && args.kind !== 'node' && args.kind !== 'appliance')) { return { error: 'Invalid kind (pc/node/appliance)' }; } const drr = await deviceRegister({ identity: args.identity as Record<string, unknown>, kind: args.kind, ...(Array.isArray(args.capabilities) ? { capabilities: args.capabilities as string[] } : {}), ...(typeof args.tenant === 'string' ? { tenant: args.tenant } : {}) }); return { ...drr, isError: !drr.data.ok }; },
  },
  {
    // v1.4.9 G9（T1）：设备清单查询——只含已验签设备，在线态实时判定（T12 派单前置）
    name: 'device_list',
    roles: ['ops'],
    description: '设备清单查询（G9 发现面）：按租户/类型/能力过滤，含最后心跳时间与在线状态；清单只含已验签设备（被拒/吊销设备不出现）。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: { type: 'string', description: '租户过滤' },
        kind: { type: 'string', enum: ['pc', 'node', 'appliance'], description: '设备类型过滤' },
        capability: { type: 'string', description: '能力标签过滤' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: (args) => deviceList({ ...(typeof args.tenant === 'string' ? { tenant: args.tenant } : {}), ...(typeof args.kind === 'string' ? { kind: args.kind } : {}), ...(typeof args.capability === 'string' ? { capability: args.capability } : {}) }),
  },
  {
    // v1.4.9 G10（T2）：设备侧数据面授权读取——白名单校验 → 读取 → 脱敏 → 审计计量
    name: 'device_data_query',
    roles: ['ops'],
    description: '设备侧数据面授权读取（G10）：设备门禁 → 目录白名单校验（默认空=全拒，opt-in）→ 读取 → 脱敏管线（敏感字段不出设备）→ 审计留痕 + 计量进 worklog。返回结构化内容（不落原始路径）。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'object', description: '设备身份码（AgentIdentity JSON——须过 gateDevice 闸门）' },
        path: { type: 'string', description: '请求读取的文件路径（设备侧绝对路径，须在白名单内）' },
        max_bytes: { type: 'number', description: '读取上限字节（缺省 64KB）' },
      },
      required: ['identity', 'path'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.identity || typeof args.identity !== 'object') { return { error: 'Missing required argument: identity' }; } if (!args.path || typeof args.path !== 'string') { return { error: 'Missing required argument: path' }; } const dqr = await deviceDataQuery({ identity: args.identity as Record<string, unknown>, path: args.path, ...(typeof args.max_bytes === 'number' && args.max_bytes > 0 ? { maxBytes: args.max_bytes } : {}) }); return { ...dqr, isError: !dqr.data.ok }; },
  },
  {
    // v1.4.9 G11（T3）：数据上行通道——采集声明校验 → 脱敏 → 加密入队（WAL 暂存/断点续传）
    name: 'device_data_push',
    roles: ['ops'],
    description: '数据上行通道（G11）：设备门禁 → 采集声明校验（默认空=不上行，opt-in）→ 脱敏 → AES-256-GCM 加密入队（WAL 暂存断网不丢，游标续传不重传已 ack 段）→ 审计留痕 + 计量进 worklog。原始数据不出设备。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'object', description: '设备身份码（AgentIdentity JSON——须过 gateDevice 闸门）' },
        category: { type: 'string', enum: ['metrics', 'audit-digest', 'inference-result'], description: '数据类别（须在采集声明内）' },
        payload: { type: 'string', description: '上行内容明文（入队前脱敏 + 加密）' },
        destination: { type: 'string', description: '目的地端点标识（与声明核对）' },
      },
      required: ['identity', 'category', 'payload'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.identity || typeof args.identity !== 'object') { return { error: 'Missing required argument: identity' }; } if (!args.category || typeof args.category !== 'string') { return { error: 'Missing required argument: category' }; } if (typeof args.payload !== 'string') { return { error: 'Missing required argument: payload' }; } const dpr = await deviceDataPush({ identity: args.identity as Record<string, unknown>, category: args.category, payload: args.payload, ...(typeof args.destination === 'string' ? { destination: args.destination } : {}) }); return { ...dpr, isError: dpr.data.isError }; },
  },
  {
    // v1.4.9 G5b（T4）：连接器注册——准入复用插件来源白名单（fail-closed）
    name: 'connector_register',
    roles: ['ops'],
    description: '注册第三方连接器（G5b 准入面）：来源过 plugin-gate 白名单校验（Git URL / 主机 / 本地路径，白名单外拒绝）→ 注册表落库（config/connectors.json，租户隔离 + 同租户重名拒绝）→ 审计留痕。与工具注册分列——连接器清单见 connector_list。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '连接器标识（租户内唯一，1-64 位字母数字开头词法）' },
        kind: { type: 'string', enum: ['db', 'rest', 'saas'], description: '连接器类型' },
        source: { type: 'string', description: '来源串（Git URL / 主机 / 本地路径——须在企业白名单内）' },
        capabilities: { type: 'array', items: { type: 'string' }, description: '能力标签（发现面过滤维度）' },
        tenant: { type: 'string', description: '归属租户（缺省 default）' },
        endpoint: { type: 'string', description: '接入端点回显（不含凭证）' },
      },
      required: ['name', 'kind', 'source'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.name || typeof args.name !== 'string') { return { error: 'Missing required argument: name' }; } if (!args.kind || (args.kind !== 'db' && args.kind !== 'rest' && args.kind !== 'saas')) { return { error: 'Invalid kind (db/rest/saas)' }; } if (!args.source || typeof args.source !== 'string') { return { error: 'Missing required argument: source' }; } const crr = await connectorRegister({ name: args.name, kind: args.kind, source: args.source, ...(Array.isArray(args.capabilities) ? { capabilities: args.capabilities as string[] } : {}), ...(typeof args.tenant === 'string' && args.tenant ? { tenant: args.tenant } : {}), ...(typeof args.endpoint === 'string' && args.endpoint ? { endpoint: args.endpoint } : {}) }); return { ...crr, isError: crr.data.isError }; },
  },
  {
    // v1.4.9 G5b（T4）：连接器发现——与 tool-registry 分列铁律
    name: 'connector_list',
    roles: ['ops'],
    description: '连接器发现（G5b 目录面）：按类型（db/rest/saas）/ 主机 / 能力标签过滤，租户隔离（只返回请求租户条目）。清单只含连接器——与 MCP 工具清单（TOOLS）分列，绝不混列。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: { type: 'string', description: '租户隔离键（缺省 default）' },
        kind: { type: 'string', enum: ['db', 'rest', 'saas'], description: '类型过滤' },
        host: { type: 'string', description: '来源过滤（主机名 / 本地路径前缀）' },
        capability: { type: 'string', description: '能力标签过滤' },
      },
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => connectorList({ ...(typeof args.tenant === 'string' && args.tenant ? { tenant: args.tenant } : {}), ...(args.kind === 'db' || args.kind === 'rest' || args.kind === 'saas' ? { kind: args.kind } : {}), ...(typeof args.host === 'string' && args.host ? { host: args.host } : {}), ...(typeof args.capability === 'string' && args.capability ? { capability: args.capability } : {}) }),
  },
  {
    // v1.4.9 G1（T5）：workflow 模板导出——五件套 + 血缘 + 跨租户剥离
    name: 'workflow_export',
    roles: ['agent'],
    description: 'workflow 模板导出（G1 五件套）：workflow.yml + 本体数据 + MD 家族 + manifest（sha256 完整性）+ 血缘元数据（源企业/源版本/fork 层级/祖先链）。跨租户缺省剥离 private / result-only 节点（G6 联动，剥离计数入 manifest）。export 事件入血缘谱系 + 审计挂链。',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: '源 workflow 标识' },
        enterprise: { type: 'string', description: '源企业标识（血缘元数据——导入方回溯锚）' },
        cross_tenant: { type: 'boolean', description: '跨租户分发（缺省 true——private/result-only 剥离；同租户传 false 全量）' },
        actor: { type: 'string', description: '执行者（审计留痕）' },
      },
      required: ['workflow_id'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.workflow_id || typeof args.workflow_id !== 'string') { return { error: 'Missing required argument: workflow_id' }; } const wer = await workflowExport({ workflow_id: args.workflow_id, ...(typeof args.enterprise === 'string' && args.enterprise ? { enterprise: args.enterprise } : {}), ...(typeof args.cross_tenant === 'boolean' ? { cross_tenant: args.cross_tenant } : {}), ...(typeof args.actor === 'string' && args.actor ? { actor: args.actor } : {}) }); return { ...wer, isError: wer.data.isError }; },
  },
  {
    // v1.4.9 G1（T5）：workflow 模板导入——三闸 + 血缘回流
    name: 'workflow_import',
    roles: ['agent'],
    description: 'workflow 模板导入（G1 三闸 fail-closed）：结构闸（manifest + 必要件 + sha256 完整性核对）→ schema 校验门（zod 结构 + 可见性枚举 + cron 语法，与 CRUD 同门）→ 落地闸（冲突拒绝）。跨企业包检出 private/result-only 节点整包拒绝（G6 加固）。血缘回流（import 事件 + 祖先链接入）+ 本体合并（本地优先）。',
    inputSchema: {
      type: 'object',
      properties: {
        bundle: { type: 'object', description: '导出包整体（workflow_export 返回的 bundle 对象——manifest + workflow.yml + 伴生件）' },
        imported_as: { type: 'string', description: '落地 workflow id（缺省 = 源 id + \'-imported\'）' },
        owner: { type: 'string', description: '落地 owner（trunk 直改权持有人——缺省 actor）' },
        actor: { type: 'string', description: '执行者（审计留痕）' },
      },
      required: ['bundle'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.bundle || typeof args.bundle !== 'object') { return { error: 'Missing required argument: bundle' }; } const wir = await workflowImport({ bundle: args.bundle as Record<string, unknown>, ...(typeof args.imported_as === 'string' && args.imported_as ? { imported_as: args.imported_as } : {}), ...(typeof args.owner === 'string' && args.owner ? { owner: args.owner } : {}), ...(typeof args.actor === 'string' && args.actor ? { actor: args.actor } : {}) }); return { ...wir, isError: wir.data.isError }; },
  },
  {
    // v1.4.9 T7：router 过站 session 承接——伴生 exporter 推送入口（103→104 终值）
    name: 'router_session_push',
    roles: ['ops'],
    description: 'router 过站 session 承接（T7 第七章）：exporter 标准 schema 校验（fail-closed 拒绝坏格式）→ 多轮展开（切窗/角色映射）→ 脱敏本地落盘（数据主权铁律——记录不出企业边界，幂等：同 sessionId 重复推送拒绝）→ usage 入 cost 台账（按模型/时段聚合）→ key 维度过站行为 HMAC 挂链（审计）。会话续接五元组（执行器+员工身份+模型+工作目录+运行时）透传判定。',
    inputSchema: {
      type: 'object',
      properties: {
        raw: { type: 'object', description: 'exporter 推送 payload（RouterSessionSchema 形态——字段：sessionId、enterpriseId、source、messages、usage、route，可选 apiKeyId、scope、pushedAt）' },
      },
      required: ['raw'],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { if (!args.raw || typeof args.raw !== 'object') { return { error: 'Missing required argument: raw' }; } const rsp = await routerSessionPush({ raw: args.raw }); return { ...rsp, isError: rsp.data.isError }; },
  },
  {
    // v1.5.0 章八：跨层证据对账（104→105——DSH trace vs git diff vs logs 三源比对）
    name: 'trace_reconcile',
    roles: ['ops', 'fde'],
    description: '跨层证据对账（trace reconcile）：DSH session trace（Agent 自述）vs git diff（独立事实）vs logs 声明集三源比对——产出差异清单（漏报/幻觉动作/瞒报四态）+ 一致率；可选模型层回溯链（推理 → 模型版本 → train_job → datasetHash）。对账结果入 decision-log（kind=COVERAGE）。',
    inputSchema: {
      type: 'object',
      properties: {
        repo_root: { type: 'string', description: '仓库根（git diff 采集目标；缺省 process.cwd()）' },
        include_model_layer: { type: 'boolean', description: '是否输出模型层回溯链（llm-calls → train fingerprint）' },
        session_limit: { type: 'number', description: 'DSH session 扫描上限（缺省 50）' },
      },
      required: [],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const trt = await traceReconcileTool({ ...(typeof args.repo_root === 'string' && args.repo_root ? { repo_root: args.repo_root } : {}), ...(typeof args.include_model_layer === 'boolean' ? { include_model_layer: args.include_model_layer } : {}), ...(typeof args.session_limit === 'number' ? { session_limit: args.session_limit } : {}) } satisfies TraceReconcileArgs); return { ...trt, isError: trt.data.isError }; },
  },
  {
    // v1.5.2 章一：审计数据只读查询——history 三维过滤 + decision 因果链（严格只读，不写链）
    name: 'audit_query',
    roles: ['audit'],
    description: '审计数据只读查询——按时间/规则/exitCode 过滤读 history.jsonl，按 ts 查 decision-log 因果链（消费 causedBy 字段）。严格只读，不写任何审计链。边界：audit_trail 按 agentId 查跨设备轨迹 / worklog_query 查工作效能指标 / run_audit 跑规则写 think.md（写侧）/ ruleset_export 导出规则面——本 tool 只查「时间·规则·exitCode·因果链」维度，勿混用。',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: '起始时间（ISO 8601，闭区间含）——history 与 decision 两面通用' },
        until: { type: 'string', description: '结束时间（ISO 8601，闭区间含）——history 与 decision 两面通用' },
        rule: { type: 'string', description: '规则 id（如 A1 / E1）——匹配 history 条目 ruleResults（id / name）' },
        exitCode: { type: 'number', enum: [0, 1, 2], description: '审计退出码：0=PASS / 1=WARN / 2=FAIL' },
        limit: { type: 'number', description: '返回条数上限（默认 100，时间倒序取最新）' },
        causedBy: { type: 'string', description: 'decision 面：查以该 ts 为因果上游的后继决策条目（消费 causedBy 字段）' },
        source: { type: 'string', enum: ['history', 'decision', 'both'], description: '查询源（缺省按是否有 causedBy 推断：有→decision，无→history）' },
        dataDir: { type: 'string', description: '数据目录覆盖（测试注入用；缺省走 SOFAGENT_DATA 解析链）' },
      },
      required: [],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const aq = await auditQuery({ ...(typeof args.since === 'string' && args.since ? { since: args.since } : {}), ...(typeof args.until === 'string' && args.until ? { until: args.until } : {}), ...(typeof args.rule === 'string' && args.rule ? { rule: args.rule } : {}), ...(args.exitCode === 0 || args.exitCode === 1 || args.exitCode === 2 ? { exitCode: args.exitCode } : {}), ...(typeof args.limit === 'number' ? { limit: args.limit } : {}), ...(typeof args.causedBy === 'string' && args.causedBy ? { causedBy: args.causedBy } : {}), ...(args.source === 'history' || args.source === 'decision' || args.source === 'both' ? { source: args.source } : {}), ...(typeof args.dataDir === 'string' && args.dataDir ? { dataDir: args.dataDir } : {}) }); return { ...aq, isError: aq.data.isError === true }; },
  },
  {
    // v1.5.2 章二：规则集导出——默认规则 + 扩展规则 → 标准 JSON（导出格式即加载格式，双向可逆）
    name: 'ruleset_export',
    roles: ['audit'],
    description: '规则集导出——25 条默认规则 + 已加载扩展规则导出为标准 JSON（与 --ruleset-path 加载格式同构，导出即加载格式、双向可逆），每条附训练消费元数据（rule_id / 检测意图 / 违规样例 / 严重级别）+ 规则集版本号 + 内容指纹（HMAC-SHA256），导出行为写审计留痕。边界：list_rules 只列规则清单、corpus_export 导出训练语料三件套——本 tool 导出「规则面标准 JSON」供第三方零转换消费。',
    inputSchema: {
      type: 'object',
      properties: {
        rulesetName: { type: 'string', description: '规则集名称（缺省 sofagent）' },
        rulesetVersion: { type: 'string', description: '规则集版本（缺省读 audit 包 package.json 版本）' },
        description: { type: 'string', description: '规则集描述（缺省自动生成）' },
        dataDir: { type: 'string', description: '数据根目录（审计留痕落点，缺省 SOFAGENT_DATA / data）' },
        outDir: { type: 'string', description: '导出 JSON 落盘目录（缺省 <dataDir>/export/ruleset）' },
        dryRun: { type: 'boolean', description: '只构造不落盘、不留痕（预览用）' },
      },
      required: [],
    },
    // v1.4.8 条目 5 迁移：查表分发
    handler: async (args) => { const re = await rulesetExport({ ...(typeof args.rulesetName === 'string' && args.rulesetName ? { rulesetName: args.rulesetName } : {}), ...(typeof args.rulesetVersion === 'string' && args.rulesetVersion ? { rulesetVersion: args.rulesetVersion } : {}), ...(typeof args.description === 'string' && args.description ? { description: args.description } : {}), ...(typeof args.dataDir === 'string' && args.dataDir ? { dataDir: args.dataDir } : {}), ...(typeof args.outDir === 'string' && args.outDir ? { outDir: args.outDir } : {}), ...(typeof args.dryRun === 'boolean' ? { dryRun: args.dryRun } : {}) }); return { ...re, isError: re.data.isError === true }; },
  },
];
