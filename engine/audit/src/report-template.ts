// ============================================================
// report-template.ts · 数据主权审计报告 Markdown 模板（v1.3.8 · P0）
// ============================================================
//
// 6 个 section（对齐 dev-prompt §2 L152-160）：
//   1. 概要（云端调用总数 / 本地执行总数 / 数据流出次数 / 敏感数据本地处理率 / 审计异常数）
//   2. 云端调用明细（时间 / 模型 / 用途 / 脱敏 / Token）
//   3. 本地执行明细（时间 / 类型 / 目标 / 敏感度 / 审计结果）
//   4. 数据流向分析（出站 / 本地 / 入站 条数 + 说明）
//   5. 模型路由分布（云端 32B+ / 云端快速 / 本地 7B / 本地 0.5B）
//   6. 异常告警
// ============================================================

import type { DataSovereigntyRecord } from './data-sovereignty';

// ============================================================
// 统计结构（report-generator.ts 聚合后传入）
// ============================================================

export interface ReportStats {
  /** 记录总数 */
  total: number;
  /** 云端调用总数（destination = cloud-api） */
  cloudCallCount: number;
  /** 本地执行总数 */
  localActionCount: number;
  /** 数据流出次数（direction = outbound） */
  outboundCount: number;
  /** 数据流入次数（direction = inbound） */
  inboundCount: number;
  /** 本地闭环次数（direction = local-only） */
  localOnlyCount: number;
  /** 敏感数据本地处理率（0-1） */
  sensitiveLocalRate: number;
  /** 审计异常数 */
  anomalyCount: number;
  /** 模型路由分布 */
  routeDist: {
    cloudStrong: number;
    cloudFast: number;
    local7b: number;
    local05b: number;
  };
  /** 原始记录（明细表用） */
  records: DataSovereigntyRecord[];
}

export type ReportKindLabel = 'daily' | 'weekly' | 'monthly';

const KIND_LABEL: Record<ReportKindLabel, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
};

// ============================================================
// 主渲染函数
// ============================================================

/**
 * 渲染 6-section Markdown 报告
 * @param kind 报告类型
 * @param label 报告标识（2026-07-28 / 2026-W30 / 2026-07）
 * @param stats 聚合统计
 */
export function renderReport(
  kind: ReportKindLabel,
  label: string,
  stats: ReportStats,
): string {
  const lines: string[] = [];
  const kindCn = KIND_LABEL[kind];

  lines.push(`# 数据主权审计报告（${kindCn}）`);
  lines.push('');
  lines.push(`> 报告周期：${label}  `);
  lines.push(`> 生成时间：${new Date().toISOString()}  `);
  lines.push(`> 记录总数：${stats.total} 条`);
  lines.push('');

  renderSummary(lines, stats);
  renderCloudDetail(lines, stats);
  renderLocalDetail(lines, stats);
  renderDataFlow(lines, stats);
  renderRouteDist(lines, stats);
  renderAnomalies(lines, stats);

  lines.push('---');
  lines.push('');
  lines.push('*本报告由 sofagent 数据主权审计引擎自动生成（v1.2.3 · P0）。*');
  return lines.join('\n');
}

// ============================================================
// Section 1：概要
// ============================================================

function renderSummary(lines: string[], stats: ReportStats): void {
  lines.push('## 1. 概要');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| 云端调用总数 | ${stats.cloudCallCount} |`);
  lines.push(`| 本地执行总数 | ${stats.localActionCount} |`);
  lines.push(`| 数据流出次数 | ${stats.outboundCount} |`);
  lines.push(`| 敏感数据本地处理率 | ${(stats.sensitiveLocalRate * 100).toFixed(1)}% |`);
  lines.push(`| 审计异常数 | ${stats.anomalyCount} |`);
  lines.push('');
}

// ============================================================
// Section 2：云端调用明细
// ============================================================

function renderCloudDetail(lines: string[], stats: ReportStats): void {
  lines.push('## 2. 云端调用明细');
  lines.push('');
  const cloud = stats.records.filter((r) => r.dataFlow.destination === 'cloud-api');
  if (cloud.length === 0) {
    lines.push('（本周期无云端调用）');
    lines.push('');
    return;
  }
  lines.push('| 时间 | 模型 | 用途 | 脱敏 | Token（入/出） |');
  lines.push('|------|------|------|------|----------------|');
  for (const r of cloud.slice(0, 50)) {
    const time = r.cloudCall.timestamp.slice(0, 19).replace('T', ' ');
    const redacted = r.dataFlow.redacted ? '是' : '否';
    lines.push(
      `| ${time} | ${r.cloudCall.model} | ${r.cloudCall.purpose} | ${redacted} | ${r.cloudCall.tokenCount.input}/${r.cloudCall.tokenCount.output} |`,
    );
  }
  if (cloud.length > 50) {
    lines.push(`| … | （其余 ${cloud.length - 50} 条省略） | | | |`);
  }
  lines.push('');
}

// ============================================================
// Section 3：本地执行明细
// ============================================================

function renderLocalDetail(lines: string[], stats: ReportStats): void {
  lines.push('## 3. 本地执行明细');
  lines.push('');
  const local = stats.records.filter((r) => r.dataFlow.destination !== 'cloud-api');
  if (local.length === 0) {
    lines.push('（本周期无本地执行记录）');
    lines.push('');
    return;
  }
  lines.push('| 时间 | 类型 | 目标 | 敏感度 | 审计结果 |');
  lines.push('|------|------|------|--------|----------|');
  for (const r of local.slice(0, 50)) {
    const time = r.cloudCall.timestamp.slice(0, 19).replace('T', ' ');
    lines.push(
      `| ${time} | ${r.localAction.type} | ${r.localAction.target} | ${r.dataFlow.sensitivity} | ${r.localAction.auditResult} |`,
    );
  }
  if (local.length > 50) {
    lines.push(`| … | （其余 ${local.length - 50} 条省略） | | | |`);
  }
  lines.push('');
}

// ============================================================
// Section 4：数据流向分析
// ============================================================

function renderDataFlow(lines: string[], stats: ReportStats): void {
  lines.push('## 4. 数据流向分析');
  lines.push('');
  lines.push('| 方向 | 条数 | 说明 |');
  lines.push('|------|------|------|');
  lines.push(`| 出站（outbound） | ${stats.outboundCount} | 数据离开本地 → 云端 API |`);
  lines.push(`| 本地（local-only） | ${stats.localOnlyCount} | 数据仅在本地闭环 |`);
  lines.push(`| 入站（inbound） | ${stats.inboundCount} | 数据从外部进入本地 |`);
  lines.push('');
  if (stats.outboundCount > 0) {
    lines.push('> ⚠️ 存在数据流出。请确认 outbound 记录均已脱敏且敏感度为 public/internal。');
    lines.push('');
  }
}

// ============================================================
// Section 5：模型路由分布
// ============================================================

function renderRouteDist(lines: string[], stats: ReportStats): void {
  lines.push('## 5. 模型路由分布');
  lines.push('');
  lines.push('| 路由 | 条数 |');
  lines.push('|------|------|');
  lines.push(`| 云端 32B+（强模型） | ${stats.routeDist.cloudStrong} |`);
  lines.push(`| 云端快速 | ${stats.routeDist.cloudFast} |`);
  lines.push(`| 本地 7B | ${stats.routeDist.local7b} |`);
  lines.push(`| 本地 0.5B | ${stats.routeDist.local05b} |`);
  lines.push('');
}

// ============================================================
// Section 6：异常告警
// ============================================================

function renderAnomalies(lines: string[], stats: ReportStats): void {
  lines.push('## 6. 异常告警');
  lines.push('');
  const anomalies = stats.records.filter(
    (r) =>
      r.localAction.auditResult === 'FAIL' ||
      ((r.dataFlow.sensitivity === 'restricted' || r.dataFlow.sensitivity === 'confidential') &&
        r.dataFlow.destination === 'cloud-api'),
  );
  if (anomalies.length === 0) {
    lines.push('✅ 本周期无异常。');
    lines.push('');
    return;
  }
  lines.push(`共 ${anomalies.length} 条异常：`);
  lines.push('');
  for (const r of anomalies.slice(0, 20)) {
    const time = r.cloudCall.timestamp.slice(0, 19).replace('T', ' ');
    const reasons: string[] = [];
    if (r.localAction.auditResult === 'FAIL') reasons.push('审计 FAIL');
    if (
      (r.dataFlow.sensitivity === 'restricted' || r.dataFlow.sensitivity === 'confidential') &&
      r.dataFlow.destination === 'cloud-api'
    ) {
      reasons.push(`${r.dataFlow.sensitivity} 数据流向云端`);
    }
    lines.push(`- **${time}** · ${r.localAction.target} · ${reasons.join(' + ')}`);
  }
  if (anomalies.length > 20) {
    lines.push(`- …（其余 ${anomalies.length - 20} 条省略）`);
  }
  lines.push('');
}
