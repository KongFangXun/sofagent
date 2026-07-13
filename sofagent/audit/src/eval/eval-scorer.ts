// ============================================================
// eval/eval-scorer.ts · eval 评分器
// v1.0.7 新增
// 三维度评分：精确匹配 / 语义相似度 / 规则合规
// ============================================================

import type { ScoreBreakdown } from './types';

/**
 * 计算精确匹配得分
 * 比较两个对象的 key/value 是否完全一致
 */
function scoreExactMatch(actual: Record<string, unknown>, expected: Record<string, unknown>): number {
  const expectedKeys = Object.keys(expected);
  if (expectedKeys.length === 0) return 1.0;

  const matchedKeys = expectedKeys.filter((key) => {
    const a = actual[key];
    const e = expected[key];
    // 数组深度比较
    if (Array.isArray(a) && Array.isArray(e)) {
      return a.length === e.length && a.every((v, i) => v === e[i]);
    }
    // 对象深度比较（简单递归）
    if (typeof a === 'object' && typeof e === 'object' && a !== null && e !== null) {
      return JSON.stringify(a) === JSON.stringify(e);
    }
    return a === e;
  });

  return matchedKeys.length / expectedKeys.length;
}

/**
 * 计算语义相似度得分
 * 对字符串类型的字段做 Jaccard 相似度
 */
function scoreSemanticSimilarity(actual: Record<string, unknown>, expected: Record<string, unknown>): number {
  const sharedKeys = Object.keys(expected).filter((k) => k in actual);
  if (sharedKeys.length === 0) return 0;

  let totalSimilarity = 0;
  let comparedFields = 0;

  for (const key of sharedKeys) {
    const actualVal = String(actual[key] ?? '');
    const expectedVal = String(expected[key] ?? '');

    if (actualVal.length === 0 && expectedVal.length === 0) {
      totalSimilarity += 1;
      comparedFields++;
      continue;
    }

    // Jaccard 相似度：交集/并集
    const actualTokens = new Set(actualVal.toLowerCase().split(/\s+/).filter(Boolean));
    const expectedTokens = new Set(expectedVal.toLowerCase().split(/\s+/).filter(Boolean));

    if (actualTokens.size === 0 && expectedTokens.size === 0) {
      totalSimilarity += 1;
    } else {
      const intersection = new Set([...actualTokens].filter((t) => expectedTokens.has(t)));
      const union = new Set([...actualTokens, ...expectedTokens]);
      totalSimilarity += union.size > 0 ? intersection.size / union.size : 0;
    }
    comparedFields++;
  }

  return comparedFields > 0 ? totalSimilarity / comparedFields : 0;
}

/**
 * 计算规则合规得分
 * 检查 result 和 rules_triggered 是否符合预期
 */
function scoreRuleCompliance(actual: Record<string, unknown>, expected: Record<string, unknown>): number {
  let score = 0;
  let checks = 0;

  // 检查 result 字段
  if (expected['result'] !== undefined) {
    checks++;
    if (actual['result'] === expected['result']) score++;
  }

  // 检查 rules_triggered
  if (expected['rules_triggered'] !== undefined) {
    checks++;
    const expectedRules = expected['rules_triggered'] as string[];
    const actualRules = actual['rules_triggered'] as string[] | undefined;
    if (Array.isArray(expectedRules) && expectedRules.length === 0) {
      // 期望无规则触发
      if (!actualRules || actualRules.length === 0) score++;
    } else if (Array.isArray(expectedRules) && Array.isArray(actualRules)) {
      // 检查期望的规则是否都被触发了
      const allTriggered = expectedRules.every((r) => actualRules.includes(r));
      if (allTriggered) score++;
    }
  }

  // 检查 severity
  if (expected['severity'] !== undefined) {
    checks++;
    if (actual['severity'] === expected['severity']) score++;
  }

  return checks > 0 ? score / checks : 1.0;
}

/**
 * 三维度综合评分
 * @param actual Agent 实际输出
 * @param expected 期望输出
 * @returns ScoreBreakdown 评分分解
 */
export function scoreCase(actual: Record<string, unknown>, expected: Record<string, unknown>): ScoreBreakdown {
  const exactMatch = scoreExactMatch(actual, expected);
  const semanticSimilarity = scoreSemanticSimilarity(actual, expected);
  const ruleCompliance = scoreRuleCompliance(actual, expected);

  // 综合：精确匹配 50%，语义 20%，规则合规 30%
  const overall = exactMatch * 0.5 + semanticSimilarity * 0.2 + ruleCompliance * 0.3;

  return {
    exactMatch: Math.round(exactMatch * 10000) / 10000,
    semanticSimilarity: Math.round(semanticSimilarity * 10000) / 10000,
    ruleCompliance: Math.round(ruleCompliance * 10000) / 10000,
    overall: Math.round(overall * 10000) / 10000,
  };
}
