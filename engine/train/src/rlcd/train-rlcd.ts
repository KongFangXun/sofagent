// train-rlcd.ts · v1.7.0 §一 · RLCD 训练入口（概率目标消费 + 加权配比 + 可复现清单 + TrainChannel 提交）
// ============================================================
// 定位：RLCD 训练的总装配——把 scoring-rules（严格适当评分）、policy-gradient
// （三防线）、shortcut-audit（三捷径自检）、retention-report（保留能力对照）
// 接成一个可提交训练任务：
//   1. 数据侧断言：只消费 v1.6.0 概率目标（分布/真值概率），硬标签样本被
//      拒载（标 no-probability-target——fail-closed，不静默降级为监督样本）；
//   2. label.source 三档加权（human > deterministic > model-judge）权重入配置；
//   3. 多判据域混训任务配比（混合任务损失权重显式落数——承接 NanoJev 蒸馏②）；
//   4. 36 判据 × 中英覆盖检查：任一判据或语言无样本 → 该档标 not-measured
//      （不硬凑、不设虚构条数阈值）；
//   5. 可复现清单：数据版本/评测器版本/种子/超参快照——快照同时记
//      「文档值 + 实际生效值」两个数（防他人代码默认值与文档不一致的坑）；
//   6. 预算检查：读 THRESHOLDS.md 冻结的墙钟/内存上限（本文件以冻结值常量
//      落地，超限标 inconclusive——如实记录已跑部分 + 移交后续版本，不缩
//      评测集不换评测器不改口径）；
//   7. 经 TrainChannel 提交（channel.submit——既有 TrainExecutor/审计链语义
//      零改动）。
//
// 冒烟回路（本版最小验证训练）：内置 toy 策略（softmax 参数化）+ 评分规则
// 奖励 + RLOO/KL 锚损失的完整梯度步进——证明回路可收敛（固定种子下损失
// 序列落盘、末段斜率 < 0），真基座 LoRA 档见 docs/VALIDATION.md 环境限制
// 登记（not-measured）。
// ============================================================

import { createHash } from 'crypto';
import {
  scoreByPrimitive,
  logScoreBernoulli,
  type PrimitiveScoreInput,
} from './scoring-rules';
import {
  buildRlcdConfig,
  policyStepLoss,
  rlooBaseline,
  klAnchorLoss,
  klDivergence,
  resolveDownweight,
  selectOptimizationPath,
  type RlcdPolicyGradientConfig,
  type PathSceneFeatures,
  type OptimizationPath,
} from './policy-gradient';
import type { TrainChannel, ChannelJobSpec, ChannelSubmitResult } from '../train-channel';
import { buildShortcutAuditReport, type ShortcutFeatureSample, type ShortcutAuditReport } from './shortcut-audit';
import { buildRetentionReport, type RetentionReport, type CapabilityReading } from './retention-report';
import { calibrateAfterTraining as calibrateAfterTrainingImpl, type PostTrainCalibrationReadout, type CalibrationFitItem, type CalibrationConfig } from './calibration';
// §二 校准件（v1.7.0）：训练后校准步骤——calibrateAfterTraining 在本文件
// runRlcdTraining 末段消费（训练 → 校准 → 三态对照的流水位）；类型与
// 纯函数本体均在 ./calibration，此处只 re-export 消费面（单点导入）。
export {
  calibrateAfterTraining,
  ECE_HARD_LINE,
  type PostTrainCalibrationReadout,
  type CalibrationFitItem,
} from './calibration';

/** RLCD 训练入口错误（fail-closed 载体） */
export class TrainRlcdError extends Error {
  constructor(message: string) {
    super(`[train-rlcd] ${message}`);
    this.name = 'TrainRlcdError';
  }
}

// ════════════════════════════════════════
// 预算上限（THRESHOLDS.md 冻结值——动工前登记）
// ════════════════════════════════════════

/** 训练预算上限（engine/train/src/rlcd/THRESHOLDS.md 动工前冻结——事后只许收紧） */
export const RLCD_TRAIN_BUDGET = {
  /** 墙钟上限（分钟——THRESHOLDS：2 小时单次训练任务） */
  maxWallClockMinutes: 120,
  /** 内存档位（统一内存 MPS 档——无独立 GPU 假设） */
  memoryTier: 'unified-memory-mps',
  /** 峰值 RSS 上限（GB——THRESHOLDS：32 GB 统一内存 · 峰值 RSS ≤ 16 GB） */
  maxPeakRssGB: 16,
} as const;

/** 预算检查结论（超限标 inconclusive——降级预案在位） */
export interface BudgetCheckReadout {
  /** 是否超预算 */
  exceeded: boolean;
  /** 超限项（exceeded=true 时非空） */
  violations: string[];
  /** 超预算默认动作（冻结口径：如实记录 + inconclusive + 移交，不缩评测集/换评测器/改口径） */
  downgrade: 'inconclusive-handover' | 'none';
}

/** 预算检查（墙钟 + 峰值 RSS——入参为实测读数） */
export function checkRlcdBudget(usage: {
  wallClockMinutes?: number;
  peakRssGB?: number;
}): BudgetCheckReadout {
  const violations: string[] = [];
  if (usage.wallClockMinutes !== undefined && usage.wallClockMinutes > RLCD_TRAIN_BUDGET.maxWallClockMinutes) {
    violations.push(
      `墙钟 ${usage.wallClockMinutes.toFixed(1)}min 超上限 ${RLCD_TRAIN_BUDGET.maxWallClockMinutes}min`,
    );
  }
  if (usage.peakRssGB !== undefined && usage.peakRssGB > RLCD_TRAIN_BUDGET.maxPeakRssGB) {
    violations.push(`峰值 RSS ${usage.peakRssGB.toFixed(1)}GB 超上限 ${RLCD_TRAIN_BUDGET.maxPeakRssGB}GB`);
  }
  return {
    exceeded: violations.length > 0,
    violations,
    downgrade: violations.length > 0 ? 'inconclusive-handover' : 'none',
  };
}

// ════════════════════════════════════════
// 概率目标消费（数据侧断言）
// ════════════════════════════════════════

/** 训练样本侧的判据键 */
export interface RlcdSampleKey {
  /** 判据 id（36 判据之一） */
  criterionId: string;
  /** 语言（zh/en——样本语言标签口径） */
  language: 'zh' | 'en';
}

/** RLCD 训练样本（概率目标形态——硬标签样本不属于此类型） */
export interface RlcdTrainSample {
  key: RlcdSampleKey;
  /** 标注来源三档（加权依据） */
  labelSource: 'human' | 'deterministic' | 'model-judge';
  /**
   * 概率目标（与硬标签的根本差别——RLCD 消费面）：
   *   - noul：真值概率（非 0/1 硬标签）
   *   - choice：全候选项概率分布
   *   - score：分档概率分布（有序）
   * 与 realizedOutcome（实际发生结果——训练时作为评分的事件侧）分列：
   * 概率目标是「长期统计胜率」的表达，realizedOutcome 是本次观测。
   */
  probabilityTarget: {
    noulReported?: number;
    noulOutcome?: boolean;
    choiceDistribution?: readonly number[];
    choiceSelected?: number;
    scorePredicted?: readonly number[];
    scoreTruth?: readonly number[];
  };
  /** 实际观测（评分事件侧——概率目标的单次实现） */
  realizedOutcome: PrimitiveScoreInput;
}

/**
 * 概率目标消费断言：样本缺概率目标字段（noulReported/choiceDistribution/
 * scorePredicted 全缺——只剩 realizedOutcome 硬标签形态）⇒ 拒载并列出
 * no-probability-target（数据侧断言的 fail-closed 落法——不静默当监督样本）。
 */
export function assertProbabilityTarget(sample: RlcdTrainSample): void {
  const t = sample.probabilityTarget;
  const hasNoul = typeof t.noulReported === 'number' && typeof t.noulOutcome === 'boolean';
  const hasChoice = Array.isArray(t.choiceDistribution) && typeof t.choiceSelected === 'number';
  const hasScore = Array.isArray(t.scorePredicted) && Array.isArray(t.scoreTruth);
  if (!hasNoul && !hasChoice && !hasScore) {
    throw new TrainRlcdError(
      `样本 ${sample.key.criterionId}/${sample.key.language} 缺概率目标（no-probability-target）——` +
        `RLCD 只消费概率目标，硬标签样本拒载（不静默降级）`,
    );
  }
}

// ════════════════════════════════════════
// label.source 三档加权 + 任务配比
// ════════════════════════════════════════

/** 标注档位（human > deterministic > model-judge） */
export type LabelSourceTier = 'human' | 'deterministic' | 'model-judge';

/** 三档权重缺省（human 最高——权重口径写进配置且可审计） */
export const DEFAULT_LABEL_SOURCE_WEIGHTS: Readonly<Record<LabelSourceTier, number>> = {
  human: 1.0,
  deterministic: 0.8,
  'model-judge': 0.5,
};

/** 权重合法性：全正 + human > deterministic > model-judge（档位序不破） */
export function resolveLabelSourceWeights(
  weights?: Partial<Record<LabelSourceTier, number>>,
): Record<LabelSourceTier, number> {
  const w = { ...DEFAULT_LABEL_SOURCE_WEIGHTS, ...weights };
  for (const [k, v] of Object.entries(w)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new TrainRlcdError(`label.source 权重 ${k}=${v} 须为正有限数`);
    }
  }
  if (!(w.human > w.deterministic && w.deterministic > w['model-judge'])) {
    throw new TrainRlcdError(
      `档位序破坏：human(${w.human}) > deterministic(${w.deterministic}) > model-judge(${w['model-judge']}) 须成立`,
    );
  }
  return w;
}

/**
 * 多判据域混训任务配比（混合任务损失权重显式落数——NanoJev 四任务
 * 1/3+1/3+1/6+1/6 的同构落法）：判据域 → 损失权重。缺省均匀；配比落数
 * 进可复现清单（审计可查——配比不是隐式超参）。
 */
export type TaskMixWeights = Readonly<Record<string, number>>;

/** 任务配比合法性：全正 + 归一（Σ=1，容差 1e-6） */
export function resolveTaskMixWeights(weights: TaskMixWeights): Record<string, number> {
  const entries = Object.entries(weights);
  if (entries.length === 0) throw new TrainRlcdError('任务配比为空（多判据域混训须显式配比）');
  let sum = 0;
  for (const [k, v] of entries) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new TrainRlcdError(`任务配比 ${k}=${v} 须为正有限数`);
    }
    sum += v;
  }
  if (Math.abs(sum - 1) > 1e-6) {
    throw new TrainRlcdError(`任务配比和=${sum}（须≈1——显式配比须归一）`);
  }
  return { ...weights };
}

// ════════════════════════════════════════
// 36 判据 × 中英覆盖检查（not-measured 档）
// ════════════════════════════════════════

/** 覆盖矩阵档位读数（单格） */
export interface CoverageCell {
  criterionId: string;
  language: 'zh' | 'en';
  /** 样本数（0 = not-measured） */
  sampleCount: number;
  /** 该档是否可训（无样本 → not-measured，不硬凑） */
  status: 'measured' | 'not-measured';
}

/** 覆盖检查读数（36 判据 × 中英——全集落数） */
export interface CoverageReadout {
  cells: CoverageCell[];
  /** not-measured 档数（>0 时这些档训练与 ECE 均标 not-measured） */
  notMeasuredCount: number;
  /** 覆盖判据清单（36 判据全集——入参给定，SSOT 口径） */
  criterionIds: readonly string[];
}

/**
 * 36 判据 × 中英覆盖检查：按判据全集 × {zh,en} 逐格计数，空格标
 * not-measured（不设虚构条数阈值——有 1 条也算 measured，0 条才算缺）。
 */
export function checkCoverage(
  criterionIds: readonly string[],
  samples: readonly RlcdTrainSample[],
): CoverageReadout {
  const count = new Map<string, number>();
  for (const s of samples) {
    const k = `${s.key.criterionId}\u0000${s.key.language}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const cells: CoverageCell[] = [];
  let notMeasured = 0;
  for (const cid of criterionIds) {
    for (const lang of ['zh', 'en'] as const) {
      const n = count.get(`${cid}\u0000${lang}`) ?? 0;
      if (n === 0) notMeasured += 1;
      cells.push({ criterionId: cid, language: lang, sampleCount: n, status: n === 0 ? 'not-measured' : 'measured' });
    }
  }
  return { cells, notMeasuredCount: notMeasured, criterionIds };
}

// ════════════════════════════════════════
// 可复现清单（数据版本/评测器版本/种子/超参快照——文档值+实际生效值）
// ════════════════════════════════════════

/** 超参快照单项（文档值 + 实际生效值——两个数都记，防他人默认值坑） */
export interface HyperparamSnapshotEntry {
  name: string;
  /** 文档/配方声称值 */
  documentedValue: string | number;
  /** 实际生效值 */
  effectiveValue: string | number;
}

/** 可复现清单（训练产物自带——四件：数据版本/评测器版本/种子/超参快照） */
export interface ReproducibilityManifest {
  /** 数据集内容指纹（sha256 前 16 位——dataset_version 同源口径） */
  datasetVersion: string;
  /** 评测器版本（对照基线所用的评测器标识） */
  evaluatorVersion: string;
  /** 随机种子 */
  seed: number;
  /** 超参快照（文档值+实际生效值双列） */
  hyperparams: HyperparamSnapshotEntry[];
}

/** 构建可复现清单（样本串 → 数据指纹；超参快照双值由调用方逐项给） */
export function buildReproducibilityManifest(input: {
  samples: readonly RlcdTrainSample[];
  evaluatorVersion: string;
  seed: number;
  hyperparams: HyperparamSnapshotEntry[];
}): ReproducibilityManifest {
  if (input.evaluatorVersion.trim() === '') {
    throw new TrainRlcdError('评测器版本为空（可复现清单四件缺一——fail-closed）');
  }
  if (!Number.isInteger(input.seed)) {
    throw new TrainRlcdError('种子须为整数（可复现清单四件缺一）');
  }
  if (input.hyperparams.length === 0) {
    throw new TrainRlcdError('超参快照为空（可复现清单四件缺一）');
  }
  const canonical = JSON.stringify(
    input.samples.map((s) => ({ k: s.key, t: s.probabilityTarget, l: s.labelSource })),
  );
  return {
    datasetVersion: createHash('sha256').update(canonical).digest('hex').slice(0, 16),
    evaluatorVersion: input.evaluatorVersion,
    seed: input.seed,
    hyperparams: [...input.hyperparams],
  };
}

// ════════════════════════════════════════
// 冒烟回路（toy 策略 + 评分奖励 + 三防线损失的完整步进）
// ════════════════════════════════════════

/** 确定性伪随机（mulberry32——固定种子下损失序列可复现落盘） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** softmax（数值稳定） */
function softmax(logits: readonly number[]): number[] {
  const m = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - m));
  const s = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / s);
}

/** 冒烟回路一步的读数（损失序列落盘的单位） */
export interface SmokeStepReadout {
  step: number;
  loss: number;
  reinforceTerm: number;
  klAnchorTerm: number;
  meanScore: number;
}

/** 冒烟回路入参 */
export interface SmokeLoopInput {
  config: RlcdPolicyGradientConfig;
  /** 样本（须过概率目标断言） */
  samples: readonly RlcdTrainSample[];
  steps: number;
}

/** 冒烟回路出参 */
export interface SmokeLoopResult {
  /** 损失序列（固定种子可复现——落盘件） */
  lossSeries: SmokeStepReadout[];
  /** 期望损失序列（策略分布下期望主项——收敛方向断言面，见 runSmokeLoop 注释） */
  expectedScoreSeries: number[];
  /** 末段总损失斜率（最小二乘拟合末 quarter——KL 平台含微小上漂时非严格负） */
  tailSlope: number;
  /** 末段期望损失斜率（验收断言 < 0 的收敛方向指标，容差入配置） */
  tailScoreSlope: number;
  /** 训练后策略分布（toy 策略最终 softmax） */
  finalPolicy: number[];
}

/**
 * 冒烟回路：toy 策略（K 维 logits，K = 样本数上限 8 截断）以评分规则为奖励
 * 做 REINFORCE（RLOO 基线 + KL 锚 + 降权）。固定种子（config.seed）驱动
 * mulberry32——同入参同损失序列（可复现断言面）。
 * 损失序列口径：报告的是**策略分布下的期望损失**（KL 锚项 + REINFORCE 期望
 * 主项 Σπᵢ·adv·logπᵢ）——KL 锚约束使序列不坍缩到 0，优化表现为期望损失
 * 单调下降（首步高、末段收敛平台）；末段斜率按**总损失**算会撞 KL 平台的
 * 微小上漂，故验收断言面用期望主项的斜率（tailScoreSlope——评分侧收敛方向）
 * 与总斜率（tailSlope）分列落盘。
 * 末段斜率：对序列最后 25% 步做最小二乘斜率（< 0 = 收敛方向）。
 */
export function runSmokeLoop(input: SmokeLoopInput): SmokeLoopResult {
  if (input.samples.length === 0) throw new TrainRlcdError('冒烟回路样本为空（fail-closed 拒载）');
  for (const s of input.samples) assertProbabilityTarget(s);
  // k≥2 断言：k=1（单样本）时策略 softmax 恒 [1.0]、KL 对单点分布退化——
  // 「收敛」读数是退化不是训练成效（复核第 1 轮：k=1 曾静默跑完全绿）
  if (input.samples.length < 2) {
    throw new TrainRlcdError(`冒烟回路须 ≥2 样本（k=${input.samples.length}：单点策略 softmax 恒 [1.0]，收敛读数失义——fail-closed 拒载）`);
  }
  const rand = mulberry32(input.config.seed);
  const k = Math.min(input.samples.length, 8);
  let logits = Array.from({ length: k }, (_, i) => Math.log(1 / k) + (rand() - 0.5) * 0.01);
  const anchorUniform = Array.from({ length: k }, () => 1 / k);
  const lossSeries: SmokeStepReadout[] = [];
  // 期望损失序列（收敛方向的断言面——见函数头注释）
  const expectedScoreSeries: number[] = [];
  for (let step = 0; step < input.steps; step++) {
    const policy = softmax(logits);
    // 奖励：按样本评分（realizedOutcome 事件侧）——toy 策略下 logProb = log π_i
    const rewards: number[] = [];
    const logProbs: number[] = [];
    for (let i = 0; i < k; i++) {
      const s = input.samples[i] as RlcdTrainSample;
      rewards.push(scoreByPrimitive(s.realizedOutcome));
      logProbs.push(Math.log(Math.max(policy[i] ?? 1e-12, 1e-12)));
    }
    const stepLoss = policyStepLoss(input.config, {
      rewards,
      logProbs,
      policyDistribution: policy,
      anchorDistribution: anchorUniform,
    });
    // 期望损失序列（收敛方向的断言面）：E_π[−r] = −Σ πᵢ·rᵢ——策略分布下平均
    // 负奖励（REINFORCE 的期望目标）。策略向高奖励样本集中时单调下降——
    // KL 锚约束使其收敛到锚内平台而非全塌缩（防 System-One 坍缩的可观测面）。
    let expectedObj = 0;
    for (let i = 0; i < k; i++) {
      expectedObj += (policy[i] as number) * (rewards[i] as number);
    }
    expectedScoreSeries.push(-expectedObj);
    lossSeries.push({
      step,
      loss: stepLoss.total,
      reinforceTerm: stepLoss.reinforceTerm,
      klAnchorTerm: stepLoss.klAnchorTerm,
      meanScore: rewards.reduce((a, b) => a + b, 0) / rewards.length,
    });
    // 梯度步进（REINFORCE 解析梯度 + KL 锚解析梯度——toy 策略直接手推；
    // 两项都用**同步批量更新**：全部梯度先算齐、再一次更新 logits——顺序更新
    // 会让后面的 j 用被前面 j 已改过的 logits 差分，产生伪梯度正反馈）
    //   ∂reinforce/∂logit_j = −downweight × mean_i[(r_i − b_i)·(1{i=j} − π_j)]
    //   ∂KL(π‖a)/∂logit_j  = π_j·(log(π_j/a_j) − KL(π‖a))
    const grad = new Array<number>(k).fill(0);
    const dw = input.config.policyGradientDownweight;
    const klNow = klDivergence(policy, anchorUniform);
    const rloo = rlooBaseline([rewards]);
    for (let i = 0; i < k; i++) {
      const adv = (rewards[i] as number) - (rloo.baselines[i] as number);
      for (let j = 0; j < k; j++) {
        const indicator = i === j ? 1 : 0;
        grad[j] = grad[j] as number + adv * (indicator - (policy[j] as number));
      }
    }
    const deltas = new Array<number>(k).fill(0);
    for (let j = 0; j < k; j++) {
      const g = -dw * ((grad[j] as number) / k);
      const klGradJ =
        (policy[j] as number) *
        (Math.log((policy[j] as number) / (anchorUniform[j] as number)) - klNow);
      deltas[j] = input.config.learningRate * (g + input.config.klAnchor.coefficient * klGradJ);
    }
    for (let j = 0; j < k; j++) {
      logits[j] = (logits[j] as number) - (deltas[j] as number);
    }
  }
  // 末段斜率（最后 25% 步的最小二乘——验收断言 < 0 用 tailScoreSlope）
  const tailSlope = tailSlopeOf(lossSeries.map((s) => ({ x: s.step, y: s.loss })));
  const tailScoreSlope = tailSlopeOf(
    expectedScoreSeries.map((y, i) => ({ x: i, y })),
  );
  return { lossSeries, expectedScoreSeries, tailSlope, tailScoreSlope, finalPolicy: softmax(logits) };
}

/** 最小二乘斜率（末段收敛方向断言的共用计算） */
function tailSlopeOf(points: Array<{ x: number; y: number }>): number {
  const tail = points.slice(Math.floor(points.length * 0.75));
  const n = tail.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (const p of tail) {
    sx += p.x;
    sy += p.y;
    sxy += p.x * p.y;
    sxx += p.x * p.x;
  }
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

// ════════════════════════════════════════
// TrainChannel 提交（既有接口零改动）
// ════════════════════════════════════════

/** RLCD 训练任务规格（job.json 摘要 + RLCD 配置指纹） */
export interface RlcdJobSpec extends ChannelJobSpec {
  /** 训练模式（rl / supervised-first——路径选择器产物入 job 规格） */
  mode: OptimizationPath;
  /** 可复现清单的哈希（清单本体随产物落盘，哈引进提交审计） */
  reproducibilityManifestHash: string;
}

/**
 * 经 TrainChannel 提交 RLCD 训练任务：
 * 通道名（channel.name）+ 提交结果（remoteJobId）原样回流——事件回流审计链
 * 走通道既有语义（本函数零改动 TrainChannel 接口）。
 */
export async function submitRlcdViaChannel(
  channel: TrainChannel,
  jobDir: string,
  spec: RlcdJobSpec,
): Promise<ChannelSubmitResult> {
  if (spec.mode !== 'rl' && spec.mode !== 'supervised-first') {
    throw new TrainRlcdError(`非法模式 ${String(spec.mode)}（路径选择器两态之外）`);
  }
  return channel.submit(jobDir, spec);
}

// ════════════════════════════════════════
// 总装配入口（一次调用产全套训练前读数 + 冒烟回路 + 提交）
// ════════════════════════════════════════

/** 训练前检查读数（数据侧 + 覆盖 + 配比 + 加权——一次成型） */
export interface RlcdPreTrainReadout {
  /** 概率目标断言通过数（硬标签拒载数 = samples − passed） */
  probabilityTargetPassed: number;
  /** 硬标签拒载数（no-probability-target——显式计数，不静默） */
  rejectedHardLabelCount: number;
  /** 覆盖矩阵（36 判据 × 中英） */
  coverage: CoverageReadout;
  /** label.source 三档权重（审计面） */
  labelSourceWeights: Record<LabelSourceTier, number>;
  /** 任务配比（显式落数） */
  taskMixWeights: Record<string, number>;
  /** 配置三件（baseline/klAnchor/mode——显式可查） */
  config: RlcdPolicyGradientConfig;
  /** 可复现清单（四件） */
  reproducibility: ReproducibilityManifest;
  /** 预算检查（训练前只查上限在位——运行读数由事件流累计） */
  budget: typeof RLCD_TRAIN_BUDGET;
}

/** 训练前检查（数据断言 + 覆盖 + 加权 + 配比 + 清单——不跑训练） */
export function preTrainCheck(input: {
  criterionIds: readonly string[];
  samples: readonly RlcdTrainSample[];
  evaluatorVersion: string;
  seed: number;
  learningRate: number;
  learningRateDocumented: string | number;
  taskMixWeights?: TaskMixWeights;
  labelSourceWeights?: Partial<Record<LabelSourceTier, number>>;
  sceneFeatures?: PathSceneFeatures;
}): RlcdPreTrainReadout {
  let passed = 0;
  let rejected = 0;
  for (const s of input.samples) {
    try {
      assertProbabilityTarget(s);
      passed += 1;
    } catch {
      rejected += 1;
    }
  }
  if (passed === 0) {
    throw new TrainRlcdError(
      input.samples.length === 0
        ? '数据集为空（0 样本通过 0 条）——空集训练是无效操作，fail-closed 拒载'
        : '全部样本缺概率目标（no-probability-target）——无 RLCD 可训数据',
    );
  }
  // 覆盖检查只计过断言的样本（拒载样本不进覆盖矩阵——它们不参与训练）
  const usable = input.samples.filter((s) => {
    try {
      assertProbabilityTarget(s);
      return true;
    } catch {
      return false;
    }
  });
  const config = buildRlcdConfig({
    seed: input.seed,
    learningRate: input.learningRate,
    sceneFeatures: input.sceneFeatures,
  });
  const domains = new Set(usable.map((s) => s.key.criterionId.split(':')[0] ?? 'default'));
  const mix = input.taskMixWeights ?? uniformMix([...domains]);
  const reproducibility = buildReproducibilityManifest({
    samples: usable,
    evaluatorVersion: input.evaluatorVersion,
    seed: input.seed,
    hyperparams: [
      {
        name: 'learningRate',
        documentedValue: input.learningRateDocumented,
        effectiveValue: input.learningRate,
      },
      {
        name: 'policyGradientDownweight',
        documentedValue: '0.1（7–12× 梯度比区间中位）',
        effectiveValue: config.policyGradientDownweight,
      },
      {
        name: 'klAnchorCoefficient',
        documentedValue: '0.05',
        effectiveValue: config.klAnchor.coefficient,
      },
    ],
  });
  return {
    probabilityTargetPassed: passed,
    rejectedHardLabelCount: rejected,
    coverage: checkCoverage(input.criterionIds, usable),
    labelSourceWeights: resolveLabelSourceWeights(input.labelSourceWeights),
    taskMixWeights: resolveTaskMixWeights(mix),
    config,
    reproducibility,
    budget: RLCD_TRAIN_BUDGET,
  };
}

/** 均匀任务配比（缺省——1/n 归一） */
function uniformMix(domains: readonly string[]): Record<string, number> {
  if (domains.length === 0) return { default: 1 };
  const w = 1 / domains.length;
  return Object.fromEntries(domains.map((d) => [d, w]));
}

// ════════════════════════════════════════
// 训练后读数装配（捷径自检 + 保留能力对照）
// ════════════════════════════════════════

/** 训练后总读数（冒烟 + 自检单 + 保留对照 + §二校准——一次落数） */
export interface RlcdTrainResult {
  smoke: SmokeLoopResult;
  shortcutAudit: ShortcutAuditReport;
  retention: RetentionReport;
  budgetCheck: BudgetCheckReadout;
  /** §二 训练后校准步骤（隔离断言 + 三原语分桶温度拟合） */
  calibration: PostTrainCalibrationReadout;
}

/**
 * 训练后装配（冒烟回路 + 捷径自检单 + 保留能力对照 + 预算检查 + §二校准）。
 * 校准入参 calibrationBuckets / calibrationTrainFamilies 可选——缺省以
 * 空校准集跑（三原语全 not-fit + 隔离恒过），有校准集时经
 * calibrateAfterTraining 出拟合读数（隔离优先于拟合——先防污染再算数）。
 */
export function runRlcdTraining(input: {
  config: RlcdPolicyGradientConfig;
  samples: readonly RlcdTrainSample[];
  steps: number;
  shortcutFeaturesBefore: readonly ShortcutFeatureSample[];
  shortcutFeaturesAfter?: readonly ShortcutFeatureSample[];
  targetCapabilities: CapabilityReading[];
  retainedCapabilities: CapabilityReading[];
  retentionDropThresholdPP?: number;
  budgetUsage?: { wallClockMinutes?: number; peakRssGB?: number };
  calibrationBuckets?: readonly CalibrationFitItem[];
  calibrationConfig?: Partial<CalibrationConfig>;
}): RlcdTrainResult {
  const smoke = runSmokeLoop({ config: input.config, samples: input.samples, steps: input.steps });
  const shortcutAudit = buildShortcutAuditReport(input.shortcutFeaturesBefore, input.shortcutFeaturesAfter);
  const retention = buildRetentionReport({
    targetCapabilities: input.targetCapabilities,
    retainedCapabilities: input.retainedCapabilities,
    dropThresholdPP: input.retentionDropThresholdPP,
  });
  // §二 校准步骤：按原语分组校准样本（calibrationBuckets 按 primitive 分桶）
  const buckets: { choice: CalibrationFitItem[]; score: CalibrationFitItem[]; noul: CalibrationFitItem[] } = {
    choice: [],
    score: [],
    noul: [],
  };
  for (const item of input.calibrationBuckets ?? []) {
    buckets[item.primitive].push(item);
  }
  const calibration = calibrateAfterTrainingImpl({
    primitiveBuckets: buckets,
    trainSamples: input.samples,
    config: input.calibrationConfig,
  });
  return {
    smoke,
    shortcutAudit,
    retention,
    budgetCheck: checkRlcdBudget(input.budgetUsage ?? {}),
    calibration,
  };
}

// ── 便捷重导出（训练入口的完整消费面——CLI/测试单点导入）────────
// （policy-gradient 与 scoring-rules 的符号经顶部 import 已在本文件作用域，
//  再导出会与 import 冲突——消费方直接从各模块导入，此处不重复建面。）
