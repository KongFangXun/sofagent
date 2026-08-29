// train-templates.ts · v1.4.3 第四章 · 场景模板库（文本提取/分类/生成/多轮对话 × QLoRA/SFT/DPO + MoE 防护）
//
// 定位：训练需求推导（train-analyze）的「选型面」——从 workflow 节点推导出
// 训练目标后，按场景 × 算法选模板实例化。模板是「参数骨架 + 评估口径 +
// 数据需求」三合一，实例化产出 Oumi 格式配置（qlora-template 构建）或
// RL hyperparams（rl-templates 合并），可直接被 train_submit 消费
// （衔接 v1.4.1 训练任务编排——推导→配置→提交全链路）。
//
// MoE 防护（2026-08-26 拍板）：模板带 base_type: dense/moe 标注；moe 模板
// 实例化时校验 LoRA target_modules 必须覆盖 expert 矩阵（gate/up/down_proj）
// ——缺失即拒绝并给修复提示（对齐商业侧后训练内部规范 §5.2）。
//
// 纯规则驱动（LLM 不参与生成）。

import {
  buildQloraTemplate,
  DENSE_TARGET_MODULES,
  MOE_TARGET_MODULES,
  type QloraOumiConfig,
} from './qlora-template';
import { instantiateRlTemplate, type RlTemplateInstance } from './rl-templates';

// ════════════════════════════════════════
// 场景模板数据模型
// ════════════════════════════════════════

/** 训练场景类型（workflow 节点映射——推导引擎的输出维度） */
export type TrainScenario = 'extraction' | 'classification' | 'generation' | 'dialogue';

/** 训练方法族（QLoRA 参数高效微调 / SFT 全参监督微调 / DPO 偏好优化） */
export type TrainMethod = 'qlora' | 'sft' | 'dpo';

/** 场景模板（场景 × 方法——list 可查，实例化产出配置） */
export interface TrainScenarioTemplate {
  /** 模板 id（场景-方法，如 extraction-qlora） */
  id: string;
  scenario: TrainScenario;
  method: TrainMethod;
  /** 场景名（人读——train templates list 展示） */
  name: string;
  /** 适用节点特征（推导引擎匹配依据——关键词命中） */
  matchHints: readonly string[];
  /** 基座类型标注（dense/moe——实例化校验分支） */
  base_type: 'dense' | 'moe';
  /** 训练目标描述（推导产物引用——审计可读） */
  goal: string;
  /** 数据需求（多少量 / 什么格式——引导采集） */
  dataRequirement: { minSamples: number; format: string; note: string };
  /** 评估标准（验收指标——eval 闭环衔接） */
  evalCriteria: { metric: string; threshold: string; note: string };
  /** 默认超参骨架（QLoRA 构建输入 / SFT·DPO hyperparams 直填） */
  defaults: Record<string, unknown>;
}

/**
 * 场景模板库（四场景 × 三方法全量——`train templates list` 数据源）。
 *
 * defaults 为「实例化基线」：extraction/classification 用 qlora-template
 * 构建 Oumi 配置（QLoRA 方法）；sft/dpo 是 hyperparams 骨架（协议透传）。
 */
export const TRAIN_SCENARIO_TEMPLATES: readonly TrainScenarioTemplate[] = [
  {
    id: 'extraction-qlora',
    scenario: 'extraction',
    method: 'qlora',
    name: '文本提取 · QLoRA',
    matchHints: ['提取', '抽取', '字段', '结构化', '解析', '录入', '抄录'],
    base_type: 'dense',
    goal: '从非结构化文本稳定提取结构化字段（键值对/表格行）',
    dataRequirement: {
      minSamples: 500,
      format: 'JSONL（messages 格式：user=原文，assistant=目标 JSON）',
      note: '字段集固定的表单/票据/工单场景 500 条起步；字段稀疏时按字段补样',
    },
    evalCriteria: { metric: 'exact_match', threshold: '≥ 0.90', note: '整条 JSON 完全匹配率——漏字段即不匹配' },
    defaults: { loraRank: 16, learningRate: 2e-4, epochs: 3, maxSeqLen: 2048 },
  },
  {
    id: 'extraction-sft',
    scenario: 'extraction',
    method: 'sft',
    name: '文本提取 · SFT 全参',
    matchHints: ['提取', '抽取', '字段', '结构化', '解析', '录入', '抄录'],
    base_type: 'dense',
    goal: '同 extraction-qlora，全参微调追求更高精度（显存预算充足时）',
    dataRequirement: {
      minSamples: 2000,
      format: 'JSONL（messages 格式）',
      note: '全参微调对数据量更敏感——2000 条起步防过拟合',
    },
    evalCriteria: { metric: 'exact_match', threshold: '≥ 0.92', note: '全参相对 QLoRA 应有 +2pt 提升，否则不值显存差价' },
    defaults: { learningRate: 1e-5, epochs: 2, batchSize: 4 },
  },
  {
    id: 'classification-qlora',
    scenario: 'classification',
    method: 'qlora',
    name: '文本分类 · QLoRA',
    matchHints: ['分类', '分级', '判定', '审核', '筛选', '打标', '识别缺陷'],
    base_type: 'dense',
    goal: '按固定类目体系对输入做可靠分类（单选/多选标签）',
    dataRequirement: {
      minSamples: 300,
      format: 'JSONL（messages 格式：user=原文，assistant=标签枚举值）',
      note: '每类至少 50 条且类目均衡——长尾类补样优先于总量堆叠',
    },
    evalCriteria: { metric: 'macro_f1', threshold: '≥ 0.85', note: '宏平均 F1——长尾类不达标则整体不达标' },
    defaults: { loraRank: 16, learningRate: 2e-4, epochs: 3, maxSeqLen: 1024 },
  },
  {
    id: 'classification-sft',
    scenario: 'classification',
    method: 'sft',
    name: '文本分类 · SFT 全参',
    matchHints: ['分类', '分级', '判定', '审核', '筛选', '打标', '识别缺陷'],
    base_type: 'dense',
    goal: '同 classification-qlora，全参微调（类目体系复杂时）',
    dataRequirement: {
      minSamples: 1000,
      format: 'JSONL（messages 格式）',
      note: '类目 ≥ 10 时建议全参——小容量 LoRA 表达力不足',
    },
    evalCriteria: { metric: 'macro_f1', threshold: '≥ 0.88', note: '同上' },
    defaults: { learningRate: 1e-5, epochs: 2, batchSize: 4 },
  },
  {
    id: 'generation-qlora',
    scenario: 'generation',
    method: 'qlora',
    name: '文本生成 · QLoRA',
    matchHints: ['生成', '撰写', '起草', '报告', '摘要', '润色', '改写'],
    base_type: 'dense',
    goal: '按企业文体/格式惯例生成初稿（报告段落/邮件/单证）',
    dataRequirement: {
      minSamples: 1000,
      format: 'JSONL（messages 格式：user=需求+素材，assistant=范文）',
      note: '范文质量决定上限——采集历史成稿而非流水账',
    },
    evalCriteria: { metric: 'rouge_l', threshold: '≥ 0.35', note: '与范文重叠加权——生成类主指标' },
    defaults: { loraRank: 32, learningRate: 1e-4, epochs: 3, maxSeqLen: 4096 },
  },
  {
    id: 'generation-dpo',
    scenario: 'generation',
    method: 'dpo',
    name: '文本生成 · DPO 偏好对齐',
    matchHints: ['偏好', '选优', '排序', '口味', '风格对齐', '两稿选一'],
    base_type: 'dense',
    goal: '在企业偏好上对齐生成风格（chosen/rejected 偏好对）',
    dataRequirement: {
      minSamples: 800,
      format: 'JSONL（prompt + chosen + rejected 三字段）',
      note: '偏好对必须同题成对——历史 A/B 评审记录是现成来源',
    },
    evalCriteria: { metric: 'win_rate', threshold: '≥ 0.60', note: '与基座对比胜率——盲评口径' },
    defaults: { learningRate: 5e-7, epochs: 1, beta: 0.1 },
  },
  {
    id: 'dialogue-qlora',
    scenario: 'dialogue',
    method: 'qlora',
    name: '多轮对话 · QLoRA',
    matchHints: ['对话', '客服', '问答', '多轮', '应答', '接待'],
    base_type: 'dense',
    goal: '多轮对话风格与知识对齐（企业话术/领域 FAQ）',
    dataRequirement: {
      minSamples: 2000,
      format: 'JSONL（完整多轮 messages 数组——含 system 轮）',
      note: '单条样本是完整会话不是单轮——轮次分布与真实流量对齐',
    },
    evalCriteria: { metric: 'task_success_rate', threshold: '≥ 0.80', note: '对话任务完成率——按会话判定非按轮判定' },
    defaults: { loraRank: 32, learningRate: 1e-4, epochs: 3, maxSeqLen: 4096 },
  },
  {
    id: 'dialogue-dpo',
    scenario: 'dialogue',
    method: 'dpo',
    name: '多轮对话 · DPO 偏好对齐',
    matchHints: ['偏好', '话术风格', '拒答边界', '安全对齐'],
    base_type: 'dense',
    goal: '对话风格/安全边界偏好对齐（拒绝越界+保持语气）',
    dataRequirement: {
      minSamples: 600,
      format: 'JSONL（多轮上下文 + chosen + rejected）',
      note: '拒答/越界类偏好对单独成组——边界行为必须显式训练',
    },
    evalCriteria: { metric: 'win_rate', threshold: '≥ 0.65', note: '偏好对盲评胜率' },
    defaults: { learningRate: 5e-7, epochs: 1, beta: 0.1 },
  },
];

/** 按模板 id 查（未知名返回 null） */
export function findTrainTemplate(id: string): TrainScenarioTemplate | null {
  return TRAIN_SCENARIO_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** 按场景列模板（scenario 省略 = 全量——train templates list 数据面） */
export function listTrainTemplates(scenario?: TrainScenario | string): TrainScenarioTemplate[] {
  if (scenario === undefined || scenario === '') return [...TRAIN_SCENARIO_TEMPLATES];
  return TRAIN_SCENARIO_TEMPLATES.filter((t) => t.scenario === scenario);
}

// ════════════════════════════════════════
// MoE 防护（expert 矩阵覆盖校验）
// ════════════════════════════════════════

/** MoE expert FFN 三矩阵（覆盖校验的最小集合） */
export const MOE_REQUIRED_EXPERT_MODULES: readonly string[] = ['gate_proj', 'up_proj', 'down_proj'] as const;

/** MoE 校验失败结果（拒绝实例化 + 修复提示） */
export interface MoeValidationError {
  valid: false;
  /** 缺失的 expert 矩阵 */
  missing: string[];
  /** 修复提示（人读——CLI/MCP 展示） */
  fixHint: string;
}

/** MoE 校验通过结果 */
export interface MoeValidationOk {
  valid: true;
}

export type MoeValidationResult = MoeValidationOk | MoeValidationError;

/**
 * MoE 基座 expert 矩阵覆盖校验（v1.4.3 第四章拍板——拒绝+修复提示）。
 *
 * dense 基座恒通过（无 expert 矩阵概念）；moe 基座要求 target_modules
 * 覆盖 gate/up/down_proj 全部三个——只挂 attention 投影是典型配置错误
 * （LoRA 只调路由不调专家容量，训练效果断崖且难归因）。
 */
export function validateMoeTargetModules(
  baseType: 'dense' | 'moe',
  targetModules: readonly string[],
): MoeValidationResult {
  if (baseType !== 'moe') return { valid: true };
  const missing = MOE_REQUIRED_EXPERT_MODULES.filter((m) => !targetModules.includes(m));
  if (missing.length > 0) {
    return {
      valid: false,
      missing,
      fixHint:
        `MoE 基座的 LoRA target_modules 必须显式覆盖 expert 矩阵（gate_proj/up_proj/down_proj）——` +
        `当前缺失：${missing.join(', ')}。修复：target_modules 用完整 MoE 预置组 ` +
        `[${MOE_TARGET_MODULES.join(', ')}]（attention 四投影 + expert 三矩阵）`,
    };
  }
  return { valid: true };
}

// ════════════════════════════════════════
// 模板实例化（场景模板 → 训练配置）
// ════════════════════════════════════════

/** 模板实例化输入 */
export interface InstantiateTrainTemplateInput {
  /** 模板 id（如 extraction-qlora） */
  templateId: string;
  /** 基座模型名（如 Qwen3-8B） */
  baseModel: string;
  /** 基座类型（dense/moe——moe 走 expert 覆盖校验） */
  baseType: 'dense' | 'moe';
  /** 训练数据路径 */
  dataPath: string;
  /** 覆盖默认超参（浅合并） */
  overrides?: Record<string, unknown>;
  /** 显式 target_modules（moe 校验对象——缺省用 baseType 预置组） */
  targetModules?: readonly string[];
}

/** QLoRA 类模板实例化结果（Oumi 配置 + train_submit 映射） */
export interface QloraTemplateInstance {
  schemaVersion: 'v1';
  templateId: string;
  scenario: TrainScenario;
  /** train_submit 算法映射（qlora → sft 通道——协议枚举三值） */
  algorithm: 'sft';
  base_type: 'dense' | 'moe';
  /** Oumi 格式完整配置（qlora-template 构建） */
  oumi: QloraOumiConfig;
  /** 评估指标（eval.metrics 填充后——eval 闭环衔接） */
  evalMetric: string;
  evalThreshold: string;
  /** train_submit 提交映射提示 */
  submitHint: string;
}

/** SFT/DPO 类模板实例化结果（hyperparams 骨架直出） */
export interface PlainTemplateInstance {
  schemaVersion: 'v1';
  templateId: string;
  scenario: TrainScenario;
  algorithm: 'sft' | 'dpo';
  base_type: 'dense' | 'moe';
  baseModel: string;
  dataPath: string;
  hyperparams: Record<string, unknown>;
  evalMetric: string;
  evalThreshold: string;
  submitHint: string;
}

/** 模板实例化结果（方法族决定形态） */
export type TrainTemplateInstance = QloraTemplateInstance | PlainTemplateInstance;

/**
 * 实例化场景模板（确定性输出——同输入同配置）。
 *
 * 流程：查模板 → MoE 校验（moe 时校验 target_modules 覆盖 expert 矩阵，
 * 缺失抛错带修复提示）→ 按 method 构建产物：
 *   - qlora → buildQloraTemplate 产出 Oumi 配置（algorithm 映射 sft 通道）
 *   - sft/dpo → hyperparams 骨架直出（协议透传）
 *
 * @throws 模板不存在 / MoE expert 矩阵覆盖校验失败（错误信息含修复提示）
 */
export function instantiateTrainTemplate(input: InstantiateTrainTemplateInput): TrainTemplateInstance {
  const template = findTrainTemplate(input.templateId);
  if (!template) {
    throw new Error(
      `[train-templates] 未知模板：${input.templateId}（可查 train templates list——四场景 × QLoRA/SFT/DPO）`,
    );
  }

  // MoE 防护：moe 基座校验 expert 矩阵覆盖（dense 预置组即校验失败案例）
  const effectiveTarget =
    input.targetModules !== undefined
      ? [...input.targetModules]
      : input.baseType === 'moe'
        ? [...MOE_TARGET_MODULES]
        : [...DENSE_TARGET_MODULES];
  const moeCheck = validateMoeTargetModules(input.baseType, effectiveTarget);
  if (!moeCheck.valid) {
    throw new Error(
      `[train-templates] MoE 模板防护拒绝实例化（模板 ${template.id}，基座 ${input.baseModel}）：` +
        `${moeCheck.fixHint}`,
    );
  }

  const overrides = input.overrides ?? {};
  if (template.method === 'qlora') {
    const merged = { ...template.defaults, ...overrides };
    const oumi = buildQloraTemplate({
      baseModel: input.baseModel,
      baseType: input.baseType,
      dataPath: input.dataPath,
      ...(typeof merged.loraRank === 'number' ? { loraRank: merged.loraRank } : {}),
      ...(typeof merged.learningRate === 'number' ? { learningRate: merged.learningRate } : {}),
      ...(typeof merged.epochs === 'number' ? { epochs: merged.epochs } : {}),
      ...(typeof merged.maxSeqLen === 'number' ? { maxSeqLen: merged.maxSeqLen } : {}),
      ...(typeof merged.batchSize === 'number' ? { batchSize: merged.batchSize } : {}),
      ...(input.targetModules !== undefined ? { targetModules: input.targetModules } : {}),
    });
    oumi.eval.metrics = [template.evalCriteria.metric];
    return {
      schemaVersion: 'v1',
      templateId: template.id,
      scenario: template.scenario,
      algorithm: 'sft',
      base_type: input.baseType,
      oumi,
      evalMetric: template.evalCriteria.metric,
      evalThreshold: template.evalCriteria.threshold,
      submitHint: `train_submit（algorithm=sft，hyperparams 含 qlora.oumi 配置——base_type=${input.baseType}）`,
    };
  }

  // sft / dpo：hyperparams 骨架直出
  const hyperparams = { ...template.defaults, ...overrides };
  return {
    schemaVersion: 'v1',
    templateId: template.id,
    scenario: template.scenario,
    algorithm: template.method === 'dpo' ? 'dpo' : 'sft',
    base_type: input.baseType,
    baseModel: input.baseModel,
    dataPath: input.dataPath,
    hyperparams,
    evalMetric: template.evalCriteria.metric,
    evalThreshold: template.evalCriteria.threshold,
    submitHint: `train_submit（algorithm=${template.method}，模板 ${template.id} 超参骨架）`,
  };
}

/** RL 模板实例化再导出（train-templates 单一入口——train analyze 消费同源） */
export { instantiateRlTemplate, RL_TEMPLATES, findRlTemplate } from './rl-templates';
export type { RlTemplate, RlRecipeId, RlTemplateInstance, RlTemplateInstantiateInput } from './rl-templates';
// MoE 防护常量再导出（qlora-template 单一事实源——测试与 CLI 消费同源）
export { DENSE_TARGET_MODULES, MOE_TARGET_MODULES } from './qlora-template';
