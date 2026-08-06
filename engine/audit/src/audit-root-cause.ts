// ============================================================
// audit-root-cause.ts · 根因分析——三维度聚合历史数据
// v0.98 新增：审计闭环六步——根因分析层
// ============================================================
// 从审计历史（AuditHistoryEntry[]）中提取三个维度的信息：
//   1. 按规则聚合：每条规则的触发/FAIL/WARN 次数 + 趋势
//   2. 按文件聚合：哪些文件被反复标记
//   3. 配置建议：根据模式给出可操作的配置调整建议
//
// 最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块。
// ============================================================

import type { AuditHistoryEntry } from './audit-history';

/**
 * 配置建议——从根因分析生成的可操作建议
 */
export interface ConfigSuggestion {
  /** 建议类型：阈值调整 / 白名单 / 规则开关 */
  type: 'threshold' | 'whitelist' | 'rule-toggle';
  /** 相关规则名 */
  ruleName: string;
  /** 当前值 */
  currentValue: string;
  /** 建议值 */
  suggestedValue: string;
  /** 建议理由 */
  reason: string;
  /** 置信度 0-1 */
  confidence: number;
}

/**
 * 按规则聚合的结果
 */
export interface RuleAggregation {
  /** 规则名 */
  ruleName: string;
  /** 总触发次数（WARN + FAIL） */
  triggerCount: number;
  /** FAIL 次数 */
  failCount: number;
  /** WARN 次数 */
  warnCount: number;
  /** 最近 10 次的趋势 */
  recentTrend: 'up' | 'down' | 'stable';
}

/**
 * 按文件聚合的结果
 */
export interface FileAggregation {
  /** 文件路径 */
  filePath: string;
  /** 被标记次数 */
  flaggedCount: number;
  /** 被哪些规则标记过 */
  rules: string[];
}

/**
 * 根因分析报告
 */
export interface RootCauseReport {
  /** 维度 1：按规则聚合 */
  byRule: RuleAggregation[];
  /** 维度 2：按文件聚合 */
  byFile: FileAggregation[];
  /** 维度 3：配置建议 */
  suggestions: ConfigSuggestion[];
}

/** 从 details 字符串中提取文件路径的正则——匹配 /[\w/.-]+\.\w+ */
const FILE_PATH_PATTERN = /[\w/.-]+\.\w+/g;

/**
 * 从规则 details 字段中提取文件路径
 * details 格式不固定（各规则自己写的），用宽松匹配
 * @param details 规则的 details 字符串数组
 * @returns 提取到的文件路径数组
 */
function extractFilePaths(details: string[]): string[] {
  const paths: string[] = [];
  for (const detail of details) {
    const matches = detail.match(FILE_PATH_PATTERN);
    if (matches) {
      for (const match of matches) {
        paths.push(match);
      }
    }
  }
  return paths;
}

/**
 * 计算规则趋势
 * 取最近 10 条该规则的结果，FAIL+WARN 占比 vs 前 10 条对比
 * >10% 差异 = up/down，其余 stable
 * @param statuses 该规则的所有历史状态（按时间正序）
 */
function calculateTrend(statuses: ('PASS' | 'WARN' | 'FAIL' | 'SKIPPED')[]): 'up' | 'down' | 'stable' {
  if (statuses.length < 2) {
    return 'stable';
  }

  // 分成前后两半
  const mid = Math.floor(statuses.length / 2);
  const earlier = statuses.slice(0, mid);
  const recent = statuses.slice(-Math.min(10, statuses.length - mid > 0 ? statuses.length - mid : 1));

  // 如果 earlier 或 recent 为空，无法比较
  if (earlier.length === 0 || recent.length === 0) {
    return 'stable';
  }

  const earlierTriggerRate = earlier.filter((s) => s === 'WARN' || s === 'FAIL').length / earlier.length;
  const recentTriggerRate = recent.filter((s) => s === 'WARN' || s === 'FAIL').length / recent.length;

  const diff = recentTriggerRate - earlierTriggerRate;

  if (diff > 0.1) {
    return 'up';
  } else if (diff < -0.1) {
    return 'down';
  }
  return 'stable';
}

/**
 * 分析根因——三维度聚合历史数据
 * @param history 审计历史条目数组（按时间正序或倒序均可，内部排序）
 * @returns 根因分析报告
 */
export function analyzeRootCause(history: AuditHistoryEntry[]): RootCauseReport {
  // 按时间正序排序（最早在前，便于趋势计算）
  const sorted = [...history].sort((a, b) => {
    return a.timestamp.localeCompare(b.timestamp);
  });

  // 维度 1：按规则聚合
  const ruleStats = new Map<string, {
    triggerCount: number;
    failCount: number;
    warnCount: number;
    statuses: ('PASS' | 'WARN' | 'FAIL' | 'SKIPPED')[];
  }>();

  // 维度 2：按文件聚合
  const fileStats = new Map<string, {
    flaggedCount: number;
    rules: Set<string>;
  }>();

  // 遍历每条历史
  for (const entry of sorted) {
    for (const ruleResult of (entry.ruleResults ?? [])) {
      const name = ruleResult.name;

      // 初始化规则统计
      if (!ruleStats.has(name)) {
        ruleStats.set(name, {
          triggerCount: 0,
          failCount: 0,
          warnCount: 0,
          statuses: [],
        });
      }
      const stat = ruleStats.get(name)!;

      // 统计状态
      stat.statuses.push(ruleResult.status);

      if (ruleResult.status === 'FAIL') {
        stat.failCount++;
        stat.triggerCount++;
      } else if (ruleResult.status === 'WARN') {
        stat.warnCount++;
        stat.triggerCount++;
      }

      // 从 details 提取文件路径（仅 WARN/FAIL 时有意义的 details）
      if (ruleResult.status === 'WARN' || ruleResult.status === 'FAIL') {
        const filePaths = extractFilePaths(ruleResult.details);
        for (const fp of filePaths) {
          if (!fileStats.has(fp)) {
            fileStats.set(fp, { flaggedCount: 0, rules: new Set<string>() });
          }
          const fs = fileStats.get(fp)!;
          fs.flaggedCount++;
          fs.rules.add(name);
        }
      }
    }
  }

  // 构建 byRule 数组
  const byRule: RuleAggregation[] = [];
  for (const [ruleName, stat] of ruleStats) {
    byRule.push({
      ruleName,
      triggerCount: stat.triggerCount,
      failCount: stat.failCount,
      warnCount: stat.warnCount,
      recentTrend: calculateTrend(stat.statuses),
    });
  }
  // 按触发次数降序
  byRule.sort((a, b) => b.triggerCount - a.triggerCount);

  // 构建 byFile 数组（只保留 flaggedCount >= 2）
  const byFile: FileAggregation[] = [];
  for (const [filePath, stat] of fileStats) {
    if (stat.flaggedCount >= 2) {
      byFile.push({
        filePath,
        flaggedCount: stat.flaggedCount,
        rules: [...stat.rules],
      });
    }
  }
  // 按被标记次数降序
  byFile.sort((a, b) => b.flaggedCount - a.flaggedCount);

  // 维度 3：生成建议
  const suggestions = generateSuggestions(byRule, byFile, sorted.length);

  return { byRule, byFile, suggestions };
}

/**
 * 根据聚合结果生成配置建议
 * @param byRule 按规则聚合的结果
 * @param byFile 按文件聚合的结果
 * @param historyCount 历史总条数
 */
function generateSuggestions(
  byRule: RuleAggregation[],
  byFile: FileAggregation[],
  historyCount: number
): ConfigSuggestion[] {
  const suggestions: ConfigSuggestion[] = [];

  // 建议规则 1：某规则 WARN 远大于 FAIL 且 WARN 占比 >50%
  // → 建议调高阈值或加白名单
  for (const rule of byRule) {
    const total = rule.failCount + rule.warnCount;
    if (total === 0) continue;

    const warnRatio = rule.warnCount / total;
    if (rule.warnCount > rule.failCount * 2 && warnRatio > 0.5 && rule.warnCount >= 3) {
      suggestions.push({
        type: 'threshold',
        ruleName: rule.ruleName,
        currentValue: '默认阈值',
        suggestedValue: '调高阈值或添加白名单',
        reason: `${rule.ruleName} 的 WARN(${rule.warnCount}) 远大于 FAIL(${rule.failCount})，WARN 占比 ${(warnRatio * 100).toFixed(0)}%，可能存在误报`,
        confidence: 0.7,
      });
    }
  }

  // 建议规则 2：某文件被标记 >= 3 次 → 建议加入 lowRiskPatterns
  for (const file of byFile) {
    if (file.flaggedCount >= 3) {
      suggestions.push({
        type: 'whitelist',
        ruleName: file.rules.join(', '),
        currentValue: `${file.filePath} 不在 lowRiskPatterns 中`,
        suggestedValue: `将 ${file.filePath} 加入 lowRiskPatterns`,
        reason: `${file.filePath} 被标记 ${file.flaggedCount} 次（规则: ${file.rules.join(', ')}），可能是已知的安全文件`,
        confidence: 0.6,
      });
    }
  }

  // 建议规则 3：某规则从不触发（triggerCount = 0 且历史 >= 20 条）
  // → 建议评估是否关闭（confidence 低）
  if (historyCount >= 20) {
    for (const rule of byRule) {
      if (rule.triggerCount === 0) {
        suggestions.push({
          type: 'rule-toggle',
          ruleName: rule.ruleName,
          currentValue: '启用',
          suggestedValue: '评估是否关闭',
          reason: `${rule.ruleName} 在最近 ${historyCount} 次审计中从未触发，可能是无效规则`,
          confidence: 0.3,
        });
      }
    }
  }

  return suggestions;
}
