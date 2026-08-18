// ============================================================
// fde/compose-interview.ts · FDE 梳理辅助交互式五要素引导（v1.3.7 交付 7右半）
// ============================================================
//
// CLI 逐节点收集五要素（输入/输出/负责人/耗时/最卡的地方），
// 必填校验 + 三问判定自动打标签 + 依赖引导 → workflow.yml 草稿。
//
// 纯规则驱动（LLM 不参与生成）。
// ============================================================
/** 五要素 */
export interface FiveElements {
  /** 输入 */
  input: string;
  /** 输出 */
  output: string;
  /** 负责人/角色 */
  owner: string;
  /** 耗时（分钟/小时/天） */
  duration: string;
  /** 最卡的地方（痛点） */
  bottleneck: string;
}

/** 三问判定结果 */
export type AutomationTag = 'auto' | 'enhance' | 'manual';

/** 三问判定输入 */
export interface ThreeQuestions {
  /** Q1：输入能自动取？ */
  inputAutomatable: boolean;
  /** Q2：规则能写清？ */
  rulesCodifiable: boolean;
  /** Q3：输出能自动推？ */
  outputPredictable: boolean;
}

/** 单节点梳理结果 */
export interface NodeInterview {
  /** 节点 ID */
  nodeId: string;
  /** 节点描述 */
  description: string;
  /** 五要素 */
  elements: FiveElements;
  /** 三问判定 */
  questions: ThreeQuestions;
  /** 自动化标签（🔄/⚡/👤） */
  tag: AutomationTag;
  /** 依赖的节点 ID 列表 */
  dependsOn: string[];
  /** 量化四字段（GUIDE §4.3） */
  metrics?: {
    currentCost: string;
    aiCost: string;
    annualSaving: string;
    paybackPeriod: string;
  };
}

/** 一次完整的 FDE 梳理会话 */
export interface ComposeSession {
  /** 企业 ID */
  enterpriseId: string;
  /** 工作流名称 */
  workflowName: string;
  /** 工作流描述 */
  workflowDescription: string;
  /** 节点列表 */
  nodes: NodeInterview[];
  /** ontology 草稿（交付 10 第二段推导） */
  ontologyDraft?: OntologyDraftResult;
}

/** Ontology 草稿推导结果（交付 10） */
export interface OntologyDraftResult {
  /** 实体列表 */
  entities: string[];
  /** 概念列表 */
  concepts: string[];
  /** 关系列表 */
  relations: Array<{
    from: string;
    type: string;
    to: string;
  }>;
  /** 是否需要全量本体（第 0 步按需判断） */
  needsFullOntology: boolean;
}

/**
 * 三问判定 → 自动化标签。
 *
 * 三问全 yes → 🔄 auto（自动执行）
 * 两问 yes → ⚡ enhance（强化岗位）
 * 一问或零 yes → 👤 manual（暂不动）
 *
 * @param questions 三问结果
 * @returns AutomationTag
 */
export function classifyAutomation(questions: ThreeQuestions): AutomationTag {
  const yesCount = [
    questions.inputAutomatable,
    questions.rulesCodifiable,
    questions.outputPredictable,
  ].filter(Boolean).length;

  if (yesCount >= 3) return 'auto';
  if (yesCount >= 2) return 'enhance';
  return 'manual';
}

/**
 * 校验五要素完整性。
 * 缺「最卡的地方」不允许跳过（必填）。
 *
 * @param elements 五要素
 * @returns 缺失字段列表（空 = 校验通过）
 */
export function validateFiveElements(elements: Partial<FiveElements>): string[] {
  const missing: string[] = [];
  if (!elements.input || elements.input.trim().length === 0) missing.push('输入');
  if (!elements.output || elements.output.trim().length === 0) missing.push('输出');
  if (!elements.owner || elements.owner.trim().length === 0) missing.push('负责人');
  if (!elements.duration || elements.duration.trim().length === 0) missing.push('耗时');
  if (!elements.bottleneck || elements.bottleneck.trim().length === 0) missing.push('最卡的地方');
  return missing;
}

/**
 * 从五要素 + 三问推导 Ontology 草稿（交付 10）。
 *
 * 推导路径（复用 GUIDE 本体推导路径）：
 *   五要素 → entity（实体）→ concept（概念）→ relations（关系）→ ontology 草稿
 *
 * 规则驱动 + 人工确认——LLM 只辅助建议不自动生成。
 *
 * @param session 梳理会话
 * @returns OntologyDraftResult
 */
export function deriveOntologyDraft(session: ComposeSession): OntologyDraftResult {
  const entities: Set<string> = new Set();
  const concepts: Set<string> = new Set();
  const relations: Array<{ from: string; type: string; to: string }> = [];

  for (const node of session.nodes) {
    // 从五要素的输入/输出提取实体（名词性短语）
    const inputEntities = extractNounPhrases(node.elements.input);
    const outputEntities = extractNounPhrases(node.elements.output);
    inputEntities.forEach((e) => entities.add(e));
    outputEntities.forEach((e) => entities.add(e));

    // 从「最卡的地方」提取概念（校验/预警/排程等）
    const bottleneckConcepts = extractConcepts(node.elements.bottleneck);
    bottleneckConcepts.forEach((c) => concepts.add(c));

    // 依赖关系 → relations
    for (const dep of node.dependsOn) {
      relations.push({ from: dep, type: 'produces', to: node.nodeId });
    }

    // 输入→输出关系
    for (const inp of inputEntities) {
      for (const outp of outputEntities) {
        relations.push({ from: inp, type: 'transforms_to', to: outp });
      }
    }
  }

  // 第 0 步：按需判断（多数中小企业不必建全量本体）
  const needsFullOntology = entities.size > 10 || session.nodes.length > 5;

  return {
    entities: Array.from(entities),
    concepts: Array.from(concepts),
    relations,
    needsFullOntology,
  };
}

/** 从文本中提取名词性短语（简化——按空格/标点分词取实体候选） */
function extractNounPhrases(text: string): string[] {
  // 简化版：按中文标点/空格分词，取 2-6 字的片段作为实体候选
  const phrases = text
    .split(/[，,。.、；;：:（）()\s]+/)
    .filter((p) => p.length >= 2 && p.length <= 10)
    .map((p) => p.trim());
  // 去常见停用词
  const stopWords = ['这个', '那个', '一个', '一些', '可以', '需要', '进行'];
  return phrases.filter((p) => !stopWords.includes(p));
}

/** 从「最卡的地方」提取概念（动作性短语） */
function extractConcepts(text: string): string[] {
  const conceptKeywords = ['校验', '预警', '排程', '审批', '确认', '核对', '比对', '检查', '计算', '统计'];
  const found: string[] = [];
  for (const kw of conceptKeywords) {
    if (text.includes(kw)) found.push(kw);
  }
  return found;
}
