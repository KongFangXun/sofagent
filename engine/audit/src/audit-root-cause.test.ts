// ============================================================
// audit-root-cause.test.ts · 根因分析测试
// v0.98 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { analyzeRootCause } from './audit-root-cause';
import type { AuditHistoryEntry } from './audit-history';
import type { RuleCheck } from './rules/types';

/** 构造测试用 RuleCheck */
function makeRuleCheck(
  name: string,
  number: number,
  status: 'PASS' | 'WARN' | 'FAIL',
  details: string[] = []
): RuleCheck {
  return { name, number, status, details };
}

/** 构造测试用历史条目 */
function makeEntry(
  timestamp: string,
  rules: RuleCheck[]
): AuditHistoryEntry {
  return {
    timestamp,
    diffRange: 'HEAD~1..HEAD',
    task: '测试',
    exitCode: rules.some(r => r.status === 'FAIL') ? 2 : rules.some(r => r.status === 'WARN') ? 1 : 0,
    ruleResults: rules,
    diffFileCount: 3,
  };
}

describe('audit-root-cause', () => {
  it('空历史返回空的 byRule / byFile / suggestions', () => {
    // 验证：空历史不报错，返回空数组
    const report = analyzeRootCause([]);

    expect(report.byRule).toEqual([]);
    expect(report.byFile).toEqual([]);
    expect(report.suggestions).toEqual([]);
  });

  it('按规则正确聚合 PASS / WARN / FAIL 次数', () => {
    // 验证：统计每条规则的触发/FAIL/WARN 次数
    const history: AuditHistoryEntry[] = [
      makeEntry('2026-01-01T00:00:00Z', [
        makeRuleCheck('A1 不碰敏感', 1, 'PASS'),
        makeRuleCheck('A3 不改越界', 3, 'WARN'),
      ]),
      makeEntry('2026-01-02T00:00:00Z', [
        makeRuleCheck('A1 不碰敏感', 1, 'PASS'),
        makeRuleCheck('A3 不改越界', 3, 'FAIL'),
      ]),
      makeEntry('2026-01-03T00:00:00Z', [
        makeRuleCheck('A1 不碰敏感', 1, 'PASS'),
        makeRuleCheck('A3 不改越界', 3, 'WARN'),
      ]),
    ];

    const report = analyzeRootCause(history);

    // A1: 全 PASS，triggerCount=0
    const a1 = report.byRule.find(r => r.ruleName === 'A1 不碰敏感');
    expect(a1).toBeDefined();
    expect(a1!.triggerCount).toBe(0);
    expect(a1!.failCount).toBe(0);
    expect(a1!.warnCount).toBe(0);

    // A3: 2 WARN + 1 FAIL = triggerCount 3
    const a3 = report.byRule.find(r => r.ruleName === 'A3 不改越界');
    expect(a3).toBeDefined();
    expect(a3!.triggerCount).toBe(3);
    expect(a3!.failCount).toBe(1);
    expect(a3!.warnCount).toBe(2);
  });

  it('byRule 按触发次数降序排列', () => {
    // 验证：触发次数多的排在前面
    const history: AuditHistoryEntry[] = [
      makeEntry('2026-01-01T00:00:00Z', [
        makeRuleCheck('R1', 1, 'WARN'),
        makeRuleCheck('R2', 2, 'WARN'),
      ]),
      makeEntry('2026-01-02T00:00:00Z', [
        makeRuleCheck('R1', 1, 'WARN'),
        makeRuleCheck('R2', 2, 'FAIL'),
      ]),
      makeEntry('2026-01-03T00:00:00Z', [
        makeRuleCheck('R2', 2, 'WARN'),
      ]),
    ];

    const report = analyzeRootCause(history);

    // R2 触发 3 次（2 WARN + 1 FAIL），R1 触发 2 次（2 WARN）
    expect(report.byRule[0]!.ruleName).toBe('R2');
    expect(report.byRule[0]!.triggerCount).toBe(3);
    expect(report.byRule[1]!.ruleName).toBe('R1');
    expect(report.byRule[1]!.triggerCount).toBe(2);
  });

  it('按文件聚合：提取 details 中的文件路径', () => {
    // 验证：从 details 字段中提取文件路径并统计
    const history: AuditHistoryEntry[] = [
      makeEntry('2026-01-01T00:00:00Z', [
        makeRuleCheck('A3 不改越界', 3, 'WARN', ['不相关文件 src/legacy/utils.ts']),
      ]),
      makeEntry('2026-01-02T00:00:00Z', [
        makeRuleCheck('A3 不改越界', 3, 'WARN', ['不相关文件 src/legacy/utils.ts']),
        makeRuleCheck('A1 不碰敏感', 1, 'FAIL', ['敏感文件 `src/config/db.yml`']),
      ]),
      makeEntry('2026-01-03T00:00:00Z', [
        makeRuleCheck('A3 不改越界', 3, 'WARN', ['不相关文件 src/legacy/utils.ts']),
      ]),
    ];

    const report = analyzeRootCause(history);

    // src/legacy/utils.ts 被标记 3 次
    const utilsFile = report.byFile.find(f => f.filePath === 'src/legacy/utils.ts');
    expect(utilsFile).toBeDefined();
    expect(utilsFile!.flaggedCount).toBe(3);
    expect(utilsFile!.rules).toContain('A3 不改越界');

    // src/config/db.yml 被标记 1 次（不出现，因为 < 2）
    const dbFile = report.byFile.find(f => f.filePath.includes('db.yml'));
    expect(dbFile).toBeUndefined();
  });

  it('byFile 只保留 flaggedCount >= 2 的文件', () => {
    // 验证：只被标记 1 次的文件不出现
    const history: AuditHistoryEntry[] = [
      makeEntry('2026-01-01T00:00:00Z', [
        makeRuleCheck('R1', 1, 'WARN', ['file_once.ts']),
      ]),
      makeEntry('2026-01-02T00:00:00Z', [
        makeRuleCheck('R1', 1, 'WARN', ['file_once.ts', 'file_twice.ts']),
      ]),
      makeEntry('2026-01-03T00:00:00Z', [
        makeRuleCheck('R1', 1, 'WARN', ['file_twice.ts']),
      ]),
    ];

    const report = analyzeRootCause(history);

    // file_once.ts 被标记 2 次（>= 2，保留）
    expect(report.byFile.find(f => f.filePath === 'file_once.ts')).toBeDefined();
    // file_twice.ts 被标记 2 次（>= 2，保留）
    expect(report.byFile.find(f => f.filePath === 'file_twice.ts')).toBeDefined();
  });

  it('趋势判定：触发率上升时 recentTrend = up', () => {
    // 验证：前半段全 PASS，后半段全 FAIL → up
    const rules: RuleCheck[] = [];
    const history: AuditHistoryEntry[] = [];

    // 前 10 条全 PASS
    for (let i = 1; i <= 10; i++) {
      history.push(makeEntry(`2026-01-${String(i).padStart(2, '0')}T00:00:00Z`, [
        makeRuleCheck('TREND_RULE', 99, 'PASS'),
      ]));
    }
    // 后 10 条全 FAIL
    for (let i = 11; i <= 20; i++) {
      history.push(makeEntry(`2026-01-${String(i).padStart(2, '0')}T00:00:00Z`, [
        makeRuleCheck('TREND_RULE', 99, 'FAIL'),
      ]));
    }

    const report = analyzeRootCause(history);
    const trendRule = report.byRule.find(r => r.ruleName === 'TREND_RULE');
    expect(trendRule).toBeDefined();
    expect(trendRule!.recentTrend).toBe('up');
  });

  it('趋势判定：触发率下降时 recentTrend = down', () => {
    // 验证：前半段全 FAIL，后半段全 PASS → down
    const history: AuditHistoryEntry[] = [];

    for (let i = 1; i <= 10; i++) {
      history.push(makeEntry(`2026-01-${String(i).padStart(2, '0')}T00:00:00Z`, [
        makeRuleCheck('TREND_RULE', 99, 'FAIL'),
      ]));
    }
    for (let i = 11; i <= 20; i++) {
      history.push(makeEntry(`2026-01-${String(i).padStart(2, '0')}T00:00:00Z`, [
        makeRuleCheck('TREND_RULE', 99, 'PASS'),
      ]));
    }

    const report = analyzeRootCause(history);
    const trendRule = report.byRule.find(r => r.ruleName === 'TREND_RULE');
    expect(trendRule).toBeDefined();
    expect(trendRule!.recentTrend).toBe('down');
  });

  it('建议生成：WARN 远大于 FAIL 且占比 >50% → threshold 建议', () => {
    // 验证：误报模式检测——建议调高阈值
    const history: AuditHistoryEntry[] = [];

    // 10 条 WARN + 0 FAIL（WARN 占比 100%）
    for (let i = 1; i <= 10; i++) {
      history.push(makeEntry(`2026-01-${String(i).padStart(2, '0')}T00:00:00Z`, [
        makeRuleCheck('NOISY_RULE', 99, 'WARN', ['file.ts']),
      ]));
    }

    const report = analyzeRootCause(history);

    const thresholdSuggestion = report.suggestions.find(s => s.type === 'threshold');
    expect(thresholdSuggestion).toBeDefined();
    expect(thresholdSuggestion!.ruleName).toBe('NOISY_RULE');
    expect(thresholdSuggestion!.confidence).toBeGreaterThan(0.5);
  });

  it('建议生成：历史 >= 20 条且规则从不触发 → rule-toggle 建议', () => {
    // 验证：低置信度建议——从不触发的规则
    const history: AuditHistoryEntry[] = [];

    // 25 条历史，某规则始终 PASS
    for (let i = 1; i <= 25; i++) {
      history.push(makeEntry(`2026-01-${String(i).padStart(2, '0')}T00:00:00Z`, [
        makeRuleCheck('DEAD_RULE', 99, 'PASS'),
      ]));
    }

    const report = analyzeRootCause(history);

    const toggleSuggestion = report.suggestions.find(s => s.type === 'rule-toggle');
    expect(toggleSuggestion).toBeDefined();
    expect(toggleSuggestion!.ruleName).toBe('DEAD_RULE');
    expect(toggleSuggestion!.confidence).toBeLessThanOrEqual(0.3);
  });
});
