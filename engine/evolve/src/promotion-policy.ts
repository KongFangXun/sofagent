// promotion-policy.ts · 三层晋级判据纯函数（v1.5.8 章二）
//
// 两 substrate 成本模型的显式化：注入租用（每次推理重付）/ skill 半持久 /
// 微调摊销（一次付清）。何时升层此前靠人拍——本文件给可计算判据：
//   输入：条目注入频次 × 存续期 × 验证态 → keep-inject / promote-skill / promote-train
//   对偶：上层验证失败 → demote-train / demote-skill（回退复用既有 snapshot/restore
//         语义——本模块只出判定，不新建回退机制）
//   人审门：promote-train 只提示不执行（FDE 确认队列）
//   台账：每次判定落 decision-log（判据快照可追溯——经 core 的
//         emitAuditDecision；该符号当前未从 @sofagent/core 导出，本模块以
//         可注入 writer 解耦：默认 no-op，生产接线下版随 core 导出面收口）
//
// 晋级四道证据门槛（evidenceGates）：留出集优先 / 严格优于历史最佳 /
// 单变量可归因 / 校准不退化——四门全过才允许 promote-*，任一拒绝即 keep。
// 「历史最佳」存储裁定（落数表 #8）：复用 native-gate 的 GateHistory.bestScore
// 单标量（口径 = held-out 分数），不另立第二套基线存储（双事实源风险）。

import type { QuotaConfig, QuotaUsage, QuotaVerdict } from '@sofagent/core';

// ── 阈值常量（集中定义——对齐 skill-health.ts MAX_SCAN_FILES 惯例；落数表 #4/#5/#6）──

/** 晋级频次阈值 N₁（窗口期内注入次数 ≥ 此值才够「高频」） */
export const PROMOTION_FREQUENCY_THRESHOLD = 5;

/** 晋级存续期阈值 N₂（天数——条目首次出现距今 ≥ 此值才够「半持久」） */
export const PROMOTION_PERSISTENCE_DAYS = 14;

/** 晋级验证态门槛 N₃（窗口 passRate ≥ 此值；口径 = passRate，非 eval 分数） */
export const PROMOTION_VERIFICATION_PASSRATE = 0.8;

/** promote-train 的更高验证门槛（微调摊销层——更高风险更高门槛） */
export const PROMOTION_TRAIN_PASSRATE = 0.9;

/** 存续期窗口（天——频次统计窗口） */
export const FREQUENCY_WINDOW_DAYS = 7;

/** 校准退化容差 ε（准确率升而校准降超出 ε 即拒——落数表 #9：严格小于 0 或允许 ε 的裁定=允许 0.02） */
export const CALIBRATION_EPSILON = 0.02;

/** 晋级判据输入（三维） */
export interface PromotionInput {
  /** 条目 ID */
  itemId: string;
  /** 窗口期内注入频次（次 / FREQUENCY_WINDOW_DAYS 天） */
  injectionFrequency: number;
  /** 存续期（天——首次出现距今） */
  persistenceDays: number;
  /** 验证态：窗口 passRate [0,1]（口径 = passRate） */
  passRate: number;
  /** 当前层（inject / skill / train） */
  currentLayer: 'inject' | 'skill' | 'train';
}

/** 晋级三态建议（+ 对偶回退两态） */
export type PromotionVerdict =
  | { action: 'keep-inject'; basis: string }
  | { action: 'promote-skill'; basis: string }
  | { action: 'promote-train'; basis: string; requiresHumanApproval: true }
  | { action: 'demote-skill'; basis: string }
  | { action: 'demote-inject'; basis: string };

/**
 * 三层晋级判据纯函数。
 * promote-train 恒带 requiresHumanApproval=true（只提示不执行——FDE 确认队列）。
 */
export function judgePromotion(input: PromotionInput): PromotionVerdict {
  const freqOk = input.injectionFrequency >= PROMOTION_FREQUENCY_THRESHOLD;
  const persistOk = input.persistenceDays >= PROMOTION_PERSISTENCE_DAYS;
  const verifySkillOk = input.passRate >= PROMOTION_VERIFICATION_PASSRATE;
  const verifyTrainOk = input.passRate >= PROMOTION_TRAIN_PASSRATE;

  if (freqOk && persistOk && verifyTrainOk) {
    return {
      action: 'promote-train',
      basis: `频次 ${input.injectionFrequency}≥${PROMOTION_FREQUENCY_THRESHOLD} × 存续 ${input.persistenceDays}d≥${PROMOTION_PERSISTENCE_DAYS}d × 验证 ${input.passRate.toFixed(2)}≥${PROMOTION_TRAIN_PASSRATE}（微调摊销档）——只提示，进 FDE 确认队列`,
      requiresHumanApproval: true,
    };
  }
  if (freqOk && persistOk && verifySkillOk) {
    return {
      action: 'promote-skill',
      basis: `频次 ${input.injectionFrequency}≥${PROMOTION_FREQUENCY_THRESHOLD} × 存续 ${input.persistenceDays}d≥${PROMOTION_PERSISTENCE_DAYS}d × 验证 ${input.passRate.toFixed(2)}≥${PROMOTION_VERIFICATION_PASSRATE}（skill 半持久档）`,
    };
  }
  return {
    action: 'keep-inject',
    basis: `未达晋级门槛（频次 ${input.injectionFrequency}/${PROMOTION_FREQUENCY_THRESHOLD} · 存续 ${input.persistenceDays}d/${PROMOTION_PERSISTENCE_DAYS}d · 验证 ${input.passRate.toFixed(2)}/${PROMOTION_VERIFICATION_PASSRATE}）——注入租用层维持`,
  };
}

/**
 * 回退判定（对偶面——上层验证失败回退下一层）：
 * train 层失败 → demote-skill；skill 层失败 → demote-inject。
 * 回退动作本身由调用方走既有 snapshot/restore 执行——本函数只出判定
 * （不新建回退机制——静态纪律：本模块零 snapshot/restore 语义命名导出）。
 */
export function judgeDemotion(currentLayer: 'inject' | 'skill' | 'train', verificationFailed: boolean): PromotionVerdict | null {
  if (!verificationFailed) return null;
  if (currentLayer === 'train') {
    return { action: 'demote-skill', basis: 'train 层验证失败（微调后 eval 退化）——回退 skill 半持久层（执行走既有 snapshot/restore）' };
  }
  if (currentLayer === 'skill') {
    return { action: 'demote-inject', basis: 'skill 层验证失败（考核连续失败）——回退注入租用层（执行走既有 snapshot/restore）' };
  }
  return null;
}

// ── 晋级证据门槛（四道——落数表 #8/#9/#10）──

/** 证据门槛输入 */
export interface EvidenceGatesInput {
  /** 反馈集提升（不计入依据——只登记不判） */
  feedbackSetGain: number;
  /** 留出集提升（判定依据） */
  heldOutGain: number;
  /** 本轮候选分数 vs 历史最佳（native-gate GateHistory.bestScore 同口径） */
  candidateScore: number;
  historicalBestScore: number;
  /** 本次变更涉及的变更面清单（单变量可归因——枚举：skill 文件 / 注入模板 / 权重 / 规则集） */
  changedSurfaces: ReadonlyArray<'skill-file' | 'inject-template' | 'weights' | 'ruleset'>;
  /** 校准逐维读数（落数表 #9：ECE 与 Brier 两维） */
  calibration: {
    /** 期望校准误差（降 = 好） */
    ece: number;
    /** Brier 分数（降 = 好） */
    brier: number;
    /** 基线（晋级前）读数 */
    baselineEce: number;
    baselineBrier: number;
  };
  /** 准确率是否提升 */
  accuracyImproved: boolean;
}

/** 证据门槛判定结果 */
export interface EvidenceGatesVerdict {
  passed: boolean;
  gateResults: {
    heldOutFirst: boolean;
    strictlyBetterThanBest: boolean;
    singleVariable: boolean;
    calibrationNotDegraded: boolean;
  };
  rejectionReasons: string[];
}

/**
 * 四道证据门槛判定（全过才允许 promote-*）：
 * ① 留出集优先——heldOutGain > 0（反馈集提升不计：feedbackSetGain 只登记）
 * ② 严格优于历史最佳——candidateScore > historicalBestScore（持平 = 不接受）
 * ③ 单变量可归因——changedSurfaces 恰好 1 个（多变量捆包拒收）
 * ④ 校准不退化——逐维判定（ECE 与 Brier 各自升幅 ≤ ε）；准确率升而校准降同样拒
 */
export function judgeEvidenceGates(input: EvidenceGatesInput): EvidenceGatesVerdict {
  const reasons: string[] = [];
  const heldOutFirst = input.heldOutGain > 0;
  if (!heldOutFirst) reasons.push(`留出集优先：heldOut 增益 ${input.heldOutGain} ≤ 0（反馈集 +${input.feedbackSetGain} 不计入依据）`);
  const strictlyBetterThanBest = input.candidateScore > input.historicalBestScore;
  if (!strictlyBetterThanBest) reasons.push(`严格优于历史最佳：${input.candidateScore} ≤ 最佳 ${input.historicalBestScore}（持平视为不接受）`);
  const singleVariable = input.changedSurfaces.length === 1;
  if (!singleVariable) reasons.push(`单变量可归因：变更面 ${input.changedSurfaces.length} 个（${input.changedSurfaces.join('/')}）——多变量捆包拒收`);
  const eceDegraded = input.calibration.ece - input.calibration.baselineEce > CALIBRATION_EPSILON;
  const brierDegraded = input.calibration.brier - input.calibration.baselineBrier > CALIBRATION_EPSILON;
  const calibrationNotDegraded = !eceDegraded && !brierDegraded;
  if (!calibrationNotDegraded) {
    const dims: string[] = [];
    if (eceDegraded) dims.push(`ECE ${input.calibration.baselineEce}→${input.calibration.ece}`);
    if (brierDegraded) dims.push(`Brier ${input.calibration.baselineBrier}→${input.calibration.brier}`);
    reasons.push(`校准不退化（逐维）：${dims.join(' 与 ')} 超容差 ε=${CALIBRATION_EPSILON}${input.accuracyImproved ? '（准确率升而校准降同样拒收）' : ''}`);
  }
  return {
    passed: reasons.length === 0,
    gateResults: { heldOutFirst, strictlyBetterThanBest, singleVariable, calibrationNotDegraded },
    rejectionReasons: reasons,
  };
}

// ── 进化收益四指标（数据从既有台账取——不造新数据源）──

/** 四指标读数 */
export interface EvolutionBenefitMetrics {
  /** 任务通过率趋势（acceptance/ab-history 既有数据源——窗口斜率） */
  passRateTrend: number;
  /** 错题本复发率（同类失败重犯间隔的倒数化——failure-ledger 台账） */
  recurrenceRate: number;
  /** skill 复用率（调用次数 / 产生次数——skill-impact 台账） */
  skillReuseRate: number;
  /** 纠偏介入率（人工干预频次趋势——decision-log ESCALATE_REPORT 计数） */
  interventionRate: number;
}

/** 四指标记录形态（可计算可记录——呈现挂 v1.5.0 治理 KPI 面板，复用六卡框架） */
export interface BenefitMetricsRecord {
  windowStart: string;
  windowEnd: string;
  metrics: EvolutionBenefitMetrics;
  recordedAt: string;
}

/** 纯计算：四指标聚合记录（供 KPI 面板消费） */
export function recordBenefitMetrics(
  metrics: EvolutionBenefitMetrics,
  window: { start: string; end: string },
  now?: string,
): BenefitMetricsRecord {
  return { windowStart: window.start, windowEnd: window.end, metrics, recordedAt: now ?? new Date().toISOString() };
}

// ── 台账（decision-log——经可注入 writer 解耦 core 导出面缺口）──

/** 判定台账单条（判据快照可追溯） */
export interface PromotionLedgerEntry {
  ts: string;
  itemId: string;
  verdict: PromotionVerdict;
  /** 判据快照（三维原始输入——复算依据） */
  criteriaSnapshot: PromotionInput;
  /** 证据门槛快照（若走了 gates） */
  evidenceSnapshot?: EvidenceGatesVerdict;
}

/** decision-log writer 注入口（生产侧接 core emitAuditDecision；默认 no-op——core 导出面收口前不硬依赖） */
export type DecisionWriter = (entry: { kind: string; moment: string; why: string; evidence?: string[] }) => { ts: string } | null;

/** no-op writer（默认——测试与未接线环境零副作用） */
export const noopDecisionWriter: DecisionWriter = () => null;

/**
 * 判定落台账：判据快照 + decision-log 留痕。
 * 返回台账条目；writer 失败不阻断（留痕缺失由 writer 返回 null 如实暴露）。
 */
export function recordPromotionDecision(
  input: PromotionInput,
  verdict: PromotionVerdict,
  writer: DecisionWriter = noopDecisionWriter,
  now?: string,
): PromotionLedgerEntry {
  const ts = now ?? new Date().toISOString();
  const entry: PromotionLedgerEntry = { ts, itemId: input.itemId, verdict, criteriaSnapshot: input };
  writer({
    kind: 'EVOLUTION',
    moment: 'select',
    why: `晋级判定 ${verdict.action}：${verdict.basis}`,
    evidence: [`item=${input.itemId}`, `freq=${input.injectionFrequency}`, `persist=${input.persistenceDays}d`, `passRate=${input.passRate.toFixed(2)}`],
  });
  return entry;
}

// ── 与第一章 quota 门禁的衔接（无第二套预算）──

/**
 * 进化循环成本门（复用 core checkQuota——WARN/HARD 双模式处置即其 verdict，
 * 本模块零新增预算逻辑）。返回「是否允许启动进化循环」+ quota 判定原文。
 */
export function evolutionCostGate(config: QuotaConfig | null | undefined, usage: QuotaUsage): { allowed: boolean; quotaVerdict: QuotaVerdict } {
  const verdict = (globalThis as unknown as { __sofagentQuotaCheck?: typeof import('@sofagent/core').checkQuota }).__sofagentQuotaCheck?.(config, usage)
    ?? quotaCheckShim(config, usage);
  return { allowed: verdict.action !== 'block', quotaVerdict: verdict };
}

/** 局部 import 规避循环依赖（core 的 checkQuota 运行时动态取） */
function quotaCheckShim(config: QuotaConfig | null | undefined, usage: QuotaUsage): QuotaVerdict {
  // 动态 require @sofagent/core（evolve 已依赖 core——无新增依赖边）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = require('@sofagent/core') as typeof import('@sofagent/core');
  return core.checkQuota(config, usage);
}
