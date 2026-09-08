// rl-templates.ts · v1.4.6 边界收缩 · RL 配方装载面（参考配方 + 外部装载 + ScaleRL 对齐参数）
//
// 定位：模板库的 RL 算法维度——阶段 2 主路线是 RL（v1.4.6 已提 GRPO 大
// 采样组），模板库缺 RL 模板 = 主路线裸奔。三组配方：
//   - grpo：组相对策略优化（Group Relative Policy Optimization）——
//     无 value model，同 prompt 组内 reward 归一化做 advantage
//   - dapo：解耦 clip + 动态采样（Decoupled Alignment Policy Optimization）——
//     clip-higher 放宽高概率 token、过采样补偿全对/全错组
//   - cispo：截断重要性采样策略优化（Clipped Importance Sampling Policy
//     Optimization）——完整 token 级 clip，超长响应不整条丢弃
//
// 边界收缩拍板（训练资产归商业侧）：本文件只留 grpo 参考配方（schema
// 活样例）+ SCALE_* 缩放律对齐参数（缰绳面——与 scale-curve 同族）+
// 实例化构造器；dapo/cispo 全量配方迁商业仓经 loadExternalRecipes 的
// rl/*.json 装载（registerRlRecipes 注册——同 id 覆盖，幂等）。
//
// ScaleRL 四技巧参数（arxiv 2510.13786 论文配方可复现——注释级标注）：
//   ① batch 级 advantage 归一化（advantage_estimator: grpo + batch 归一窗口）
//   ② CISPO clip ε（clip_eps 参数化——dapo/cispo 差异化取值）
//   ③ 零方差组跳过（skip_zero_variance_groups——全对/全错组不贡献梯度）
//   ④ LR warmup（warmup_steps_ratio——RL 阶段比 SFT 更需要防早期崩）
//
// 参考形态：slime `--advantage-estimator` choices（GRPO/CISPO 上游原生）+
// verl `algorithm.adv_estimator`。实例化产物是 hyperparams 对象——可直接
// 被 train_submit 的 hyperparams 字段消费（协议透传，Node 不解释具体键）。
//
// 纯规则驱动（LLM 不参与生成）。

// ════════════════════════════════════════
// ScaleRL 四技巧参数（论文默认值——单一事实源）
// ════════════════════════════════════════

/** ScaleRL 技巧 ①：advantage 归一化窗口（batch 级——组内归一再跨 batch 归一） */
export const SCALE_ADVANTAGE_NORMALIZATION = 'batch' as const;

/** ScaleRL 技巧 ②：CISPO clip ε 默认值（token 级截断阈值） */
export const SCALE_CISPO_CLIP_EPS = 0.2 as const;

/** ScaleRL 技巧 ③：零方差组跳过（全对/全错组 advantage 恒 0——不进梯度） */
export const SCALE_SKIP_ZERO_VARIANCE = true as const;

/** ScaleRL 技巧 ④：LR warmup 比例（RL 早期防崩——对齐 SFT warmup 惯例） */
export const SCALE_WARMUP_RATIO = 0.03 as const;

// ════════════════════════════════════════
// RL 配方模板
// ════════════════════════════════════════

/** RL 配方标识（grpo / dapo / cispo——外部装载可扩展） */
export type RlRecipeId = 'grpo' | 'dapo' | 'cispo';

/** RL 配方模板（描述 + 默认超参骨架——实例化时按场景覆盖） */
export interface RlTemplate {
  id: RlRecipeId | string;
  /** 配方名（人读） */
  name: string;
  /** 适用场景（引导选型——推导产物引用） */
  scenarios: readonly string[];
  /** 基座类型标注（dense/moe——与场景模板同字段） */
  base_type: 'dense' | 'moe';
  /** 默认超参（Oumi/verl 透传键——train_submit hyperparams 直接消费） */
  hyperparams: Record<string, unknown>;
  /** ScaleRL 四技巧说明（人读注释——实例化产物原样携带） */
  scalerlNotes: readonly string[];
}

/**
 * RL 参考配方（grpo——schema 活样例与缺省演示）。
 *
 * dapo/cispo 全量配方是训练资产，归商业侧外部配方目录（经
 * loadExternalRecipes 的 rl/*.json 装载）。保留 grpo 参考配方保证：
 * RL 通道实例化缺省可用、`train templates` RL 维度非空、schema 有活样例。
 */
export const RL_TEMPLATES: readonly RlTemplate[] = [
  {
    id: 'grpo',
    name: 'GRPO 组相对策略优化',
    scenarios: ['可验证奖励任务（数学/代码/规则判定）', '无 value model 的轻量 RLHF'],
    base_type: 'dense',
    hyperparams: {
      advantage_estimator: 'grpo',
      // ScaleRL 技巧 ①：batch 级 advantage 归一化（跨组归一稳方差）
      advantage_normalization: SCALE_ADVANTAGE_NORMALIZATION,
      // ScaleRL 技巧 ③：零方差组跳过
      skip_zero_variance_groups: SCALE_SKIP_ZERO_VARIANCE,
      // ScaleRL 技巧 ④：LR warmup
      warmup_steps_ratio: SCALE_WARMUP_RATIO,
      clip_eps: SCALE_CISPO_CLIP_EPS,
      group_size: 8,
      beta: 0.04,
      max_prompt_len: 512,
      max_response_len: 1024,
    },
    scalerlNotes: [
      '技巧① batch 级 advantage 归一化：advantage_normalization=batch',
      '技巧③ 零方差组跳过：skip_zero_variance_groups=true',
      '技巧④ LR warmup：warmup_steps_ratio=0.03',
    ],
  },
];

// ════════════════════════════════════════
// 外部配方装载面（loadExternalRecipes 消费——商业侧配方经此注册）
// ════════════════════════════════════════

/** 已注册的外部 RL 配方（registerRlRecipes——同 id 覆盖，幂等） */
const loadedRlRecipes: RlTemplate[] = [];

/** 按配方 id 查（含外部装载——未知名返回 null） */
export function findRlTemplate(id: string): RlTemplate | null {
  return [...loadedRlRecipes, ...RL_TEMPLATES].find((t) => t.id === id) ?? null;
}

/** 列出全部 RL 配方（外部装载在前——同 id 外部覆盖参考） */
export function listRlTemplates(): RlTemplate[] {
  return [...loadedRlRecipes, ...RL_TEMPLATES];
}

/** 注册外部 RL 配方（loadExternalRecipes 调用——同 id 覆盖，幂等） */
export function registerRlRecipes(recipes: RlTemplate[]): void {
  for (const r of recipes) {
    const i = loadedRlRecipes.findIndex((x) => x.id === r.id);
    if (i >= 0) loadedRlRecipes[i] = r;
    else loadedRlRecipes.push(r);
  }
}

// ════════════════════════════════════════
// RL 模板实例化
// ════════════════════════════════════════

/** RL 模板实例化输入 */
export interface RlTemplateInstantiateInput {
  /** 配方 id（grpo/dapo/cispo——含外部装载配方） */
  recipe: RlRecipeId | string;
  /** 基座模型名 */
  baseModel: string;
  /** 基座类型（dense/moe——实例化记录同字段标注） */
  baseType: 'dense' | 'moe';
  /** 训练数据路径 */
  dataPath: string;
  /** 覆盖超参（浅合并——场景推导的 LR/组大小等覆盖默认值） */
  overrides?: Record<string, unknown>;
}

/** RL 模板实例化结果（可直接被 train_submit 消费） */
export interface RlTemplateInstance {
  /** 实例化 schema 版本 */
  schemaVersion: 'v1';
  /** 使用的配方 */
  recipe: RlRecipeId;
  /** 基座类型标注 */
  base_type: 'dense' | 'moe';
  /** train_submit 算法字段（RL 配方均映射 grpo 算法通道） */
  algorithm: 'grpo';
  baseModel: string;
  dataPath: string;
  /** 合并后超参（ScaleRL 四技巧键齐全——train_submit hyperparams 直填） */
  hyperparams: Record<string, unknown>;
  /** train_submit 提交入口提示（人读——CLI/MCP 展示） */
  submitHint: string;
  /** ScaleRL 技巧清单（实例化产物携带——审计可读） */
  scalerlNotes: readonly string[];
}

/**
 * 实例化 RL 配方模板（浅合并覆盖——确定性输出）。
 *
 * 未知名配方抛错（快速失败——CLI 与 MCP 调用方结构化捕获）。
 * RL 配方统一走协议 algorithm='grpo' 通道（协议枚举 sft/dpo/grpo 三值，
 * RL 细分配方在 hyperparams.advantage_estimator 区分——协议即版本边界
 * 不为细分算法扩枚举）。
 */
export function instantiateRlTemplate(input: RlTemplateInstantiateInput): RlTemplateInstance {
  const template = findRlTemplate(input.recipe);
  if (!template) {
    throw new Error(
      `[rl-templates] 未知 RL 配方：${input.recipe}（可选：grpo / dapo / cispo 或经 loadExternalRecipes 装载的外部配方）`,
    );
  }
  const hyperparams = { ...template.hyperparams, ...(input.overrides ?? {}) };
  return {
    schemaVersion: 'v1',
    recipe: template.id as RlRecipeId,
    base_type: input.baseType,
    algorithm: 'grpo',
    baseModel: input.baseModel,
    dataPath: input.dataPath,
    hyperparams,
    submitHint: `train_submit（algorithm=grpo，hyperparams.advantage_estimator=${template.id}）`,
    scalerlNotes: template.scalerlNotes,
  };
}
