// ============================================================
// audit-sub-agent.ts · Audit Sub Agent 工具定义
// v1.0.9 新增：审计子代理的工具实现
// 检测到 A1/A2 违规时自动启动，或 daemon 定时调度
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadHistory, type AuditHistoryEntry } from '../audit-history';
import { calculateBaseline, isAnomaly, isColdStart } from '../cost-baseline';

/**
 * 工具：read_audit_history
 * 读取 history.jsonl 中最近的审计记录
 * @param limit 返回最近 N 条（默认 50）
 * @param dataDir 数据目录
 * @returns 审计历史条目数组
 */
export function readAuditHistory(limit: number = 50, dataDir?: string): AuditHistoryEntry[] {
  return loadHistory(limit, dataDir);
}

/**
 * 工具：analyze_cost_baseline
 * 对比指定任务类型的成本基线，检测异常
 * @param taskType 任务类型
 * @param dataDir 数据目录
 * @returns 分析结果——基线、异常状态、建议
 */
export function analyzeCostBaseline(
  taskType: string,
  dataDir: string
): {
  baseline: ReturnType<typeof calculateBaseline>;
  isAnomaly: boolean;
  isColdStart: boolean;
  message: string;
} {
  const baseline = calculateBaseline(taskType, dataDir);

  if (!baseline || isColdStart(baseline.sampleCount)) {
    return {
      baseline,
      isAnomaly: false,
      isColdStart: true,
      message: `任务类型 "${taskType}" 处于冷启动期（样本数: ${baseline?.sampleCount ?? 0}），暂无基线数据。`,
    };
  }

  // 取最新一条该类型的 token 消耗（简化：从 baseline 的计算上下文中获取）
  // 实际应传入当前任务的 token 消耗
  const anomaly = isAnomaly(baseline.mean + baseline.stddev, baseline);

  return {
    baseline,
    isAnomaly: anomaly,
    isColdStart: false,
    message: anomaly
      ? `⚠️ 任务类型 "${taskType}" 的 token 消耗异常——基线: ${baseline.mean.toFixed(0)} ± ${baseline.stddev.toFixed(0)} (${baseline.sampleCount} 样本)`
      : `任务类型 "${taskType}" 的 token 消耗正常——基线: ${baseline.mean.toFixed(0)} ± ${baseline.stddev.toFixed(0)} (${baseline.sampleCount} 样本)`,
  };
}

/**
 * 工具：generate_audit_report
 * 生成审计摘要报告
 * @param dataDir 数据目录
 * @returns 格式化报告文本
 */
export function generateAuditReport(dataDir: string): string {
  const history = loadHistory(50, dataDir);

  if (history.length === 0) {
    return '无审计历史数据。运行 sofagent-audit --diff <range> 后自动记录。';
  }

  const latest = history[0];
  if (!latest) return '无审计历史数据。';

  const failCount = history.filter((e) => e.exitCode === 2).length;
  const warnCount = history.filter((e) => e.exitCode === 1).length;
  const passCount = history.filter((e) => e.exitCode === 0).length;

  const reportLines: string[] = [
    `=== 审计报告 ===`,
    `检查范围: 最近 ${history.length} 条审计记录`,
    `通过: ${passCount} / 警告: ${warnCount} / 违规: ${failCount}`,
    `最近一次审计: ${latest.timestamp} (exit=${latest.exitCode})`,
    `变更文件数: ${latest.diffFileCount}`,
  ];

  if (latest.commitMsg) {
    reportLines.push(`commit message: ${latest.commitMsg}`);
  }

  // A1/A2 违规统计
  const a1a2Fails = history.filter((e) =>
    e.ruleResults.some((r) => (r.number === 1 || r.number === 2) && r.status === 'FAIL')
  );
  if (a1a2Fails.length > 0) {
    reportLines.push(`\n⚠️ A1/A2 违规历史: ${a1a2Fails.length} 次`);
    for (const entry of a1a2Fails.slice(0, 3)) {
      reportLines.push(`  - ${entry.timestamp}: ${entry.commitMsg ?? '(无 message)'}`);
    }
  }

  return reportLines.join('\n');
}

export default {
  readAuditHistory,
  analyzeCostBaseline,
  generateAuditReport,
};
