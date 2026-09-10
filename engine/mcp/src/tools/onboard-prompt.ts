// ============================================================
// onboard-prompt.ts · MCP tool：onboard_prompt（上岗 prompt 生成器）
// ============================================================
//
// 岗位描述 → 上岗 prompt 三段（职责/边界/工具面）——新 Agent 进
// workflow 的标准化上岗材料。产物可经 workflow_node_add 落进节点
// 配置（task 字段），与 G14 闭环。
//
// 三段结构：
//   职责——岗位要交付什么（从岗位描述提取）
//   边界——什么必须做/什么禁止做（约束层纪律对齐）
//   工具面——可用的 MCP tools（按角色面生成）
// ============================================================

export interface OnboardPromptArgs {
  /** 岗位描述（必填——自由文本，如「负责每日数据报表生成与异常告警」） */
  role_description: string;
  /** Agent 名（可选——缺省从岗位描述推导） */
  agent_name?: string;
  /** 工具角色面（可选——缺省 ops；生成工具面清单的口径） */
  role?: string;
}

export interface OnboardPromptResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    /** 生成的上岗 prompt（三段结构——可直接进 workflow_node_add 的 task 字段） */
    prompt: string;
    /** 推导的 agent 名 */
    agentName: string;
    /** 三段结构标记（消费端校验用） */
    sections: string[];
    /** 使用提示（workflow_node_add 落点） */
    nextStep: string;
  };
}

/** 从岗位描述推导 agent 名（取关键词 slug 化——中英混合取 ASCII 词，纯中文取前 8 字符拼音位不可靠，直接用原文） */
function deriveAgentName(roleDescription: string): string {
  const trimmed = roleDescription.trim();
  // 英文词优先（data-report → data-report）
  const asciiWords = trimmed.match(/[A-Za-z][A-Za-z0-9_-]{1,31}/g);
  if (asciiWords && asciiWords.length > 0) {
    return asciiWords.slice(0, 3).join('-').toLowerCase();
  }
  // 纯中文——取前 12 字符（名称位允许中文）
  return trimmed.slice(0, 12);
}

/** 各角色面的代表工具清单（描述生成用——非权限面，实际暴露走 SOFAGENT_MCP_ROLES） */
const ROLE_TOOL_HINTS: Record<string, string[]> = {
  ops: ['worklog_query（工作明细查询）', 'cost_query（成本查询）', 'workflow_gaps（能力缺口分析）', 'health_check（健康检查）'],
  agent: ['workflow_create / workflow_update（workflow 对象化读写）', 'workflow_node_add（节点追加）', 'workflow_diff_preview（变更预览）'],
  fde: ['fde_interview（访谈结构化）', 'fde_classify（节点分类）', 'fde_derive（工作流推导）'],
  audit: ['run_audit（代码审计）', 'audit_trail（审计链查询）', 'list_rules（规则清单）'],
  eval: ['define_acceptance（验收条件登记）', 'check_acceptance（验收执行）', 'evaluate（基准评测）'],
};

/**
 * onboard_prompt——岗位描述 → 上岗 prompt（职责/边界/工具面三段）。
 */
export async function onboardPrompt(args: OnboardPromptArgs): Promise<OnboardPromptResult> {
  const desc = args.role_description?.trim() ?? '';

  if (desc === '') {
    return {
      text: '[sofagent] onboard_prompt 失败：缺少必填参数 role_description（岗位描述）',
      data: {
        isError: true,
        prompt: '',
        agentName: '',
        sections: [],
        nextStep: '补 role_description 后重试',
      },
    };
  }

  const agentName = args.agent_name?.trim() || deriveAgentName(desc);
  const role = args.role ?? 'ops';
  const toolHints = ROLE_TOOL_HINTS[role] ?? ROLE_TOOL_HINTS['ops']!;

  const prompt = [
    `你是 ${agentName}。${desc}`,
    '',
    '## 职责',
    `- 核心交付：${desc}`,
    '- 按节点任务描述执行；产出物过审计（每次落库动作可溯源）',
    '- 遇到不确定：结构化上报（说明卡点 + 选项），不臆造',
    '',
    '## 边界',
    '- 必须做：任务闭环（完成或明确上报阻塞）；变更走 trunk/branch 协议（非 owner 开 branch）',
    '- 禁止做：越权改他人 workflow（trunk）；绕过审计直接落库；对 private/result-only 节点越级访问',
    '',
    '## 工具面',
    ...toolHints.map((t) => `- ${t}`),
    `- 完整工具面以 SOFAGENT_MCP_ROLES=${role} 配置为准（本段为代表性清单）`,
  ].join('\n');

  return {
    text: [
      `[sofagent] ✅ 上岗 prompt 已生成（agent=${agentName}，角色面=${role}）:`,
      '',
      prompt,
      '',
      `落点提示：经 workflow_node_add 传入 node.task 即可落进节点配置（与 G14 闭环）。`,
    ].join('\n'),
    data: {
      isError: false,
      prompt,
      agentName,
      sections: ['职责', '边界', '工具面'],
      nextStep: 'workflow_node_add → node.task = 本 prompt',
    },
  };
}
