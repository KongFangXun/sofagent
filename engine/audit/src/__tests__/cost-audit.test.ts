// ============================================================
// cost-audit.test.ts · 成本审计维度单测（v1.4.0 交付三）
// ============================================================
// 覆盖：
//   1. 超支判定（token / cost 两维度）
//   2. 无预算不审（opt-in）
//   3. WARN 不改 exitCode（severity 恒 WARN）
//   4. worklog 文件缺失降级（loadWorklogSlice → null）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCostAudit, loadWorklogSlice, type WorklogSlice, type CostBudget } from '../cost-audit';
import { emitDecision } from '../decision-log';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 测试用 HMAC 密钥内容——64 位 hex（Shannon 熵 ≈4.0 bit/char，不含弱模式词）。
// 写面用例断言 hmacSig 在场，而签名依赖 HMAC 密钥（经 SOFAGENT_KEY_PATH 解析）；
// 不就地隔离则结果随开发机是否有 ~/.sofagent-key 漂移（无密钥机器上 hmacSig 缺省）。
const HMAC_TEST_KEY = 'c81f4a6e29b7d3508e6c1a4f7b2d9e58a3c6f1902b8e4d7a5f1c3e9b6d802a4f';

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

describe('COST 写面接线（v1.5.3 收口：读面在、写面永空 → quota 闸恒空过）', () => {
  let keyDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    // 密钥隔离（与同目录 mandate/egress-audit 测试同款惯例）——不碰真实 ~/.sofagent-key
    keyDir = mkdtempSync(join(tmpdir(), 'cost-write-key-'));
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    writeFileSync(join(keyDir, 'hmac-key'), HMAC_TEST_KEY, { mode: 0o600 });
    process.env.SOFAGENT_KEY_PATH = join(keyDir, 'hmac-key');
  });

  afterEach(() => {
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    try { rmSync(keyDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('写面：emitDecision 接受 kind=COST 且落盘带 HMAC（should-run quota 五问的消费前提）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cost-write-'));
    try {
      const entry = emitDecision({
        agentId: 'agent-cost-write-test',
        sessionId: 'cost-audit-tokens',
        kind: 'COST',
        moment: 'ACT',
        category: 'escalate',
        why: { text: 'Agent agent-cost-write-test token 用量 200000 超预算 100000', tags: ['cost', 'tokens', 'overrun'] },
        evidence: ['dimension=tokens', 'limit=100000', 'actual=200000', 'rule=COST-OVERRUN'],
      }, tmp);
      expect(entry.kind).toBe('COST');
      expect(entry.hmacSig).toBeTruthy();
      // 落盘可查（queryByKind('COST') 消费面能读到）
      const lines = readFileSync(join(tmp, 'audit', 'decision-log.jsonl'), 'utf-8').trim().split('\n');
      const kinds = lines.map((l) => JSON.parse(l).kind);
      expect(kinds).toContain('COST');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
