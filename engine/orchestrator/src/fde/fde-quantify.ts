// ============================================================
// fde/fde-quantify.ts · v1.4.4 章八 · 引擎三量化 + 引擎四本体 + 引擎五沉淀 + 引擎六部署
// ============================================================
//
// 与 fde-workbench.ts（数据层 + 引擎一二）合成六引擎闭环：
//   引擎三 fde_quantify：量化四字段计算器 + ROI 排序（GUIDE §4.3
//     年节省 = 岗位年薪 × AI 接管工时占比——复用 train-report 的
//     computeQuantification 保持同公式同源）
//   引擎四 fde_derive：本体推导（复用 compose-interview 的
//     deriveOntologyDraft 完整链路——产出 YAML 草稿可导入 ontology_import）
//   引擎五 fde_distill：三层交付物生成（文档层/Skill 层/运行层——
//     GUIDE 第五章模板自动生成）
//   引擎六 fde_deploy：workflow.yml 组装（复用 workflow-draft 生成器
//     ——产物可 submit + activate，复用现有链路）
// ============================================================

import { mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import {
  fdeWorkbenchPaths,
  emitFdeAudit,
  type NodePlan,
  type NodesPlanFile,
  type InterviewRecord,
} from './fde-workbench';
import { deriveOntologyDraft, type ComposeSession, type NodeInterview } from './compose-interview';
import { generateWorkflowDraft } from './workflow-draft';
import { computeQuantification, type QuantificationMetrics, type QuantifyInput } from '../train/train-report';

// ══════════════════════════════════════
// 引擎三：fde_quantify 量化 + ROI 排序
// ══════════════════════════════════════

/** 单节点量化入参（岗位口径——GUIDE §4.3） */
export interface NodeQuantifyInput {
  nodeId: string;
  annualSalary: number;
  takeoverRatio: number;
  aiAnnualCost: number;
  oneTimeInvestment?: number;
}

/** 节点量化结果（ROI 排序元素） */
export interface NodeQuantification {
  nodeId: string;
  tag: NodePlan['tag'] | 'unknown';
  metrics: QuantificationMetrics;
  /**
   * ROI 排序键 = 年节省 ÷（一次性投入 + 1000）——分母常数 1000 元是
   * 「小额投资防除零」的量化地板（非 +1：+1 的量纲是元，invest=0 与
   * invest=1 元会差一倍，小额排序严重失真；1000 元地板下万元级投入
   * 排序近乎纯比值，千元级以下按地板平滑）。零投入节点 roiScore =
   * annualSaving / 1000，仍是「省得多排前」的正确序。
   */
  roiScore: number;
}

/** 量化文件（quantification.json——喂训练报告与 dashboard） */
export interface QuantificationFile {
  schemaVersion: 'v1';
  enterpriseId: string;
  quantifiedAt: string;
  /** ROI 降序（年节省高/投入低优先——决策面从上往下投） */
  ranked: NodeQuantification[];
  /** 汇总（全景——总年节省是客户最关心的一个数） */
  totals: {
    totalAnnualSaving: number;
    totalOneTimeInvestment: number;
    nodeCount: number;
  };
}

/**
 * 节点 ID 清洗（Skill frontmatter name / 文件名安全——中文等非 ASCII
 * 转 ASCII 安全形态；空/全非法字符回退 'node'）。
 *
 * 保留可读性策略：ASCII 字母数字与 -_. 保留，其余（含中文）转 -，
 * 连续 - 压缩、首尾 - 去除——「电池质检-报告」→「-」这类全清洗结果
 * 回退 'node'（不产生空标识）。产物文件名同用（`${nodeId}-manual.md`）。
 */
function sanitizeNodeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9-_.]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'node';
}

/** YAML 标量安全包裹（含冒号+空格/#/首尾特殊字符时加双引号——ontology_import 机器消费可靠性） */
function yamlScalar(value: string): string {
  if (/[:#]/.test(value) || /^[-?[\]{}&*!|>'"%`]|^\s|\s$/.test(value) || value === '') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * 引擎三：量化计算 + ROI 排序落盘。
 *
 * 公式复用 train-report.computeQuantification（同公式同源——训练报告
 * 与 FDE 量化两个消费方看到一致的数）。manual 节点不参与（👤 暂不动
 * ——量化给 🔄/⚡）。
 */
export function quantifyNodes(
  dataDir: string,
  enterpriseId: string,
  inputs: readonly NodeQuantifyInput[],
  plans: readonly NodePlan[] | null,
  options: { now?: () => number } = {},
): QuantificationFile {
  const now = options.now ?? Date.now;
  const paths = fdeWorkbenchPaths(dataDir, enterpriseId);

  const tagOf = (nodeId: string): NodePlan['tag'] | 'unknown' =>
    plans?.find((p) => p.nodeId === nodeId)?.tag ?? 'unknown';

  const ranked: NodeQuantification[] = inputs.map((inp) => {
    const metrics = computeQuantification({
      annualSalary: inp.annualSalary,
      takeoverRatio: inp.takeoverRatio,
      aiAnnualCost: inp.aiAnnualCost,
      ...(inp.oneTimeInvestment !== undefined ? { oneTimeInvestment: inp.oneTimeInvestment } : {}),
    });
    const invest = inp.oneTimeInvestment ?? 0;
    return {
      nodeId: inp.nodeId,
      tag: tagOf(inp.nodeId),
      metrics,
      roiScore: metrics.annualSaving.value / (invest + 1000),
    };
  });
  ranked.sort((a, b) => b.roiScore - a.roiScore);

  const file: QuantificationFile = {
    schemaVersion: 'v1',
    enterpriseId,
    quantifiedAt: new Date(now()).toISOString(),
    ranked,
    totals: {
      totalAnnualSaving: ranked.reduce((s, r) => s + r.metrics.annualSaving.value, 0),
      totalOneTimeInvestment: inputs.reduce((s, i) => s + (i.oneTimeInvestment ?? 0), 0),
      nodeCount: ranked.length,
    },
  };
  mkdirSync(paths.dir, { recursive: true });
  atomicWriteSync(paths.quantification, JSON.stringify(file, null, 2));
  emitFdeAudit(
    {
      type: 'fde_quantify',
      enterpriseId,
      artifact: paths.quantification,
      reason: `量化 ${ranked.length} 节点，总年节省 ${file.totals.totalAnnualSaving.toFixed(0)} 元（ROI 首位：${ranked[0]?.nodeId ?? '—'}）`,
    },
    dataDir,
  );
  return file;
}

// ══════════════════════════════════════
// 引擎四：fde_derive 本体推导（YAML 草稿）
// ══════════════════════════════════════

/** 本体推导结果（引擎四产物） */
export interface DeriveResult {
  /** ontology-draft.yaml 落盘路径（可导入 ontology_import） */
  draftPath: string;
  /** 实体/概念/关系计数（决策面快览） */
  counts: { entities: number; concepts: number; relations: number };
  needsFullOntology: boolean;
}

/**
 * 引擎四：五要素 + 访谈 → ontology YAML 草稿。
 *
 * 复用 compose-interview.deriveOntologyDraft 完整推导链路（名词短语
 * 提取 → 概念识别 → 关系推导）；YAML 形态对齐 ontology_import 入参。
 */
export function deriveOntology(
  dataDir: string,
  enterpriseId: string,
  session: ComposeSession,
): DeriveResult {
  const paths = fdeWorkbenchPaths(dataDir, enterpriseId);
  const draft = deriveOntologyDraft(session);

  const yamlLines: string[] = [
    '# FDE 本体推导草稿（机器初稿——人工确认后经 ontology_import 导入）',
    `# 企业：${enterpriseId}`,
    'entities:',
    ...draft.entities.map((e) => `  - ${yamlScalar(e)}`),
    'concepts:',
    ...draft.concepts.map((c) => `  - ${yamlScalar(c)}`),
    'relations:',
    ...draft.relations.map((r) => `  - from: ${yamlScalar(r.from)}\n    type: ${yamlScalar(r.type)}\n    to: ${yamlScalar(r.to)}`),
  ];
  mkdirSync(paths.dir, { recursive: true });
  atomicWriteSync(paths.ontologyDraft, yamlLines.join('\n'));
  emitFdeAudit(
    {
      type: 'fde_derive',
      enterpriseId,
      artifact: paths.ontologyDraft,
      reason: `本体草稿：${draft.entities.length} 实体 / ${draft.concepts.length} 概念 / ${draft.relations.length} 关系（needsFullOntology=${draft.needsFullOntology}）`,
    },
    dataDir,
  );
  return {
    draftPath: paths.ontologyDraft,
    counts: { entities: draft.entities.length, concepts: draft.concepts.length, relations: draft.relations.length },
    needsFullOntology: draft.needsFullOntology,
  };
}

// ══════════════════════════════════════
// 引擎五：fde_distill 三层交付物生成
// ══════════════════════════════════════

/**
 * 三层交付模板外置（模板骨架可定制——改模板不改代码）。
 *
 * 查找链（三级，对齐 builtin-agents 的 SKILL/agents 定位先例）：
 *   ① SOFAGENT_REPO_ROOT/FDE/templates/deliverables/
 *   ② cwd/FDE/templates/deliverables/
 *   ③ 包相对路径上溯四级到仓库根（monorepo 开发态，见下方 join 实现）
 * 三级全 miss → 回退内置默认骨架（fail-closed：模板缺失不阻断交付）。
 */
export const DELIVERABLES_TEMPLATE_DIR_SEGMENTS = ['FDE', 'templates', 'deliverables'];

/** 模板文件名 → 渲染产物后缀的稳定契约 */
export const DELIVERABLES_TEMPLATE_FILES = {
  doc: 'node-manual.md',
  skill: 'node-skill.md',
  run: 'node-node.yaml',
} as const;

/** 逐级查找模板目录——找到即返回（未找到返回 null，调用方走内置回退） */
function resolveTemplatesDir(): string | null {
  const candidates: string[] = [];
  const root = process.env.SOFAGENT_REPO_ROOT;
  if (root !== undefined && root !== '') candidates.push(join(root, ...DELIVERABLES_TEMPLATE_DIR_SEGMENTS));
  candidates.push(join(process.cwd(), ...DELIVERABLES_TEMPLATE_DIR_SEGMENTS));
  // dist/fde/ → 仓库根（monorepo 开发态：__dirname 上溯四级——join 参数见下一行）
  candidates.push(join(__dirname, '..', '..', '..', '..', ...DELIVERABLES_TEMPLATE_DIR_SEGMENTS));
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

/**
 * 渲染模板：`{{key}}` 占位符替换。
 *
 * fail-closed 语义：模板缺失 → 返回 null（调用方用内置默认）；
 * 模板存在但渲染后残留 `{{` → 视为模板坏了，同样回退内置默认。
 */
function renderTemplate(templateBody: string, vars: Record<string, string>): string | null {
  let out = templateBody;
  for (const [key, value] of Object.entries(vars)) {
    // split/join 全局替换（$ 等特殊字符安全——join 不走正则替换语义）
    out = out.split(`{{${key}}}`).join(value);
  }
  return out.includes('{{') ? null : out;
}

/** 加载三层模板（任一缺失/损坏 → 整体回退内置，保证三层风格一致） */
function loadDeliverablesTemplates(): { doc: string; skill: string; run: string } | null {
  const dir = resolveTemplatesDir();
  if (dir === null) return null;
  try {
    const doc = readFileSync(join(dir, DELIVERABLES_TEMPLATE_FILES.doc), 'utf-8');
    const skill = readFileSync(join(dir, DELIVERABLES_TEMPLATE_FILES.skill), 'utf-8');
    const run = readFileSync(join(dir, DELIVERABLES_TEMPLATE_FILES.run), 'utf-8');
    return { doc, skill, run };
  } catch {
    return null; // 任一模板读失败 → 整体回退（三层不混搭）
  }
}

/** 三层交付物（GUIDE 第五章——单节点三实体） */
export interface ThreeLayerDeliverables {
  nodeId: string;
  /** 文档层：节点交付手册（人读——怎么做/验收标准） */
  docLayer: { path: string; content: string };
  /** Skill 层：SKILL.md 模板（Agent 可执行的作业指导） */
  skillLayer: { path: string; content: string };
  /** 运行层：workflow 节点片段（可组装——引擎六消费） */
  runLayer: { path: string; content: string };
}

/** 引擎五结果 */
export interface DistillResult {
  deliverablesDir: string;
  layers: ThreeLayerDeliverables[];
  /** 交付手册总览（deliverables/README.md） */
  index: { path: string; content: string };
}

/**
 * 引擎五：跑通过程 → 三层交付物自动生成。
 *
 * 文档层/Skill 层按 GUIDE 第五章模板渲染（节点五要素注入模板位）；
 * 运行层产出节点 yaml 片段（引擎六组装 workflow 用）。
 */
export function distillDeliverables(
  dataDir: string,
  enterpriseId: string,
  nodes: readonly NodeInterview[],
  plans: readonly NodePlan[] | null = null,
): DistillResult {
  const paths = fdeWorkbenchPaths(dataDir, enterpriseId);
  const deliverablesDir = join(paths.deliverablesDir);
  mkdirSync(deliverablesDir, { recursive: true });

  // 模板外置：三级查找链命中 → 模板渲染；miss/损坏 → 内置默认（fail-closed）
  const templates = loadDeliverablesTemplates();

  const layers: ThreeLayerDeliverables[] = nodes.map((n) => {
    const tag = plans?.find((p) => p.nodeId === n.nodeId)?.tag ?? 'unknown';
    const tagLabel = tag === 'auto' ? '🔄 自动执行' : tag === 'enhance' ? '⚡ 强化岗位' : '👤 暂不动';

    // 占位符变量集（模板契约——键名与 FDE/templates/deliverables/README.md 约定一致）
    const vars: Record<string, string> = {
      nodeId: n.nodeId,
      description: n.description,
      tag,
      tagLabel,
      input: n.elements.input,
      output: n.elements.output,
      owner: n.elements.owner,
      duration: n.elements.duration,
      bottleneck: n.elements.bottleneck,
      sixSteps: sixSteps(n).join('\n'),
    };

    // 模板渲染（任一层失败 → 该层回退内置默认，其余层不受影响）
    const docContent =
      (templates ? renderTemplate(templates.doc, vars) : null) ??
      [
        `# 交付手册 · ${n.nodeId}`,
        '',
        `> 节点：${n.description} · 判定：${tagLabel}`,
        '',
        '## 现状（五要素）',
        `- 输入：${n.elements.input}`,
        `- 输出：${n.elements.output}`,
        `- 负责人：${n.elements.owner}`,
        `- 耗时：${n.elements.duration}`,
        `- 最卡的地方：${n.elements.bottleneck}`,
        '',
        '## 作业步骤（六步分解）',
        ...sixSteps(n),
        '',
        '## 验收标准',
        `- 输出物形态与原人工产出一致（${n.elements.output}）`,
        '- 处理时长显著低于人工基线',
        '- 抽检错误率低于人工基线',
        '',
        '## 回滚方式',
        '停用 AI 节点 → 人工按本手册「现状」节恢复原流程。',
      ].join('\n');

    const skillContent =
      (templates ? renderTemplate(templates.skill, vars) : null) ??
      [
        '---',
        `name: node-${sanitizeNodeId(n.nodeId)}`,
        'description: 本 Skill 由 FDE 沉淀引擎自动生成——按交付手册执行节点作业。',
        '---',
        '',
        `# ${n.description}`,
        '',
        `## 输入`,
        `${n.elements.input}`,
        '',
        `## 任务`,
        `${n.elements.bottleneck}`,
        '',
        `## 输出`,
        `${n.elements.output}`,
      ].join('\n');

    const runContent =
      (templates ? renderTemplate(templates.run, vars) : null) ??
      [
        `# 节点片段（引擎六组装 workflow 用）`,
        `- id: ${n.nodeId}`,
        `  # agent: 由 agent-creation 推导`,
        `  task: |`,
        `    节点：${n.description}`,
        `    输入：${n.elements.input}`,
        `    输出：${n.elements.output}`,
        `    痛点：${n.elements.bottleneck}`,
        `  # 自动化标签：${tag}`,
      ].join('\n');

    return {
      nodeId: n.nodeId,
      docLayer: { path: join(deliverablesDir, `${sanitizeNodeId(n.nodeId)}-manual.md`), content: docContent },
      skillLayer: { path: join(deliverablesDir, `${sanitizeNodeId(n.nodeId)}-skill.md`), content: skillContent },
      runLayer: { path: join(deliverablesDir, `${sanitizeNodeId(n.nodeId)}-node.yaml`), content: runContent },
    };
  });

  // 落盘三层
  for (const l of layers) {
    atomicWriteSync(l.docLayer.path, l.docLayer.content);
    atomicWriteSync(l.skillLayer.path, l.skillLayer.content);
    atomicWriteSync(l.runLayer.path, l.runLayer.content);
  }

  const indexContent = [
    `# FDE 交付物总览 · ${enterpriseId}`,
    '',
    '| 节点 | 文档层 | Skill 层 | 运行层 |',
    '|------|--------|----------|--------|',
    ...layers.map(
      (l) => `| ${l.nodeId} | [手册](./${l.nodeId}-manual.md) | [Skill](./${l.nodeId}-skill.md) | [片段](./${l.nodeId}-node.yaml) |`,
    ),
    '',
    '> 三层交付（GUIDE 第五章）：文档层给人看、Skill 层给 Agent 执行、运行层组装 workflow。',
  ].join('\n');
  const indexPath = join(deliverablesDir, 'README.md');
  atomicWriteSync(indexPath, indexContent);

  emitFdeAudit(
    {
      type: 'fde_distill',
      enterpriseId,
      artifact: indexPath,
      reason: `三层交付物：${layers.length} 节点 × 3 层（文档/Skill/运行）`,
    },
    dataDir,
  );
  return { deliverablesDir, layers, index: { path: indexPath, content: indexContent } };
}

function sixSteps(n: NodeInterview): string[] {
  return [
    `1. 接收输入：${n.elements.input}`,
    '2. 校验输入（格式与完整性）',
    `3. 核心处理（痛点：${n.elements.bottleneck}）`,
    '4. 结果自检',
    `5. 产出：${n.elements.output}`,
    '6. 交付下游',
  ];
}

// ══════════════════════════════════════
// 引擎六：fde_deploy 部署（workflow 组装）
// ══════════════════════════════════════

/** 部署结果（引擎六产物） */
export interface DeployResult {
  /** workflow.yml 落盘路径（可经 workflow_submit 提交 + activate_workflow 激活） */
  workflowPath: string;
  /** 组装的节点数 */
  nodeCount: number;
  /** 下一步指引（人读——submit/activate 的 MCP 调用提示） */
  nextSteps: string[];
}

/**
 * 引擎六：三层交付物 → workflow.yml 组装部署。
 *
 * 复用 workflow-draft.generateWorkflowDraft（同生成器——与 fde_compose
 * 产物同格式，直接走 workflow_submit + activate_workflow 现有链路）。
 */
export function deployWorkflow(
  dataDir: string,
  enterpriseId: string,
  session: ComposeSession,
): DeployResult {
  const paths = fdeWorkbenchPaths(dataDir, enterpriseId);
  mkdirSync(paths.deploymentsDir, { recursive: true });

  const draft = generateWorkflowDraft(session);
  const workflowPath = join(paths.deploymentsDir, `${session.workflowName}.yml`);
  atomicWriteSync(workflowPath, draft.yaml);

  emitFdeAudit(
    {
      type: 'fde_deploy',
      enterpriseId,
      artifact: workflowPath,
      reason: `workflow 组装：${session.nodes.length} 节点（${session.workflowName}）——待 workflow_submit 提交`,
    },
    dataDir,
  );
  return {
    workflowPath,
    nodeCount: session.nodes.length,
    nextSteps: [
      `workflow_submit 提交：${workflowPath}`,
      `activate_workflow 激活（复用现有链路——本引擎只产出工件不代激活）`,
    ],
  };
}
