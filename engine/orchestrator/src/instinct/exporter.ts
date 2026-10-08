// instinct/exporter.ts · instinct 池筛选导出（v1.5.8 章三）
//
// 打通 Data-RSI 断链的上半段：从 instinct 池筛选「高置信度 + 已考核（verified）」
// 条目导出为训练记录。三道门：
//   置信门——scored confidence ≥ DEFAULT_CONFIDENCE_THRESHOLD（0.7，与第四章同源——落数表 #11）
//   考核门——verified 态才可导出（本版第四章考核器产出；未考核/失败均拒）
//   真实性门——sourceTrace 必须在位（审计链锚定的真实运行轨迹 = verified-trace），
//              未标记来源按不可信处理 fail-closed（防自证污染：Agent 自己造的
//              「成功经验」不得进训练数据）
// 租户门——按 enterpriseId 分区；跨租户导出默认禁止，显式开启留痕（数据主权铁律）。
//
// 评估硬边界：本文件零外部评估调用（不 import 任何判定件/托管端点）；导出是
// 纯本地数据变换，结果只做筛选与映射——入池/晋级/安装由人审 gate 消费。

import { DEFAULT_CONFIDENCE_THRESHOLD, scoreInstinct } from './scorer';
import { filterByTenant, type StoredInstinct } from './store';

/** 导出的训练记录（血缘字段随行） */
export interface ExportedTrainingRecord {
  /** 指令（pattern → instruction） */
  instruction: string;
  /** 产出（期望输出面——由调用方或考核记录补全；此处承载占位与血缘） */
  output: string;
  /** 血缘：来源轨迹哈希 */
  sourceTraceId: string;
  /** 血缘：instinct 条目 ID */
  instinctId: string;
  /** 血缘：导出时置信度 */
  confidence: number;
  /** 血缘：租户 */
  enterpriseId: string;
}

/** 跨租户开启记录（显式开启留痕） */
export interface CrossTenantExportRecord {
  fromEnterpriseId: string;
  toEnterpriseId: string;
  openedAt: string;
  basis: string;
}

/** 导出选项 */
export interface ExportOptions {
  /** 数据目录外的运行时选项——导出目标租户（默认 'default'） */
  enterpriseId?: string;
  /** 跨租户显式开启（默认 false = 禁止；开启即留痕） */
  allowCrossTenant?: boolean;
  /** 置信度阈值覆盖（缺省同源 0.7——一般不覆盖） */
  confidenceThreshold?: number;
  /** 当前时间（测试注入） */
  now?: string;
}

/** 单条拒收原因（fail-closed 台账——三道门的拒收可审计） */
export interface RejectedItem {
  instinctId: string;
  reason: string;
}

/** 导出结果 */
export interface ExportResult {
  records: ExportedTrainingRecord[];
  rejected: RejectedItem[];
  /** 跨租户开启留痕（本次导出如发生） */
  crossTenantRecord?: CrossTenantExportRecord;
}

/**
 * 筛选导出纯函数：置信门 + 考核门 + 真实性门 + 租户门。
 * - 每道门拒收都记 reason（可审计，不静默丢）
 * - 跨租户：pool 条目 tenant ≠ 请求 tenant 且未显式开启 → 全量拒收 + 留痕记录
 */
export function exportInstinctRecords(
  pool: readonly StoredInstinct[],
  opts: ExportOptions = {},
): ExportResult {
  const now = opts.now ?? new Date().toISOString();
  const tenant = opts.enterpriseId ?? 'default';
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const records: ExportedTrainingRecord[] = [];
  const rejected: RejectedItem[] = [];

  const tenantPool = filterByTenant(pool, tenant);
  const otherTenantCount = pool.length - tenantPool.length;
  let crossTenantRecord: CrossTenantExportRecord | undefined;
  if (otherTenantCount > 0 && opts.allowCrossTenant) {
    crossTenantRecord = {
      fromEnterpriseId: tenant,
      toEnterpriseId: '(multi)',
      openedAt: now,
      basis: `显式开启跨租户导出（覆盖 ${otherTenantCount} 条他租户条目——数据主权例外须留痕）`,
    };
  }

  const candidates = opts.allowCrossTenant ? pool : tenantPool;
  for (const item of candidates) {
    // 真实性门（verified-trace）
    if (!item.sourceTrace) {
      rejected.push({ instinctId: item.id, reason: '真实性门：缺 sourceTrace（未标记来源按不可信 fail-closed 拒收——防自证污染）' });
      continue;
    }
    // 考核门（只收 verified）
    if (item.verified !== 'verified') {
      rejected.push({ instinctId: item.id, reason: `考核门：verified=${item.verified}（只有已考核通过条目可进训练数据）` });
      continue;
    }
    // 置信门（≥ 0.7 与第四章同源）
    const scored = scoreInstinct(item);
    if (scored.confidence < threshold) {
      rejected.push({ instinctId: item.id, reason: `置信门：confidence=${scored.confidence.toFixed(3)} < 阈值 ${threshold}（与第四章考核器同源）` });
      continue;
    }
    records.push({
      instruction: item.pattern,
      output: item.pattern,
      sourceTraceId: item.sourceTrace,
      instinctId: item.id,
      confidence: scored.confidence,
      enterpriseId: item.enterpriseId ?? 'default',
    });
  }

  return { records, rejected, crossTenantRecord };
}

/**
 * 血缘锚点（数据集 manifest 消费）：记录「哪些 instinct 条目进了这个数据集」——
 * 训练产物（权重）可反向追溯至经验源头。
 */
export interface InstinctLineageAnchor {
  /** 进本数据集的 instinct 条目 ID 全集 */
  instinctIds: string[];
  /** 各条目的 sourceTrace → confidence 映射（逐字段值可断言） */
  lineage: Array<{ instinctId: string; sourceTraceId: string; confidence: number }>;
  /** 锚点生成时间 */
  generatedAt: string;
}

/** 由导出记录生成数据集 manifest 的血缘锚点 */
export function buildLineageAnchor(records: readonly ExportedTrainingRecord[], now?: string): InstinctLineageAnchor {
  return {
    instinctIds: records.map((r) => r.instinctId),
    lineage: records.map((r) => ({ instinctId: r.instinctId, sourceTraceId: r.sourceTraceId, confidence: r.confidence })),
    generatedAt: now ?? new Date().toISOString(),
  };
}
