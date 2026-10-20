// calibration-claims-wiring.test.ts · v1.7.0 §三 · 校准判据纪律 orchestrator 接线单测
// 覆盖面：uncalibratedDecisionPathClaims 生产查询点（intent-triage 消费
// calibration-registry——「至少一个真实查询点」的验收断言面）。
import { describe, it, expect } from 'vitest';
import { uncalibratedDecisionPathClaims } from '../router/intent-triage';

describe('§三 校准判据纪律 · orchestrator 生产接线', () => {
  it('test_wiring_未校准决策路径清单非空且含三段门控阈值', () => {
    // 普查面如实暴露：决策路径上的未校准消费点被列出（不隐藏现状）
    const claims = uncalibratedDecisionPathClaims();
    expect(claims.length).toBeGreaterThan(0);
    // 三段门控阈值（ALLOW/ASK/l1MinConfidence）在列——重点消费点对账锚
    expect(claims).toContain('decision-channel/default-grade-thresholds/allow');
    expect(claims).toContain('decision-channel/default-grade-thresholds/ask');
    expect(claims).toContain('intent-triage/l1-min-confidence');
  });

  it('test_wiring_幂等_重复查询不重复登记', () => {
    const a = uncalibratedDecisionPathClaims();
    const b = uncalibratedDecisionPathClaims();
    expect(a).toEqual(b); // 进程内一次登记（legacyRegistered 守卫）
  });
});
