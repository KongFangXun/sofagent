// ============================================================
// config-suggestion.ts · 配置建议——格式化与应用
// v0.98 新增：审计闭环六步——配置建议层
// ============================================================
// 从 RootCauseReport 生成可操作的配置调整建议。
// 提供两个功能：
//   1. formatSuggestions: 把 suggestions 格式化为人类可读的终端输出
//   2. applySuggestion: 返回应用建议后的新配置（不修改原对象）
//
// 最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块。
// ============================================================

import type { RootCauseReport, ConfigSuggestion } from './audit-root-cause';
import type { AuditConfig } from './config-loader';

/**
 * 把 suggestions 格式化为人类可读的终端输出
 * @param report 根因分析报告
 * @returns 格式化的多行字符串
 */
export function formatSuggestions(report: RootCauseReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('=== 审计根因分析报告 ===');
  lines.push('');

  // 维度 1：按规则聚合
  lines.push('--- 按规则聚合 ---');
  if (report.byRule.length === 0) {
    lines.push('  无规则数据');
  } else {
    for (const rule of report.byRule) {
      const trendIcon =
        rule.recentTrend === 'up' ? '↑' :
        rule.recentTrend === 'down' ? '↓' : '→';
      lines.push(
        `  ${rule.ruleName}: 触发 ${rule.triggerCount} 次 ` +
        `(FAIL: ${rule.failCount}, WARN: ${rule.warnCount}) 趋势 ${trendIcon}`
      );
    }
  }
  lines.push('');

  // 维度 2：按文件聚合
  lines.push('--- 按文件聚合（被标记 >= 2 次） ---');
  if (report.byFile.length === 0) {
    lines.push('  无反复标记的文件');
  } else {
    for (const file of report.byFile) {
      lines.push(
        `  ${file.filePath}: 被标记 ${file.flaggedCount} 次 ` +
        `(规则: ${file.rules.join(', ')})`
      );
    }
  }
  lines.push('');

  // 维度 3：配置建议
  lines.push('--- 配置建议 ---');
  if (report.suggestions.length === 0) {
    lines.push('  暂无建议');
  } else {
    for (const suggestion of report.suggestions) {
      const typeLabel =
        suggestion.type === 'threshold' ? '[阈值调整]' :
        suggestion.type === 'whitelist' ? '[白名单]' :
        '[规则开关]';
      const confidencePct = (suggestion.confidence * 100).toFixed(0);
      lines.push(
        `  ${typeLabel} ${suggestion.ruleName} (置信度 ${confidencePct}%)`
      );
      lines.push(`    当前: ${suggestion.currentValue}`);
      lines.push(`    建议: ${suggestion.suggestedValue}`);
      lines.push(`    理由: ${suggestion.reason}`);
      lines.push('');
    }
  }

  lines.push('=== 报告结束 ===');
  return lines.join('\n');
}

/**
 * 应用单条建议到配置，返回新配置对象（不修改原对象）
 * @param config 原始配置
 * @param suggestion 要应用的建议
 * @returns 应用建议后的新配置
 */
export function applySuggestion(
  config: AuditConfig,
  suggestion: ConfigSuggestion
): AuditConfig {
  // 浅拷贝，但列表字段需要深拷贝
  const newConfig: AuditConfig = {
    ...config,
    lowRiskPatterns: [...config.lowRiskPatterns],
    testPatterns: [...config.testPatterns],
  };

  switch (suggestion.type) {
    case 'whitelist': {
      // 从 suggestedValue 中提取文件路径
      // 格式: "将 xxx 加入 lowRiskPatterns"
      const match = suggestion.suggestedValue.match(/将\s+(.+?)\s+加入/);
      if (match && match[1]) {
        const pattern = match[1];
        if (!newConfig.lowRiskPatterns.includes(pattern)) {
          newConfig.lowRiskPatterns.push(pattern);
        }
      }
      break;
    }

    case 'threshold': {
      // 建议调高阈值——微调 carefulModifyThreshold
      // 仅当建议涉及阈值且当前值 < 0.3 时调高
      if (newConfig.carefulModifyThreshold < 0.3) {
        newConfig.carefulModifyThreshold = Math.min(
          newConfig.carefulModifyThreshold + 0.1,
          0.5
        );
      }
      break;
    }

    case 'rule-toggle': {
      // 规则开关——当前建议是评估是否关闭
      // 不自动关闭规则（太危险），只在配置中留个标记
      // 此处不做实际修改，仅返回原配置
      break;
    }

    default:
      // 未知类型，不做修改
      break;
  }

  return newConfig;
}
