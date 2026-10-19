// ============================================================
// audit-criteria.test.ts · 判据数据的不变量测试
// v1.6.0 后补（2026-10-19）：把「判据条数 / 双向对账 / id 唯一」变成机械判据
//
// 为什么补：下游文档曾因**只 grep `...noulCriterion(` 助手调用**得出 35，
// 漏掉手写对象 A19-1，与 changelog 的 36 冲突。本条把口径固化为
// 「数组实有条目」，任何构造形态差异都不再影响判定。
// ============================================================

import { describe, it, expect } from 'vitest';
import { AUDIT_CRITERIA, AUDIT_CRITERIA_RECONCILIATION } from './rules/criteria/audit-criteria';

describe('判据数据不变量', () => {
  it('条数为 36（数组实有条目，不依赖任何构造形态）', () => {
    expect(AUDIT_CRITERIA.length).toBe(36);
  });

  it('id 全唯一', () => {
    const ids = AUDIT_CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('与 28 条规则双向对账：每条规则至少一条判据，且无判据指向规则表之外的 ruleId', () => {
    const ruleIds = new Set(AUDIT_CRITERIA_RECONCILIATION.ruleIds);
    const criteriaRules = new Set(AUDIT_CRITERIA.map((c) => c.ruleId));

    // 规则 → 判据（全覆盖）
    for (const r of ruleIds) {
      expect(criteriaRules.has(r), `规则 ${r} 无对应判据`).toBe(true);
    }
    // 判据 → 规则（无越界）
    for (const r of criteriaRules) {
      expect(ruleIds.has(r), `判据指向规则表之外的 ${r}`).toBe(true);
    }
    // 规则总数本身
    expect(AUDIT_CRITERIA_RECONCILIATION.totalRules).toBe(28);
    expect(ruleIds.size).toBe(28);
  });

  it('拆分规则与 changelog 描述一致：A15/A16/A17/A19/A22/E6 各 2 条、E5 拆 3 条', () => {
    const byRule = new Map<string, number>();
    for (const c of AUDIT_CRITERIA) {
      byRule.set(c.ruleId, (byRule.get(c.ruleId) ?? 0) + 1);
    }
    for (const r of ['A15', 'A16', 'A17', 'A19', 'A22', 'E6']) {
      expect(byRule.get(r), `${r} 应拆 2 条`).toBe(2);
    }
    expect(byRule.get('E5'), 'E5 应拆 3 条').toBe(3);
  });
});
