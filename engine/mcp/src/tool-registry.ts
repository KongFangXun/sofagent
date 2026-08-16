// ============================================================
// tool-registry.ts · MCP tools/list schema definitions
// v1.3.5: 从 mcp-server.ts 提取
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
}

/**
 * 完整工具清单——52 个 tool（v1.3.5：run_ab_test/promote_ab/snapshot_list/snapshot_restore 新增；v1.3.4：market_publish/search/invoke/rate/retire/harvest_rule；不含 4 个 resource shortcut）
 */
export const TOOLS: ToolDef[] = [
  {
    name: 'run_audit',
    description: '对 git diff 运行全量审计规则（sofagent 审计引擎 · 24 条审计规则，静态规则扫描为主，复杂项可走 LLM 辅助）。返回结构化审计报告。',
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
    description: '读取 think.md 的最新反思条目。返回最后一条 ## 开头的反思记录，含审计结果、教训、改动范围。',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '返回最近 N 条反思条目（默认 1）', default: 1 },
      },
    },
  },
  {
    name: 'write_think',
    description: '向 think.md 追加一条手动反思记录。用于 Agent 主动记录经验教训。',
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
    description: '编排引擎——传入任务描述，返回 Sub Agent 编排方案（YAML）',
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
    description: '单文件变更即时审计（v1.1.5 新增）——Agent 通过 MCP 编辑文件时调用，即时跑适用于单文件的规则（A3/A7/A11/A18，可选 A14 当传 task 时）。返回结构化结果（不阻断，由 Agent 自决）。',
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
    description: '跨 entities/concepts 模糊搜索 knowledge 库（v1.1.5）。返回匹配的页面列表（含路径 + 首行摘要）。',
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
    description: '读取单个 entity 页（knowledge/entities/<name>.md）',
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
    description: '读取单个 concept 页（knowledge/concepts/<name>.md）',
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
    description: '列出 knowledge/entities/ 下所有 entity（可选按 domain 过滤）',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'domain 过滤（可选）' },
      },
    },
  },
  {
    name: 'read_lessons',
    description: '读取 knowledge/lessons-missteps.md（踩坑记录）',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_think_md',
    description: '读取 think.md 完整内容（v1.1.5 新增，返回值首行带 [sofagent] 前缀）',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'stats',
    description: 'knowledge 库统计（entities 数 / concepts 数 / 最后更新时间）',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_capabilities',
    description: '返回 sofagent MCP 完整能力清单（tools + resources + 描述）——Agent 首次连上时调用获取能力地图',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'data_sovereignty_report',
    description: '查询数据主权审计报告摘要（v1.2.2 P0）。支持 date 参数：today / yesterday / YYYY-MM-DD。返回云端调用、本地执行、数据流出、敏感本地处理率、异常明细。',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '查询日期：today / yesterday / YYYY-MM-DD（默认 today）', default: 'today' },
      },
    },
  },
  {
    name: 'create_entity',
    description: '在知识库中创建/更新一个 entity 页（knowledge/entities/<name>.md）。写入前跑 D1-D5 数据审计，FAIL 时拒绝写入。',
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
    description: '在知识库中创建/更新一个 concept 页（knowledge/concepts/<name>.md）。用于沉淀业务概念定义。',
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
    description: '字段级更新 entity 页（knowledge/entities/<name>.md，v1.3.1 交付 5）——只改传入字段（domain/description/relations/content/newName），保留其余 frontmatter 与正文，updated_at 自动刷新。写入前跑 D1-D5 数据审计，FAIL 时拒绝写入。',
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
    description: '删除 entity 页（knowledge/entities/<name>.md，v1.3.1 交付 5）——破坏性操作，强制人审确认：必须显式传 confirmed:true 才执行，否则只返回提示。删除全程 D1-D5 审计留痕。',
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
    description: '删除 concept 页（knowledge/concepts/<name>.md，v1.3.1 交付 5）——破坏性操作，强制人审确认：必须显式传 confirmed:true 才执行，否则只返回提示。删除全程 D1-D5 审计留痕。',
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
    description: '检查本体结构完整性——实体数、关联断裂、孤儿实体、死链。复用 ontology merge-engine 逻辑。',
    inputSchema: {
      type: 'object',
      properties: {
        fix: { type: 'boolean', description: '是否自动修复可修复的问题（如孤儿实体标记），默认 false' },
      },
    },
  },
  {
    name: 'evaluate_output',
    description: '用 golden set 评估 Agent 产出质量。复用 eval 引擎逻辑。返回评分 + 失败用例。',
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
    description: '优化指定 Skill 文件——调用 skillopt 引擎分析并生成优化建议。复用 skillopt 逻辑。',
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
    description: '运行 sofagent 环境健康检查——环境/配置/数据目录/Hook/依赖。复用 core doctor/verify 逻辑。',
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
    description: '对知识库结构化数据变更跑审计（D1-D5 数据规则）。可审计最近 N 次数据变更，或指定 entity/concept 名称。',
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
    description: '向当前 Agent session 推送审计结果摘要。用于审计完成后主动告知用户审计状态，确保"结果可见"。',
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
    description: '读取 FDE 交付物（workflow.yml + skills/ + entities/），注册企业 SubAgent 到 .sofagent/subagents/*.yml。激活后 registry.listAgents() 可发现企业 Agent。',
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
    description: '查询 sofagent daemon 的运行状态（PID/启动时间/心跳/错误）。只读操作，不启动或停止 daemon。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_agents',
    description: '列出已注册的 Agent（内置 + 企业 SubAgent），含 name/type/description/hitl/knowledgeDomain。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_concepts',
    description: '列出 knowledge/concepts/ 下所有 concept（业务概念页）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'hitl_resolve',
    description: 'HITL 异步决议——对挂起等待人工确认的 LOOP checkpoint 提交决策（approve/reject/aborted），触发 LOOP 恢复运行。',
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
    description: '列出所有审计规则清单（只读）——tool 运行时拦截规则 + diff 提交时审计规则。参数 type: tool|diff|all（默认 all）。不暴露规则实现逻辑。',
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
    description: '查询 Agent 身份码（v1.3.1 Ed25519 完整版）——无参数查自己，传 agent_id 查他人。返回委托人/约束版本/责任声明/公钥/签名验证结果（不含私钥）。',
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
    description: 'Onboard Agent L1 调试循环（v1.3.1 交付 8）——传 task 触发 activate→run→judge→fix→re-run 循环（只判 crash/error/超时，不判语义对错）；不传 task 查询最近调试记录（带 agentId 可追溯）。',
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
    description: 'Benchmark 评测（v1.3.1 交付 9）——传 benchmark_id 触发隔离评测（statement/rubric 物理分离 + Test Agent 强制 read-only，评分 0..100 写入 HMAC 链 evaluation-log）；传 query:true 查询评测日志。',
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
    description: '跨设备审计轨迹查询（v1.3.1 交付 7）——按 agent_id 查完整轨迹（合并跨设备审计记录，HMAC 验签 + trust 优先级裁决）；不传 agent_id 列出全部有轨迹的 agent。',
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
    description: '一句话需求自动推导 Agent 配置（角色 + 域规则 + think.md + knowledge 安装）。需求够具体就不追问（如「回答金融合规问题的专家」→直接推导；「有用的助手」→追问）。',
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
    description: '企业专属 eval 套件管理（行业模板加载 + 基线冻结 + 运行评测 + 查询日志）。支持金融/制造/供应链行业模板，首次冻结基线调 freezeBenchmark，运行评测写 evaluation-log（HMAC 链）。',
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
    description: 'FDE 梳理辅助——五要素引导 → workflow.yml 草稿或 ontology 草稿生成。纯规则驱动（LLM 不参与），action=workflow 生成 workflow 草稿，action=ontology 生成 entity/concept/relations 草稿。',
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
    description: '入口路由（v1.3.3）——传入用户请求 task + 已解析的 workflow，返回路由结果：命中 workflow 节点（route=workflow）或走 fallback 直答（route=fallback）。匹配判定记 audit decision（可审计）。⚡/🔄 节点路由进 workflow，👤 节点和不命中走 fallback。',
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
    description: '创建团队（v1.3.3 L2 协作协议）——传入 team.yml 文本，解析校验后写入 data/teams/<team-id>/team.yml。team.yml 含 name/team_id/members[agent_id,role,trust]/shared_state/broadcast_channels。',
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
    description: '意图广播（v1.3.3 L2 协作协议）——Agent 广播「我要做什么」到团队意图总线。匹配的订阅者触发反应。意图类型支持 glob 匹配（intent.create.* / intent.modify.*）。记 audit decision（kind=TEAM）。',
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
    description: 'Refine Agent 质量优化循环（v1.3.3）——复用 loop-agent 引擎（L1/L3/L4/L5），只换 L2 判据（质量规则集）。action=trigger 触发质量循环（针对 Agent 产出做质量优化），action=query 查询结果。Onboard 收敛 PASS 后自动触发。',
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
    name: 'market_publish',
    description: '能力发布（v1.3.4 L3 组织能力市场）——将 Skill/Agent/流程发布到企业能力市场。发布前校验元数据完整性 + SkillScan 安全门（DANGEROUS 拦截）。发布后能力可被其他 Agent 检索发现。全程记审计（kind=MARKET）。',
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
    name: 'market_search',
    description: '能力检索（v1.3.4 L3 组织能力市场）——按标签/关键词/类型检索企业能力市场目录。复用 searchKnowledge 的模糊匹配链路（匹配名称/描述/标签）。无参数列出全部已发布能力。',
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
    name: 'market_invoke',
    description: '能力调用（v1.3.4 L3 组织能力市场）——发现能力 → 挂载调用 → 结果回流。挂载前强制 SkillScan（DANGEROUS 拦截 / SUSPICIOUS 走 HITL 人工确认）。调用全程审计（kind=MARKET，谁调了谁的能力、结果如何）。',
    inputSchema: {
      type: 'object',
      properties: {
        capability_id: { type: 'string', description: '能力 ID（必填——先 market_search 发现）' },
        caller_agent_id: { type: 'string', description: '调用者 agentId（必填）' },
        input: { description: '调用入参（透传给被调能力）' },
      },
      required: ['capability_id', 'caller_agent_id'],
    },
  },
  {
    // v1.3.4 (交付 2)：能力评价
    name: 'market_rate',
    description: '能力评价（v1.3.4 L3 组织能力市场）——调用后累积评分（0.0~1.0），加权排序让高频高价值能力自然上浮。评分公式 = trust(owner) × 平均评分 × log(调用量+1)。防刷：同一评价者对同一能力仅一票（后评覆盖前评）。评价回流同时更新 owner trust 信誉分。',
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
    name: 'market_retire',
    description: '能力退役/恢复（v1.3.4 L3 组织能力市场养护环）——标记能力为退役（不删除，可恢复，保留审计轨迹）。强制 owner 确认（confirmed=true 才执行）。退役触发 owner trust 下调。action=retire 退役 / restore 恢复 / scan 扫描退役候选（低评分/低调用量）。',
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
    name: 'market_harvest_rule',
    description: '评估体系三步（v1.3.4 L3 组织能力市场）——从市场调用日志低分差评 + Refine 循环反复触发 case 提炼质量规则候选（action=harvest），或全跑三步（action=full：提炼→业务方评审→晋升 builtin）。让 Refine 质量规则从生产中长出来。晋升记录 kind=EVOLUTION。',
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
    description: 'MCP 自进化闭环（v1.3.5）——发起 A/B 对比实验：current vs candidate 两版 Agent 定义在 golden-set 上并行评测，返回双方分数（exact/semantic/rule 三维 + overall）、胜出方、分差、连续胜出次数与晋升建议。结果持久化到 data/ab-test/latest.json。实验通过后调 promote_ab（需人工确认）完成晋升。',
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
    description: 'MCP 自进化闭环（v1.3.5）——晋升 candidate 为 current（覆写 Agent 定义文件）。🔴 破坏性操作强制人审：human_confirmed ≠ true 时挂起不执行，只返回决策依据（最近实验数据 + 晋升建议）；human_confirmed=true 才执行晋升并写 decision-log 审计留痕（kind=EVOLUTION）。',
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
    description: 'MCP 运维闭环（v1.3.5）——列出审计快照时间线（SHA + 时间 + 文件数，最新在前）。只读查询，无副作用。恢复到指定快照用 snapshot_restore（需人工确认）。',
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
    description: 'MCP 运维闭环（v1.3.5）——恢复工作区到指定审计快照。🔴 破坏性操作强制人审：human_confirmed ≠ true 时挂起不执行，只返回目标快照时间线上下文；human_confirmed=true 才执行恢复并写 decision-log 审计留痕（kind=CONFIG_CHANGE）。恢复后建议跑 build + test 验证。',
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
];
