// train-report.ts · v1.4.2 章六 · 训练报告生成（客户可读交付物）
//
// 定位：训练完成 = 训练数据 + eval 结果 + 产物清单，应产出一份客户
// 可读的训练报告——FDE 交付给企业看（对齐 GUIDE §4.3 量化四字段）。
//
// 报告五段：
//   ① 数据概况（样本数/来源/列映射/脱敏说明——复用章一 dataset_version）
//   ② 训练配置（超参/算法/基座——train job state 回读）
//   ③ eval 对比（基线 vs 训后——复用章三 TrainEvalReport）
//   ④ 产物清单（checkpoint/权重路径/训练集文件）
//   ⑤ 绩效衔接：量化四字段（当前成本/AI 后成本/年节省/回本周期——
//      GUIDE §4.3：年节省 = 岗位真实市场年薪 × AI 接管工时占比）
//      供绩效量化引擎消费
//
// 归档：data/dashboard/train-reports/<trainJobId>.md + .json
//   （对齐 worklog aggregator 的 data/dashboard/ 落点——FDE 交付物
//   + 可追溯）
//
// 复用来源：
//   - train-job（v1.4.1）：loadTrainJobRecord（配置回读）
//   - train-eval-loop（章三）：TrainEvalReport / compareEvalReports
//   - dataset-version（章二）：DatasetVersionRecord（数据概况回读）
//
// 可测试性：纯函数（输入全注入）+ 落盘路径单一出口——单测零真实训练。

import { mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import { loadTrainJobRecord, type TrainJobRecord } from './train-job';
import { compareEvalReports, type TrainEvalReport } from './train-eval-loop';
import type { DatasetVersionRecord } from './dataset-version';

// ══════════════════════════════════════
// 量化四字段（GUIDE §4.3——绩效量化引擎输入）
// ══════════════════════════════════════

/** 量化四字段（年节省 = 岗位真实市场年薪 × AI 接管工时占比） */
export interface QuantificationMetrics {
  /** 当前成本（人工程伴年成本口径——人读金额 + 数值双形态） */
  currentCost: { value: number; unit: string; display: string };
  /** AI 后成本（AI 方案年运行成本） */
  aiCost: { value: number; unit: string; display: string };
  /** 年节省（currentCost − aiCost；或按 GUIDE 公式独立填报） */
  annualSaving: { value: number; unit: string; display: string };
  /** 回本周期（投入 ÷ 年节省——月/年） */
  paybackPeriod: { value: number; unit: string; display: string };
}

/** 量化计算入参（岗位口径——GUIDE §4.3 公式） */
export interface QuantifyInput {
  /** 岗位真实市场年薪（元/年——追问真实数，不用平均工资拍脑袋） */
  annualSalary: number;
  /** AI 接管工时占比（0..1——如每天 2.7h/8h ≈ 0.3375） */
  takeoverRatio: number;
  /** AI 方案年运行成本（元/年——算力+订阅+运维） */
  aiAnnualCost: number;
  /** 一次性投入（元——训练成本/实施费；缺省 0 → 回本周期按无一次性投入计） */
  oneTimeInvestment?: number;
}

/**
 * 量化四字段计算器（GUIDE §4.3）：
 *   年节省 = 岗位真实市场年薪 × AI 接管工时占比
 *   回本周期 = 一次性投入 ÷ 年节省（年节省 ≤ 0 → 不适用）
 */
export function computeQuantification(input: QuantifyInput): QuantificationMetrics {
  const saving = input.annualSalary * input.takeoverRatio;
  const invest = input.oneTimeInvestment ?? 0;
  const paybackYears = saving > 0 ? invest / saving : Number.POSITIVE_INFINITY;
  const fmt = (n: number): string => {
    if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万元`;
    return `${n.toFixed(0)} 元`;
  };
  return {
    currentCost: { value: input.annualSalary, unit: '元/年', display: fmt(input.annualSalary) },
    aiCost: { value: input.aiAnnualCost, unit: '元/年', display: fmt(input.aiAnnualCost) },
    annualSaving: { value: saving, unit: '元/年', display: fmt(saving) },
    paybackPeriod: {
      value: Number.isFinite(paybackYears) ? paybackYears : -1,
      unit: '年',
      display: Number.isFinite(paybackYears)
        ? paybackYears >= 1
          ? `${paybackYears.toFixed(1)} 年`
          : `${(paybackYears * 12).toFixed(0)} 个月`
        : '不适用（年节省 ≤ 0）',
    },
  };
}

// ══════════════════════════════════════
// 报告模型与生成
// ══════════════════════════════════════

/** 报告生成入参（全部注入——单测零真实训练） */
export interface TrainReportInput {
  dataDir: string;
  enterpriseId: string;
  trainJobId: string;
  /** 基线 eval（训练前）与训后 eval（章三 runTrainEval 产出） */
  baselineEval: TrainEvalReport | null;
  afterEval: TrainEvalReport | null;
  /** 训练集版本（章二——数据概况段） */
  datasetVersion: DatasetVersionRecord | null;
  /** 量化四字段（GUIDE §4.3——绩效衔接段；缺省省略该段） */
  quantification?: QuantificationMetrics;
  /** 产物清单（checkpoint/权重——缺省从 job record 的 outputDir 推导） */
  artifacts?: string[];
  /** 时钟（缺省 Date.now） */
  now?: () => number;
}

/** 报告生成结果 */
export interface TrainReportResult {
  /** markdown 全文（客户可读） */
  markdown: string;
  /** 结构化 JSON（绩效量化引擎消费） */
  json: TrainReportJson;
  /** 归档路径 */
  archivePaths: { markdownPath: string; jsonPath: string };
}

/** 报告结构化形态（.json 归档——机器消费） */
export interface TrainReportJson {
  schemaVersion: 'v1';
  trainJobId: string;
  enterpriseId: string;
  generatedAt: string;
  job: {
    algorithm: string;
    baseModel: string;
    hyperparams: Record<string, unknown>;
    status: string;
    outputDir: string | null;
    checkpointPath: string | null;
  } | null;
  dataset: {
    datasetId: string;
    version: string;
    sampleCount: number;
    contentHash: string;
    columnMapping: Record<string, string>;
    sanitized: true; // 章一训练入口脱敏（REDACTION_PATTERNS 同源）
  } | null;
  evaluation: {
    baselineAverage: number | null;
    afterAverage: number | null;
    scoreDelta: number | null;
    improved: boolean | null;
    sameDataset: boolean | null;
    decision: string | null;
    summary: string | null;
  };
  artifacts: string[];
  quantification: QuantificationMetrics | null;
}

/** 报告归档目录：{dataDir}/dashboard/train-reports/（对齐 worklog 落点） */
export function trainReportsDir(dataDir: string): string {
  return join(dataDir, 'dashboard', 'train-reports');
}

/** 报告归档路径（<trainJobId>.md + .json） */
export function trainReportPaths(dataDir: string, trainJobId: string): { markdownPath: string; jsonPath: string } {
  const dir = trainReportsDir(dataDir);
  return {
    markdownPath: join(dir, `${trainJobId}.md`),
    jsonPath: join(dir, `${trainJobId}.json`),
  };
}

/**
 * 生成训练报告（markdown + JSON 双形态）并归档 data/dashboard/train-reports/。
 *
 * job record 缺失不拒绝（报告按 eval/数据侧输入尽力生成——job 段标
 * null 注明）；eval 双侧齐全才产出对比段。
 */
export function generateTrainReport(input: TrainReportInput): TrainReportResult {
  const nowMs = input.now !== undefined ? input.now() : Date.now();
  const job: TrainJobRecord | null = loadTrainJobRecord(input.dataDir, input.enterpriseId, input.trainJobId);

  // eval 对比（章三 compareEvalReports——双侧齐全才算）
  const comparison =
    input.baselineEval !== null && input.afterEval !== null
      ? compareEvalReports(input.baselineEval, input.afterEval)
      : null;

  const artifacts =
    input.artifacts ??
    (job?.job.outputDir
      ? [job.job.outputDir, job.job.checkpointPath].filter((p): p is string => typeof p === 'string' && p.length > 0)
      : []);

  const json: TrainReportJson = {
    schemaVersion: 'v1',
    trainJobId: input.trainJobId,
    enterpriseId: input.enterpriseId,
    generatedAt: new Date(nowMs).toISOString(),
    job:
      job !== null
        ? {
            algorithm: job.job.algorithm,
            baseModel: job.job.baseModel,
            hyperparams: job.job.hyperparams ?? {},
            status: job.status,
            outputDir: job.job.outputDir ?? null,
            checkpointPath: job.job.checkpointPath ?? null,
          }
        : null,
    dataset:
      input.datasetVersion !== null
        ? {
            datasetId: input.datasetVersion.datasetId,
            version: input.datasetVersion.version,
            sampleCount: input.datasetVersion.sampleCount,
            contentHash: input.datasetVersion.contentHash,
            columnMapping: input.datasetVersion.columnMapping as unknown as Record<string, string>,
            sanitized: true,
          }
        : null,
    evaluation: {
      baselineAverage: input.baselineEval?.averageScore ?? null,
      afterAverage: input.afterEval?.averageScore ?? null,
      scoreDelta: comparison?.scoreDelta ?? null,
      improved: comparison?.improved ?? null,
      sameDataset: comparison?.sameDataset ?? null,
      decision: input.afterEval?.decision ?? null,
      summary: comparison?.summary ?? null,
    },
    artifacts,
    quantification: input.quantification ?? null,
  };

  const markdown = renderMarkdown(json, comparison?.summary ?? null);

  const paths = trainReportPaths(input.dataDir, input.trainJobId);
  mkdirSync(trainReportsDir(input.dataDir), { recursive: true });
  atomicWriteSync(paths.markdownPath, markdown);
  atomicWriteSync(paths.jsonPath, JSON.stringify(json, null, 2));

  return { markdown, json, archivePaths: paths };
}

// ══════════════════════════════════════
// markdown 渲染（客户可读——FDE 交付物）
// ══════════════════════════════════════

function renderMarkdown(json: TrainReportJson, evalSummary: string | null): string {
  const lines: string[] = [];
  lines.push(`# 训练报告 · ${json.trainJobId}`);
  lines.push('');
  lines.push(`> 企业：${json.enterpriseId} · 生成时间：${json.generatedAt}`);
  lines.push('');

  // ── ① 数据概况 ──
  lines.push('## 一、训练数据概况');
  if (json.dataset !== null) {
    const d = json.dataset;
    lines.push(`- 训练集：\`${d.datasetId}\`（版本 ${d.version}）`);
    lines.push(`- 样本量：${d.sampleCount} 条`);
    lines.push(`- 内容指纹：\`${d.contentHash}\`（sha256——可复现对账）`);
    lines.push(`- 列映射：${JSON.stringify(d.columnMapping)}`);
    lines.push('- 脱敏：训练入口已应用密钥脱敏（与审计日志同规则——训练集不含密钥类敏感信息）');
  } else {
    lines.push('- 未关联训练集版本（章二 dataset_version 缺失——数据可复现性口径不全）');
  }
  lines.push('');

  // ── ② 训练配置 ──
  lines.push('## 二、训练配置');
  if (json.job !== null) {
    lines.push(`- 算法：${json.job.algorithm.toUpperCase()}`);
    lines.push(`- 基座模型：${json.job.baseModel}`);
    lines.push(`- 任务状态：${json.job.status}`);
    lines.push(`- 超参：\`${JSON.stringify(json.job.hyperparams)}\``);
    if (json.job.outputDir) lines.push(`- 产物目录：\`${json.job.outputDir}\``);
    if (json.job.checkpointPath) lines.push(`- checkpoint：\`${json.job.checkpointPath}\``);
  } else {
    lines.push('- train job 记录缺失（state.json 未找到——配置段按缺失处理）');
  }
  lines.push('');

  // ── ③ eval 对比 ──
  lines.push('## 三、评测对比（基线 → 训后）');
  const e = json.evaluation;
  if (e.afterAverage !== null) {
    const base = e.baselineAverage !== null ? e.baselineAverage.toFixed(1) : '—';
    lines.push(`- 综合分：${base} → ${e.afterAverage.toFixed(1)}${e.scoreDelta !== null ? `（${e.scoreDelta >= 0 ? '+' : ''}${e.scoreDelta.toFixed(1)}）` : ''}`);
    lines.push(`- 判定结论：${e.decision ?? '—'}`);
    if (evalSummary !== null) lines.push(`- 对比摘要：${evalSummary}`);
    if (e.sameDataset === false) {
      lines.push('- ⚠️ 两轮训练集版本不同——分数变化归因需谨慎（先对齐数据）');
    }
  } else {
    lines.push('- 训后 eval 缺失（章三 train-eval-loop 未跑或报告未传——建议补跑）');
  }
  lines.push('');

  // ── ④ 产物清单 ──
  lines.push('## 四、产物清单');
  if (json.artifacts.length > 0) {
    for (const a of json.artifacts) lines.push(`- \`${a}\``);
  } else {
    lines.push('- （无登记产物）');
  }
  lines.push('');

  // ── ⑤ 绩效衔接（量化四字段） ──
  lines.push('## 五、绩效量化（GUIDE §4.3 量化四字段）');
  if (json.quantification !== null) {
    const q = json.quantification;
    lines.push('| 字段 | 数值 |');
    lines.push('|------|------|');
    lines.push(`| 当前成本 | ${q.currentCost.display} |`);
    lines.push(`| AI 后成本 | ${q.aiCost.display} |`);
    lines.push(`| 年节省 | ${q.annualSaving.display} |`);
    lines.push(`| 回本周期 | ${q.paybackPeriod.display} |`);
    lines.push('');
    lines.push('> 口径：年节省 = 岗位真实市场年薪 × AI 接管工时占比（真实市场年薪已含工时与年工作日，无需再乘日耗时/250）。');
  } else {
    lines.push('- 未提供量化输入（绩效量化引擎可基于本报告 JSON 的 evaluation 段补算）');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*本报告由 sofagent 训练引擎自动生成（v1.4.2 章六）——归档于 data/dashboard/train-reports/。*');

  return lines.join('\n');
}
