// train-dryrun.ts · v1.5.7 章五 · 训练 dry-run 与配置预检（失败前预防）
//
// 定位：长任务训练最怕跑了一半发现配置错（显存不够、数据格式错、
// 学习率发散）。v1.5.7 有 job.json schema 校验（格式对不对），本文件
// 补「失败前的预检」：管线连通 + 显存估算 + 数据抽样 + 算力外推。
//
// 四项预检（全部结构化报告，不抛错——体检语义）：
//   ① 管线连通：极小数据集（10 条）跑通 数据→构建→闸门 链路
//      （不真训练——验证数据能读、格式能解析、训练集能建）
//   ② 数据预检：训练集抽样检查（复用章一 dataset-validator 闸门——
//      dry-run 语义放宽 minSamples=1，只验质量硬伤不验量）
//   ③ 显存预检：模型参数量 + batch size + 优化器状态 → 估算显存占用
//      超 GPU 上限提前告警（不是 OOM 崩了才知道）
//   ④ 算力外推：pilot 数据点 → sigmoid 缩放律拟合 → 目标规模性能/
//      成本外推（复用 scale-curve；外推成本超预算 → 告警——预算控制
//      事前化衔接 v1.4.1 train-budget）
//   ⑤ instinct 源混合构建（可选输入 · v1.5.8 章三）：传入 instinctRecords 时
//      归一后与外部源记录合并进**同一个** buildDataset（旁挂接入，builder 零改动）
//
// 复用来源：
//   - data-ingest（章一）：ingestFile 按扩展名路由四源
//   - dataset-builder（章一）：buildDataset / inferColumnMapping
//   - dataset-validator（章一）：validateDataset / requiredFieldsOf
//   - scale-curve（本版章五）：fitSigmoid / extrapolate / suggestNextPilotCompute
//   - instinct-source（v1.5.8 章三）：ingestInstinctSource / mergeForDatasetBuild
//
// 可测试性：纯函数 + 文件系统 fixture（临时目录小 CSV）——零真实训练。
//
// v1.5.8 章三架构决策的落地形态：instinct 源是**旁挂适配器**，接入点选在
// 本文件（train-dryrun = 数据集构建的生产消费面），dataset-builder.ts 零改动
// ——它的入参 IngestRecord[] 对来源完全无感，混合构建天然成立。

import { existsSync } from 'fs';
import { ingestFile } from './data-ingest';
import { buildDataset, inferColumnMapping, type DatasetAlgorithm } from './dataset-builder';
import { validateDataset, requiredFieldsOf } from './dataset-validator';
import { fitSigmoid, extrapolate, suggestNextPilotCompute, type ScaleCurvePoint, type Extrapolation } from './scale-curve';
import {
  ingestInstinctSource,
  mergeForDatasetBuild,
  extractLineageAnchor,
  type InstinctSourceRecord,
  type InstinctDatasetAnchor,
} from './instinct-source';

// ══════════════════════════════════════
// 显存估算（纯函数——经验公式）
// ══════════════════════════════════════

/** 显存估算输入 */
export interface VramEstimateInput {
  /** 模型参数量（十亿为单位，如 8 = 8B） */
  paramsBillions: number;
  /** batch size */
  batchSize: number;
  /** 序列长度（token 数） */
  sequenceLength: number;
  /** 精度（字节/参数：fp32=4 / bf16=2 / 混合精度=2） */
  bytesPerParam?: number;
  /** 优化器状态倍数（Adam ≈ 2x 参数量；缺省 2） */
  optimizerMultiplier?: number;
  /** 梯度检查点（开启 → 激活内存 /sqrt(batch)；缺省 false） */
  gradientCheckpointing?: boolean;
}

/** 显存估算结果 */
export interface VramEstimate {
  /** 模型权重（GiB） */
  weightsGiB: number;
  /** 优化器状态（GiB） */
  optimizerGiB: number;
  /** 激活值（GiB——batch × 序列长相关） */
  activationsGiB: number;
  /** 合计估算（GiB） */
  totalGiB: number;
  /** 估算公式说明（人读——报告消费） */
  formula: string;
}

/**
 * 显存估算（经验公式——量级正确即可，精确值由框架实测）：
 *   权重     = params × bytesPerParam
 *   优化器   = 权重 × optimizerMultiplier（Adam 两动量）
 *   激活     = params × sqrt(batch × seq) × 0.02（近似——梯度检查点
 *              开启再除以 sqrt(batch)）
 * 结果换算 GiB（1B 参数 fp32 = 4 GiB 量级）。
 */
export function estimateVram(input: VramEstimateInput): VramEstimate {
  const bytesPerParam = input.bytesPerParam ?? 2; // 混合精度训练缺省
  const optMult = input.optimizerMultiplier ?? 2;
  const P = input.paramsBillions;
  const weights = P * bytesPerParam;
  const optimizer = weights * optMult;
  const rawActivations = P * Math.sqrt(input.batchSize * input.sequenceLength) * 0.02;
  const activations = input.gradientCheckpointing ? rawActivations / Math.sqrt(input.batchSize) : rawActivations;
  const total = weights + optimizer + activations;
  return {
    weightsGiB: round1(weights),
    optimizerGiB: round1(optimizer),
    activationsGiB: round1(activations),
    totalGiB: round1(total),
    formula: `权重 ${round1(weights)} = ${P}B × ${bytesPerParam}B/param；优化器 ${round1(optimizer)} = 权重 × ${optMult}；激活 ${round1(activations)}（batch=${input.batchSize}，seq=${input.sequenceLength}${input.gradientCheckpointing ? '，梯度检查点' : ''}）——量级估算，精确值以框架实测为准`,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ══════════════════════════════════════
// dry-run 预检报告模型
// ══════════════════════════════════════

/** 预检项状态 */
export interface DryrunCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  detail: string;
}

/** instinct 源混合构建的接线结果（DryrunResult 的可选面——传了 instinct 才有） */
export interface InstinctSourceCheck {
  /** 归一后进入构建的 instinct 记录数 */
  accepted: number;
  /** 源侧拒收数（真实性门 fail-closed 的透传） */
  rejected: number;
  /** 合并后进入同一个 buildDataset 的总记录数 */
  mergedTotal: number;
  /** 产物中来自 instinct 源的样本行数（混合构建的真值——不是"应该能进"） */
  instinctLines: number;
  /** 构建产物总行数 */
  totalLines: number;
  /** 数据集血缘锚点（权重 → 数据集 → 经验源反向追溯） */
  lineage: InstinctDatasetAnchor;
}

/** dry-run 结果（结构化——MCP train_dryrun 直接消费） */
export interface DryrunResult {
  /** 整体结论（任一 fail → false；warn 不阻断） */
  passed: boolean;
  checks: DryrunCheck[];
  /** 显存估算（启用时给） */
  vramEstimate?: VramEstimate;
  /** 算力外推（启用时给） */
  extrapolation?: Extrapolation;
  /** 下一个 pilot 规模建议（外推置信低时给——补点提升置信） */
  nextPilotCompute?: number | null;
  /** instinct 源混合构建摘要（传了 instinctRecords 才有） */
  instinct?: InstinctSourceCheck;
}

// ══════════════════════════════════════
// dry-run 编排
// ══════════════════════════════════════

/** dry-run 入参 */
export interface DryrunInput {
  /** 数据文件路径（CSV/Excel/JSON/文本——ingestFile 按扩展名路由） */
  dataPath: string;
  /** 训练算法 */
  algorithm: DatasetAlgorithm;
  /** 列映射（缺省 inferColumnMapping 推断） */
  columnMapping?: Record<string, string>;
  /** 显存预检输入（缺省跳过显存预检） */
  vram?: VramEstimateInput & { gpuVramMiB?: number };
  /** 算力外推（pilot 数据点 + 目标规模；缺省跳过外推） */
  extrapolate?: {
    points: ScaleCurvePoint[];
    targetCompute: number;
    /** 成本单价（元/GPU小时——外推成本告警用） */
    costPerUnit?: number;
    /** 预算上限（元——超限告警） */
    budgetCap?: number;
  };
  /** 依赖注入：管线连通样本上限（缺省 10 条） */
  pipelineSampleLimit?: number;
  /**
   * instinct 源记录（可选输入 · v1.5.8 章三旁挂接入点）。
   * 传入时归一后与外部源记录合并成同一 records 数组喂给**同一个**
   * buildDataset；缺省则全流程与 v1.5.7 逐字一致（零行为变化）。
   */
  instinctRecords?: readonly InstinctSourceRecord[];
}

/**
 * 训练 dry-run：管线连通 + 数据抽样 + 显存估算 + 算力外推四项预检，
 * 另附可选的 instinct 源混合构建检查（传了 instinctRecords 才启用）。
 *
 * 不真训练——验证「数据能读、格式能解析、训练集能建、显存够不够、
 * 值不值得投」。全部结构化报告（passed=false 时 checks 指明哪项挂了）。
 */
export function runDryrun(input: DryrunInput): DryrunResult {
  const checks: DryrunCheck[] = [];
  const limit = input.pipelineSampleLimit ?? 10;

  // ── ①+② 数据读取一次，管线连通与数据预检共用 ──
  let records: ReturnType<typeof ingestFile>['records'] | null = null;
  let columns: string[] = [];
  if (!existsSync(input.dataPath)) {
    checks.push({
      name: 'pipeline-connectivity',
      status: 'fail',
      detail: `数据文件不存在：${input.dataPath}`,
    });
  } else {
    try {
      const ingested = ingestFile(input.dataPath);
      records = ingested.records;
      columns = ingested.columns;
      if (records.length === 0) {
        checks.push({ name: 'pipeline-connectivity', status: 'fail', detail: '数据文件解析后为空（0 条记录）' });
      }
    } catch (err) {
      checks.push({
        name: 'pipeline-connectivity',
        status: 'fail',
        detail: `数据解析失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── ⑤ instinct 源混合构建（v1.5.8 章三旁挂接入 · 可选输入） ──
  // 归一 → mergeForDatasetBuild 并入同一 records/columns → 后续 ①② 与外部源
  // 走**同一个** buildDataset（dataset-builder.ts 零改动：其入参对来源无感）。
  let instinct: InstinctSourceCheck | undefined;
  let instinctRecordIds: ReadonlySet<string> = new Set();
  if (input.instinctRecords !== undefined) {
    const ing = ingestInstinctSource(input.instinctRecords);
    instinctRecordIds = new Set(ing.records.map((r) => r.id));
    let mergedTotal = 0;
    if (records !== null) {
      const merged = mergeForDatasetBuild({ records, columns }, ing);
      records = merged.records;
      columns = merged.columns;
      mergedTotal = merged.records.length;
    }
    // 外部源不可读时 mergedTotal 保持 0——混合构建未发生，根因见 pipeline-connectivity
    instinct = {
      accepted: ing.records.length,
      rejected: ing.rejected.length,
      mergedTotal,
      instinctLines: 0,
      totalLines: 0,
      lineage: extractLineageAnchor(ing.records),
    };
  }

  if (records !== null && records.length > 0) {
    const mapping =
      input.columnMapping !== undefined
        ? { ...inferColumnMapping(columns), ...input.columnMapping }
        : inferColumnMapping(columns);
    const required = requiredFieldsOf(input.algorithm);
    const mappedCols = Object.values(mapping);
    const missing = required.filter((col) => !mappedCols.includes(col));

    // ── ① 管线连通（10 条试构建） ──
    if (missing.length > 0) {
      checks.push({
        name: 'pipeline-connectivity',
        status: 'fail',
        detail: `列映射缺必填列：${missing.join(', ')}（推断/给定映射 ${JSON.stringify(mapping)}——请改列名或显式传 columnMapping）`,
      });
    } else {
      const sample = records.slice(0, limit);
      const built = buildDataset(sample, columns, {
        algorithm: input.algorithm,
        columnMapping: mapping,
      });
      checks.push({
        name: 'pipeline-connectivity',
        status: 'ok',
        detail: `管线连通：${records.length} 条读取，取 ${sample.length} 条试构建 → ${built.lines.length} 条样本成型（跳过 ${built.skipped}；列映射 ${JSON.stringify(mapping)}）`,
      });
    }

    // ── ② 数据预检（复用章一闸门——minSamples 放宽为 1 只验质量硬伤） ──
    const builtFull = buildDataset(records, columns, {
      algorithm: input.algorithm,
      columnMapping: mapping,
    });
    // 混合构建的真值：从产物行里点出 instinct 来源的行（不是"应该能进"）
    if (instinct !== undefined) {
      instinct.instinctLines = builtFull.lines.filter((l) => instinctRecordIds.has(l.meta.recordId)).length;
      instinct.totalLines = builtFull.lines.length;
    }
    if (missing.length > 0) {
      checks.push({
        name: 'data-preflight',
        status: 'fail',
        detail: `数据预检无法执行：必填列 ${missing.join(', ')} 缺失——先修列映射`,
      });
    } else if (builtFull.lines.length === 0) {
      checks.push({
        name: 'data-preflight',
        status: 'fail',
        detail: `构建后 0 条样本（跳过 ${builtFull.skipped} 行：${builtFull.skipReasons.join('；')}）——检查必填字段是否为空`,
      });
    } else {
      const gate = validateDataset(builtFull.lines, input.algorithm, { minSamples: 1 });
      const hardViolations = gate.violations.filter(
        (v) => v.code === 'empty_dataset' || v.code === 'missing_fields' || v.code === 'label_imbalance',
      );
      if (hardViolations.length > 0) {
        checks.push({
          name: 'data-preflight',
          status: 'fail',
          detail: `数据质量硬伤：${hardViolations.map((v) => `${v.code}（${v.message}）`).join('；')}`,
        });
      } else if (builtFull.lines.length < 10) {
        checks.push({
          name: 'data-preflight',
          status: 'warn',
          detail: `样本量 ${builtFull.lines.length} 条（< 10）——正式训练前建议积累更多数据（构建跳过 ${builtFull.skipped} 行）`,
        });
      } else {
        checks.push({
          name: 'data-preflight',
          status: 'ok',
          detail: `数据预检通过：${builtFull.lines.length} 条样本，无字段缺失/标签失衡（跳过 ${builtFull.skipped} 行可容忍）`,
        });
      }
    }
  }

  // ── ⑤ instinct 源混合构建检查（v1.5.8 章三 · 未传输入则 skip） ──
  if (instinct === undefined) {
    checks.push({
      name: 'instinct-source-connectivity',
      status: 'skip',
      detail: '未提供 instinct 记录——跳过（纯外部源构建，行为与 v1.5.7 一致）',
    });
  } else if (instinct.mergedTotal === 0) {
    checks.push({
      name: 'instinct-source-connectivity',
      status: 'fail',
      detail: `instinct 源归一 ${instinct.accepted} 条但未合并进数据集（外部源不可读，见 pipeline-connectivity）`,
    });
  } else if (instinct.instinctLines === 0) {
    checks.push({
      name: 'instinct-source-connectivity',
      status: 'fail',
      detail: `instinct 源归一 ${instinct.accepted} 条（拒收 ${instinct.rejected} 条）并入 ${instinct.mergedTotal} 条合并记录，但产物 ${instinct.totalLines} 行中无 instinct 来源行——混合构建未成立`,
    });
  } else {
    checks.push({
      name: 'instinct-source-connectivity',
      status: 'ok',
      detail: `instinct 源归一 ${instinct.accepted} 条（拒收 ${instinct.rejected} 条：${instinct.rejected > 0 ? '真实性门 fail-closed' : '无'}），与外部源合并为 ${instinct.mergedTotal} 条喂入同一个 buildDataset → 产物 ${instinct.totalLines} 行（其中 instinct 来源 ${instinct.instinctLines} 行；血缘锚点 ${instinct.lineage.instinctIds.length} 条：${instinct.lineage.instinctIds.join(', ')}）`,
    });
  }

  // ── ③ 显存预检 ──
  let vramEstimate: VramEstimate | undefined;
  if (input.vram) {
    const est = estimateVram(input.vram);
    vramEstimate = est;
    const gpuGiB = input.vram.gpuVramMiB !== undefined ? input.vram.gpuVramMiB / 1024 : null;
    if (gpuGiB !== null) {
      if (est.totalGiB > gpuGiB) {
        checks.push({
          name: 'vram-preflight',
          status: 'fail',
          detail: `显存不足：估算需 ${est.totalGiB} GiB > GPU 可用 ${round1(gpuGiB)} GiB（${est.formula}）——降 batch/开梯度检查点/换小模型/用 LoRA`,
        });
      } else {
        checks.push({
          name: 'vram-preflight',
          status: 'ok',
          detail: `显存充裕：估算需 ${est.totalGiB} GiB ≤ GPU 可用 ${round1(gpuGiB)} GiB（余量 ${round1(gpuGiB - est.totalGiB)} GiB）`,
        });
      }
    } else {
      checks.push({
        name: 'vram-preflight',
        status: 'warn',
        detail: `显存估算 ${est.totalGiB} GiB（${est.formula}）——未提供 GPU 上限（gpuVramMiB），无法比对`,
      });
    }
  } else {
    checks.push({ name: 'vram-preflight', status: 'skip', detail: '未提供显存估算输入——跳过' });
  }

  // ── ④ 算力外推 ──
  let extrapolation: Extrapolation | undefined;
  let nextPilotCompute: number | null | undefined;
  if (input.extrapolate && input.extrapolate.points.length > 0) {
    const fit = fitSigmoid(input.extrapolate.points);
    extrapolation = extrapolate(input.extrapolate.points, input.extrapolate.targetCompute, fit);
    if (extrapolation.confidence === 'low') {
      nextPilotCompute = suggestNextPilotCompute(input.extrapolate.points);
    }
    const note = `外推性能 ${extrapolation.projectedPerformance ?? '不可推'}（band ${extrapolation.band.lower ?? '-'}~${extrapolation.band.upper ?? '-'}，天花板 ${extrapolation.ceiling ?? '线性兜底'}）·置信 ${extrapolation.confidence}——${extrapolation.confidenceNote}${nextPilotCompute !== undefined && nextPilotCompute !== null ? `；建议补 pilot 点：compute=${nextPilotCompute}` : ''}`;
    // 成本外推：目标算力 × 单价 → 总成本；超预算 → warn 告警（预算事前化）
    const costPerUnit = input.extrapolate.costPerUnit;
    if (costPerUnit !== undefined) {
      const projectedCost = input.extrapolate.targetCompute * costPerUnit;
      const cap = input.extrapolate.budgetCap;
      if (cap !== undefined && projectedCost > cap) {
        checks.push({
          name: 'scale-extrapolation',
          status: 'warn',
          detail: `${note}；外推成本 ${roundCost(projectedCost)} 元超预算上限 ${roundCost(cap)} 元（${input.extrapolate.targetCompute} × ${costPerUnit} 元/单位）——提交前先调预算或降规模（衔接 v1.4.1 预算控制）`,
        });
      } else {
        checks.push({
          name: 'scale-extrapolation',
          status: extrapolation.confidence === 'low' ? 'warn' : 'ok',
          detail: `${note}；外推成本 ${roundCost(projectedCost)} 元${cap !== undefined ? `（预算内，上限 ${roundCost(cap)} 元）` : ''}`,
        });
      }
    } else {
      checks.push({
        name: 'scale-extrapolation',
        status: extrapolation.confidence === 'low' ? 'warn' : 'ok',
        detail: note,
      });
    }
  } else {
    checks.push({ name: 'scale-extrapolation', status: 'skip', detail: '未提供 pilot 数据点——跳过外推' });
  }

  const passed = checks.every((c) => c.status !== 'fail');
  return { passed, checks, vramEstimate, extrapolation, nextPilotCompute, instinct };
}

/** 成本取整显示（≥1 万按万计） */
function roundCost(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return `${n.toFixed(0)}`;
}
