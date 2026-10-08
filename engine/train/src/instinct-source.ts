// instinct-source.ts · instinct 数据源适配器（v1.5.8 章三 · train 包侧）
//
// 形态对齐 db-source.ts 先例（v1.5.7 章一）：「文件接入之外的第二入口」——
// 本文件把 orchestrator instinct 池的**导出记录**归一到 data-ingest 的
// IngestRecord 中间格式，与 CSV/Excel/DB 接入同一套下游（dataset-builder）。
//
// ⚠️ 架构事实（devprompt 权威源例外已裁定）：dataset-builder 的 buildDataset
// 只吃已归一的 IngestRecord[]、对来源完全无感、全仓无源类型枚举——故本模块
// 是**旁挂适配器**，dataset-builder.ts 零改动（其入参天然支持混合构建）。
//
// 列契约：instruction / output（sft 算法消费）+ 血缘三列
// （source_trace_id / instinct_id / confidence）——列名与 inferColumnMapping
// 的 sft 推断（instruction+output）天然对齐。

import type { IngestRecord } from './data-ingest';

/** instinct 源记录（上游 = orchestrator instinct/exporter 的 ExportedTrainingRecord） */
export interface InstinctSourceRecord {
  instruction: string;
  output: string;
  sourceTraceId: string;
  instinctId: string;
  confidence: number;
  enterpriseId?: string;
}

/** instinct 源接入结果 */
export interface InstinctIngestResult {
  /** 归一后的 IngestRecord（可直接与文件源混合） */
  records: IngestRecord[];
  /** 供给本批的列名（列契约固定五列） */
  columns: string[];
  /** 拒收（真实性门 fail-closed 的透传——空 sourceTraceId 不进 records） */
  rejected: Array<{ instinctId: string; reason: string }>;
}

/** 固定列契约（顺序稳定——manifest 与混合构建的列对齐面） */
export const INSTINCT_SOURCE_COLUMNS: readonly string[] = [
  'instruction',
  'output',
  'source_trace_id',
  'instinct_id',
  'confidence',
] as const;

/**
 * instinct 源归一（纯函数）：导出记录 → IngestRecord[]。
 * 真实性门在源侧再守一道：sourceTraceId 为空的条目拒收（fail-closed，
 * 与 exporter 侧同名门语义一致——纵深防御，非重复台账）。
 */
export function ingestInstinctSource(records: readonly InstinctSourceRecord[]): InstinctIngestResult {
  const out: IngestRecord[] = [];
  const rejected: Array<{ instinctId: string; reason: string }> = [];
  let seq = 0;
  for (const r of records) {
    seq += 1;
    if (!r.sourceTraceId) {
      rejected.push({ instinctId: r.instinctId, reason: '真实性门（源侧）：sourceTraceId 为空——fail-closed 拒收' });
      continue;
    }
    out.push({
      id: `instinct#${seq}`,
      source: r.enterpriseId ? `instinct-pool/${r.enterpriseId}/${r.instinctId}` : `instinct-pool/${r.instinctId}`,
      fields: {
        instruction: r.instruction,
        output: r.output,
        source_trace_id: r.sourceTraceId,
        instinct_id: r.instinctId,
        confidence: r.confidence,
      },
    });
  }
  return { records: out, columns: [...INSTINCT_SOURCE_COLUMNS], rejected };
}

/**
 * 供给 dataset-builder.buildDataset 的便捷入口：外部源记录 + instinct 源记录
 * 混合成同一 records 数组与合并列集（质量闸门由 buildDataset 照常执行——
 * 混合构建的断言载体）。
 */
export function mergeForDatasetBuild(
  external: { records: readonly IngestRecord[]; columns: readonly string[] },
  instinct: InstinctIngestResult,
): { records: IngestRecord[]; columns: string[] } {
  return {
    records: [...external.records, ...instinct.records],
    columns: Array.from(new Set([...external.columns, ...instinct.columns])),
  };
}

/**
 * 数据集 manifest 的 instinct 血缘锚点（逐字段值断言载体——
 * 权重 → 数据集 → 经验源可反向追溯）。
 */
export interface InstinctDatasetAnchor {
  kind: 'instinct-lineage';
  instinctIds: string[];
  lineage: Array<{ instinctId: string; sourceTraceId: string; confidence: number }>;
}

/** 从归一记录提取血缘锚点（manifest 嵌入用） */
export function extractLineageAnchor(records: readonly IngestRecord[]): InstinctDatasetAnchor {
  const lineage: InstinctDatasetAnchor['lineage'] = [];
  for (const r of records) {
    const instinctId = r.fields['instinct_id'];
    const sourceTraceId = r.fields['source_trace_id'];
    const confidence = r.fields['confidence'];
    if (typeof instinctId === 'string' && typeof sourceTraceId === 'string') {
      lineage.push({
        instinctId,
        sourceTraceId,
        confidence: typeof confidence === 'number' ? confidence : Number(confidence ?? 0),
      });
    }
  }
  return { kind: 'instinct-lineage', instinctIds: lineage.map((l) => l.instinctId), lineage };
}
