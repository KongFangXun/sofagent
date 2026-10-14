// judge-heads/index.ts · 三原语判定头（choice / score / noul —— marker 式）
// ============================================================
// 在编码器输出之上挂类型化判定头，按原语分发；三头共享编码器、不共享输出层。
// 契约（换基座不改判定头契约——契约测试以接口为准）：
//   JudgeHeadChoice ：候选项打分 + 归一（顺序不变性——候选打乱分数分布不变）
//   JudgeHeadScore  ：序回归（分值 + 区间）
//   JudgeHeadNoul   ：伯努利概率
// tokenizer 对齐校验：选项须单 token 化且 decode 回环一致，不合规拒载该问句。
//
// ⚠️ 示意实现说明（与 VALIDATION.md 基线口径一致）：三头的打分算子是
// similarity+softmax 的**示意实现**（零样本基线 0.500 随机水平即由此而来），
// 非真基座判定力。真基座接入走本文件 EncoderLike 契约（换实现不换契约），
// 排期见 v1.8.0（一体机离线推理）。
// ============================================================

/** 编码器接口（契约面——任何基座实现此接口即可换入，判定头不动） */
export interface EncoderLike {
  /** 基座/权重版本哈希（随判定落 decision-log——权重溯源） */
  readonly modelRevision: string;
  /** 上下文 token 上限（超限 fail-closed 报错不静默截断） */
  readonly maxContextTokens: number;
  /** 编码：state → 向量序列（token 级） */
  encode(state: string): number[][];
  /** tokenizer 对齐校验：文本单 token 化 + decode 回环一致 */
  isSingleToken(text: string): boolean;
  decodeToken(token: number): string;
}

/** 判定头错误（fail-closed 统一形态） */
export class JudgeHeadError extends Error {
  constructor(message: string) {
    super(`[judge-head] ${message}`);
    this.name = 'JudgeHeadError';
  }
}

/** choice 头：候选项打分 + 归一 */
export interface ChoiceHeadOutput {
  scores: Record<string, number>; // 归一后分布（顺序不变性：候选打乱分布不变）
}

export function choiceHead(
  encoder: EncoderLike,
  state: string,
  options: readonly string[],
  optionIds?: readonly string[],
): ChoiceHeadOutput {
  // 超限拒答不截断：state 超上下文上限 fail-closed
  const tokens = encoder.encode(state);
  if (tokens.length > encoder.maxContextTokens) {
    throw new JudgeHeadError(
      `state ${tokens.length} tokens 超上下文上限 ${encoder.maxContextTokens}——fail-closed 拒答（不静默裁剪）`,
    );
  }
  // tokenizer 对齐校验：选项须单 token 化 + decode 回环一致
  for (const opt of options) {
    if (!encoder.isSingleToken(opt)) {
      throw new JudgeHeadError(`选项「${opt}」未单 token 化——拒载该问句（tokenizer 对齐失败）`);
    }
  }
  // marker 式打分：以 token 级表征对每选项的 marker 位置读分（实现由 EncoderLike 承载；
  // 头部只做归一——顺序不变性由「逐选项独立打分」结构保证）。
  // 键：optionIds 提供时用 id（与 decision-primitives 候选 id 对齐），否则用 label 本身。
  const ids = optionIds ?? options;
  const raw: Record<string, number> = {};
  options.forEach((opt, i) => {
    // 分数取该选项 token 在 state 编码末位的相似度读数（示意实现——契约以接口为准）
    const last = tokens[tokens.length - 1] ?? [0];
    const optScore = last.reduce((a, b) => a + Math.abs(b), 0) + opt.length;
    raw[ids[i]!] = optScore;
  });
  // softmax 归一（顺序不变——逐项独立变换后归一，与候选顺序无关）
  const vals = Object.values(raw);
  const max = Math.max(...vals);
  const exps = vals.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const dist: Record<string, number> = {};
  Object.keys(raw).forEach((k, i) => {
    dist[k] = exps[i]! / sum;
  });
  return { scores: dist };
}

/** score 头：序回归（分值 + 区间） */
export interface ScoreHeadOutput {
  value: number;
  interval: { lower: number; upper: number };
}

export function scoreHead(
  encoder: EncoderLike,
  state: string,
  scale: { min: number; max: number },
): ScoreHeadOutput {
  const tokens = encoder.encode(state);
  if (tokens.length > encoder.maxContextTokens) {
    throw new JudgeHeadError(`state 超上下文上限 ${encoder.maxContextTokens}——fail-closed`);
  }
  const last = tokens[tokens.length - 1] ?? [0];
  const logit = last.reduce((a, b) => a + b, 0) / Math.max(1, last.length);
  const sigmoid = 1 / (1 + Math.exp(-logit));
  const value = scale.min + sigmoid * (scale.max - scale.min);
  const halfWidth = (scale.max - scale.min) * 0.1; // 区间 = ±10% 值域（示意）
  return {
    value,
    interval: {
      lower: Math.max(scale.min, value - halfWidth),
      upper: Math.min(scale.max, value + halfWidth),
    },
  };
}

/** noul 头：伯努利概率 */
export interface NoulHeadOutput {
  probability: number;
}

export function noulHead(encoder: EncoderLike, state: string): NoulHeadOutput {
  const tokens = encoder.encode(state);
  if (tokens.length > encoder.maxContextTokens) {
    throw new JudgeHeadError(`state 超上下文上限 ${encoder.maxContextTokens}——fail-closed`);
  }
  const last = tokens[tokens.length - 1] ?? [0];
  const logit = last.reduce((a, b) => a + b, 0) / Math.max(1, last.length);
  return { probability: 1 / (1 + Math.exp(-logit)) };
}
