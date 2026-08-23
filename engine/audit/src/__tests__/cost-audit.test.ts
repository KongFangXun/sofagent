// ============================================================
// cost-audit.test.ts · 成本审计维度单测（v1.4.0 交付三）
// ============================================================
// 覆盖：
//   1. 超支判定（token / cost 两维度）
//   2. 无预算不审（opt-in）
//   3. WARN 不改 exitCode（severity 恒 WARN）
//   4. worklog 文件缺失降级（loadWorklogSlice → null）
// ============================================================

import { describe, it, expect } from 'vitest';
import { runCostAudit, loadWorklogSlice, type WorklogSlice, type CostBudget } from '../cost-audit';

const worklog: WorklogSlice = {
  agents: [
    {
      agentId: 'agent-a',
      totals: { tokens: { input: 1000, output: 500 }, costUsd: 0.12, tasks: 3, llmCalls: 5 },
    },
    {
      agentId: 'agent-b',
      totals: { tokens: { input: 90000, output: 20000 }, costUsd: 3.5, tasks: 10, llmCalls: 40 },
    },
  ],
};

describe('runCostAudit · 成本超支判定', () => {
  it('case1: 配 maxTokensPerRun 且超限 → 产出 tokens 维度 WARN 发现', () => {
    const budget: CostBudget = { maxTokensPerRun: 50000 };
    const findings = runCostAudit({ worklog, budget });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('COST-OVERRUN');
    expect(findings[0].severity).toBe('WARN');
    expect(findings[0].dimension).toBe('tokens');
    expect(findings[0].target).toBe('agent-b');
    expect(findings[0].actual).toBe(110000);
    expect(findings[0].limit).toBe(50000);
  });

  it('case2: 配 maxCostPerDay 且超限 → 产出 cost 维度 WARN 发现', () => {
    const budget: CostBudget = { maxCostPerDay: 1.0 };
    const findings = runCostAudit({ worklog, budget });
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('cost');
    expect(findings[0].target).toBe('agent-b');
  });

  it('case3: 无预算 → 空发现（opt-in，不配 budget 不审计成本）', () => {
    expect(runCostAudit({ worklog, budget: undefined })).toHaveLength(0);
    expect(runCostAudit({ worklog, budget: null })).toHaveLength(0);
  });

  it('case4: 全部未超限 → 空发现', () => {
    const budget: CostBudget = { maxTokensPerRun: 999999, maxCostPerDay: 999 };
    expect(runCostAudit({ worklog, budget })).toHaveLength(0);
  });

  it('case5: 无 worklog 数据 → 空发现（不抛）', () => {
    expect(runCostAudit({ worklog: null, budget: { maxTokensPerRun: 100 } })).toHaveLength(0);
    expect(runCostAudit({ worklog: undefined, budget: { maxTokensPerRun: 100 } })).toHaveLength(0);
  });

  it('case6: 双维度都超 → 两个发现', () => {
    const budget: CostBudget = { maxTokensPerRun: 50000, maxCostPerDay: 1.0 };
    const findings = runCostAudit({ worklog, budget });
    // agent-b 两维度都超 → 2 条；agent-a 都不超
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.target === 'agent-b')).toBe(true);
  });

  it('case7: worklog 文件缺失 → loadWorklogSlice 返回 null（不抛）', () => {
    expect(loadWorklogSlice('/nonexistent-dir')).toBeNull();
  });
});
