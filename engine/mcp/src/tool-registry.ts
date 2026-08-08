// ============================================================
// tool-registry.ts · MCP tools/list schema definitions
// v1.2.9: 从 mcp-server.ts 提取
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
 * 完整工具清单——27 个 tool（不含 4 个 resource shortcut）
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
];
