// ============================================================
// config-suggestion.test.ts · 配置建议测试
// v0.98 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { formatSuggestions, applySuggestion } from './config-suggestion';
import type { RootCauseReport, ConfigSuggestion } from './audit-root-cause';
import { DEFAULT_CONFIG, type AuditConfig } from '@sofagent/core';

describe('config-suggestion', () => {
  it('formatSuggestions 输出人类可读的根因报告', () => {
    // 验证：格式化输出包含三个维度的标题
    const report: RootCauseReport = {
      byRule: [
        { ruleName: 'A3 不改越界', triggerCount: 5, failCount: 1, warnCount: 4, recentTrend: 'up' },
      ],
      byFile: [
        { filePath: 'src/legacy/utils.ts', flaggedCount: 3, rules: ['A3 不改越界'] },
      ],
      suggestions: [
        {
          type: 'threshold',
          ruleName: 'A3 不改越界',
          currentValue: '默认阈值',
          suggestedValue: '调高阈值或添加白名单',
          reason: 'WARN 远大于 FAIL',
          confidence: 0.7,
        },
      ],
    };

    const output = formatSuggestions(report);

    expect(output).toContain('审计根因分析报告');
    expect(output).toContain('按规则聚合');
    expect(output).toContain('A3 不改越界');
    expect(output).toContain('按文件聚合');
    expect(output).toContain('src/legacy/utils.ts');
    expect(output).toContain('配置建议');
    expect(output).toContain('[阈值调整]');
  });

  it('formatSuggestions 空报告输出「无数据」提示', () => {
    // 验证：空数据时有友好的提示
    const report: RootCauseReport = {
      byRule: [],
      byFile: [],
      suggestions: [],
    };

    const output = formatSuggestions(report);

    expect(output).toContain('无规则数据');
    expect(output).toContain('无反复标记的文件');
    expect(output).toContain('暂无建议');
  });

  it('applySuggestion whitelist 类型添加到 lowRiskPatterns', () => {
    // 验证：白名单建议把文件路径加入 lowRiskPatterns
    const config: AuditConfig = { ...DEFAULT_CONFIG };
    const suggestion: ConfigSuggestion = {
      type: 'whitelist',
      ruleName: 'A3 不改越界',
      currentValue: 'src/utils.ts 不在 lowRiskPatterns 中',
      suggestedValue: '将 src/utils.ts 加入 lowRiskPatterns',
      reason: '反复标记',
      confidence: 0.6,
    };

    const newConfig = applySuggestion(config, suggestion);

    expect(newConfig.lowRiskPatterns).toContain('src/utils.ts');
    // 原配置不变
    expect(config.lowRiskPatterns).not.toContain('src/utils.ts');
  });

  it('applySuggestion 不修改原配置对象（不可变性）', () => {
    // 验证：返回新对象，原对象未被修改
    const config: AuditConfig = {
      lowRiskPatterns: ['a.ts'],
      testPatterns: ['npm test'],
      carefulModifyThreshold: 0.2,
      extendedRulesEnabled: false,
    };
    const originalSnapshot = JSON.stringify(config);

    const suggestion: ConfigSuggestion = {
      type: 'whitelist',
      ruleName: 'R1',
      currentValue: 'b.ts 不在 lowRiskPatterns 中',
      suggestedValue: '将 b.ts 加入 lowRiskPatterns',
      reason: 'test',
      confidence: 0.5,
    };

    applySuggestion(config, suggestion);

    // 原配置对象未被修改
    expect(JSON.stringify(config)).toBe(originalSnapshot);
    expect(config.lowRiskPatterns).not.toContain('b.ts');
    expect(config.lowRiskPatterns.length).toBe(1);
  });
});
