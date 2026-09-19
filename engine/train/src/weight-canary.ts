// weight-canary.ts · v1.5.0 T9 第九章 · 权重灰度发布 AB（分流 + 指标对比 + 劣化回退）
//
// 定位：session 承接（T7）→ 蒸馏 → 新 LoRA 权重后，怎么安全上线？
// 全量切新权重 = 拿生产流量赌训练质量。本件交付灰度面：
//   - 新旧 LoRA 适配器按流量比例分流服务（如 95% 旧 / 5% 新）
//   - 灰度期指标（正确率/拒绝率/成本）对比可查
//   - 劣化超阈 → 自动回退全量旧权重（**复用 rollback-weights 语义**——
//     train-continuous.ts rollbackWeights 签名 (modelName) => {ok, message}）
//   - 回退事件 HMAC 留痕（audit 链挂链——由调用方 emitDecision 执行，
//     本文件产出留痕载荷）
//
// 纯函数判定（分流/劣化/回退全量可注入测试）——I/O 面（权重切换/审计
// 落盘）经依赖注入，与 train-continuous ContinuousDeps 同一设计哲学。

import { createHmac, createHash } from 'crypto';

// ══════════════════════════════════════
// 分流（流量比例灰度）
// ══════════════════════════════════════

/** 灰度配置 */
export interface CanaryConfig {
  /** 基座模型名（新旧适配器同基座——切换面在适配器层） */
  modelName: string;
  /** 旧权重（当前生产适配器——回退目标） */
  oldAdapter: string;
  /** 新权重（灰度候选适配器） */
  newAdapter: string;
  /** 新权重流量百分比（0-100——如 5 = 95 旧 / 5 新） */
  newWeightPercent: number;
}

/** 分流判定结果 */
export interface RouteVerdict {
  /** 命中适配器（old/new） */
  adapter: string;
  /** 是否灰度臂 */
  isNew: boolean;
}

/**
 * 单请求分流判定（纯函数——hash 键稳定分流：同 sessionId 恒定同臂，
 * 避免同会话在两臂间抖动导致上下文漂移）。
 *
 * 更名避歧（v1.5.0 TASK-32）：orchestrator 另有同名 routeRequest
 * （语义路由，route/route-request.ts）——同名不同物，裸符号 grep 会假阳性，
 * 故 train 灰度分流导出更名为 canaryRouteRequest。
 *
 * @param key 分流键（sessionId/requestId——hash 输入）
 * @param config 灰度配置
 */
export function canaryRouteRequest(key: string, config: CanaryConfig): RouteVerdict {
  const percent = Math.min(100, Math.max(0, config.newWeightPercent));
  const h = createHash('sha256').update(String(key)).digest();
  // 取 hash 前 4 字节 → [0, 100) 均匀桶
  const bucket = h.readUInt32BE(0) % 10_000 / 100;
  const isNew = bucket < percent;
  return {
    adapter: isNew ? config.newAdapter : config.oldAdapter,
    isNew,
  };
}

// ══════════════════════════════════════
// 灰度指标（正确率/拒绝率/成本——第九章三指标）
// ══════════════════════════════════════

/** 单臂累计指标 */
export interface ArmMetrics {
  /** 请求数 */
  requests: number;
  /** 正确响应数（eval/验收判过——正确率分子） */
  correct: number;
  /** 拒绝响应数（安全拒答——拒绝率分子；蒸馏模型常见劣化形态） */
  refusals: number;
  /** 累计成本 USD */
  costUsd: number;
}

/** 空指标（起点） */
export function emptyArmMetrics(): ArmMetrics {
  return { requests: 0, correct: 0, refusals: 0, costUsd: 0 };
}

/** 逐请求累计（纯函数——返回新对象不原地改） */
export function accumulateMetrics(arm: ArmMetrics, ev: { correct: boolean; refused: boolean; costUsd: number }): ArmMetrics {
  return {
    requests: arm.requests + 1,
    correct: arm.correct + (ev.correct ? 1 : 0),
    refusals: arm.refusals + (ev.refused ? 1 : 0),
    costUsd: arm.costUsd + ev.costUsd,
  };
}

/** 派生比率（正确率/拒绝率/单均成本——除零给 0） */
export function deriveRates(arm: ArmMetrics): {
  accuracy: number;
  refusalRate: number;
  costPerRequest: number;
} {
  const d = arm.requests > 0 ? arm.requests : 1;
  return {
    accuracy: arm.correct / d,
    refusalRate: arm.refusals / d,
    costPerRequest: arm.costUsd / d,
  };
}

// ══════════════════════════════════════
// 劣化判定 + 回退
// ══════════════════════════════════════

/** 劣化阈值（外部化——对齐 dataset-validator 模式） */
export interface DeteriorationThresholds {
  /** 正确率最大允许降幅（new < old × (1 - maxAccuracyDrop) 即劣化——0.02 = 降 2 个点） */
  maxAccuracyDrop: number;
  /** 拒绝率最大允许增幅（new > old × (1 + maxRefusalRise) 即劣化） */
  maxRefusalRise: number;
  /** 单均成本最大允许增幅（同上形态） */
  maxCostRise: number;
  /** 最小样本量（低于此值不判——统计噪声保护，缺省 30） */
  minSampleSize: number;
}

/** 缺省阈值（保守起步） */
export const DEFAULT_DETERIORATION_THRESHOLDS: DeteriorationThresholds = {
  maxAccuracyDrop: 0.02,
  maxRefusalRise: 0.10,
  maxCostRise: 0.20,
  minSampleSize: 30,
};

/** 劣化判定结果 */
export interface DeteriorationVerdict {
  /** 是否劣化（触发回退） */
  deteriorated: boolean;
  /** 命中的劣化维度（人读原因——入审计） */
  reasons: string[];
  /** 样本量是否充足（不足时不判劣化——防噪声误杀） */
  sufficientSamples: boolean;
}

/**
 * 劣化判定（纯函数——新旧两臂指标对比三维度）。
 *
 * 样本量不足（任一臂 < minSampleSize）→ 不判劣化（sufficientSamples=false）；
 * 三维度任一超阈 → deteriorated=true，reasons 逐条给出人读依据。
 */
export function judgeDeterioration(
  oldArm: ArmMetrics,
  newArm: ArmMetrics,
  thresholds: DeteriorationThresholds = DEFAULT_DETERIORATION_THRESHOLDS,
): DeteriorationVerdict {
  const sufficient = oldArm.requests >= thresholds.minSampleSize && newArm.requests >= thresholds.minSampleSize;
  if (!sufficient) {
    return {
      deteriorated: false,
      reasons: [`样本量不足（old=${oldArm.requests} / new=${newArm.requests} < ${thresholds.minSampleSize}）——统计噪声保护，不判劣化`],
      sufficientSamples: false,
    };
  }
  const oldRates = deriveRates(oldArm);
  const newRates = deriveRates(newArm);
  const reasons: string[] = [];

  if (newRates.accuracy < oldRates.accuracy * (1 - thresholds.maxAccuracyDrop)) {
    reasons.push(
      `正确率劣化：新 ${(newRates.accuracy * 100).toFixed(1)}% < 旧 ${(oldRates.accuracy * 100).toFixed(1)}% × (1 - ${thresholds.maxAccuracyDrop})` +
      `（允许下限 ${(oldRates.accuracy * (1 - thresholds.maxAccuracyDrop) * 100).toFixed(1)}%）`,
    );
  }
  if (newRates.refusalRate > oldRates.refusalRate * (1 + thresholds.maxRefusalRise)) {
    reasons.push(
      `拒绝率劣化：新 ${(newRates.refusalRate * 100).toFixed(1)}% > 旧 ${(oldRates.refusalRate * 100).toFixed(1)}% × (1 + ${thresholds.maxRefusalRise})` +
      `（允许上限 ${(oldRates.refusalRate * (1 + thresholds.maxRefusalRise) * 100).toFixed(1)}%）`,
    );
  }
  if (newRates.costPerRequest > oldRates.costPerRequest * (1 + thresholds.maxCostRise)) {
    reasons.push(
      `成本劣化：新单均 $${newRates.costPerRequest.toFixed(4)} > 旧 $${oldRates.costPerRequest.toFixed(4)} × (1 + ${thresholds.maxCostRise})`,
    );
  }
  return { deteriorated: reasons.length > 0, reasons, sufficientSamples: true };
}

// ══════════════════════════════════════
// 回退执行（复用 rollback-weights 语义 + HMAC 留痕）
// ══════════════════════════════════════

/** 回退执行面（复用 train-continuous rollbackWeights 签名——模型名 → 回退结果） */
export type RollbackWeightsFn = (modelName: string) => Promise<{ ok: boolean; message: string }>;

/** 回退事件留痕载荷（HMAC 签名对象——调用方 emitDecision 消费） */
export interface RollbackAuditPayload {
  /** 事件类型（固定 weight-canary-rollback） */
  kind: 'weight-canary-rollback';
  /** 回退时间（ISO） */
  ts: string;
  modelName: string;
  /** 回退目标（旧适配器——全量切回） */
  rolledBackTo: string;
  /** 被回退的灰度适配器 */
  canaryAdapter: string;
  /** 劣化依据（judgeDeterioration reasons——人读可追溯） */
  reasons: string[];
  /** 劣化时刻的两臂指标快照 */
  metricsSnapshot: { old: ArmMetrics; new: ArmMetrics };
  /** 回退执行结果 */
  rollbackResult: { ok: boolean; message: string };
}

/** 回退编排结果 */
export interface RollbackOutcome {
  /** 是否已执行回退（劣化未触发/样本不足 → false） */
  rolledBack: boolean;
  /** 回退执行是否成功（rolledBack=true 时有意义） */
  rollbackOk: boolean;
  message: string;
  /** 留痕载荷（rolledBack=true 时给出——HMAC 签名在 payload 层） */
  auditPayload?: RollbackAuditPayload;
  /** HMAC 签名（auditPayload 的 canonical JSON 签名——挂链用） */
  auditSignature?: string;
}

/**
 * 灰度巡检：判劣化 → 触发回退 → 产留痕载荷。
 *
 * 回退语义复用 v1.4.4 rollback-weights（签名同 train-continuous.
 * ContinuousDeps.rollbackWeights）：劣化 → 全量切回旧适配器。
 * HMAC 留痕：RollbackAuditPayload canonical JSON（key 字典序）经
 * hmacKey 签名——调用方连同 payload 一起 emitDecision 入审计链。
 *
 * @param rollbackWeights 回退执行面（注入——daemon 装配时绑
 *        train-deliverable / model-switch 的 rollback-weights 实现）
 * @param hmacKey 留痕签名密钥（缺省无签名——生产装配必须注入）
 */
export async function runCanaryCheck(
  config: CanaryConfig,
  oldArm: ArmMetrics,
  newArm: ArmMetrics,
  opts: {
    thresholds?: DeteriorationThresholds;
    rollbackWeights?: RollbackWeightsFn;
    hmacKey?: string;
    now?: () => string;
  } = {},
): Promise<RollbackOutcome> {
  const thresholds = opts.thresholds ?? DEFAULT_DETERIORATION_THRESHOLDS;
  const verdict = judgeDeterioration(oldArm, newArm, thresholds);

  if (!verdict.deteriorated) {
    return {
      rolledBack: false,
      rollbackOk: false,
      message: verdict.sufficientSamples
        ? '灰度指标健康（三维度均在阈内）——继续灰度'
        : `样本量不足不判劣化——继续灰度积累样本（${verdict.reasons[0]}）`,
    };
  }

  // 劣化触发 → 复用 rollback-weights 语义回退全量旧权重
  if (!opts.rollbackWeights) {
    return {
      rolledBack: false,
      rollbackOk: false,
      message: `劣化已判定但 rollbackWeights 未注入（人工回滚指引：model_switch action=rollback-weights）——依据：${verdict.reasons.join('；')}`,
    };
  }
  const rb = await opts.rollbackWeights(config.modelName);
  const payload: RollbackAuditPayload = {
    kind: 'weight-canary-rollback',
    ts: (opts.now ?? (() => new Date().toISOString()))(),
    modelName: config.modelName,
    rolledBackTo: config.oldAdapter,
    canaryAdapter: config.newAdapter,
    reasons: verdict.reasons,
    metricsSnapshot: { old: oldArm, new: newArm },
    rollbackResult: { ok: rb.ok, message: rb.message },
  };
  const signature = opts.hmacKey
    ? createHmac('sha256', opts.hmacKey).update(canonicalJson(payload)).digest('hex')
    : undefined;

  return {
    rolledBack: true,
    rollbackOk: rb.ok,
    message: rb.ok
      ? `⚠ 灰度劣化已触发自动回退（全量切回 ${config.oldAdapter}）：${verdict.reasons.join('；')}`
      : `⚠ 灰度劣化已判定但回退执行失败（${rb.message}）——需人工介入：${verdict.reasons.join('；')}`,
    auditPayload: payload,
    auditSignature: signature,
  };
}

/** canonical JSON（key 字典序——与 audit 链 stableStringify 同哲学） */
function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && v.constructor === Object) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = walk((v as Record<string, unknown>)[k]);
      }
      return sorted;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}
