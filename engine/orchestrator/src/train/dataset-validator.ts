// dataset-validator.ts · v1.4.5 章一 · 训练集质量闸门（不达标拒绝提交）
//
// 定位：数据质检 = 决策点（v1.4.5 架构主线拍板）——训练集提交前的最后一道
// 闸门：字段完整性 / 样本量 / 标签分布三项检查，不达标 → 结构化错误拒绝
// （不是告警放行——垃圾进垃圾出，训出来的模型不可用还烧算力）。
//
// 「质量闸门由受约束的训练 Agent 把关」：本模块输出结构化判定
// （passed / violations / warnings），决策面（训练 Agent / 人审）消费判定
// 决定拒绝或放行——多源接入管道（data-ingest/db-source）走代码，闸门
// 判定走决策点，两层职责分离。
//
// 三项检查语义：
//   1. 字段完整性：每样本必填字段非空（按算法——sft: instruction+output；
//      dpo: prompt+chosen+rejected；grpo: prompt）
//   2. 样本量：达到最低样本数（缺省 10——与 dry-run 极小数据集口径一致）
//   3. 标签分布：离散标签列（可指定）不得单一化（占比超 maxDominance
//      即离谱——训练集全一类标签训出恒输出模型）；连续列跳过
//
// 复用来源：消费 dataset-builder 的 DatasetLine / DatasetAlgorithm 模型；
// 检查是纯函数（零 IO——对齐 v1.4.1 train-protocol 校验层模式）。

import type { DatasetAlgorithm, DatasetLine } from './dataset-builder';

// ══════════════════════════════════════
// 闸门配置与判定模型
// ══════════════════════════════════════

/** 质量闸门阈值配置（阈值外部化雏形——部署侧可调，机制开源） */
export interface DatasetValidatorOptions {
  /** 最低样本量（缺省 10） */
  minSamples?: number;
  /** 标签分布检查的标签列名（缺省不查——无标签数据不强制） */
  labelColumn?: string;
  /** 标签单一化占比上限 0..1（单一标签占比超此值即违规；缺省 0.95） */
  maxLabelDominance?: number;
}

/** 闸门违规类型 */
export type DatasetViolationCode =
  | 'empty_dataset' // 空数据集
  | 'insufficient_samples' // 样本量不足
  | 'missing_fields' // 字段完整性（必填字段空/缺失）
  | 'label_imbalance'; // 标签分布离谱（单一化）

/** 单条违规（结构化——决策面消费，机器可判） */
export interface DatasetViolation {
  code: DatasetViolationCode;
  /** 人读说明（拒绝原因——附修复建议） */
  message: string;
  /** 违规规模（如缺字段样本数——严重度研判） */
  count?: number;
}

/** 非阻断告警（不拒提交但需决策面知晓） */
export interface DatasetWarning {
  code: 'near_min_samples' | 'empty_optional_fields' | 'label_column_missing';
  message: string;
}

/** 闸门判定结果 */
export interface DatasetValidationResult {
  /** 是否通过（violations 空 = 通过） */
  passed: boolean;
  algorithm: DatasetAlgorithm;
  /** 样本总数（闸门输入行数） */
  sampleCount: number;
  violations: DatasetViolation[];
  warnings: DatasetWarning[];
  /** 标签分布概览（指定 labelColumn 且存在时给出——决策面研判输入） */
  labelDistribution?: Array<{ label: string; count: number; ratio: number }>;
}

// ══════════════════════════════════════
// 字段完整性（按算法的必填字段集合）
// ══════════════════════════════════════

/** 按算法取必填字段（空串 = 缺失——builder 侧 sanitizeCell 已把 null → ''） */
export function requiredFieldsOf(algorithm: DatasetAlgorithm): string[] {
  switch (algorithm) {
    case 'sft':
      return ['instruction', 'output'];
    case 'dpo':
      return ['prompt', 'chosen', 'rejected'];
    case 'grpo':
      return ['prompt'];
  }
}

/** 判定样本的某字段是否为空（undefined / null / 空白串） */
function isFieldEmpty(sample: Record<string, unknown>, field: string): boolean {
  const v = sample[field];
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

/** 统计样本某字段的字符串形态值（非 string 归一 String()——标签列概览用） */
function fieldLabelOf(sample: Record<string, unknown>, field: string): string {
  const v = sample[field];
  if (v === undefined || v === null) return '(空)';
  return typeof v === 'string' ? v.trim() : String(v);
}

// ══════════════════════════════════════
// 标签分布（纯函数）
// ══════════════════════════════════════

/**
 * 计算标签列分布（计数 + 占比，降序）。
 * 连续列（唯一值数 ≥ 样本数的 90%）返回原样分布——由 maxLabelDominance
 * 判定天然不违规（连续值单一化占比不可能超阈），概览照给（研判输入）。
 */
export function computeLabelDistribution(
  lines: readonly DatasetLine[],
  labelColumn: string,
): Array<{ label: string; count: number; ratio: number }> {
  const counter = new Map<string, number>();
  for (const line of lines) {
    const label = fieldLabelOf(line.sample as unknown as Record<string, unknown>, labelColumn);
    counter.set(label, (counter.get(label) ?? 0) + 1);
  }
  const total = lines.length;
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, ratio: total > 0 ? count / total : 0 }));
}

// ══════════════════════════════════════
// 质量闸门主判定（纯函数）
// ══════════════════════════════════════

/**
 * 训练集质量闸门：字段完整性 / 样本量 / 标签分布三项检查。
 *
 * 违规即 passed=false（结构化拒绝——决策点消费后拒绝提交 train job）；
 * 告警不阻断（near_min_samples 接近下限 / 可选字段全空——人工研判输入）。
 */
export function validateDataset(
  lines: readonly DatasetLine[],
  algorithm: DatasetAlgorithm,
  options: DatasetValidatorOptions = {},
): DatasetValidationResult {
  const minSamples = options.minSamples ?? 10;
  const maxLabelDominance = options.maxLabelDominance ?? 0.95;
  const violations: DatasetViolation[] = [];
  const warnings: DatasetWarning[] = [];

  // ── 检查一：空数据集（先于一切——空集谈不上后续检查）──
  if (lines.length === 0) {
    return {
      passed: false,
      algorithm,
      sampleCount: 0,
      violations: [
        {
          code: 'empty_dataset',
          message: '训练集为空——数据管道未产出任何样本，拒绝提交（检查数据源与列映射）',
        },
      ],
      warnings,
    };
  }

  // ── 检查二：字段完整性（必填字段逐样本扫描）──
  const required = requiredFieldsOf(algorithm);
  const missingByField = new Map<string, number>();
  for (const line of lines) {
    const sample = line.sample as unknown as Record<string, unknown>;
    for (const field of required) {
      if (isFieldEmpty(sample, field)) {
        missingByField.set(field, (missingByField.get(field) ?? 0) + 1);
      }
    }
  }
  if (missingByField.size > 0) {
    const detail = [...missingByField.entries()]
      .map(([field, count]) => `${field}（${count}/${lines.length} 样本为空）`)
      .join('、');
    violations.push({
      code: 'missing_fields',
      count: Math.max(...missingByField.values()),
      message: `字段完整性未过：必填字段 ${required.join('/')} 存在空值——${detail}`,
    });
  }

  // ── 检查三：样本量 ──
  if (lines.length < minSamples) {
    violations.push({
      code: 'insufficient_samples',
      count: lines.length,
      message: `样本量不足：${lines.length} < 最低 ${minSamples}（训练信号不够，先补数据再提交）`,
    });
  } else if (lines.length < minSamples * 2) {
    warnings.push({
      code: 'near_min_samples',
      message: `样本量 ${lines.length} 逼近下限 ${minSamples}（不足 2 倍——过拟合风险偏高，建议扩样）`,
    });
  }

  // ── 检查四：标签分布（指定 labelColumn 时）──
  let labelDistribution: DatasetValidationResult['labelDistribution'];
  if (options.labelColumn !== undefined && options.labelColumn !== '') {
    const first = lines[0]?.sample as Record<string, unknown> | undefined;
    const columnExists = first !== undefined && first[options.labelColumn] !== undefined;
    if (!columnExists) {
      warnings.push({
        code: 'label_column_missing',
        message: `标签列 ${options.labelColumn} 不在样本字段中——跳过分布检查（检查列名拼写或数据源）`,
      });
    } else {
      labelDistribution = computeLabelDistribution(lines, options.labelColumn);
      const top = labelDistribution[0];
      if (top !== undefined && top.ratio > maxLabelDominance && labelDistribution.length > 1) {
        violations.push({
          code: 'label_imbalance',
          count: top.count,
          message: `标签分布离谱：标签「${top.label}」占比 ${(top.ratio * 100).toFixed(1)}% 超上限 ${(maxLabelDominance * 100).toFixed(0)}%——单一化标签训出恒输出模型，先做类别均衡`,
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    algorithm,
    sampleCount: lines.length,
    violations,
    warnings,
    ...(labelDistribution !== undefined ? { labelDistribution } : {}),
  };
}
