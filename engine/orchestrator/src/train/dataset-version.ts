// dataset-version.ts · v1.4.2 章二 · 训练集版本管理（数据可复现）
//
// 定位：同一份数据反复迭代训练，数据变了训练结果不可比——每次数据管道
// 产出训练集必须记 dataset_version（hash + 生成时间 + 样本数 + 配置），
// eval 报告引用该版本（训练前后对比可复现），两版差异可概览
// （样本数/分布变化——判断「数据变了导致分数变了」）。
//
// 与 v1.4.2 train-fingerprint 的分工：fingerprint 冻结的是「一次训练的
// 全部输入」（含环境/超参/种子，job 维度，不可变）；dataset_version 记录
// 的是「数据集的血统」（企业维度，append-only 台账，每版一行）——
// 同一 dataset 多次产出（数据更新）形成版本链。
//
// 落盘布局（沿用 data/train/<enterpriseId>/ 分区纪律）：
//   data/train/<enterpriseId>/datasets/versions.jsonl —— 全数据集版本台账
//     （append-only；记录含 enterpriseId 隔离字段）
//   dataset_version 记录本身不 hash 链（区别于 audit.jsonl）——版本记录
//   的完整性由 contentHash 锚定（内容指纹即证据，改数据必改 hash）。

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicAppendSync } from '@sofagent/core';
import type { DatasetAlgorithm, ColumnMapping } from './dataset-builder';

// ══════════════════════════════════════
// dataset_version 数据模型
// ══════════════════════════════════════

/** 数据集版本记录（versions.jsonl 单行） */
export interface DatasetVersionRecord {
  /** 版本标识（显式版本号或 contentHash 前 8 位） */
  version: string;
  /** 数据集标识（同一 datasetId 多次产出 = 版本链） */
  datasetId: string;
  /** 企业标识（隔离分区依赖——台账全企业共文件，记录级隔离字段） */
  enterpriseId: string;
  /** 训练集内容指纹（sha256——dataset.jsonl 全文 hash，改数据必变） */
  contentHash: string;
  /** 样本数（训练框架消费的行数） */
  sampleCount: number;
  /** 构建算法（sft/dpo/grpo——影响样本形态，版本可比性前提） */
  algorithm: DatasetAlgorithm;
  /** 生效列映射（构建配置——复现口径） */
  columnMapping: ColumnMapping;
  /** 训练集文件路径（dataset.jsonl 落点） */
  datasetFile: string;
  /** 生成时间（ISO 8601） */
  createdAt: string;
}

/** 记录版本入参（dataset-builder 产出侧组装） */
export interface RecordDatasetVersionInput {
  dataDir: string;
  enterpriseId: string;
  datasetId: string;
  contentHash: string;
  sampleCount: number;
  algorithm: DatasetAlgorithm;
  columnMapping: ColumnMapping;
  datasetFile: string;
  /** 生成时间（缺省当前——测试可注入固定值） */
  createdAt?: string;
}

/** 两版差异概览（章二交付：判断「数据变了导致分数变了」） */
export interface DatasetVersionDiff {
  from: DatasetVersionRecord;
  to: DatasetVersionRecord;
  /** 是否同数据集（不同 datasetId 的对比概览意义有限但仍可给出） */
  sameDataset: boolean;
  /** 样本数变化（to - from；正 = 增样本） */
  sampleCountDelta: number;
  /** 内容是否变化（contentHash 不同即变化） */
  contentChanged: boolean;
  /** 算法是否变化（算法变 = 不可直接对比，概览必标注） */
  algorithmChanged: boolean;
  /** 人读差异摘要（一二句——报告与决策面消费） */
  summary: string;
}

// ══════════════════════════════════════
// 台账读写
// ══════════════════════════════════════

/** 版本台账路径：data/train/<enterpriseId>/datasets/versions.jsonl（单一出口） */
export function datasetVersionsPath(dataDir: string, enterpriseId: string): string {
  return join(dataDir, 'train', enterpriseId, 'datasets', 'versions.jsonl');
}

/**
 * 记录一个数据集版本（append-only 台账）。
 *
 * 幂等语义：同一 (datasetId, version) 已存在 → 返回既有记录不重复追加
 * （重复产出同版本是调用方重试，不污染台账）。
 */
export function recordDatasetVersion(
  input: RecordDatasetVersionInput,
  explicitVersion?: string,
): DatasetVersionRecord {
  const record: DatasetVersionRecord = {
    version:
      explicitVersion !== undefined && explicitVersion.trim() !== ''
        ? explicitVersion.trim()
        : input.contentHash.slice(0, 8),
    datasetId: input.datasetId,
    enterpriseId: input.enterpriseId,
    contentHash: input.contentHash,
    sampleCount: input.sampleCount,
    algorithm: input.algorithm,
    columnMapping: input.columnMapping,
    datasetFile: input.datasetFile,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  const existing = readDatasetVersions(input.dataDir, input.enterpriseId);
  const dup = existing.find(
    (r) => r.datasetId === record.datasetId && r.version === record.version,
  );
  if (dup) return dup;

  const filePath = datasetVersionsPath(input.dataDir, input.enterpriseId);
  const dir = join(filePath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicAppendSync(filePath, JSON.stringify(record));
  return record;
}

/** 读取版本台账（坏行跳过不中断——append-only 文件的读侧容错惯例） */
export function readDatasetVersions(dataDir: string, enterpriseId: string): DatasetVersionRecord[] {
  const filePath = datasetVersionsPath(dataDir, enterpriseId);
  if (!existsSync(filePath)) return [];
  const records: DatasetVersionRecord[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed) as DatasetVersionRecord;
      if (typeof parsed.datasetId === 'string' && typeof parsed.version === 'string') {
        records.push(parsed);
      }
    } catch {
      // 坏行跳过（台账读侧容错）
    }
  }
  return records;
}

/** 查指定数据集的版本链（按生成时间升序） */
export function listDatasetVersions(
  dataDir: string,
  enterpriseId: string,
  datasetId: string,
): DatasetVersionRecord[] {
  return readDatasetVersions(dataDir, enterpriseId)
    .filter((r) => r.datasetId === datasetId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** 取指定版本记录（不存在 → null） */
export function getDatasetVersion(
  dataDir: string,
  enterpriseId: string,
  datasetId: string,
  version: string,
): DatasetVersionRecord | null {
  return (
    readDatasetVersions(dataDir, enterpriseId).find(
      (r) => r.datasetId === datasetId && r.version === version,
    ) ?? null
  );
}

// ══════════════════════════════════════
// 两版差异概览（纯函数）
// ══════════════════════════════════════

/**
 * 两版数据集差异概览（样本数/内容/算法三轴 + 人读摘要）。
 *
 * 判读语义：contentChanged=false → 数据没变，分数变化与数据无关；
 * sampleCountDelta 大幅为正 → 新数据注入，分数提升可能是数据红利；
 * algorithmChanged=true → 不可直接对比（概览必标注）。
 */
export function diffDatasetVersions(
  from: DatasetVersionRecord,
  to: DatasetVersionRecord,
): DatasetVersionDiff {
  const sampleCountDelta = to.sampleCount - from.sampleCount;
  const contentChanged = from.contentHash !== to.contentHash;
  const algorithmChanged = from.algorithm !== to.algorithm;
  const sameDataset = from.datasetId === to.datasetId;

  const parts: string[] = [];
  parts.push(
    contentChanged
      ? `内容已变化（${from.version} → ${to.version}）`
      : `内容未变化（同一 contentHash ${from.version.slice(0, 8)}）`,
  );
  if (sampleCountDelta !== 0) {
    parts.push(`样本 ${from.sampleCount} → ${to.sampleCount}（${sampleCountDelta > 0 ? '+' : ''}${sampleCountDelta}）`);
  } else {
    parts.push(`样本数持平（${from.sampleCount}）`);
  }
  if (algorithmChanged) {
    parts.push(`⚠ 算法已切换 ${from.algorithm} → ${to.algorithm}——eval 分数不可直接对比`);
  }
  if (!sameDataset) {
    parts.push(`⚠ 跨数据集对比（${from.datasetId} vs ${to.datasetId}）——血缘不同仅作概览`);
  }

  return {
    from,
    to,
    sameDataset,
    sampleCountDelta,
    contentChanged,
    algorithmChanged,
    summary: parts.join('；'),
  };
}
