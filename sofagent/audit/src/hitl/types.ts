// ============================================================
// hitl/types.ts · HITL 渐进自主度类型定义
// v1.0.7 新增
// ============================================================

/**
 * 风险等级
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
/**
 * 置信度标签
 */
export type ConfidenceTag = '🟢' | '🟡' | '🔒';

/**
 * 风险评估输入
 */
export interface RiskAssessmentInput {
  /** 操作描述 */
  action: string;
  /** 操作目标 */
  target?: string;
  /** 上下文信息 */
  context?: Record<string, unknown>;
}

/**
 * 风险评估输出
 */
export interface RiskAssessment {
  /** 风险等级 */
  level: RiskLevel;
  /** 置信度分数（0-100） */
  score: number;
  /** 置信度标签 */
  tag: ConfidenceTag;
  /** 命中的强制场景列表 */
  forcedTriggers: string[];
  /** 详细说明 */
  details: string[];
}

/**
 * HITL 会话统计
 */
export interface HitlStats {
  /** 总操作数 */
  totalActions: number;
  /** 各标签分布 */
  byTag: Record<ConfidenceTag, number>;
  /** 各风险等级分布 */
  byLevel: Record<RiskLevel, number>;
  /** 强制人工确认数 */
  forcedReviews: number;
}
