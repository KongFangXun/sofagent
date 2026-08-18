// ============================================================
// permission/risk-classifier.ts · 风险等级分类器
// v1.3.6 · v1.3.7 开发② 新增
//
// 判定链第 3 环：身份 → 场景匹配 → 【风险等级】 → 放行/deny/人工批准
//
// 维度交叉（changelog §二示例表）：
//   读（低）/ 写（中）/ 删（高）/ 外传（极高）
//   × 数据域敏感度（audit-data / user-data 天然提级）
// ============================================================

import { ActionType, DataDomain } from './scenario-router';

/** 风险等级（与沙箱 tool-gate 的 ToolRisk 对齐） */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** 基线动作风险（changelog §二：读低/写中/删高/外传极高） */
const ACTION_BASE_RISK: Record<ActionType, RiskLevel> = {
  read: 'low',
  write: 'medium',
  delete: 'high',
  export: 'critical',
};

/** 数据域敏感度修正（在基线上提级，不降级）——入参是动作基线风险，按原始 action 语义判断 */
const DOMAIN_SENSITIVITY: Partial<Record<DataDomain, (risk: RiskLevel, action: ActionType) => RiskLevel>> = {
  // 审计数据：写/删一律提级到 critical（防篡改审计）；读保持
  'audit-data': (risk, action) => (action === 'read' ? risk : 'critical'),
  // 用户数据：外传已是 critical；删除提级到 critical（不可恢复）
  'user-data': (risk, action) => (action === 'delete' ? 'critical' : risk),
};

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/**
 * 分类风险等级（判定链第 3 环）。
 *
 * @param action 动作类型
 * @param domain 数据域
 * @returns 风险等级（只升不降——敏感域叠加修正）
 */
export function classifyRisk(action: ActionType, domain: DataDomain): RiskLevel {
  const base = ACTION_BASE_RISK[action];
  const adjust = DOMAIN_SENSITIVITY[domain];
  if (!adjust) return base;
  const adjusted = adjust(base, action);
  // 只升不降保障
  return RISK_ORDER.indexOf(adjusted) > RISK_ORDER.indexOf(base) ? adjusted : base;
}

/**
 * 风险等级 → 默认处置建议（policy-engine 消费）。
 * low/medium → 可自动；high → 人工批准；critical → 人工批准（+双人可选）。
 */
export function riskToDefaultAction(risk: RiskLevel): 'auto-allow' | 'human-approval' {
  return risk === 'high' || risk === 'critical' ? 'human-approval' : 'auto-allow';
}
