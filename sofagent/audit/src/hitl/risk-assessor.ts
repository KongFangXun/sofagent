// ============================================================
// hitl/risk-assessor.ts · HITL 风险评估器
// v1.0.7 新增
// 四类强制人工确认场景检测 + 风险等级判定
// ============================================================

import type { RiskAssessment, RiskAssessmentInput, RiskLevel } from './types';

/**
 * 四类强制人工确认场景
 */
const FORCED_HUMAN_REVIEW: { pattern: RegExp; type: string }[] = [
  { pattern: /rm\s+-rf|DELETE\s+FROM|drop\s+table/i, type: '删除操作' },
  { pattern: /fetch\(|curl\s|http\./i, type: '外部 API 调用' },
  { pattern: /chmod|chown|sudo|permissions/i, type: '权限变更' },
  { pattern: /migration|migrate|ALTER\s+TABLE/i, type: '数据迁移' },
];

/**
 * 中风险场景
 */
const MEDIUM_RISK_PATTERNS: { pattern: RegExp; type: string }[] = [
  { pattern: /write|modify|update|replace|create/i, type: '写入操作' },
  { pattern: /config|configure|setup|install/i, type: '配置变更' },
  { pattern: /exec|execute|run\s/i, type: '命令执行' },
];

/**
 * 评估操作风险
 * @param input 风险评估输入
 * @returns RiskAssessment 风险评估结果
 */
export function assessRisk(input: RiskAssessmentInput): RiskAssessment {
  const forcedTriggers: string[] = [];
  const details: string[] = [];
  let riskScore = 0;

  // 检查四类强制场景
  const actionWithContext = `${input.action} ${input.target ?? ''} ${JSON.stringify(input.context ?? {})}`;

  for (const { pattern, type } of FORCED_HUMAN_REVIEW) {
    if (pattern.test(actionWithContext)) {
      forcedTriggers.push(type);
      details.push(`命中强制人工场景: ${type}`);
    }
  }

  // 有强制场景 → 直接 critical
  if (forcedTriggers.length > 0) {
    return {
      level: 'critical',
      score: 0,
      tag: '🔒',
      forcedTriggers,
      details,
    };
  }

  // 检查中风险场景
  for (const { pattern, type } of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(actionWithContext)) {
      riskScore += 15;
      details.push(`中风险场景: ${type}`);
    }
  }

  // 基础风险评分
  // - 操作路径深度
  const pathDepth = (input.action.match(/\//g) || []).length;
  riskScore += Math.min(pathDepth * 5, 20);

  // - 参数复杂度
  if (input.context) {
    const contextKeys = Object.keys(input.context);
    riskScore += Math.min(contextKeys.length * 3, 15);
  }

  // clamp 到 0-100
  riskScore = Math.max(0, Math.min(100, riskScore));

  // 反算置信度分数
  const confidenceScore = 100 - riskScore;

  // 判定等级
  let level: RiskLevel;
  if (riskScore >= 70) {
    level = 'high';
  } else if (riskScore >= 40) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return {
    level,
    score: confidenceScore,
    tag: getConfidenceTag(confidenceScore),
    forcedTriggers,
    details,
  };
}

/**
 * 根据分数获取置信度标签
 */
function getConfidenceTag(score: number): '🟢' | '🟡' | '🔒' {
  if (score >= 99) return '🟢';
  if (score >= 80) return '🟡';
  return '🔒';
}
