// ============================================================
// audit-regression.test.ts · 回归验证测试
// v0.98 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { runRegression, type DiffSnapshot } from './audit-regression';
import type { Rule, RuleCheck, AuditContext } from './rules/types';
import type { DiffFile } from '@sofagent/core';
import type { LogEntry } from '@sofagent/core';

/** 构造一个模拟规则 */
function makeMockRule(
  name: string,
  status: 'PASS' | 'WARN' | 'FAIL'
): Rule {
  return {
    name,
    number: 1,
    evidenceMode: 'git-diff',
    ruleType: 'diff',
    check: (_ctx: AuditContext): RuleCheck => ({
      name,
      number: 1,
      status,
      details: [],
    }),
  };
}

/** 构造测试用快照 */
function makeSnapshot(
  timestamp: string,
  previousResults: RuleCheck[]
): DiffSnapshot {
  return {
    timestamp,
    diffFiles: [] as DiffFile[],
    logEntries: [] as LogEntry[],
    previousResults,
  };
}

/** 构造测试用 RuleCheck */
function makeRuleCheck(
  name: string,
  status: 'PASS' | 'WARN' | 'FAIL'
): RuleCheck {
  return { name, number: 1, status, details: [] };
}

describe('audit-regression', () => {
  it('空 snapshots 返回全零报告', () => {
    // 验证：无快照时，报告全为 0
    const report = runRegression([], []);

    expect(report.totalSnapshots).toBe(0);
    expect(report.newIssues).toBe(0);
    expect(report.resolvedIssues).toBe(0);
    expect(report.unchanged).toBe(0);
    expect(report.details).toEqual([]);
  });

  it('新增问题：之前 PASS 现在 WARN/FAIL', () => {
    // 验证：规则更新后发现新问题
    const currentRules: Rule[] = [
      makeMockRule('R1', 'WARN'),
    ];

    const snapshots: DiffSnapshot[] = [
      makeSnapshot('2026-01-01T00:00:00Z', [
        makeRuleCheck('R1', 'PASS'),
      ]),
    ];

    const report = runRegression(snapshots, currentRules);

    expect(report.totalSnapshots).toBe(1);
    expect(report.newIssues).toBe(1);
    expect(report.resolvedIssues).toBe(0);
    expect(report.unchanged).toBe(0);
    expect(report.details.length).toBe(1);
    expect(report.details[0]!.ruleName).toBe('R1');
    expect(report.details[0]!.oldStatus).toBe('PASS');
    expect(report.details[0]!.newStatus).toBe('WARN');
  });

  it('解决问题：之前 WARN/FAIL 现在 PASS', () => {
    // 验证：规则更新后解决了旧问题
    const currentRules: Rule[] = [
      makeMockRule('R1', 'PASS'),
    ];

    const snapshots: DiffSnapshot[] = [
      makeSnapshot('2026-01-01T00:00:00Z', [
        makeRuleCheck('R1', 'FAIL'),
      ]),
    ];

    const report = runRegression(snapshots, currentRules);

    expect(report.totalSnapshots).toBe(1);
    expect(report.newIssues).toBe(0);
    expect(report.resolvedIssues).toBe(1);
    expect(report.unchanged).toBe(0);
    expect(report.details.length).toBe(1);
    expect(report.details[0]!.ruleName).toBe('R1');
    expect(report.details[0]!.oldStatus).toBe('FAIL');
    expect(report.details[0]!.newStatus).toBe('PASS');
  });

  it('无变化：新旧状态相同', () => {
    // 验证：结果不变时计入 unchanged
    const currentRules: Rule[] = [
      makeMockRule('R1', 'WARN'),
      makeMockRule('R2', 'PASS'),
    ];

    const snapshots: DiffSnapshot[] = [
      makeSnapshot('2026-01-01T00:00:00Z', [
        makeRuleCheck('R1', 'WARN'),
        makeRuleCheck('R2', 'PASS'),
      ]),
    ];

    const report = runRegression(snapshots, currentRules);

    expect(report.totalSnapshots).toBe(1);
    expect(report.newIssues).toBe(0);
    expect(report.resolvedIssues).toBe(0);
    expect(report.unchanged).toBe(2);
    expect(report.details).toEqual([]);
  });

  it('多个快照正确累计统计', () => {
    // 验证：多个快照的结果正确累加
    const currentRules: Rule[] = [
      makeMockRule('R1', 'WARN'),  // 新规则更严格
    ];

    const snapshots: DiffSnapshot[] = [
      // 快照 1：之前 PASS → 现在 WARN（新问题）
      makeSnapshot('2026-01-01T00:00:00Z', [
        makeRuleCheck('R1', 'PASS'),
      ]),
      // 快照 2：之前 WARN → 现在 WARN（不变）
      makeSnapshot('2026-01-02T00:00:00Z', [
        makeRuleCheck('R1', 'WARN'),
      ]),
      // 快照 3：之前 FAIL → 现在 WARN（变化但不属于新/解决）
      makeSnapshot('2026-01-03T00:00:00Z', [
        makeRuleCheck('R1', 'FAIL'),
      ]),
    ];

    const report = runRegression(snapshots, currentRules);

    expect(report.totalSnapshots).toBe(3);
    expect(report.newIssues).toBe(1);
    expect(report.resolvedIssues).toBe(0);
    expect(report.unchanged).toBe(1);
    // details 包含新问题 + 状态变化（PASS→WARN 和 FAIL→WARN）
    expect(report.details.length).toBe(2);
  });
});
