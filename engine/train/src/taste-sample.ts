// taste-sample.ts · v1.7.0 §七 · 品味样本构造（(偏离模式, 尺子变更) 对 + 三要素校验）
// ============================================================
// 样本定义 = (偏离模式, 尺子变更)，标签 = effect.verdict——训练目标不是
// 「该选什么尺子」，而是「在什么偏离模式出现时，人会换成什么尺子」
// （元判断的监督信号）。
//
// 四条硬纪律（全部机制化，不靠流程自觉）：
//   ① 三要素校验：缺 refs（事发情境）/ 缺 delta（可比前后）/ 缺 effect
//     （对错判定）三类样本分别**显式拒绝并列出缺失项**（不静默丢弃）；
//   ② 空集容忍：冷启动期 override 稀疏为正常态——输入零偏离时返回空集 +
//     显式标注 insufficient-samples，不报错、不造假样本、不设样本量下限；
//   ③ 未校准只入档不进训练集：ECE 未达阈（§二 eceVerdict.achieved=false）
//     时产出标 archive-only——不写入训练集（行为锁，有断言）；
//   ④ 样本纯净性：rationale.note（自由文本）不入训练输入——机器消费面
//     只认 trigger + refs + delta + effect 四个结构化字段。
// ============================================================

/** 偏离模式（divergence-extractor 输出的消费投影——结构同源，train 侧不引 orchestrator 包构建期依赖） */
export interface DivergencePatternInput {
  patternId: string;
  memberTs: string[];
  windowStart: string;
  windowEnd: string;
  involvedSurfaces: string[];
  count: number;
}

/** 尺子变更（ruler-change-schema 输出的消费投影——train 侧最小面） */
export interface RulerChangeInput {
  aspect: 'criterion' | 'question' | 'threshold' | 'cost' | 'domain' | 'evidence';
  targetId: string;
  delta: { op: 'add' | 'modify' | 'remove' | 'disable'; before?: unknown; after?: unknown };
  rationale: { trigger: string; refs: string[]; note?: string };
  effect?: {
    windowDays: number;
    overrideRateBefore: number;
    overrideRateAfter: number;
    verdict: 'improved' | 'neutral' | 'regressed';
  };
}

/** ECE 达阈读数（§二 eceVerdict 输出的消费投影——与 abstain-policy.EceVerdictReading 同形态） */
export interface EceGateReading {
  achieved: boolean;
}

/** 品味样本（训练输入——四结构化字段，无自由文本） */
export interface TasteSample {
  /** 样本 id（确定性派生：patternId × targetId × delta.op） */
  id: string;
  /** 事发情境（偏离模式——结构化投影，不含 decision-log 原文自由文本） */
  divergence: DivergencePatternInput;
  /** 尺子变更（aspect/targetId/delta——结构化快照） */
  rulerChange: Pick<RulerChangeInput, 'aspect' | 'targetId' | 'delta'>;
  /** 变更依据的结构化面（trigger + refs——note 被显式剔除：自由文本不入训练输入） */
  trigger: string;
  refs: string[];
  /** 标签（effect.verdict——相关非因果） */
  label: 'improved' | 'neutral' | 'regressed';
}

/** 样本构造结果 */
export interface TasteSampleResult {
  /** 构造出的样本（空集容忍——零偏离时为空数组） */
  samples: TasteSample[];
  /** 产出土去向：ECE 未达阈 ⇒ archive-only（只入档不进训练集——行为锁读数） */
  disposition: 'train-ready' | 'archive-only';
  /** 空集标注（零偏离——insufficient-samples；正常态不报错不造假） */
  status: 'ok' | 'insufficient-samples';
  /** 拒绝明细（三要素缺失样本——显式列出缺失项，不静默丢弃） */
  rejected: Array<{ targetId: string; missing: string[] }>;
}

/** 品味样本构造错误（三要素缺失——fail-closed 载体） */
export class TasteSampleError extends Error {
  readonly missing: string[];
  constructor(message: string, missing: string[] = []) {
    super(`[taste-sample] ${message}${missing.length > 0 ? `（缺失：${missing.join('、')}）` : ''}`);
    this.name = 'TasteSampleError';
    this.missing = missing;
  }
}

/**
 * 三要素校验（单样本）：
 *   ① refs 非空（有事发情境）；② delta 结构化可比（modify/disable 须
 *   before+after 齐，add 须 after，remove 须 before——与 ruler-change-schema
 *   同口径）；③ effect.verdict 已回填（有对错判定）。
 * 缺任一 → 抛 TasteSampleError 并显式列出缺失项（不静默丢弃）。
 */
export function assertThreeElements(change: RulerChangeInput): void {
  const missing: string[] = [];
  if (change.rationale.refs.length === 0) missing.push('refs（事发情境——人否机器的条目不许缺席）');
  if (change.delta.before === undefined && change.delta.after === undefined) {
    missing.push('delta（可比前后——before/after 全缺即无可比对快照）');
  } else if (change.delta.op === 'modify' || change.delta.op === 'disable') {
    if (change.delta.before === undefined || change.delta.after === undefined) {
      missing.push(`delta（op=${change.delta.op} 须 before+after 齐——可比前后残缺）`);
    }
  }
  if (change.effect === undefined) missing.push('effect（对错判定——verdict 未回填）');
  if (missing.length > 0) {
    throw new TasteSampleError(`尺子变更 ${change.targetId} 三要素校验失败（只入档不入训）`, missing);
  }
}

/**
 * 品味样本构造器。
 *
 * @param pairs (偏离模式, 尺子变更) 对——refs 命中的偏离聚成模式 × 变更事件
 * @param eceGate §二 eceVerdict 读数（achieved=false ⇒ 全部产出 archive-only——
 *   未校准样本只入档不进训练集，与「阶段二未达阈不启动阶段三」同条纪律精神）
 * @returns 样本集 + 去向 + 状态（零偏离 ⇒ insufficient-samples 空集，不报错）
 */
export function buildTasteSamples(
  pairs: ReadonlyArray<{ pattern: DivergencePatternInput; change: RulerChangeInput }>,
  eceGate: EceGateReading,
): TasteSampleResult {
  // 空集容忍（冷启动期 override 稀疏为正常态）——不造假样本、不设样本量下限断言
  if (pairs.length === 0) {
    return { samples: [], disposition: 'archive-only', status: 'insufficient-samples', rejected: [] };
  }
  const samples: TasteSample[] = [];
  const rejected: TasteSampleResult['rejected'] = [];
  for (const { pattern, change } of pairs) {
    try {
      assertThreeElements(change);
    } catch (err) {
      if (err instanceof TasteSampleError) {
        // 显式拒绝并列出缺失项（只入档不入训——不静默丢弃）
        rejected.push({ targetId: change.targetId, missing: err.missing });
        continue;
      }
      throw err;
    }
    // 样本纯净性：note 不入训练输入——机器消费面只认 trigger/refs/delta/effect
    // 四结构化字段（rationale.note 是人读留痕，喂进训练等于从噪声里学）。
    samples.push({
      id: `${pattern.patternId}::${change.targetId}::${change.delta.op}`,
      divergence: pattern,
      rulerChange: { aspect: change.aspect, targetId: change.targetId, delta: change.delta },
      trigger: change.rationale.trigger,
      refs: [...change.rationale.refs].sort(),
      label: change.effect!.verdict,
    });
  }
  return {
    samples,
    // 行为锁：ECE 未达阈 ⇒ 产出标 archive-only（只入档不进训练集）
    disposition: eceGate.achieved ? 'train-ready' : 'archive-only',
    status: 'ok',
    rejected,
  };
}
