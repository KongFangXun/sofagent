// ============================================================
// decision-channel.ts · L1 语义分类的可插拔判定源协议（v1.5.4 · 第二章）
// ============================================================
//
// 定位：L1 语义分类的**可插拔判定源协议**（研究收编：System One 决策模型
// Jev 启发，2026-09-19 拍板）——引擎定义接口与编排，实现由用户按 TrainChannel
// 同款纪律自带（云端 provider 走用户 key opt-in，默认关闭；本地部署走开源
// 并行约束解码方案：KV cache 广播 + 单次前向出全部字段，数据主权不破）。
//
// **通道而非依赖**：本文件只交**契约**（类型 + 问句校验 + 校准分桶 + 档位语义
// + 审计挂链记录形态），默认实现留空——v1.8.0 在此填默认实现，本版只交契约。
//
// 三问题原语（语义固定，实现可换）：choice / score / noul。
// 批量纪律：同一 state 下的全部问句**一次提交**，实现须单次前向内出全部答案
//   （禁止逐问句多次调用——延迟与槽位占用翻倍，且破坏「不占本地主模型槽位」可测性）。
// 校准契约：分桶温度按「（原语 × 选项数）」分桶拟合；选项数上限 5（超限拆问句）。
// 档位语义（五态 → 执行面）：ALLOW / ASK / ABSTAIN / DENY / SKIP。
// 边界（硬性）：决策模型**不进信任地基**——可被 state 内容操纵的失灵面已知，
//   只坐确定性规则之后的语义兜底层；25 条审计规则判定面零改动。
// ============================================================

import { createHash } from 'crypto';

/** choice 选项数上限（超限拆问句） */
export const MAX_OPTIONS = 5;

/** 判定原语（三问题原语——语义固定，实现可换） */
export type DecisionPrimitive = 'choice' | 'score' | 'noul';

/**
 * 证据就绪度（判据启用门控——未就绪不得启用该判据）。
 *   - structural：结构化解引用齐备（可走 L0 规则面）
 *   - trace：有轨迹证据（可走证据类判据）
 *   - none：无证据（仅可走语义兜底）
 */
export type EvidenceReadiness = 'structural' | 'trace' | 'none';

/**
 * 判定输入 state（待判定语义输入）。
 *
 * - `refs` 供 L0 规则面先判——命中则不进入判定（零模型成本）
 * - `evidenceReadiness` 是判据启用门控：未就绪不得启用该判据
 */
export interface DecisionState {
  /** 待判定语义输入（工作流节点上下文 / 工具调用参数 / 变更描述） */
  text: string;
  /** 结构化解引用（workflow 节点 id / 规则编号）——供 L0 规则面先判 */
  refs?: string[];
  /** 证据就绪度（判据启用门控；未就绪不得启用该判据） */
  evidenceReadiness: EvidenceReadiness;
}

/** 判定问句 */
export interface DecisionQuestion {
  /** 问句标识（回填与留痕用） */
  id: string;
  /** 原语 */
  primitive: DecisionPrimitive;
  /** choice 候选集（选项数 ≤5；必带兜底候选） */
  options?: string[];
  /** choice 兜底候选（须在 options 内——兜底与弃权**分别**留痕） */
  fallback?: string;
  /** score 量程 */
  range?: { min: number; max: number };
}

/** 判定状态（answered / abstained） */
export type DecisionStatus = 'answered' | 'abstained';

/** 弃权原因（三因） */
export type AbstainReason = 'low-confidence' | 'out-of-domain' | 'missing-criteria';

/** 单条判定答案（类型化） */
export interface DecisionAnswer {
  /** 对应问句 id */
  id: string;
  /** 类型化答案（choice→选中项 / score→分值 / noul→boolean 或真值标签） */
  value: string | number | boolean;
  /** 校准后概率 / 置信，[0,1] */
  probability: number;
  /** choice 全候选分布（和 ≈ 1） */
  distribution?: Record<string, number>;
  /** score 区间 */
  interval?: { min: number; max: number };
  /** 答案状态 */
  status: DecisionStatus;
  /** 弃权原因（status=abstained 时有值） */
  abstainReason?: AbstainReason;
}

/** 判定结果（一次前向出全部答案） */
export interface DecisionResult {
  /** 全部问句的类型化答案（与提交的问句集一一对应） */
  answers: DecisionAnswer[];
  /** 判定件代次号（如 sofa-s1m-v2——可追溯「用哪个模型判的」） */
  modelVersion: string;
  /** 本次采用的分桶键（原语 × 选项数——可追溯「哪档校准判的」） */
  tempBucket: string;
  /** 本次判定耗时（ms） */
  latencyMs: number;
}

/**
 * DecisionChannel 接口——`judge(state, questions) → DecisionResult`。
 *
 * 定义方 = 引擎（本仓），实现方 = 判定件提供方（AIR 侧判定件 / 用户自带 provider）。
 * 与 TrainChannel 同族同纪律（通道而非依赖、凭据走引用、实现方自测清单）。
 */
export interface DecisionChannel {
  /** 通道名（审计追溯实现方） */
  readonly name: string;
  /** 一次前向出全部问句的类型化答案 + 校准概率 */
  judge(state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionResult>;
}

/** 档位（五态——判定不直接执行，经授权档位落到执行面） */
export type DecisionGrade = 'ALLOW' | 'ASK' | 'ABSTAIN' | 'DENY' | 'SKIP';

/** 档位阈值（升档判据——阈值由代价反推，见 computeEscalationThreshold） */
export interface GradeThresholds {
  /** ALLOW 最低置信（高置信 + 域内 → 自动放行） */
  allowMinConfidence: number;
  /** ASK 最低置信（中置信 / ⚡ 节点 → 转人批 HITL 中断点） */
  askMinConfidence: number;
  /** 红线命中（规则面先行 → DENY 拦截，优先级最高） */
  redlineHit?: boolean;
  /** ⚡ 节点（强制 ASK——转人批） */
  criticalNode?: boolean;
  /** 是否在判定域内（false → SKIP，不判定，走 L0 兜底） */
  inDomain?: boolean;
}

/** 缺省档位阈值（保守起步——企业按代价反推覆盖） */
export const DEFAULT_GRADE_THRESHOLDS: Omit<GradeThresholds, 'redlineHit' | 'criticalNode' | 'inDomain'> = {
  allowMinConfidence: 0.8,
  askMinConfidence: 0.5,
};

/** 判定通道不可用（fail-closed——降级 L0 规则面兜底，不得静默放行） */
export class DecisionChannelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionChannelUnavailableError';
  }
}

/**
 * 问句集校验（fail-closed——非法问句集拒绝提交，不当成空问句静默放行）。
 *
 * 判据：
 *   - id 必填非空且唯一
 *   - choice：options 必填、1..MAX_OPTIONS 项、fallback 必填且在 options 内
 *   - score：range 必填且 min < max
 *   - noul：无附加约束
 */
export function validateQuestions(questions: readonly DecisionQuestion[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  if (questions.length === 0) issues.push('问句集为空——至少一个问句');
  questions.forEach((q, i) => {
    const tag = q.id ? `问句 ${q.id}` : `问句 #${i}`;
    if (typeof q.id !== 'string' || q.id.trim() === '') {
      issues.push(`${tag} 缺 id`);
    } else if (seen.has(q.id)) {
      issues.push(`${tag} id 重复`);
    } else {
      seen.add(q.id);
    }
    if (q.primitive === 'choice') {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        issues.push(`${tag}（choice）缺 options`);
      } else if (q.options.length > MAX_OPTIONS) {
        issues.push(`${tag}（choice）选项数 ${q.options.length} 超上限 ${MAX_OPTIONS}`);
      }
      if (typeof q.fallback !== 'string' || q.fallback === '') {
        issues.push(`${tag}（choice）缺兜底候选 fallback`);
      } else if (Array.isArray(q.options) && !q.options.includes(q.fallback)) {
        issues.push(`${tag}（choice）兜底候选「${q.fallback}」不在 options 内`);
      }
    } else if (q.primitive === 'score') {
      if (!q.range || typeof q.range.min !== 'number' || typeof q.range.max !== 'number') {
        issues.push(`${tag}（score）缺 range`);
      } else if (q.range.min >= q.range.max) {
        issues.push(`${tag}（score）量程非法（min 须 < max）`);
      }
    } else if (q.primitive !== 'noul') {
      issues.push(`${tag} 原语非法「${String(q.primitive)}」`);
    }
  });
  return issues;
}

/** 分桶键（原语 × 选项数——校准温度按此分桶拟合） */
export function tempBucketKey(primitive: DecisionPrimitive, optionCount = 0): string {
  return `${primitive}×${optionCount}`;
}

/** 从「问句 + 答案」反推本次分桶键（choice 取分布项数；score/noul 选项数记 0） */
export function resultBucketKey(question: DecisionQuestion, answer: DecisionAnswer): string {
  const count = question.primitive === 'choice'
    ? Object.keys(answer.distribution ?? {}).length
    : 0;
  return tempBucketKey(question.primitive, count);
}

/**
 * 升档判据：`confidence < 1 − 升级成本/判错代价` ⇒ 向上一档升级
 * （本地 → 云端 → 人审）。阈值**由代价反推**，不由拍脑袋常数给定。
 *
 * @param escalateCost 升级成本（升一档的代价）
 * @param mistakeCost 判错代价（判错一次的代价；<=0 时无升档依据 → 返回 0）
 * @returns 升档阈值（[0,1] 内）
 */
export function computeEscalationThreshold(escalateCost: number, mistakeCost: number): number {
  if (!(mistakeCost > 0)) return 0;
  const ratio = escalateCost / mistakeCost;
  const t = 1 - ratio;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * 档位判定（五态 → 执行面）。
 *
 * 优先级：DENY（红线命中，规则面先行）> SKIP（不在判定域内）> ABSTAIN（弃权三因）
 * > ASK（中置信 / ⚡ 节点）> ALLOW（高置信 + 域内）。
 */
export function gradeOf(answer: DecisionAnswer, thresholds: GradeThresholds): DecisionGrade {
  if (thresholds.redlineHit) return 'DENY';
  if (thresholds.inDomain === false) return 'SKIP';
  if (answer.status === 'abstained') return 'ABSTAIN';
  if (thresholds.criticalNode) return 'ASK';
  if (answer.probability >= thresholds.allowMinConfidence) return 'ALLOW';
  if (answer.probability >= thresholds.askMinConfidence) return 'ASK';
  return 'ABSTAIN';
}

/** state 摘要（**不落原文**——防敏感信息入链） */
export function stateDigest(state: DecisionState): string {
  return createHash('sha256').update(state.text, 'utf-8').digest('hex');
}

/** 审计挂链记录（落 decision-log，随审计链留痕——类型化输出天然可审计） */
export interface DecisionAuditRecord {
  /** state 摘要（不落原文） */
  stateDigest: string;
  /** 问句 id 集 */
  questionIds: string[];
  /** 答案 / 概率 / 状态 / 弃权原因（逐条） */
  answers: Array<{
    id: string;
    value: string | number | boolean;
    probability: number;
    status: DecisionStatus;
    abstainReason?: AbstainReason;
  }>;
  /** 判定件代次号（可追溯「用哪个模型判的」） */
  modelVersion: string;
  /** 本次采用的分桶键（可追溯「哪档校准判的」） */
  tempBucket: string;
  /** 是否升档 */
  escalate: boolean;
  /** 升档阈值（由代价反推） */
  threshold: number;
}

/**
 * 构造审计挂链记录（stateDigest + questionIds + answer/probability/status/
 * abstainReason + modelVersion/tempBucket + escalate/threshold）。
 */
export function toAuditRecord(
  state: DecisionState,
  questions: readonly DecisionQuestion[],
  result: DecisionResult,
  opts: { threshold: number; escalate: boolean },
): DecisionAuditRecord {
  return {
    stateDigest: stateDigest(state),
    questionIds: questions.map((q) => q.id),
    answers: result.answers.map((a) => ({
      id: a.id,
      value: a.value,
      probability: a.probability,
      status: a.status,
      ...(a.abstainReason ? { abstainReason: a.abstainReason } : {}),
    })),
    modelVersion: result.modelVersion,
    tempBucket: result.tempBucket,
    escalate: opts.escalate,
    threshold: opts.threshold,
  };
}

/**
 * 未配置判定通道（本版只交契约——默认实现留 v1.8.0）。
 * judge 抛 DecisionChannelUnavailableError——上层 fail-closed 降级 L0 规则面兜底，
 * **不得静默放行**。
 */
export class UnconfiguredDecisionChannel implements DecisionChannel {
  readonly name = 'unconfigured';

  async judge(_state: DecisionState, _questions: DecisionQuestion[]): Promise<DecisionResult> {
    throw new DecisionChannelUnavailableError(
      '判定通道未配置（本版只交契约——默认实现留 v1.8.0）；fail-closed：降级 L0 规则面兜底',
    );
  }
}

/** 缺省未配置通道工厂 */
export function createUnconfiguredDecisionChannel(): DecisionChannel {
  return new UnconfiguredDecisionChannel();
}
