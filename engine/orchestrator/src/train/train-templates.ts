// train-templates.ts · v1.4.6 边界收缩 · 场景模板装载面（参考模板 + 外部配方装载 + MoE 防护）
//
// 定位：训练需求推导（train-analyze）的「选型面」——从 workflow 节点推导出
// 训练目标后，按场景 × 算法选模板实例化。模板是「参数骨架 + 评估口径 +
// 数据需求」三合一，实例化产出 Oumi 格式配置（qlora-template 构建）或
// RL hyperparams（rl-templates 合并），可直接被 train_submit 消费
// （衔接 v1.4.1 训练任务编排——推导→配置→提交全链路）。
//
// 边界收缩拍板（2026-08-10「工程骨架放开源、训练资产放模型层（商业侧）」）：
//   - 本文件只留「参考模板 + 装载逻辑」——内置四场景各 1 个 QLoRA 参考模板
//     （schema 活样例与缺省演示），全量配方（SFT/DPO 变体）经外部配方目录
//     装载（loadExternalRecipes——路径传入 → schema 校验 → 注册进查找面）
//   - 场景判定语义（matchHints）拆为 SCENARIO_MATCH_HINTS 场景级常量——
//     「节点文本→训练场景」的判定是缰绳面，与配方资产解耦：外部配方目录
//     缺某场景时 deriveTrainScenario 判定语义也不塌缩（判定用常量、
//     实例化才查模板）
//   - MoE 防护（参数校验）与实例化构造器留开源——缰绳性质
//
// MoE 防护（2026-08-26 拍板）：模板带 base_type: dense/moe 标注；moe 模板
// 实例化时校验 LoRA target_modules 必须覆盖 expert 矩阵（gate/up/down_proj）
// ——缺失即拒绝并给修复提示（对齐商业侧后训练内部规范 §5.2）。
//
// 纯规则驱动（LLM 不参与生成）。

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  buildQloraTemplate,
  DENSE_TARGET_MODULES,
  MOE_TARGET_MODULES,
  type QloraOumiConfig,
} from './qlora-template';
import { registerRlRecipes, type RlTemplate } from './rl-templates';

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

// ════════════════════════════════════════
// 场景判定语义（缰绳面——与配方资产解耦）
// ════════════════════════════════════════

/**
 * 场景判定关键词（场景级常量——deriveTrainScenario 的唯一数据源）。
 *
 * 这是「节点文本 → 训练场景」的判定语义（缰绳面），不是训练资产：判定
 * 不依赖模板集完整性——外部配方目录缺某场景的模板时，场景推导与兜底
 * 语义零变化（判定用本常量、实例化才查模板）。各场景关键词 = 原全量
 * 模板库（四场景 × QLoRA/SFT/DPO 八模板）matchHints 的场景级并集，
 * 归并时语义零变化。
 */
export const SCENARIO_MATCH_HINTS: Readonly<Record<TrainScenario, readonly string[]>> = {
  extraction: ['提取', '抽取', '字段', '结构化', '解析', '录入', '抄录'],
  classification: ['分类', '分级', '判定', '审核', '筛选', '打标', '识别缺陷'],
  generation: ['生成', '撰写', '起草', '报告', '摘要', '润色', '改写', '偏好', '选优', '排序', '口味', '风格对齐', '两稿选一'],
  dialogue: ['对话', '客服', '问答', '多轮', '应答', '接待', '偏好', '话术风格', '拒答边界', '安全对齐'],
};

// ════════════════════════════════════════
// 参考模板（四场景各 1——schema 活样例与缺省演示）
// ════════════════════════════════════════

/**
 * 内置参考模板库（四场景各 1 个 QLoRA——`train templates list` 缺省数据面）。
 *
 * 全量配方（SFT/DPO 变体）是训练资产，归商业侧外部配方目录——经
 * loadExternalRecipes 装载后与参考模板合并进查找面（外部同 id 覆盖参考，
 * 幂等）。每场景保留 1 个 QLoRA 参考模板保证：pickDefaultTemplate 四场景
 * 均非 null、train-analyze 缺省路径不空转、schema 有活样例。
 */
export const TRAIN_SCENARIO_TEMPLATES: readonly TrainScenarioTemplate[] = [
  {
    id: 'extraction-qlora',
    scenario: 'extraction',
    method: 'qlora',
    name: '文本提取 · QLoRA',
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
    id: 'classification-qlora',
    scenario: 'classification',
    method: 'qlora',
    name: '文本分类 · QLoRA',
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
    id: 'generation-qlora',
    scenario: 'generation',
    method: 'qlora',
    name: '文本生成 · QLoRA',
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
    id: 'dialogue-qlora',
    scenario: 'dialogue',
    method: 'qlora',
    name: '多轮对话 · QLoRA',
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
];

// ════════════════════════════════════════
// 外部配方装载（训练资产在商业侧——装载面是缰绳）
// ════════════════════════════════════════

/** 已装载的外部场景模板（loadExternalRecipes 注册——查找面统一消费） */
const loadedExternalTemplates: TrainScenarioTemplate[] = [];

/** 外部配方装载结果（审计可读——CLI 展示与测试断言） */
export interface LoadExternalRecipesResult {
  /** 配方目录路径 */
  dir: string;
  /** 成功装载的场景模板数 */
  scenarioTemplatesLoaded: number;
  /** 成功装载的 RL 配方数 */
  rlRecipesLoaded: number;
  /** 跳过明细（schema 不符 / JSON 解析失败——文件名 + 原因） */
  skipped: Array<{ file: string; reason: string }>;
}

const SCENARIO_VALUES: readonly TrainScenario[] = ['extraction', 'classification', 'generation', 'dialogue'];
const METHOD_VALUES: readonly TrainMethod[] = ['qlora', 'sft', 'dpo'];

/** 单条场景模板 schema 校验（必填字段 + 枚举值——不通过的拒绝装载） */
function validateExternalTemplate(item: unknown): { ok: true; value: TrainScenarioTemplate } | { ok: false; reason: string } {
  if (typeof item !== 'object' || item === null) return { ok: false, reason: '非对象' };
  const t = item as Record<string, unknown>;
  if (typeof t.id !== 'string' || t.id === '') return { ok: false, reason: 'id 缺失或非字符串' };
  if (!SCENARIO_VALUES.includes(t.scenario as TrainScenario)) {
    return { ok: false, reason: `scenario 非法：${String(t.scenario)}（可选：${SCENARIO_VALUES.join(' | ')}）` };
  }
  if (!METHOD_VALUES.includes(t.method as TrainMethod)) {
    return { ok: false, reason: `method 非法：${String(t.method)}（可选：${METHOD_VALUES.join(' | ')}）` };
  }
  if (typeof t.name !== 'string' || t.name === '') return { ok: false, reason: 'name 缺失或非字符串' };
  if (t.base_type !== 'dense' && t.base_type !== 'moe') return { ok: false, reason: 'base_type 须为 dense | moe' };
  if (typeof t.goal !== 'string') return { ok: false, reason: 'goal 缺失或非字符串' };
  const dr = t.dataRequirement;
  if (typeof dr !== 'object' || dr === null || typeof (dr as Record<string, unknown>).minSamples !== 'number'
    || typeof (dr as Record<string, unknown>).format !== 'string' || typeof (dr as Record<string, unknown>).note !== 'string') {
    return { ok: false, reason: 'dataRequirement 须含 minSamples(number)/format(string)/note(string)' };
  }
  const ec = t.evalCriteria;
  if (typeof ec !== 'object' || ec === null || typeof (ec as Record<string, unknown>).metric !== 'string'
    || typeof (ec as Record<string, unknown>).threshold !== 'string' || typeof (ec as Record<string, unknown>).note !== 'string') {
    return { ok: false, reason: 'evalCriteria 须含 metric/threshold/note(string)' };
  }
  if (typeof t.defaults !== 'object' || t.defaults === null || Array.isArray(t.defaults)) {
    return { ok: false, reason: 'defaults 须为对象' };
  }
  return {
    ok: true,
    value: {
      id: t.id,
      scenario: t.scenario as TrainScenario,
      method: t.method as TrainMethod,
      name: t.name,
      base_type: t.base_type,
      goal: t.goal,
      dataRequirement: dr as TrainScenarioTemplate['dataRequirement'],
      evalCriteria: ec as TrainScenarioTemplate['evalCriteria'],
      defaults: t.defaults as Record<string, unknown>,
    },
  };
}

/** 单条 RL 配方 schema 校验（必填字段 + 枚举值） */
function validateExternalRlRecipe(item: unknown): { ok: true; value: RlTemplate } | { ok: false; reason: string } {
  if (typeof item !== 'object' || item === null) return { ok: false, reason: '非对象' };
  const r = item as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return { ok: false, reason: 'id 缺失或非字符串' };
  if (typeof r.name !== 'string' || r.name === '') return { ok: false, reason: 'name 缺失或非字符串' };
  if (!Array.isArray(r.scenarios) || r.scenarios.length === 0) return { ok: false, reason: 'scenarios 须为非空字符串数组' };
  if (r.base_type !== 'dense' && r.base_type !== 'moe') return { ok: false, reason: 'base_type 须为 dense | moe' };
  if (typeof r.hyperparams !== 'object' || r.hyperparams === null || Array.isArray(r.hyperparams)) {
    return { ok: false, reason: 'hyperparams 须为对象' };
  }
  return {
    ok: true,
    value: {
      id: r.id as RlTemplate['id'],
      name: r.name,
      scenarios: r.scenarios as readonly string[],
      base_type: r.base_type,
      hyperparams: r.hyperparams as Record<string, unknown>,
      scalerlNotes: Array.isArray(r.scalerlNotes) ? (r.scalerlNotes as string[]) : [],
    },
  };
}

/** 注册外部场景模板（同 id 覆盖——幂等） */
function upsertExternalTemplate(t: TrainScenarioTemplate): void {
  const i = loadedExternalTemplates.findIndex((x) => x.id === t.id);
  if (i >= 0) loadedExternalTemplates[i] = t;
  else loadedExternalTemplates.push(t);
}

/**
 * 装载外部配方目录（路径传入 → schema 校验 → 注册进查找面）。
 *
 * 目录约定：`<dir>/scenarios/*.json`（TrainScenarioTemplate 数组或单对象）
 * + `<dir>/rl/*.json`（RlTemplate 数组或单对象）。校验不通过的逐条跳过
 * 并记 skipped（不中断整批——装载面是缰绳，坏资产不该炸好资产）。
 * 可重复调用（同 id 覆盖，幂等）。
 */
export function loadExternalRecipes(dir: string): LoadExternalRecipesResult {
  const result: LoadExternalRecipesResult = {
    dir,
    scenarioTemplatesLoaded: 0,
    rlRecipesLoaded: 0,
    skipped: [],
  };

  const scenarioDir = join(dir, 'scenarios');
  if (existsSync(scenarioDir)) {
    for (const f of readdirSync(scenarioDir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const raw = JSON.parse(readFileSync(join(scenarioDir, f), 'utf-8')) as unknown;
        const arr = Array.isArray(raw) ? raw : [raw];
        for (const item of arr) {
          const check = validateExternalTemplate(item);
          if (!check.ok) {
            result.skipped.push({ file: `scenarios/${f}`, reason: check.reason });
            continue;
          }
          upsertExternalTemplate(check.value);
          result.scenarioTemplatesLoaded += 1;
        }
      } catch (err) {
        result.skipped.push({ file: `scenarios/${f}`, reason: `JSON 解析失败：${(err as Error).message}` });
      }
    }
  }

  const rlDir = join(dir, 'rl');
  if (existsSync(rlDir)) {
    const recipes: RlTemplate[] = [];
    for (const f of readdirSync(rlDir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const raw = JSON.parse(readFileSync(join(rlDir, f), 'utf-8')) as unknown;
        const arr = Array.isArray(raw) ? raw : [raw];
        for (const item of arr) {
          const check = validateExternalRlRecipe(item);
          if (!check.ok) {
            result.skipped.push({ file: `rl/${f}`, reason: check.reason });
            continue;
          }
          recipes.push(check.value);
          result.rlRecipesLoaded += 1;
        }
      } catch (err) {
        result.skipped.push({ file: `rl/${f}`, reason: `JSON 解析失败：${(err as Error).message}` });
      }
    }
    if (recipes.length > 0) registerRlRecipes(recipes);
  }

  return result;
}

// ════════════════════════════════════════
// 查找面（参考模板 + 外部装载统一消费）
// ════════════════════════════════════════

/** 全量查找面（外部在前——同 id 外部覆盖参考；内部消费统一入口） */
function allTemplates(): TrainScenarioTemplate[] {
  return [...loadedExternalTemplates, ...TRAIN_SCENARIO_TEMPLATES];
}

/** 按模板 id 查（未知名返回 null——外部装载面与参考模板统一查找） */
export function findTrainTemplate(id: string): TrainScenarioTemplate | null {
  return allTemplates().find((t) => t.id === id) ?? null;
}

/** 按场景列模板（scenario 省略 = 全量——train templates list 数据面） */
export function listTrainTemplates(scenario?: TrainScenario | string): TrainScenarioTemplate[] {
  const all = allTemplates();
  if (scenario === undefined || scenario === '') return all;
  return all.filter((t) => t.scenario === scenario);
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
  /** 模板 id（如 extraction-qlora——含外部装载配方 id） */
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
 * 流程：查模板（参考 + 外部装载统一查找面）→ MoE 校验（moe 时校验
 * target_modules 覆盖 expert 矩阵，缺失抛错带修复提示）→ 按 method 构建
 * 产物：
 *   - qlora → buildQloraTemplate 产出 Oumi 配置（algorithm 映射 sft 通道）
 *   - sft/dpo → hyperparams 骨架直出（协议透传）
 *
 * @throws 模板不存在 / MoE expert 矩阵覆盖校验失败（错误信息含修复提示）
 */
export function instantiateTrainTemplate(input: InstantiateTrainTemplateInput): TrainTemplateInstance {
  const template = findTrainTemplate(input.templateId);
  if (!template) {
    throw new Error(
      `[train-templates] 未知模板：${input.templateId}（可查 train templates list——参考模板 + 外部装载配方）`,
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
export { instantiateRlTemplate, RL_TEMPLATES, findRlTemplate, listRlTemplates, registerRlRecipes } from './rl-templates';
export type { RlTemplate, RlRecipeId, RlTemplateInstance, RlTemplateInstantiateInput } from './rl-templates';
// MoE 防护常量再导出（qlora-template 单一事实源——测试与 CLI 消费同源）
export { DENSE_TARGET_MODULES, MOE_TARGET_MODULES } from './qlora-template';
