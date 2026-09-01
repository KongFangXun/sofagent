// ============================================================
// fde/fde-quantify.ts · v1.4.3 章八 · 引擎三量化 + 引擎四本体 + 引擎五沉淀 + 引擎六部署
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

import { mkdirSync } from 'fs';
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
  /** ROI 排序键 = 年节省 ÷（一次性投入 + 1）——高在前 */
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
      roiScore: metrics.annualSaving.value / (invest + 1),
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
    ...draft.entities.map((e) => `  - ${e}`),
    'concepts:',
    ...draft.concepts.map((c) => `  - ${c}`),
    'relations:',
    ...draft.relations.map((r) => `  - from: ${r.from}\n    type: ${r.type}\n    to: ${r.to}`),
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

  const layers: ThreeLayerDeliverables[] = nodes.map((n) => {
    const tag = plans?.find((p) => p.nodeId === n.nodeId)?.tag ?? 'unknown';
    const tagLabel = tag === 'auto' ? '🔄 自动执行' : tag === 'enhance' ? '⚡ 强化岗位' : '👤 暂不动';

    const docContent = [
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

    const skillContent = [
      '---',
      `name: node-${n.nodeId}`,
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

    const runContent = [
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
      docLayer: { path: join(deliverablesDir, `${n.nodeId}-manual.md`), content: docContent },
      skillLayer: { path: join(deliverablesDir, `${n.nodeId}-skill.md`), content: skillContent },
      runLayer: { path: join(deliverablesDir, `${n.nodeId}-node.yaml`), content: runContent },
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
