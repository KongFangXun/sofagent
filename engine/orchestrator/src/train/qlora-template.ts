// qlora-template.ts · v1.4.4 第四章 · QLoRA 配置模板（Oumi 格式）
//
// 定位：训练配置生成的「参数面」——场景模板（train-templates）选定算法族后，
// 本文件产出 Oumi 格式的训练配置对象（data/model/training/peft/eval 五节）。
// Oumi 是主流生产后训练框架之一（v1.3.6 协议调研清单成员），配置结构
// 以其 YAML 惯例为骨架：纯对象输出（YAML 序列化由调用方决定——CLI 落盘
// .yaml 时用 JSON 兼容结构即可）。
//
// MoE 基座注意（v1.4.4 第四章拍板）：模板带 base_type: dense/moe 标注；
// moe 基座的 LoRA target_modules 必须显式覆盖 expert 矩阵——校验在
// train-templates.ts 的 instantiateTrainTemplate（本文件只提供两组
// 预置 target_modules 常量，单一事实源）。
//
// 纯规则驱动（LLM 不参与生成）——对齐 compose-interview 模式。

// ════════════════════════════════════════
// LoRA target_modules 预置（dense / moe 两型）
// ════════════════════════════════════════

/**
 * dense 基座默认 LoRA 挂载点（Qwen3 / Llama / R1-Distill 同族自注意力投影）。
 * 阶段 2 当前基座（Qwen3/R1-Distill）均为 dense——此组是缺省内建值。
 */
export const DENSE_TARGET_MODULES: readonly string[] = [
  'q_proj',
  'k_proj',
  'v_proj',
  'o_proj',
] as const;

/**
 * MoE 基座完整 LoRA 挂载点（attention 投影 + expert FFN 三矩阵）。
 *
 * MoE 基座只挂 attention（q/k/v/o_proj）会漏掉 expert 矩阵——gate_proj/
 * up_proj/down_proj 缺失时 LoRA 只调路由不调专家容量，训练效果断崖。
 * 商业侧后训练内部规范 §5.2 对齐（2026-08-26 拍板）。
 */
export const MOE_TARGET_MODULES: readonly string[] = [
  // attention 投影（与 dense 同组）
  'q_proj',
  'k_proj',
  'v_proj',
  'o_proj',
  // expert FFN 三矩阵（MoE 专属——缺失即校验拒绝）
  'gate_proj',
  'up_proj',
  'down_proj',
] as const;

// ════════════════════════════════════════
// Oumi 配置模板
// ════════════════════════════════════════

/** QLoRA 配置模板输入（场景模板实例化时填充） */
export interface QloraTemplateInput {
  /** 基座模型名（如 Qwen3-8B） */
  baseModel: string;
  /** 基座类型（dense / moe——决定 target_modules 预置组与校验路径） */
  baseType: 'dense' | 'moe';
  /** 训练数据路径（train.jsonl / 已版本化数据集目录） */
  dataPath: string;
  /** 验证数据比例（0~1，缺省 0.05） */
  evalSplitRatio?: number;
  /** LoRA rank（缺省 16——8B 级基座经验值） */
  loraRank?: number;
  /** LoRA alpha（缺省 32——rank × 2 惯例） */
  loraAlpha?: number;
  /** LoRA dropout（缺省 0.05） */
  loraDropout?: number;
  /** 学习率（缺省 2e-4——QLoRA 惯例区间） */
  learningRate?: number;
  /** batch size（per-device，缺省 2——QLoRA 4bit 下显存友好） */
  batchSize?: number;
  /** 梯度累积（缺省 8——有效 batch = 16） */
  gradientAccumulation?: number;
  /** 训练轮数（缺省 3） */
  epochs?: number;
  /** 最大序列长度（缺省 2048） */
  maxSeqLen?: number;
  /** 显式覆盖 target_modules（moe 基座必须含 expert 三矩阵——校验在实例化层） */
  targetModules?: readonly string[];
}

/** Oumi 格式 QLoRA 配置（data/model/training/peft/eval 五节） */
export interface QloraOumiConfig {
  /** 配置 schema 版本 */
  schemaVersion: 'v1';
  /** 框架目标（Oumi 格式） */
  framework: 'oumi';
  /** 基座类型标注（dense/moe——实例化校验与审计可读） */
  base_type: 'dense' | 'moe';
  data: {
    train_path: string;
    eval_split_ratio: number;
    max_seq_len: number;
    /** 数据格式（Oumi chat 模板惯例） */
    format: 'chat';
  };
  model: {
    name: string;
    /** 4bit 量化加载（QLoRA 核心特征） */
    load_in_4bit: true;
    dtype: 'bfloat16';
  };
  training: {
    learning_rate: number;
    per_device_batch_size: number;
    gradient_accumulation_steps: number;
    epochs: number;
    warmup_ratio: number;
    /** 显存优化双开关（QLoRA 标配——对齐失败诊断 OOM 处方） */
    gradient_checkpointing: true;
    paged_adamw_8bit: true;
  };
  peft: {
    method: 'lora';
    r: number;
    alpha: number;
    dropout: number;
    target_modules: string[];
  };
  eval: {
    /** 评估指标（场景模板填充——accuracy/f1/rouge/win_rate 等） */
    metrics: string[];
    eval_interval_steps: number;
  };
}

/**
 * 构建 Oumi 格式 QLoRA 配置（纯函数——确定性输出，同输入同输出）。
 *
 * target_modules 缺省按 baseType 选预置组：dense → attention 四投影；
 * moe → attention + expert 三矩阵（expert 覆盖校验在 instantiateTrainTemplate，
 * 本函数信任调用方已过校验或显式传入）。
 */
export function buildQloraTemplate(input: QloraTemplateInput): QloraOumiConfig {
  const targetModules =
    input.targetModules !== undefined
      ? [...input.targetModules]
      : input.baseType === 'moe'
        ? [...MOE_TARGET_MODULES]
        : [...DENSE_TARGET_MODULES];
  return {
    schemaVersion: 'v1',
    framework: 'oumi',
    base_type: input.baseType,
    data: {
      train_path: input.dataPath,
      eval_split_ratio: input.evalSplitRatio ?? 0.05,
      max_seq_len: input.maxSeqLen ?? 2048,
      format: 'chat',
    },
    model: {
      name: input.baseModel,
      load_in_4bit: true,
      dtype: 'bfloat16',
    },
    training: {
      learning_rate: input.learningRate ?? 2e-4,
      per_device_batch_size: input.batchSize ?? 2,
      gradient_accumulation_steps: input.gradientAccumulation ?? 8,
      epochs: input.epochs ?? 3,
      warmup_ratio: 0.03,
      gradient_checkpointing: true,
      paged_adamw_8bit: true,
    },
    peft: {
      method: 'lora',
      r: input.loraRank ?? 16,
      alpha: input.loraAlpha ?? 32,
      dropout: input.loraDropout ?? 0.05,
      target_modules: targetModules,
    },
    eval: {
      metrics: [],
      eval_interval_steps: 100,
    },
  };
}
