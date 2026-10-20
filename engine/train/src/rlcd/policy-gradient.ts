// policy-gradient.ts · v1.7.0 §一 · RLCD 策略梯度回路（RLOO 基线 + KL 锚 + 降权 + 路径选择器）
// ============================================================
// 定位：以严格适当评分规则为奖励的策略梯度优化（不引入人类偏好模型、
// 不依赖外部教师模型——奖励信号完全来自 scoring-rules）。
//
// RLCD 失败模式防线三件套（SSOT §一验收第 5 条，外部参照蒸馏的施工化）：
//   ① 基线估计器 = 留一（RLOO）非组均值——组均值基线会放大奖励归一化噪声项
//      （外部实测比简单交叉熵低 2.5–3.0pp），RLOO 无偏基线可弥补大部分差距；
//      本实现把「非组均值」落成可断言面：baselineMethod 字段 + rlooBaseline
//      纯函数（留一均值 = (组内和 − 本样本) / (n − 1)，组容量 1 时退化为 0
//      并显式读数 single-sample-group）。
//   ② KL 锚（防 System-One 坍缩——policy 退化为空/极简 rationale）+ 策略梯度
//      项降权（防淹没 readout：外部实测 policy-gradient 项梯度比 readout 大
//      7–12×——见 POLICY_GRADIENT_DOWNWEIGHT 注释）。KL 锚以「策略分布与锚
//      分布的 KL 散度 × 系数」进总损失，超锚预算只提示不阻断（对齐校准漂移
//      监测的只提示纪律）。
//   ③ 直接评分场景（无轨迹/无延迟标签）优先监督 Brier/交叉熵——路径选择器
//      selectOptimizationPath 按场景特征选 supervised-first / rl；RL 仅用于
//      分布依赖采样推理的场景。三件（baseline=rloo / klAnchor / 模式）在
//      配置对象里显式可查（测试断言面）。
//
// 本文件是纯函数层（零 IO / 零真实网络）——训练循环的可注入依赖（评分函数、
// 采样器）由 train-rlcd.ts 装配；冒烟收敛由 rlcd-train.test.ts 验证。
// ============================================================

/** 策略梯度回路错误（fail-closed 载体） */
export class PolicyGradientError extends Error {
  constructor(message: string) {
    super(`[policy-gradient] ${message}`);
    this.name = 'PolicyGradientError';
  }
}

// ════════════════════════════════════════
// ① RLOO 留一基线
// ════════════════════════════════════════

/** RLOO 读数（审计面：留一均值 + 组容量退化标记） */
export interface RlooReadout {
  /** 每个样本的留一基线（组容量 1 时为 0——显式退化，不造噪声） */
  baselines: number[];
  /** 组容量 1 的组数（这些样本基线为 0——留一不可算，审计可查） */
  singleSampleGroups: number;
  /** 基线方法（显式可查三件之一：'rloo'——非组均值的可断言落点） */
  baselineMethod: 'rloo';
}

/**
 * RLOO 留一基线（非组均值）：
 *   baseline_i = (Σ_{j≠i} r_j) / (n − 1)
 * 组容量 1 时留一不可算 → 基线 0 + singleSampleGroups 计数（不静默、不造假）。
 * 组均值基线（被弃用）= (Σ r_j) / n 含本样本——奖励与其自身的相关进入基线
 * 估计，放大噪声项；留一剔除该相关（无偏性的来源）。
 */
export function rlooBaseline(groups: readonly (readonly number[])[]): RlooReadout {
  if (groups.length === 0) {
    throw new PolicyGradientError('样本组为空（无基线可估——fail-closed 拒载）');
  }
  const baselines: number[] = [];
  let singleSampleGroups = 0;
  for (const group of groups) {
    if (group.length === 0) {
      throw new PolicyGradientError('组内样本数为 0（空组不可估基线）');
    }
    if (group.length === 1) {
      baselines.push(0);
      singleSampleGroups += 1;
      continue;
    }
    const sum = group.reduce((a, b) => a + b, 0);
    const n = group.length;
    for (const r of group) {
      baselines.push((sum - r) / (n - 1));
    }
  }
  return { baselines, singleSampleGroups, baselineMethod: 'rloo' };
}

/**
 * 组均值基线（对照组——仅测试断言「RLOO ≠ 组均值」与审计对照用，
 * 训练配置缺省不选它：baselineMethod 字段锁定 'rloo'）。
 */
export function groupMeanBaseline(groups: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  for (const group of groups) {
    const sum = group.reduce((a, b) => a + b, 0);
    const mean = sum / group.length;
    for (const _ of group) out.push(mean);
  }
  return out;
}

// ════════════════════════════════════════
// ② KL 锚 + 策略梯度项降权
// ════════════════════════════════════════

/**
 * 策略梯度项降权系数（防淹没 readout）。
 * 依据：外部参照蒸馏（SSOT §一交付表「RLCD 数学本质与失败模式」②，arXiv:2609.38850
// OpenJev-RLCD，本仓未复算）实测 policy-gradient 项梯度比 readout 大 7–12×——
 * 降权系数须落在该区间内（缺省 0.1 ≈ 1/10：把 7–12× 的梯度优势压回 ~1× 量级）。
 * 可配（POLICY_GRADIENT_DOWNWEIGHT_MIN/MAX 之外的值拒载——防配出放大淹没的系数）。
 */
export const POLICY_GRADIENT_DOWNWEIGHT = 0.1;
/** 降权系数合法区间（7–12× 梯度比的工程化留一余量：0.05–0.2） */
export const POLICY_GRADIENT_DOWNWEIGHT_MIN = 0.05;
export const POLICY_GRADIENT_DOWNWEIGHT_MAX = 0.2;

/** KL 锚缺省系数（锚强度——policy 与锚分布偏离的惩罚权重） */
export const KL_ANCHOR_COEFFICIENT = 0.05;

/** 策略梯度项降权读数（配置三件显式可查的降权件） */
export interface DownweightReadout {
  /** 降权系数（生效值——快照落数） */
  coefficient: number;
  /** 依据（7–12× 梯度比——注释同源，供审计对账） */
  basis: 'policy-gradient-to-readout-gradient-ratio-7-12x';
}

/**
 * 解析降权系数（区间外拒载——见 POLICY_GRADIENT_DOWNWEIGHT 注释）。
 */
export function resolveDownweight(coefficient?: number): DownweightReadout {
  const c = coefficient ?? POLICY_GRADIENT_DOWNWEIGHT;
  if (c < POLICY_GRADIENT_DOWNWEIGHT_MIN || c > POLICY_GRADIENT_DOWNWEIGHT_MAX) {
    throw new PolicyGradientError(
      `策略梯度降权系数 ${c} 越界 [${POLICY_GRADIENT_DOWNWEIGHT_MIN}, ${POLICY_GRADIENT_DOWNWEIGHT_MAX}]` +
        `（依据：policy-gradient 梯度比 readout 大 7–12×，降权须压回 ~1× 量级）`,
    );
  }
  return { coefficient: c, basis: 'policy-gradient-to-readout-gradient-ratio-7-12x' };
}

/** KL 散度（离散分布——防 p=0 的 log 项以 0·log0=0 约定承载） */
export function klDivergence(p: readonly number[], q: readonly number[]): number {
  if (p.length !== q.length) {
    throw new PolicyGradientError(`KL 两分布长度不一致（${p.length} vs ${q.length}）`);
  }
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i] as number;
    const qi = q[i] as number;
    if (pi < 0 || qi < 0) throw new PolicyGradientError('KL 分布含负概率');
    if (pi > 0 && qi > 0) acc += pi * Math.log(pi / qi);
    // pi > 0 且 qi = 0：KL 数学上为 ∞——训练实现层以大有限值承载（不静默 0）
    else if (pi > 0 && qi === 0) acc += 1e6;
  }
  return acc;
}

/** KL 锚读数（配置三件显式可查的锚件） */
export interface KlAnchorReadout {
  /** 锚系数（生效值） */
  coefficient: number;
  /** 锚在位（防 System-One 坍缩——策略分布不退化为空/极简 rationale） */
  anchor: true;
  /** KL 散度是否超锚预算（只提示不阻断——对齐校准漂移监测纪律） */
  overBudgetHint: boolean;
}

/**
 * KL 锚损失项：anchorLoss = coefficient × KL(policy ‖ anchor)。
 * 超锚预算（threshold）只置 overBudgetHint（不阻断训练——坍缩风险提示面）。
 */
export function klAnchorLoss(
  policy: readonly number[],
  anchor: readonly number[],
  opts: { coefficient?: number; budgetThreshold?: number } = {},
): { loss: number; readout: KlAnchorReadout } {
  const coefficient = opts.coefficient ?? KL_ANCHOR_COEFFICIENT;
  if (coefficient < 0) throw new PolicyGradientError('KL 锚系数须 ≥ 0');
  const kl = klDivergence(policy, anchor);
  const threshold = opts.budgetThreshold ?? 1.0;
  return {
    loss: coefficient * kl,
    readout: {
      coefficient,
      anchor: true,
      overBudgetHint: kl > threshold,
    },
  };
}

// ════════════════════════════════════════
// ③ 路径选择器（supervised-first）
// ════════════════════════════════════════

/** 优化路径（直接评分场景优先监督——RL 仅用于分布依赖采样推理） */
export type OptimizationPath = 'supervised-first' | 'rl';

/** 场景特征（路径选择依据——无轨迹/无延迟标签 ⇒ 直接评分场景） */
export interface PathSceneFeatures {
  /** 有无轨迹依赖（动作改变后续观察） */
  hasTrajectory: boolean;
  /** 标签是否沿轨迹延迟到达 */
  delayedLabels: boolean;
  /** 推理是否依赖采样分布（采样行为改变被评对象本身） */
  distributionDependentSampling: boolean;
}

/** 路径选择读数（配置三件显式可查的模式件） */
export interface PathSelectionReadout {
  /** 选定路径 */
  path: OptimizationPath;
  /** 模式显式字段（配置快照可查） */
  mode: 'supervised-first' | 'rl';
  /** 判定依据（人可读——审计对账） */
  reason: string;
}

/**
 * 路径选择器：直接评分场景（无轨迹 + 无延迟标签）⇒ supervised-first
 * （监督 Brier/交叉熵可达同期望最优且方差更低——RL 只在「分布依赖采样推理、
 * 动作改变观察、标签沿轨迹到达」时才必要）；否则 rl。
 * 显式 override 优先（配置声明即事实源），但 supervised 强转 rl 须显式给
 * rlOverride 理由——防「顺手全 RL」把方差劣势带进直接评分场景。
 */
export function selectOptimizationPath(
  features: PathSceneFeatures,
  override?: { forcePath?: OptimizationPath; rlOverrideReason?: string },
): PathSelectionReadout {
  if (override?.forcePath === 'rl') {
    if (!override.rlOverrideReason || override.rlOverrideReason.trim() === '') {
      throw new PolicyGradientError(
        '强制 rl 路径须给 rlOverrideReason（直接评分场景监督路径方差更低——硬转 RL 须留痕）',
      );
    }
    return { path: 'rl', mode: 'rl', reason: `显式强制：${override.rlOverrideReason}` };
  }
  if (override?.forcePath === 'supervised-first') {
    return { path: 'supervised-first', mode: 'supervised-first', reason: '显式指定（配置声明）' };
  }
  const directScoring =
    !features.hasTrajectory && !features.delayedLabels && !features.distributionDependentSampling;
  if (directScoring) {
    return {
      path: 'supervised-first',
      mode: 'supervised-first',
      reason: '直接评分场景（无轨迹/无延迟标签/无分布依赖采样）——监督 Brier/交叉熵同期望最优且方差更低',
    };
  }
  return {
    path: 'rl',
    mode: 'rl',
    reason: '分布依赖采样推理/动作改变观察/标签沿轨迹到达——RL 必要场景',
  };
}

// ════════════════════════════════════════
// 策略梯度回路（配置装配 + 单步损失计算）
// ════════════════════════════════════════

/** RLCD 训练配置（配置三件显式可查的总载体——测试断言面） */
export interface RlcdPolicyGradientConfig {
  /** 基线估计器（锁定 'rloo'——非组均值的可断言落点） */
  baselineMethod: 'rloo';
  /** KL 锚（在位标记 + 系数——防 System-One 坍缩） */
  klAnchor: { enabled: true; coefficient: number; budgetThreshold: number };
  /** 模式（supervised-first / rl——路径选择器产物） */
  mode: OptimizationPath;
  /** 策略梯度项降权系数（生效值） */
  policyGradientDownweight: number;
  /** 随机种子（可复现清单成员） */
  seed: number;
  /** 学习率 */
  learningRate: number;
  /** 组容量（RLOO 留一的最小分组） */
  groupSize: number;
}

/**
 * 装配 RLCD 训练配置（三防线一次成型 + 显式可查）：
 * 调用方给的 seed/lr/groupSize 入配置；baseline/klAnchor/mode 三件由本函数
 * 显式落值（不接受隐式缺省——查配置即查三防线在位状态）。
 */
export function buildRlcdConfig(input: {
  seed: number;
  learningRate: number;
  groupSize?: number;
  klAnchorCoefficient?: number;
  klBudgetThreshold?: number;
  downweightCoefficient?: number;
  pathOverride?: { forcePath?: OptimizationPath; rlOverrideReason?: string };
  sceneFeatures?: PathSceneFeatures;
}): RlcdPolicyGradientConfig {
  const downweight = resolveDownweight(input.downweightCoefficient);
  const path = selectOptimizationPath(
    input.sceneFeatures ?? { hasTrajectory: false, delayedLabels: false, distributionDependentSampling: false },
    input.pathOverride,
  );
  if (input.learningRate <= 0) throw new PolicyGradientError('学习率须 > 0');
  const groupSize = input.groupSize ?? 8;
  if (!Number.isInteger(groupSize) || groupSize < 1) {
    throw new PolicyGradientError(`组容量 ${groupSize} 须为正整数`);
  }
  return {
    baselineMethod: 'rloo',
    klAnchor: {
      enabled: true,
      coefficient: input.klAnchorCoefficient ?? KL_ANCHOR_COEFFICIENT,
      budgetThreshold: input.klBudgetThreshold ?? 1.0,
    },
    mode: path.path,
    policyGradientDownweight: downweight.coefficient,
    seed: input.seed,
    learningRate: input.learningRate,
    groupSize,
  };
}

/** 单步策略梯度损失入参 */
export interface PolicyStepInput {
  /** 组内奖励（来自评分规则——scoreByPrimitive 或其监督等价物） */
  rewards: readonly number[];
  /** 策略对数概率（各样本 log π(a|s)——REINFORCE 的对数概率项） */
  logProbs: readonly number[];
  /** 策略当前分布（KL 锚的 policy 侧——按批均值） */
  policyDistribution: readonly number[];
  /** 锚分布（防坍缩参照——校准检查点或均匀先验） */
  anchorDistribution: readonly number[];
}

/** 单步损失读数（损失分解显式落数——审计可拆账） */
export interface PolicyStepLoss {
  /** 总损失（REINFORCE 主项 + KL 锚——策略梯度主项已乘降权系数） */
  total: number;
  /** REINFORCE 主项（已降权：downweight × mean[(r − b)·logπ] 的负值） */
  reinforceTerm: number;
  /** KL 锚项 */
  klAnchorTerm: number;
  /** RLOO 基线读数（非组均值的证据面） */
  rloo: RlooReadout;
  /** KL 锚读数（在位 + 超预算提示） */
  klAnchor: KlAnchorReadout;
  /** 降权读数（系数 + 依据） */
  downweight: DownweightReadout;
}

/**
 * 单步策略梯度损失（REINFORCE + RLOO 基线 + KL 锚 + 降权）：
 *   reinforceTerm = −downweight × mean_i[(r_i − baseline_i) · logπ_i]
 *   klAnchorTerm  = klCoeff × KL(policy ‖ anchor)
 *   total         = reinforceTerm + klAnchorTerm
 * 长度一致性校验（rewards × logProbs）不一致即拒载。
 */
export function policyStepLoss(
  config: RlcdPolicyGradientConfig,
  input: PolicyStepInput,
): PolicyStepLoss {
  if (input.rewards.length !== input.logProbs.length) {
    throw new PolicyGradientError(
      `rewards(${input.rewards.length}) 与 logProbs(${input.logProbs.length}) 长度不一致`,
    );
  }
  if (input.rewards.length === 0) {
    throw new PolicyGradientError('空批（无样本可算损失——fail-closed 拒载）');
  }
  // RLOO：整批作为一组留一（组内每样本的基线 = 其余样本奖励均值）
  const rloo = rlooBaseline([input.rewards]);
  const downweight = resolveDownweight(config.policyGradientDownweight);
  let acc = 0;
  for (let i = 0; i < input.rewards.length; i++) {
    const advantage = (input.rewards[i] as number) - (rloo.baselines[i] as number);
    acc += advantage * (input.logProbs[i] as number);
  }
  const reinforceTerm = -downweight.coefficient * (acc / input.rewards.length);
  const anchor = klAnchorLoss(input.policyDistribution, input.anchorDistribution, {
    coefficient: config.klAnchor.coefficient,
    budgetThreshold: config.klAnchor.budgetThreshold,
  });
  return {
    total: reinforceTerm + anchor.loss,
    reinforceTerm,
    klAnchorTerm: anchor.loss,
    rloo,
    klAnchor: anchor.readout,
    downweight,
  };
}
