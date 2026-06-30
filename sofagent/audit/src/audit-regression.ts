// ============================================================
// audit-regression.ts · 回归验证——用历史快照重跑当前规则
// v0.98 新增：审计闭环六步——回归验证层
// ============================================================
// 用历史 diff 快照重新运行当前版本的审计规则，
// 对比新旧结果，发现：
//   - newIssues: 规则更新后新发现的问题（之前 PASS 现在 WARN/FAIL）
//   - resolvedIssues: 规则更新后解决的问题（之前 WARN/FAIL 现在 PASS）
//   - unchanged: 结果不变的
//
// 注意：当前历史存储只存 AuditHistoryEntry（规则结果），
// 不存原始 diff。所以回归验证需要用户手动传入 snapshots
// （从 git log 重建，或从测试 fixture 加载）。
// 自动重建待 v1.x。
//
// 零外部依赖——只用 Node.js 内置模块。
// ============================================================

import type { DiffFile } from './diff-parser';
import type { LogEntry } from './log-checker';
import type { Rule } from './rules/types';
import { runRules } from './reporter';
import type { RuleCheck } from './rules/types';

/**
 * 历史 diff 快照——包含已解析的 diff 和日志
 * 用户从 git log 重建或从测试 fixture 加载
 */
export interface DiffSnapshot {
  /** 快照时间戳 */
  timestamp: string;
  /** 已解析的 diff 文件列表 */
  diffFiles: DiffFile[];
  /** 日志条目 */
  logEntries: LogEntry[];
  /** 任务描述 */
  task?: string;
  /** 该快照之前的规则结果（用于对比） */
  previousResults: RuleCheck[];
}

/**
 * 回归验证报告
 */
export interface RegressionReport {
  /** 重跑的历史快照数 */
  totalSnapshots: number;
  /** 规则更新后新发现的问题（之前 PASS 现在 WARN/FAIL） */
  newIssues: number;
  /** 规则更新后解决的问题（之前 WARN/FAIL 现在 PASS） */
  resolvedIssues: number;
  /** 结果不变的 */
  unchanged: number;
  /** 详细变化记录 */
  details: {
    /** 快照时间戳 */
    timestamp: string;
    /** 规则名 */
    ruleName: string;
    /** 旧状态 */
    oldStatus: string;
    /** 新状态 */
    newStatus: string;
  }[];
}

/**
 * 运行回归验证
 * 遍历每个 snapshot，用 currentRules 重新跑一遍规则，
 * 对比新旧状态
 * @param snapshots 历史 diff 快照数组
 * @param currentRules 当前版本的规则数组
 * @returns 回归验证报告
 */
export function runRegression(
  snapshots: DiffSnapshot[],
  currentRules: Rule[]
): RegressionReport {
  const report: RegressionReport = {
    totalSnapshots: snapshots.length,
    newIssues: 0,
    resolvedIssues: 0,
    unchanged: 0,
    details: [],
  };

  for (const snapshot of snapshots) {
    // 用当前规则重新跑一遍
    // 注意：runRules 接收的是规则数组，但实际是从 rules 注册表读取
    // 这里需要模拟 runRules 的行为——遍历 currentRules 并调用 check
    const newResults: RuleCheck[] = [];

    for (const rule of currentRules) {
      const ctx = {
        diffFiles: snapshot.diffFiles,
        logEntries: snapshot.logEntries,
        task: snapshot.task,
        strict: false,
        silent: false,
        commitMsg: undefined,
        config: undefined,
      };
      newResults.push(rule.check(ctx));
    }

    // 对比新旧结果
    const oldMap = new Map<string, RuleCheck>();
    for (const old of snapshot.previousResults) {
      oldMap.set(old.name, old);
    }

    for (const newResult of newResults) {
      const oldResult = oldMap.get(newResult.name);
      const oldStatus = oldResult?.status ?? 'ABSENT';
      const newStatus = newResult.status;

      if (oldStatus === newStatus) {
        report.unchanged++;
      } else if (
        (oldStatus === 'PASS' || oldStatus === 'ABSENT') &&
        (newStatus === 'WARN' || newStatus === 'FAIL')
      ) {
        // 之前 PASS 现在 WARN/FAIL → 新发现问题
        report.newIssues++;
        report.details.push({
          timestamp: snapshot.timestamp,
          ruleName: newResult.name,
          oldStatus,
          newStatus,
        });
      } else if (
        (oldStatus === 'WARN' || oldStatus === 'FAIL') &&
        newStatus === 'PASS'
      ) {
        // 之前 WARN/FAIL 现在 PASS → 问题已解决
        report.resolvedIssues++;
        report.details.push({
          timestamp: snapshot.timestamp,
          ruleName: newResult.name,
          oldStatus,
          newStatus,
        });
      } else {
        // 状态变化但不属于 newIssues 或 resolvedIssues（如 WARN→FAIL）
        report.details.push({
          timestamp: snapshot.timestamp,
          ruleName: newResult.name,
          oldStatus,
          newStatus,
        });
      }
    }
  }

  return report;
}
