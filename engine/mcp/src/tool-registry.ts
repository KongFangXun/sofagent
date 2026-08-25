// ============================================================
// tool-registry.ts · MCP tools/list schema definitions
// v1.4.0: 从 mcp-server.ts 提取
// ============================================================

import { VERSION } from '@sofagent/audit';

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
}

/**
 * 完整工具清单——67 个 tool（v1.4.1：train_submit 新增；v1.4.0：cost_query + browser 4 新增；v1.3.9：worklog_query 新增；v1.3.6：workflow_submit/ontology_import/model_register/model_switch/model_unregister/train_budget/define_acceptance/check_acceptance；v1.3.5：run_ab_test/promote_ab/snapshot_list/snapshot_restore；v1.3.4：commons_publish/search/invoke/rate/retire/harvest_rule；不含 4 个 resource shortcut）
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
  },
  {
    // v1.4.0（十）：Agentic Browser——Playwright 驱动的浏览器 4 工具（v1.3.9 交付实现，本版注册 MCP 面）
    name: 'playwright_navigate',
    roles: ['browser'],
    description: '浏览器导航——打开 URL 并返回页面标题/状态码。Playwright 不可用时降级。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标 URL' },
      },
      required: ['url'],
    },
  },
  {
    name: 'playwright_click',
    roles: ['browser'],
    description: '浏览器点击——按 CSS 选择器点击元素。Playwright 不可用时降级。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'playwright_screenshot',
    roles: ['browser'],
    description: '浏览器截图——截取当前页面，返回图片路径与字节数。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '截图文件名（可选）' },
      },
    },
  },
  {
    name: 'playwright_assert',
    roles: ['browser'],
    description: '浏览器断言——对页面执行断言（文本/元素存在性），返回 passed 与详情。',
    inputSchema: {
      type: 'object',
      properties: {
        condition: { type: 'string', description: '断言条件（如元素可见/文本存在）' },
      },
      required: ['condition'],
    },
  },
  {
    name: 'run_audit',
    roles: ['audit'],
    description: '对 git diff 运行全量审计（24 条规则），返回结构化审计报告。',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'git diff 范围（如 HEAD~1..HEAD）。默认 HEAD~1..HEAD', default: 'HEAD~1..HEAD' },
        task: { type: 'string', description: '任务描述（用于 A3 不改越界检查）' },
        strict: { type: 'boolean', description: '严格模式：无日志时 A7/A8 返回 FAIL 而非 WARN', default: false },
        silent: { type: 'boolean', description: '沉默模式：跳过日志依赖规则，走 diff 启发式回退', default: false },
      },
    },
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
  },
  {
    name: 'sofagent_compose',
    roles: ['fde'],
    description: '编排引擎——传入任务描述，返回 Sub Agent 编排方案（YAML）。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务描述' },
        agent: { type: 'string', description: '指定 Sub Agent（可选）' },
        run: { type: 'boolean', description: '是否执行（默认 false = dry-run）' },
      },
      required: ['task'],
    },
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
  },
  {
    name: 'read_lessons',
    roles: ['fde', 'eval', 'audit'],
    description: '读取踩坑记录（lessons-missteps.md）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_think_md',
    roles: ['fde', 'eval'],
    description: '读取 think.md 完整内容。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'stats',
    roles: ['ops'],
    description: '知识库统计（entities/concepts 数 + 最后更新时间）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_capabilities',
    // v1.4.0 修正：能力发现元工具不归任何角色面（原 roles:['ops'] 致专职收窄时被过滤，
    // Agent 首次连接拿不到能力地图——S59 回归抓出）。未打标 = 始终暴露（同动态工具机制）。
    description: '返回完整能力清单（tools + resources）——Agent 首次连上时获取能力地图。',
    inputSchema: { type: 'object', properties: {} },
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
      required: ['name', 'confirmed'],
    },
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
      required: ['name', 'confirmed'],
    },
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
  },
  {
    name: 'daemon_status',
    roles: ['ops'],
    description: '查询 daemon 运行状态（PID/启动时间/心跳）。只读。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_agents',
    roles: ['fde', 'agent'],
    description: '列出已注册的 Agent（内置 + 企业 SubAgent）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_concepts',
    roles: ['fde'],
    description: '列出所有 concept。',
    inputSchema: { type: 'object', properties: {} },
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
      required: ['checkpoint_id', 'decision'],
    },
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
  },
  {
    // v1.3.2 (交付 7右)：FDE 梳理辅助
    name: 'fde_compose',
    roles: ['fde'],
    description: 'FDE 梳理辅助——五要素引导生成 workflow 或 ontology 草稿。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['workflow', 'ontology'], description: '生成类型：workflow=workflow.yml 草稿 / ontology=entity/concept/relations 草稿' },
        session: { type: 'object', description: '梳理会话 JSON（含 enterpriseId / nodes / workflowName 等，由 compose-interview 收集）' },
      },
      required: ['action', 'session'],
    },
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
  },
  {
    // v1.3.4 (交付 2)：能力调用
    name: 'commons_invoke',
    roles: ['commons'],
    description: '能力调用——发现能力后挂载调用（SkillScan 拦截 + HITL 确认）。',
    inputSchema: {
      type: 'object',
      properties: {
        capability_id: { type: 'string', description: '能力 ID（必填——先 commons_search 发现）' },
        caller_agent_id: { type: 'string', description: '调用者 agentId（必填）' },
        input: { description: '调用入参（透传给被调能力）' },
      },
      required: ['capability_id', 'caller_agent_id'],
    },
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
      required: ['name', 'endpoint', 'model'],
    },
  },
  {
    // v1.3.6 (交付 ④)：模型灰度切换/晋升/回滚——晋升强制人审（对齐 promote_ab）
    name: 'model_switch',
    roles: ['ops'],
    description: '模型灰度切换——按档位切换活动模型（percent<100 灰度，100 强制人审）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '目标模型名（action=rollback 时可省略）' },
        lane: { type: 'string', enum: ['executor', 'pipeline'], description: '档位（缺省 executor）', default: 'executor' },
        percent: { type: 'number', description: '灰度比例 1-99；100/缺省 = 晋升全量（强制人审）' },
        action: { type: 'string', enum: ['switch', 'rollback'], description: '动作：switch（默认）/ rollback', default: 'switch' },
        human_confirmed: { type: 'boolean', description: '🔴 人工确认（晋升 percent=100 时必填 true——false/缺省挂起等人审）', default: false },
        comment: { type: 'string', description: '备注（灰度依据 / 回滚原因，写入事件留痕）' },
      },
    },
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
  },
];
