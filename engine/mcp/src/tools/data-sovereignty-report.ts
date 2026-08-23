// ============================================================
// data-sovereignty-report.ts · MCP tool：数据主权审计报告查询（v1.4.0 · P0）
// ============================================================
//
// 用户对话："今天的数据安全吗？"
// Agent 调用 data_sovereignty_report({ date: "today" }) → 返回今日审计摘要
//
// 支持 date 参数：'today' | 'yesterday' | 'YYYY-MM-DD'
// 返回：概要统计 + 异常列表（供 Agent 组装自然语言回答）
// ============================================================

import { generateDailyReport } from '@sofagent/audit';

/** MCP tool 入参 */
export interface DataSovereigntyReportArgs {
  /** 查询日期：'today' | 'yesterday' | 'YYYY-MM-DD'（默认 today） */
  date?: string;
}

/** MCP tool 返回结构 */
export interface DataSovereigntyReportResult {
  /** 是否查询成功 */
  ok: boolean;
  /** 首行必须带 [sofagent] 前缀（三层签名铁律） */
  text: string;
  /** 结构化数据（供 Agent 进一步加工） */
  data: {
    date: string;
    total: number;
    cloudCallCount: number;
    localActionCount: number;
    outboundCount: number;
    sensitiveLocalRate: number;
    anomalyCount: number;
    anomalies: Array<{ time: string; target: string; reason: string }>;
    visiblePath?: string;
  };
}

/**
 * 查询指定日期的数据主权审计摘要
 *
 * 注意：本函数只查询不落盘新报告（与 daemon @daily 的落盘职责分离）。
 * 但 generateDailyReport 内部会写可见目录——这是幂等覆盖写，可接受。
 */
export function queryDataSovereigntyReport(
  args: DataSovereigntyReportArgs,
): DataSovereigntyReportResult {
  const date = args.date ?? 'today';
  const report = generateDailyReport(date);

  const anomalies = report.stats.records
    .filter(
      (r) =>
        r.localAction.auditResult === 'FAIL' ||
        ((r.dataFlow.sensitivity === 'restricted' || r.dataFlow.sensitivity === 'confidential') &&
          r.dataFlow.destination === 'cloud-api'),
    )
    .slice(0, 10)
    .map((r) => {
      const reasons: string[] = [];
      if (r.localAction.auditResult === 'FAIL') reasons.push('审计 FAIL');
      if (
        (r.dataFlow.sensitivity === 'restricted' || r.dataFlow.sensitivity === 'confidential') &&
        r.dataFlow.destination === 'cloud-api'
      ) {
        reasons.push(`${r.dataFlow.sensitivity} 数据流向云端`);
      }
      return {
        time: r.cloudCall.timestamp.slice(0, 19).replace('T', ' '),
        target: r.localAction.target,
        reason: reasons.join(' + '),
      };
    });

  const lines: string[] = [];
  lines.push(`[sofagent] 数据主权审计摘要 · ${report.label}`);
  lines.push(`记录总数：${report.stats.total} · 云端 ${report.stats.cloudCallCount} · 本地 ${report.stats.localActionCount}`);
  lines.push(
    `数据流出：${report.stats.outboundCount} · 敏感本地处理率：${(report.stats.sensitiveLocalRate * 100).toFixed(1)}% · 异常：${report.stats.anomalyCount}`,
  );
  if (anomalies.length > 0) {
    lines.push('');
    lines.push('异常明细（前 10 条）：');
    for (const a of anomalies) {
      lines.push(`- ${a.time} · ${a.target} · ${a.reason}`);
    }
  } else if (report.stats.total > 0) {
    lines.push('✅ 本日无异常。');
  } else {
    lines.push('（本日暂无审计记录——middleware 尚未接入或无调用）');
  }

  return {
    ok: true,
    text: lines.join('\n'),
    data: {
      date: report.label,
      total: report.stats.total,
      cloudCallCount: report.stats.cloudCallCount,
      localActionCount: report.stats.localActionCount,
      outboundCount: report.stats.outboundCount,
      sensitiveLocalRate: report.stats.sensitiveLocalRate,
      anomalyCount: report.stats.anomalyCount,
      anomalies,
      visiblePath: report.visiblePath,
    },
  };
}
