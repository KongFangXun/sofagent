// ============================================================
// onboard/agent-creator.ts · agent-creation 需求推导（v1.3.2 交付 5）
// ============================================================
//
// 一句话需求 → 自动推导 Role + 域规则 → 写 think.md → 装 knowledge。
// 借鉴 PenguinHarness agent-creation 方法论，sofagent 术语映射。
//
// 推导逻辑是规则驱动的 NLP（不是 LLM）：
//   解析一句话需求 → 提取领域关键词（金融/制造/供应链/客服等）
//   + 动作动词（回答/转换/处理/分析等）→ 映射到 Role 模板 + 域规则。
//
// 需求太泛（缺领域边界 / 动作不明确）→ 追问（不推导）。
//
// 关键原则（dev-prompt 验收标准）：
//   - 需求够具体就不追问
//   - 不持久化 provider/model_id 到 Agent State（只写 thinking_level）
//   - think.md 自动生成 + knowledge 按需安装（只装匹配的）
// ============================================================

/** 需求推导结果 */
export interface AgentCreationResult {
  /** 推导成功还是需要追问 */
  status: 'derived' | 'needs_clarification';
  /** 追问问题（status=needs_clarification 时有值） */
  clarifyingQuestions?: string[];
  /** 推导出的 Agent 配置（status=derived 时有值） */
  config?: DerivedAgentConfig;
}

/** 推导出的 Agent 配置 */
export interface DerivedAgentConfig {
  /** Agent 名称（从需求推导） */
  name: string;
  /** 角色描述 */
  role: string;
  /** 领域 */
  domain: string;
  /** 动作类型 */
  action: string;
  /** 输入类型 */
  inputType?: string;
  /** 输出类型 */
  outputType?: string;
  /** 引用规则（该做什么） */
  inclusionRules: string[];
  /** 拒绝规则（不该做什么） */
  exclusionRules: string[];
  /** 生成的 think.md 内容 */
  thinkMd: string;
  /** 匹配的 knowledge 条目（按需安装） */
  matchedKnowledge: string[];
  /** thinking_level（唯一持久化的运行时参数） */
  thinkingLevel: string;
}

/** 领域关键词映射表 */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  finance: ['金融', '财务', '合规', '审计', '银', '证券', '保险', '税', '账', '发票', '票据', 'finance', 'financial', 'compliance', 'banking', 'audit', 'invoice'],
  manufacturing: ['制造', '生产', '产线', '工序', '车间', '工单', 'manufacturing', 'production', 'factory'],
  supplychain: ['供应链', '物流', '仓储', '采购', '库存', '配送', 'supply', 'chain', 'logistics', 'warehouse'],
  customerservice: ['客服', '售后', '退换', '投诉', '咨询', 'customer', 'service', 'support'],
  hr: ['人事', '招聘', '薪酬', '绩效', '考勤', 'hr', 'human resource'],
  legal: ['法务', '合同', '法律', '合规审查', 'legal', 'contract'],
  healthcare: ['医疗', '健康', '病历', '诊断', 'healthcare', 'medical'],
  retail: ['零售', '电商', '商品', '订单', 'retail', 'ecommerce'],
  education: ['教育', '培训', '课程', '学习', 'education', 'training'],
};

/** 动作动词映射表 */
const ACTION_KEYWORDS: Record<string, string[]> = {
  answer: ['回答', '解答', '咨询', '解释', 'answer', 'explain', 'respond'],
  transform: ['转换', '转成', '提取', '解析', '识别', 'transform', 'convert', 'extract', 'parse', 'ocr'],
  analyze: ['分析', '评估', '诊断', '检测', '监控', 'analyze', 'evaluate', 'diagnose', 'monitor'],
  process: ['处理', '执行', '完成', 'process', 'execute', 'handle'],
  generate: ['生成', '创建', '撰写', '编写', 'generate', 'create', 'write', 'draft'],
  review: ['审查', '审核', '检查', '校验', 'review', 'audit', 'check', 'verify'],
  classify: ['分类', '归类', '标签', 'classify', 'categorize', 'tag'],
  summarize: ['总结', '摘要', '概括', 'summarize', 'abstract'],
};

/** 泛化词（缺领域边界时触发追问） */
const VAGUE_WORDS = ['有用的', '帮忙', '助手', '东西', '事情', '什么', 'useful', 'help', 'assistant', 'something'];

/** 泛化动作词（动作不明确时触发追问） */
const VAGUE_ACTIONS = ['处理', '搞定', '搞', '弄', '做', 'handle', 'deal', 'do', 'fix'];

/**
 * 从一句话需求推导 Agent 配置。
 *
 * 规则驱动 NLP：
 *   1. 提取领域关键词 → domain
 *   2. 提取动作动词 → action
 *   3. 提取输入/输出类型
 *   4. 领域边界明确 + 动作明确 → 推导（不追问）
 *   5. 需求太泛 → 追问
 *
 * @param requirement 一句话需求（如「回答金融合规问题的专家」）
 * @returns AgentCreationResult
 */
export function deriveAgentFromRequirement(requirement: string): AgentCreationResult {
  const text = requirement.trim().toLowerCase();

  if (text.length === 0) {
    return {
      status: 'needs_clarification',
      clarifyingQuestions: ['需求为空，请描述你需要什么类型的 AI 节点。'],
    };
  }

  // 1. 检测泛化词（缺领域边界）
  const hasVagueWord = VAGUE_WORDS.some((w) => text.includes(w.toLowerCase()));
  if (hasVagueWord && !hasDomainKeyword(text)) {
    return {
      status: 'needs_clarification',
      clarifyingQuestions: [
        '你的需求太泛——请明确这个 AI 节点要处理什么领域的问题（如金融/制造/客服/供应链等）。',
        '请描述具体的输入和期望输出（如「输入是 PDF 发票，输出是结构化数据」）。',
      ],
    };
  }

  // 2. 提取领域
  const domain = detectDomain(text);
  if (!domain) {
    return {
      status: 'needs_clarification',
      clarifyingQuestions: [
        '无法从需求中识别明确的业务领域。请补充这个节点服务于哪个业务场景。',
      ],
    };
  }

  // 3. 检测泛化动作（「处理」太泛——是创建/修改/查询/退款？）
  // 只有泛化动作词、没有具体动作动词 → 追问
  const hasSpecificAction = detectSpecificAction(text);
  const hasVagueActionWord = VAGUE_ACTIONS.some((w) => text.includes(w.toLowerCase()));

  if (!hasSpecificAction && hasVagueActionWord) {
    // 需求只含泛化动作词（如「处理」「搞定」），无具体动作 → 追问
    return {
      status: 'needs_clarification',
      clarifyingQuestions: [
        `「${extractVagueAction(text)}」太泛——请明确具体动作：是创建/修改/查询/分析/转换/审查？`,
        '请描述输入数据类型和期望的输出结果。',
      ],
    };
  }

  if (!hasSpecificAction) {
    return {
      status: 'needs_clarification',
      clarifyingQuestions: [
        '无法从需求中识别明确的动作。请描述这个节点具体做什么（如回答问题/转换数据/分析报告等）。',
      ],
    };
  }

  const action = hasSpecificAction;

  // 4. 提取输入/输出类型
  const inputType = detectInputType(text);
  const outputType = detectOutputType(text);

  // 5. 推导 Agent 配置
  const config = buildAgentConfig(requirement, domain, action, inputType, outputType);
  return { status: 'derived', config };
}

/** 检测领域 */
function detectDomain(text: string): string | null {
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      return domain;
    }
  }
  return null;
}

/** 检测动作 */
function detectAction(text: string): string | null {
  for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      return action;
    }
  }
  return null;
}

/**
 * 检测具体动作（排除泛化动作词）。
 * 只匹配明确的动作动词（answer/transform/analyze/review/generate/classify/summarize），
 * 不匹配泛化的 process（「处理」太泛，需要追问）。
 */
function detectSpecificAction(text: string): string | null {
  for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
    // process 动作需要额外检查——只有伴随明确上下文（如「处理订单」中的订单是 domain）
    // 且无其他更具体的动作时，才视为具体动作。但「帮我处理订单」中「处理」是唯一动作 → 不算具体。
    if (action === 'process') {
      // process 类型只在有其他更具体的上下文信号时才算
      // 如「处理退货流程」中「退货」是 customerservice domain + 「流程」有上下文
      // 但「帮我处理订单」中只有泛化处理 → 不匹配
      continue;
    }
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      return action;
    }
  }
  // process 类型：只在文本中有明确的「执行/完成」语义且非泛化时匹配
  // 如「执行工单处理」中的「执行」是具体的
  if (ACTION_KEYWORDS.process.some((kw) => text.includes(kw.toLowerCase()))) {
    // 检查是否伴随更具体的上下文词
    const hasExecutionContext = ['执行', '完成', '自动', 'execute', 'automate'].some((w) => text.includes(w));
    if (hasExecutionContext) {
      return 'process';
    }
  }
  return null;
}

/** 检测输入类型 */
function detectInputType(text: string): string | undefined {
  if (text.includes('pdf')) return 'PDF';
  if (text.includes('excel') || text.includes('表格') || text.includes('xlsx')) return 'Excel/表格';
  if (text.includes('图片') || text.includes('image') || text.includes('截图')) return '图片';
  if (text.includes('文本') || text.includes('text') || text.includes('文档')) return '文本/文档';
  if (text.includes('问题') || text.includes('question')) return '问题/咨询';
  if (text.includes('数据') || text.includes('data')) return '数据';
  return undefined;
}

/** 检测输出类型 */
function detectOutputType(text: string): string | undefined {
  if (text.includes('结构化') || text.includes('structured') || text.includes('json')) return '结构化数据';
  if (text.includes('报告') || text.includes('report')) return '报告';
  if (text.includes('答案') || text.includes('answer') || text.includes('回答')) return '答案/回复';
  if (text.includes('分类') || text.includes('标签') || text.includes('classify')) return '分类/标签';
  return undefined;
}

/** 提取泛化动作词（追问文案用） */
function extractVagueAction(text: string): string {
  for (const w of VAGUE_ACTIONS) {
    if (text.includes(w.toLowerCase())) return w;
  }
  return '处理';
}

/** 是否有领域关键词 */
function hasDomainKeyword(text: string): boolean {
  return detectDomain(text) !== null;
}

/** 构建推导出的 Agent 配置 */
function buildAgentConfig(
  requirement: string,
  domain: string,
  action: string,
  inputType?: string,
  outputType?: string,
): DerivedAgentConfig {
  const domainLabel = getDomainLabel(domain);
  const actionLabel = getActionLabel(action);
  const name = `${domain}-${action}-agent`;

  const inclusionRules = buildInclusionRules(domain, action, inputType, outputType);
  const exclusionRules = buildExclusionRules(domain, action);
  const matchedKnowledge = matchKnowledge(domain, action);

  const thinkMd = buildThinkMd(name, domainLabel, actionLabel, requirement, inputType, outputType, inclusionRules, exclusionRules);

  return {
    name,
    role: `${domainLabel}${actionLabel}专家`,
    domain,
    action,
    inputType,
    outputType,
    inclusionRules,
    exclusionRules,
    thinkMd,
    matchedKnowledge,
    thinkingLevel: determineThinkingLevel(action),
  };
}

/** 构建引用规则（该做什么） */
function buildInclusionRules(domain: string, action: string, inputType?: string, outputType?: string): string[] {
  const rules: string[] = [];
  const domainLabel = getDomainLabel(domain);
  rules.push(`只处理${domainLabel}领域的问题`);

  if (inputType) {
    rules.push(`接受${inputType}格式输入`);
  }
  if (outputType) {
    rules.push(`输出${outputType}`);
  }

  switch (action) {
    case 'answer':
      rules.push(`基于${domainLabel}知识库和规则回答问题`);
      rules.push('引用来源时标注依据');
      break;
    case 'transform':
      rules.push('保持数据完整性，不丢失关键信息');
      rules.push('转换结果可逆验证');
      break;
    case 'analyze':
      rules.push('分析结论需有数据支撑');
      rules.push('标注置信度和不确定性');
      break;
    case 'review':
      rules.push('按既定标准逐项检查');
      rules.push('违规项给出具体位置和修复建议');
      break;
    default:
      rules.push('按领域规范完成任务');
  }

  return rules;
}

/** 构建拒绝规则（不该做什么） */
function buildExclusionRules(domain: string, action: string): string[] {
  const rules: string[] = [];
  const domainLabel = getDomainLabel(domain);

  // 通用拒绝规则
  rules.push(`不回答${domainLabel}领域以外的问题`);
  rules.push('不编造无法验证的信息');

  switch (action) {
    case 'answer':
      rules.push('不越权做决策（只提供建议，不代替人决策）');
      break;
    case 'transform':
      rules.push('不篡改数据语义（只做格式转换，不改内容含义）');
      break;
    case 'analyze':
      rules.push('不做超出数据的推断');
      break;
    default:
      // 通用
  }

  return rules;
}

/** 匹配 knowledge 条目（按需安装——只装匹配的） */
function matchKnowledge(domain: string, action: string): string[] {
  const knowledge: string[] = [];
  const domainKnowledgeMap: Record<string, string[]> = {
    finance: ['finance-compliance-rules', 'finance-regulations'],
    manufacturing: ['manufacturing-process-standards', 'quality-control-guides'],
    supplychain: ['supplychain-ops-guides', 'inventory-rules'],
    customerservice: ['customer-service-scripts', 'return-refund-policies'],
    hr: ['hr-policies', 'labor-law-reference'],
    legal: ['legal-contract-templates', 'compliance-checklists'],
    healthcare: ['medical-guidelines', 'patient-privacy-rules'],
    retail: ['retail-product-catalog', 'order-management-rules'],
    education: ['education-curriculum-guides', 'learning-assessment-rubrics'],
  };

  const domainKnowledge = domainKnowledgeMap[domain] ?? [];
  knowledge.push(...domainKnowledge);

  // 按动作追加匹配的通用 knowledge
  if (action === 'transform' || action === 'extract') {
    knowledge.push('data-format-specs');
  }
  if (action === 'analyze') {
    knowledge.push('analysis-methodology');
  }

  return knowledge;
}

/** 确定思考等级（唯一持久化的运行时参数） */
function determineThinkingLevel(action: string): string {
  // 复杂推理动作 → high；简单转换 → low；默认 medium
  if (action === 'analyze' || action === 'review') return 'high';
  if (action === 'transform' || action === 'classify' || action === 'summarize') return 'low';
  return 'medium';
}

/** 构建 think.md 内容 */
function buildThinkMd(
  name: string,
  domainLabel: string,
  actionLabel: string,
  requirement: string,
  inputType?: string,
  outputType?: string,
  inclusionRules?: string[],
  exclusionRules?: string[],
): string {
  const lines: string[] = [
    `# ${name}`,
    '',
    `## 角色`,
    `你是${domainLabel}${actionLabel}专家。`,
    `（需求来源：${requirement}）`,
    '',
  ];

  if (inputType || outputType) {
    lines.push('## 输入输出');
    if (inputType) lines.push(`- 输入：${inputType}`);
    if (outputType) lines.push(`- 输出：${outputType}`);
    lines.push('');
  }

  if (inclusionRules && inclusionRules.length > 0) {
    lines.push('## 应做');
    for (const rule of inclusionRules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (exclusionRules && exclusionRules.length > 0) {
    lines.push('## 禁止');
    for (const rule of exclusionRules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  lines.push('## 验证');
  lines.push('- 完成后自检：输出是否符合上述应做规则、是否违反禁止规则');
  lines.push('- 无法确定时：明确标注不确定性，不编造');

  return lines.join('\n');
}

/** 领域中文标签 */
function getDomainLabel(domain: string): string {
  const labels: Record<string, string> = {
    finance: '金融合规',
    manufacturing: '制造生产',
    supplychain: '供应链物流',
    customerservice: '客服售后',
    hr: '人事',
    legal: '法务合规',
    healthcare: '医疗健康',
    retail: '零售电商',
    education: '教育培训',
  };
  return labels[domain] ?? domain;
}

/** 动作中文标签 */
function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    answer: '问答',
    transform: '转换',
    analyze: '分析',
    process: '处理',
    generate: '生成',
    review: '审查',
    classify: '分类',
    summarize: '摘要',
  };
  return labels[action] ?? action;
}
