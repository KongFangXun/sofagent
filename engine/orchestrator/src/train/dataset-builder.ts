// dataset-builder.ts · v1.4.5 章一+章二 · 中间格式 → 训练集构建（+ dataset_version 落盘）
//
// 定位：数据管道的出口——IngestRecord 中间格式按算法选型构建训练集：
//   - sft：instruction 集（instruction + input + output 三元组）
//   - dpo ：偏好对集（prompt + chosen + rejected 三元组）
//   - grpo：RL 提示集（prompt + 可选参考答案）
// 产出物：JSONL 训练集文件（衔接 v1.4.5 语料导出格式）+ dataset_version
// 版本记录（章二——每次产出记 hash + 样本数 + 配置，eval 引用可复现）。
//
// 训练入口脱敏（⚠️ 前向依赖注记，devlog §一）：v1.4.5 通用脱敏管线
// （redactor）尚未交付——本版先落地最小可用版：复用 core 审计脱敏能力
// （REDACTION_PATTERNS——与 train-audit.sanitizeDeep 同规则同源），
// 对全部文本字段先脱敏再入训练集。v1.4.4 通用管线落地后升级对齐
// （复用同一套语义脱敏规则，接口经 sanitizeFn 注入点预留）。
//
// 落盘布局（沿用 train-job 分区纪律）：
//   data/train/<enterpriseId>/datasets/<datasetId>/dataset.jsonl
//   data/train/<enterpriseId>/datasets/<datasetId>/dataset_version.json
//   data/train/<enterpriseId>/datasets/versions.jsonl（全版本台账，append-only）

import { existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { atomicWriteSync, atomicAppendSync, REDACTION_PATTERNS } from '@sofagent/core';
import type { IngestRecord, CellValue } from './data-ingest';
import { recordDatasetVersion, datasetVersionsPath } from './dataset-version';

// ══════════════════════════════════════
// 训练集样本模型（三种算法形态）
// ══════════════════════════════════════

/** 训练算法（与 train-protocol 的 TrainJob.algorithm 同枚举口径） */
export type DatasetAlgorithm = 'sft' | 'dpo' | 'grpo';

/** SFT 样本（instruction / input / output 三元组——Alpaca 格式兼容） */
export interface SftSample {
  instruction: string;
  input: string;
  output: string;
}

/** DPO 偏好对样本（prompt + chosen + rejected） */
export interface DpoSample {
  prompt: string;
  chosen: string;
  rejected: string;
}

/** RL 提示样本（prompt + 可选参考答案——grpo reward 评分参考） */
export interface RlSample {
  prompt: string;
  reference?: string;
}

/** 训练集样本（按 algorithm 三态） */
export type DatasetSample = SftSample | DpoSample | RlSample;

/** 单条训练集 JSONL 行（样本 + 溯源头——__meta 不进训练，供审计回查） */
export interface DatasetLine {
  sample: DatasetSample;
  /** 溯源头（source + 记录 id——样本级可回溯到原始数据行） */
  meta: { source: string; recordId: string };
}

// ══════════════════════════════════════
// 训练入口脱敏（最小可用版——复用审计 REDACTION_PATTERNS）
// ══════════════════════════════════════

/** 单字符串脱敏——逐条应用 REDACTION_PATTERNS（与 train-audit.redactString 同规则） */
function redactString(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * 训练入口脱敏最小版：字段值 string → 脱敏；null → ''（训练集不留 null）；
// number/boolean → 原样（数字与布尔不承载密钥语义）。
 * v1.4.4 通用脱敏管线落地后由 sanitizeFn 注入点替换实现（规则同源对齐）。
 */
export function sanitizeCell(value: CellValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return redactString(value);
  return String(value);
}

/** 可注入的样本级脱敏函数（v1.4.4 redactor 升级对齐接口预留） */
export type SampleSanitizeFn = (sample: DatasetSample) => DatasetSample;

/** 默认样本脱敏：对样本内全部 string 字段过 REDACTION_PATTERNS */
export const defaultSampleSanitize: SampleSanitizeFn = (sample) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sample)) {
    out[k] = typeof v === 'string' ? redactString(v) : v;
  }
  return out as unknown as DatasetSample;
};

// ══════════════════════════════════════
// 列映射配置（中间格式字段名 → 训练集语义角色）
// ══════════════════════════════════════

/** 列映射：中间格式列名 → 样本语义角色（缺省约定见 inferColumnMapping） */
export interface ColumnMapping {
  /** 指令列（sft）/ prompt 列（dpo/grpo） */
  instruction?: string;
  /** 上下文输入列（sft 可选） */
  input?: string;
  /** 期望输出列（sft）/ 参考答案列（grpo 可选） */
  output?: string;
  /** 更优回答列（dpo） */
  chosen?: string;
  /** 更劣回答列（dpo） */
  rejected?: string;
  /** prompt 列（dpo/grpo 显式指定；缺省用 instruction 列） */
  prompt?: string;
}

/**
 * 按常见命名约定推断列映射（大小写不敏感）：
 *   instruction/instruction/prompt/问题/指令 → instruction
 *   input/context/输入 → input
 *   output/answer/response/回答/答案/输出 → output
 *   chosen/ preferred/更优 → chosen
 *   rejected/dispreferred/更劣 → rejected
 */
export function inferColumnMapping(columns: readonly string[]): ColumnMapping {
  const find = (...cands: string[]): string | undefined => {
    const lower = columns.map((c) => c.toLowerCase());
    for (const c of cands) {
      const idx = lower.indexOf(c);
      if (idx >= 0) return columns[idx];
    }
    return undefined;
  };
  return {
    instruction: find('instruction', 'instructions', 'prompt', 'question', '指令', '问题'),
    input: find('input', 'context', '输入', '上下文'),
    output: find('output', 'answer', 'response', '回答', '答案', '输出'),
    chosen: find('chosen', 'preferred', '更优', ' preferred'),
    rejected: find('rejected', 'dispreferred', '更劣'),
  };
}

/** 取记录字段值并脱敏（列缺失 → ''；列映射未覆盖 → 空） */
function pickField(record: IngestRecord, column: string | undefined): string {
  if (column === undefined) return '';
  return sanitizeCell(record.fields[column] ?? null);
}

// ══════════════════════════════════════
// 训练集构建（核心纯函数）
// ══════════════════════════════════════

/** 构建选项 */
export interface BuildDatasetOptions {
  algorithm: DatasetAlgorithm;
  /** 列映射（缺省 inferColumnMapping 自动推断） */
  columnMapping?: ColumnMapping;
  /** 样本级脱敏函数（缺省 defaultSampleSanitize——v1.4.4 升级注入点） */
  sanitizeFn?: SampleSanitizeFn;
}

/** 构建结果（内存形态——落盘由 buildAndPersistDataset 负责） */
export interface BuildDatasetResult {
  algorithm: DatasetAlgorithm;
  lines: DatasetLine[];
  /** 构建期跳过的行数（必填列缺失等——跳过行进 issues 汇总） */
  skipped: number;
  /** 跳过原因摘要（去重） */
  skipReasons: string[];
  /** 生效的列映射（审计留痕用） */
  columnMapping: ColumnMapping;
}

/**
 * 中间格式记录 → 训练集行（按算法三分支构建）。
 *
 * 必填列缺失的行跳过不抛错（汇总 skipReasons 供质量闸门与人工研判）：
 *   - sft：instruction + output 必填
 *   - dpo：prompt + chosen + rejected 必填
 *   - grpo：prompt 必填（reference 可选）
 */
export function buildDataset(
  records: readonly IngestRecord[],
  columns: readonly string[],
  options: BuildDatasetOptions,
): BuildDatasetResult {
  const mapping = options.columnMapping ?? inferColumnMapping(columns);
  const sanitize = options.sanitizeFn ?? defaultSampleSanitize;
  const lines: DatasetLine[] = [];
  const skipReasons = new Set<string>();
  let skipped = 0;

  for (const record of records) {
    let sample: DatasetSample | null = null;
    if (options.algorithm === 'sft') {
      const instruction = pickField(record, mapping.instruction);
      const output = pickField(record, mapping.output);
      if (instruction === '' || output === '') {
        skipped += 1;
        if (mapping.instruction === undefined || mapping.output === undefined) {
          skipReasons.add('列映射缺失：sft 需要 instruction 与 output 列（显式指定或改列名后重试）');
        } else {
          skipReasons.add('必填字段为空（instruction/output）');
        }
        continue;
      }
      sample = sanitize({ instruction, input: pickField(record, mapping.input), output });
    } else if (options.algorithm === 'dpo') {
      const prompt = pickField(record, mapping.prompt ?? mapping.instruction);
      const chosen = pickField(record, mapping.chosen);
      const rejected = pickField(record, mapping.rejected);
      if (prompt === '' || chosen === '' || rejected === '') {
        skipped += 1;
        if (mapping.chosen === undefined || mapping.rejected === undefined) {
          skipReasons.add('列映射缺失：dpo 需要 prompt/chosen/rejected 列（偏好对数据须含优劣双答）');
        } else {
          skipReasons.add('必填字段为空（prompt/chosen/rejected）');
        }
        continue;
      }
      sample = sanitize({ prompt, chosen, rejected });
    } else {
      const prompt = pickField(record, mapping.prompt ?? mapping.instruction);
      if (prompt === '') {
        skipped += 1;
        skipReasons.add('必填字段为空（prompt）');
        continue;
      }
      const reference = pickField(record, mapping.output);
      sample = sanitize(reference !== '' ? { prompt, reference } : { prompt });
    }
    lines.push({ sample, meta: { source: record.source, recordId: record.id } });
  }

  return { algorithm: options.algorithm, lines, skipped, skipReasons: [...skipReasons], columnMapping: mapping };
}

// ══════════════════════════════════════
// 数据集目录布局
// ══════════════════════════════════════

/** 数据集目录：data/train/<enterpriseId>/datasets/<datasetId>/ */
export function datasetDir(dataDir: string, enterpriseId: string, datasetId: string): string {
  return join(dataDir, 'train', enterpriseId, 'datasets', datasetId);
}

/** 生成数据集标识（ds-<时间基36>-<随机6hex>——对齐 generateTrainJobId 模式） */
export function generateDatasetId(): string {
  return `ds-${Date.now().toString(36)}-${createHash('sha256')
    .update(`${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 6)}`;
}

// ══════════════════════════════════════
// 构建 + 落盘 + 版本记录（章二衔接）
// ══════════════════════════════════════

/** 持久化构建入参（buildDataset + 落盘 + dataset_version 一步到位） */
export interface BuildAndPersistInput {
  /** 数据根目录（data/train/<enterpriseId>/datasets/… 挂载点） */
  dataDir: string;
  enterpriseId: string;
  /** 数据集标识（缺省自动生成） */
  datasetId?: string;
  /** 中间格式记录（ingest/db-source 产出） */
  records: readonly IngestRecord[];
  /** 源数据列名（列映射推断依据） */
  columns: readonly string[];
  options: BuildDatasetOptions;
  /** 显式版本号（缺省 hash 前 8 位——dataset-version 内部解析） */
  version?: string;
}

/** 持久化构建结果 */
export interface BuildAndPersistResult {
  datasetId: string;
  algorithm: DatasetAlgorithm;
  /** 训练集 JSONL 落盘路径（train job 的 dataPath 即指向它） */
  datasetFile: string;
  /** 样本数（不含 meta——训练框架消费的行数） */
  sampleCount: number;
  skipped: number;
  skipReasons: string[];
  /** 训练集内容指纹（sha256——dataset_version 记录同值） */
  contentHash: string;
  /** dataset_version 记录（章二产物） */
  version: ReturnType<typeof recordDatasetVersion>;
}

/**
 * 构建训练集并落盘（JSONL）+ 记 dataset_version（章二：数据可复现）。
 *
 * JSONL 行形态：{ ...sample, __meta: { source, recordId } }——样本字段平铺
// 顶层（训练框架按样本字段消费），__meta 前缀双下划线表「非训练字段」。
 */
export function buildAndPersistDataset(input: BuildAndPersistInput): BuildAndPersistResult {
  const datasetId = input.datasetId ?? generateDatasetId();
  const built = buildDataset(input.records, input.columns, input.options);
  const dir = datasetDir(input.dataDir, input.enterpriseId, datasetId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const jsonlLines = built.lines.map((line) =>
    JSON.stringify({ ...(line.sample as unknown as Record<string, unknown>), __meta: line.meta }),
  );
  const content = jsonlLines.length > 0 ? jsonlLines.join('\n') + '\n' : '';
  const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
  const datasetFile = join(dir, 'dataset.jsonl');
  atomicWriteSync(datasetFile, content);

  // 章二衔接：每次产出记 dataset_version（hash + 样本数 + 配置——eval 可复现引用）
  const version = recordDatasetVersion(
    {
      dataDir: input.dataDir,
      enterpriseId: input.enterpriseId,
      datasetId,
      contentHash,
      sampleCount: built.lines.length,
      algorithm: built.algorithm,
      columnMapping: built.columnMapping,
      datasetFile,
    },
    input.version,
  );

  return {
    datasetId,
    algorithm: built.algorithm,
    datasetFile,
    sampleCount: built.lines.length,
    skipped: built.skipped,
    skipReasons: built.skipReasons,
    contentHash,
    version,
  };
}

/** 全版本台账路径（导出供测试与查询——dataset-version 内部同源） */
export { datasetVersionsPath };
