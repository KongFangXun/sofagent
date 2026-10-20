// retention-report.ts · v1.7.0 §一 · 保留能力对照落数（目标能力 / 保留能力分列）
// ============================================================
// 定位：微调不是单调增益——判定能力上去了、通用读出能力可能下来（SSOT §一
// 交付表「基座能力流失」行）。本文件把验收要求落成**结构约束**而非报告模板：
//   - 目标能力（判定一致率）与保留能力（基座既有零样本读出）两组数**分列**，
//     两个非空键**缺一即拒载**（「合并即失败」的类型层落法）；
//   - 保留能力跌幅超配置阈值（默认 5 个百分点，随「只许收紧」纪律走——
//     构造器拒绝放宽方向）⇒ 标 `recipe-not-converged`（配方未收敛——先调
//     配方再判训练成败，不把「用基础能力换判定能力」当成训练成功）；
//   - 禁止单一综合分：结构里不存在合计键，合并读数在类型层无处可落。
//
// 纯函数层：训练前后读数进，对照结论出。
// ============================================================

/** 保留能力对照错误（fail-closed 载体） */
export class RetentionReportError extends Error {
  constructor(message: string) {
    super(`[retention-report] ${message}`);
    this.name = 'RetentionReportError';
  }
}

/** 保留能力跌幅阈值默认值（5 个百分点——SSOT 冻结口径，只许收紧） */
export const DEFAULT_RETENTION_DROP_THRESHOLD_PP = 5;

/** 阈值收紧下限（再低于 1pp 即噪声量级——收紧到无法区分训练噪声没意义） */
export const RETENTION_DROP_THRESHOLD_FLOOR_PP = 1;

/** 单项能力读数（能力名 + 训练前/后各一次读数） */
export interface CapabilityReading {
  /** 能力名（如 'judge-agreement' / 'zero-shot-mmlu'——非空） */
  name: string;
  /** 训练前读数 ∈ [0,1]（基座零样本/训练入口基线） */
  before: number;
  /** 训练后读数 ∈ [0,1] */
  after: number;
}

/** 配方收敛判定（跌幅 ≤ 阈值为 converged；超阈为 recipe-not-converged） */
export type RecipeConvergence = 'converged' | 'recipe-not-converged';

/** 保留能力对照报告（双键分列的结构载体） */
export interface RetentionReport {
  /** 目标能力组（判定一致率等——非空键） */
  targetCapabilities: CapabilityReading[];
  /** 保留能力组（基座既有零样本读出——非空键） */
  retainedCapabilities: CapabilityReading[];
  /** 保留能力最大跌幅（百分点，正数 = 下降） */
  maxRetentionDropPP: number;
  /** 跌幅阈值（生效值——配置审计面） */
  dropThresholdPP: number;
  /** 配方收敛判定（超阈 = recipe-not-converged） */
  recipeConvergence: RecipeConvergence;
  /** 各保留能力项的分项跌幅（百分点——分列落数，禁合并综合分） */
  perCapabilityDropPP: Array<{ name: string; dropPP: number }>;
}

/** 读数合法性校验（[0,1] + 名非空） */
function assertReading(r: CapabilityReading, group: string): void {
  if (typeof r.name !== 'string' || r.name.trim() === '') {
    throw new RetentionReportError(`${group} 含无名能力项（name 非空必填）`);
  }
  if (!Number.isFinite(r.before) || r.before < 0 || r.before > 1) {
    throw new RetentionReportError(`${group}[${r.name}].before 越界 [0,1]：${r.before}`);
  }
  if (!Number.isFinite(r.after) || r.after < 0 || r.after > 1) {
    throw new RetentionReportError(`${group}[${r.name}].after 越界 [0,1]：${r.after}`);
  }
}

/**
 * 构建保留能力对照报告：
 *   - 两组非空（目标/保留各至少一项——空组即拒载，「合并即失败」的类型层落法）
 *   - 保留能力跌幅 = (before − after) × 100 百分点；超阈值 → recipe-not-converged
 *   - 阈值默认 5pp，可收紧（≤ 5），放宽方向（> 5）拒绝——「只许收紧」纪律的
 *     构造器落法
 */
export function buildRetentionReport(input: {
  targetCapabilities: CapabilityReading[];
  retainedCapabilities: CapabilityReading[];
  dropThresholdPP?: number;
}): RetentionReport {
  if (input.targetCapabilities.length === 0) {
    throw new RetentionReportError('目标能力组为空（两非空键缺一——fail-closed 拒载）');
  }
  if (input.retainedCapabilities.length === 0) {
    throw new RetentionReportError('保留能力组为空（两非空键缺一——fail-closed 拒载）');
  }
  const threshold = input.dropThresholdPP ?? DEFAULT_RETENTION_DROP_THRESHOLD_PP;
  if (threshold > DEFAULT_RETENTION_DROP_THRESHOLD_PP) {
    throw new RetentionReportError(
      `跌幅阈值 ${threshold}pp 超默认 ${DEFAULT_RETENTION_DROP_THRESHOLD_PP}pp（只许收紧不许放宽）`,
    );
  }
  if (threshold < RETENTION_DROP_THRESHOLD_FLOOR_PP) {
    throw new RetentionReportError(
      `跌幅阈值 ${threshold}pp 低于下限 ${RETENTION_DROP_THRESHOLD_FLOOR_PP}pp（低于训练噪声量级）`,
    );
  }
  for (const r of input.targetCapabilities) assertReading(r, '目标能力组');
  for (const r of input.retainedCapabilities) assertReading(r, '保留能力组');

  const perCapabilityDropPP = input.retainedCapabilities.map((r) => ({
    name: r.name,
    dropPP: (r.before - r.after) * 100,
  }));
  const maxRetentionDropPP = Math.max(0, ...perCapabilityDropPP.map((d) => d.dropPP));
  return {
    targetCapabilities: [...input.targetCapabilities],
    retainedCapabilities: [...input.retainedCapabilities],
    maxRetentionDropPP,
    dropThresholdPP: threshold,
    recipeConvergence: maxRetentionDropPP > threshold ? 'recipe-not-converged' : 'converged',
    perCapabilityDropPP,
  };
}
