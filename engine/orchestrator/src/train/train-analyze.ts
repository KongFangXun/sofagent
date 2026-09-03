// train-analyze.ts · v1.4.4 第四章 · 训练需求推导（workflow 节点 → 训练配置）
//
// 定位：训练引擎区别于训练工具的分水岭——帮企业「不是泛泛训个模型，而是
// 根据 workflow 中每个节点需要的能力，精确定义这个节点需要什么样的专属
// 模型」。推导链：
//   workflow 节点（五要素：节点描述+耗时+最卡的地方）
//     → 训练目标（提取/分类/生成/对话）
//     → 数据需求（格式/量级）
//     → 评估标准（指标+阈值）
//     → 训练配置（场景模板实例化——Oumi 格式 / RL hyperparams）
//     → train_submit（衔接 v1.4.1 训练任务编排）
//
// 复用 v1.3.2 FDE 梳理产出（拍板：不重复采集）——输入直接吃 fde-workbench
// 的 interview.json（NodeInterview 五要素 + 三问判定），五要素从访谈来，
// 推导只做「要素 → 训练目标映射」，不重新问企业一遍。
//
// 纯规则驱动（LLM 不参与生成）——关键词规则可解释可审计。

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import type { NodeInterview } from '../fde/compose-interview';
import { fdeWorkbenchPaths } from '../fde/fde-workbench';
import {
  TRAIN_SCENARIO_TEMPLATES,
  findTrainTemplate,
  instantiateTrainTemplate,
  instantiateRlTemplate,
  listTrainTemplates,
  validateMoeTargetModules,
  MOE_TARGET_MODULES,
  type TrainScenario,
  type TrainScenarioTemplate,
  type TrainTemplateInstance,
} from './train-templates';
import type { RlTemplateInstance } from './rl-templates';

// ════════════════════════════════════════
// 推导数据模型
// ════════════════════════════════════════

/** 训练目标推导结果（节点 → 场景 + 理由） */
export interface TrainGoalDerivation {
  nodeId: string;
  /** 命中的场景（extraction/classification/generation/dialogue） */
  scenario: TrainScenario;
  /** 命中理由（哪些关键词/要素证据——审计可读） */
  evidence: string[];
  /** 是否明确命中（false = 兜底默认 extraction——需人确认） */
  confident: boolean;
}

/** 场景推导内部结果（无 nodeId——外层组装时补） */
interface ScenarioMatch {
  scenario: TrainScenario;
  evidence: string[];
  confident: boolean;
}

/** 训练需求推导报告（train analyze 产物——四段全量） */
export interface TrainAnalyzeResult {
  schemaVersion: 'v1';
  enterpriseId: string;
  /** 被推导的节点 id */
  nodeId: string;
  /** 节点五要素快照（复用 v1.3.2 梳理产出——推导输入留痕） */
  node: {
    description: string;
    input: string;
    output: string;
    owner: string;
    duration: string;
    bottleneck: string;
    tag: NodeInterview['tag'];
  };
  /** 一、训练目标（场景 + 证据） */
  goal: TrainGoalDerivation;
  /** 二、数据需求（推荐模板的数据口径） */
  dataRequirement: { minSamples: number; format: string; note: string };
  /** 三、评估标准（指标 + 阈值 + 口径说明） */
  evalCriteria: { metric: string; threshold: string; note: string };
  /** 四、训练配置（模板实例化——可直接 train_submit） */
  config: TrainTemplateInstance | RlTemplateInstance | null;
  /** 配置未生成原因（config=null 时——如模板需人工选型） */
  configNote?: string;
  analyzedAt: string;
}

/** 推导选项 */
export interface TrainAnalyzeOptions {
  /** 基座模型名（缺省 Qwen3-8B——DEFAULT_BASE_MODEL_CANDIDATES 首选） */
  baseModel?: string;
  /** 基座类型（dense/moe——缺省 dense，moe 走 expert 覆盖校验） */
  baseType?: 'dense' | 'moe';
  /** 训练数据路径（缺省推荐占位——实例化仍可产出，提交前须替换真实路径） */
  dataPath?: string;
  /** 显式指定模板 id（缺省按场景自动选 QLoRA 首选模板） */
  templateId?: string;
  /** RL 配方 id（grpo/dapo/cispo——指定时走 RL 模板实例化） */
  rlRecipe?: string;
  /** 超参覆盖（透传实例化） */
  overrides?: Record<string, unknown>;
  /** 时钟注入（测试） */
  now?: () => number;
}

// ════════════════════════════════════════
// 场景关键词规则（推导引擎核心）
// ════════════════════════════════════════

/** 兜底场景（无命中时的默认——需人确认） */
const FALLBACK_SCENARIO: TrainScenario = 'extraction';

/**
 * 从节点文本（描述+输出+最卡处）推导训练场景。
 *
 * 规则：对四场景的 matchHints 逐组计数命中（拼接 描述+输出+最卡的地方
 * 三段文本），最高分组胜出；并列或零命中 → 兜底 extraction 且
 * confident=false（报告标注需人确认）。
 */
export function deriveTrainScenario(node: {
  description: string;
  output: string;
  bottleneck: string;
}): ScenarioMatch {
  const text = `${node.description} ${node.output} ${node.bottleneck}`;
  const scores = new Map<TrainScenario, string[]>();
  for (const template of TRAIN_SCENARIO_TEMPLATES) {
    const hints = template.matchHints.filter((kw) => text.includes(kw));
    if (hints.length > 0) {
      const list = scores.get(template.scenario) ?? [];
      scores.set(template.scenario, [...list, ...hints]);
    }
  }
  if (scores.size === 0) {
    return { scenario: FALLBACK_SCENARIO, evidence: [], confident: false };
  }
  let best: TrainScenario | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [scenario, evidence] of scores) {
    const unique = [...new Set(evidence)].length;
    if (unique > bestCount) {
      best = scenario;
      bestCount = unique;
      tie = false;
    } else if (unique === bestCount) {
      tie = true;
    }
  }
  if (best === null || tie) {
    return { scenario: FALLBACK_SCENARIO, evidence: [], confident: false };
  }
  return { scenario: best, evidence: [...new Set(scores.get(best) ?? [])], confident: true };
}

// ════════════════════════════════════════
// 训练需求推导主入口
// ════════════════════════════════════════

/** 从 FDE 访谈记录找节点（interview.json——复用 v1.3.2 产出不重复采集） */
export function findInterviewNode(
  dataDir: string,
  enterpriseId: string,
  nodeId: string,
): NodeInterview | null {
  const paths = fdeWorkbenchPaths(dataDir, enterpriseId);
  if (!existsSync(paths.interview)) return null;
  try {
    const record = JSON.parse(readFileSync(paths.interview, 'utf-8')) as {
      rounds?: Array<{ nodes?: NodeInterview[] }>;
    };
    // 后到覆盖（与 recordInterview 幂等合并口径一致——同 nodeId 多轮访谈取最新）
    const merged = new Map<string, NodeInterview>();
    for (const round of record.rounds ?? []) {
      for (const n of round.nodes ?? []) merged.set(n.nodeId, n);
    }
    return merged.get(nodeId) ?? null;
  } catch {
    return null;
  }
}

/** 按场景选首选模板（QLoRA 优先——参数高效，企业单卡可训） */
export function pickDefaultTemplate(scenario: TrainScenario): TrainScenarioTemplate | null {
  const candidates = listTrainTemplates(scenario);
  return candidates.find((t) => t.method === 'qlora') ?? candidates[0] ?? null;
}

/**
 * 训练需求推导主入口：workflow 节点 → 训练目标/数据需求/评估标准/训练配置。
 *
 * 输入来源（按优先级）：
 *   1. 显式传入的 node（结构化五要素——MCP/测试路径）
 *   2. data/fde/<enterpriseId>/interview.json 的既有梳理产出（CLI 路径——
 *      复用 v1.3.2 五要素，不重复采集）
 *
 * 推导为纯规则：场景关键词命中 → 模板选型 → 实例化（MoE 防护在实例化层）。
 * 节点不存在时抛错（快速失败——提示先跑 fde_interview）。
 */
export function analyzeTrainNeed(
  dataDir: string,
  enterpriseId: string,
  nodeId: string,
  options: TrainAnalyzeOptions & { node?: NodeInterview } = {},
): TrainAnalyzeResult {
  const now = options.now ?? Date.now;
  const node = options.node ?? findInterviewNode(dataDir, enterpriseId, nodeId);
  if (!node) {
    throw new Error(
      `[train-analyze] 节点 ${nodeId} 不存在（enterprise=${enterpriseId}）——` +
        `先跑 fde_interview 收集五要素（复用 v1.3.2 梳理产出），或经 MCP 传入 node 结构`,
    );
  }

  // 一、训练目标（场景推导）
  const derivation = deriveTrainScenario({
    description: node.description,
    output: node.elements.output,
    bottleneck: node.elements.bottleneck,
  });

  // 二、模板选型（显式指定 > 场景首选）
  const template =
    (options.templateId !== undefined ? findTrainTemplate(options.templateId) : null) ??
    pickDefaultTemplate(derivation.scenario);

  // 三、训练配置实例化（RL 配方显式指定时走 RL 通道；否则场景模板）
  let config: TrainTemplateInstance | RlTemplateInstance | null = null;
  let configNote: string | undefined;
  const dataPath = options.dataPath ?? `data/datasets/${enterpriseId}/${nodeId}/train.jsonl`;
  if (options.rlRecipe !== undefined) {
    config = instantiateRlTemplate({
      recipe: options.rlRecipe,
      baseModel: options.baseModel ?? 'Qwen3-8B',
      baseType: options.baseType ?? 'dense',
      dataPath,
      ...(options.overrides !== undefined ? { overrides: options.overrides } : {}),
    });
  } else if (template) {
    try {
      config = instantiateTrainTemplate({
        templateId: template.id,
        baseModel: options.baseModel ?? 'Qwen3-8B',
        baseType: options.baseType ?? 'dense',
        dataPath,
        ...(options.overrides !== undefined ? { overrides: options.overrides } : {}),
      });
    } catch (err) {
      // MoE 防护拒绝等实例化失败——报告保留前三段，配置段给原因
      configNote = err instanceof Error ? err.message : String(err);
    }
  } else {
    configNote = `场景 ${derivation.scenario} 无可用模板（train templates list 可查全量）`;
  }

  // 四、数据需求与评估标准（模板口径——无模板时给场景通用口径）
  const dataRequirement = template
    ? template.dataRequirement
    : { minSamples: 500, format: 'JSONL（messages 格式）', note: '场景未匹配模板——通用口径' };
  const evalCriteria = template
    ? template.evalCriteria
    : { metric: 'exact_match', threshold: '≥ 0.85', note: '场景未匹配模板——通用口径' };

  return {
    schemaVersion: 'v1',
    enterpriseId,
    nodeId,
    node: {
      description: node.description,
      input: node.elements.input,
      output: node.elements.output,
      owner: node.elements.owner,
      duration: node.elements.duration,
      bottleneck: node.elements.bottleneck,
      tag: node.tag,
    },
    goal: {
      nodeId,
      scenario: derivation.scenario,
      evidence: derivation.evidence,
      confident: derivation.confident,
    },
    dataRequirement,
    evalCriteria,
    config,
    ...(configNote !== undefined ? { configNote } : {}),
    analyzedAt: new Date(now()).toISOString(),
  };
}

// ════════════════════════════════════════
// 报告落盘（data/train/<enterpriseId>/analyze/<nodeId>.json）
// ════════════════════════════════════════

/** 推导报告落盘路径 */
export function trainAnalyzeReportPath(dataDir: string, enterpriseId: string, nodeId: string): string {
  return join(dataDir, 'train', enterpriseId, 'analyze', `${nodeId}.json`);
}

/** 落盘推导报告（原子写——幂等覆盖，最新推导为准确认态） */
export function saveTrainAnalyzeReport(dataDir: string, report: TrainAnalyzeResult): string {
  const file = trainAnalyzeReportPath(dataDir, report.enterpriseId, report.nodeId);
  const dir = join(file, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(file, JSON.stringify(report, null, 2));
  return file;
}

// MoE 防护工具再导出（train analyze 消费同源——单一入口）
export { validateMoeTargetModules, MOE_TARGET_MODULES };
