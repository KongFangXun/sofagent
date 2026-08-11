// ============================================================
// loop-agent-l2-l5.test.ts · Onboard L2-L5 全链路测试（v1.3.2 交付 1-4）
// ============================================================
//
// 覆盖：
//   交付 1 L2：diff-report 格式 + output-extractor + ontology-comparator
//   交付 2 L3：error-localizer（LLM 推理 + 启发式降级）
//   交付 3 L4：fix-applier（FixProposal + 审计卡关 + 回滚）
//   交付 4 L5：driver 收敛/发散判定
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  emptyDiffReport,
  isDiffPass,
  hasErrorMismatch,
  summarizeDiff,
  type DiffReport,
} from '../loop-agent/diff-report';
import { extractStructuredOutput } from '../loop-agent/output-extractor';
import {
  compareWithOntology,
  compareWithOntologySync,
  type OntologyExpectedOutput,
} from '../loop-agent/ontology-comparator';
import { localizeError, type LocalizationContext } from '../loop-agent/error-localizer';
import { applyFix, type FixProposal } from '../loop-agent/fix-applier';
import { runOnboardLoop, DEFAULT_L5_CONFIG } from '../loop-agent/driver';

// ════════════════════════════════════════
// 交付 1：L2 差异报告格式
// ════════════════════════════════════════

describe('交付 1 L2：DiffReport 格式', () => {
  it('emptyDiffReport 生成无差异报告', () => {
    const report = emptyDiffReport('task-001', 'refund-entity');
    expect(report.taskId).toBe('task-001');
    expect(report.expectedSource).toBe('refund-entity');
    expect(report.mismatches).toHaveLength(0);
    expect(isDiffPass(report)).toBe(true);
    expect(hasErrorMismatch(report)).toBe(false);
  });

  it('三类 mismatch 格式正确（field_missing / value_error / relation_broken）', () => {
    const report: DiffReport = {
      taskId: 'task-001',
      timestamp: new Date().toISOString(),
      expectedSource: 'refund-entity',
      mismatches: [
        { type: 'value_error', field: 'order_status', expected: 'refunded', actual: 'complained', severity: 'error' },
        { type: 'field_missing', field: 'refund_amount', expected: 'number', severity: 'error' },
        { type: 'relation_broken', fromEntity: 'order', relation: 'has_many', toEntity: 'refund', severity: 'error' },
      ],
    };
    expect(report.mismatches).toHaveLength(3);
    expect(hasErrorMismatch(report)).toBe(true);
    expect(isDiffPass(report)).toBe(false);
  });

  it('summarizeDiff 摘要输出正确', () => {
    const empty = emptyDiffReport('t1', 'src');
    expect(summarizeDiff(empty)).toContain('无差异');

    const withErrors: DiffReport = {
      taskId: 't1',
      timestamp: new Date().toISOString(),
      expectedSource: 'src',
      mismatches: [
        { type: 'value_error', field: 'f', expected: 'a', actual: 'b', severity: 'error' },
        { type: 'field_missing', field: 'g', expected: 'string', severity: 'warn' },
      ],
    };
    const summary = summarizeDiff(withErrors);
    expect(summary).toContain('2 条差异');
    expect(summary).toContain('1 error');
    expect(summary).toContain('1 warn');
  });
});

// ════════════════════════════════════════
// 交付 1：L2 输出提取器
// ════════════════════════════════════════

describe('交付 1 L2：OutputExtractor', () => {
  it('JSON 直接解析', async () => {
    const output = '{"order_status": "refunded", "amount": 100}';
    const result = await extractStructuredOutput(output, ['order_status', 'amount']);
    expect(result.method).toBe('json-parse');
    expect(result.fields.order_status).toBe('refunded');
    expect(result.fields.amount).toBe(100);
  });

  it('markdown code block 中的 JSON 提取', async () => {
    const output = '结果如下：\n```json\n{"status": "ok"}\n```\n完成';
    const result = await extractStructuredOutput(output, ['status']);
    expect(result.method).toBe('json-parse');
    expect(result.fields.status).toBe('ok');
  });

  it('启发式提取（无 JSON 格式）', async () => {
    const output = '订单状态: refunded\n金额: 100';
    const result = await extractStructuredOutput(output, ['订单状态', '金额']);
    expect(result.method).toBe('heuristic');
    expect(result.fields['订单状态']).toBe('refunded');
  });

  it('空输出返回空字段', async () => {
    const result = await extractStructuredOutput('', ['field']);
    expect(result.method).toBe('empty');
    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it('LLM 辅助提取', async () => {
    const mockLlm = async () => '{"order_status": "refunded"}';
    const result = await extractStructuredOutput(
      '退款已处理',
      ['order_status'],
      { callLlm: mockLlm },
    );
    expect(result.method).toBe('llm-assist');
    expect(result.fields.order_status).toBe('refunded');
  });
});

// ════════════════════════════════════════
// 交付 1：L2 Ontology 对比器
// ════════════════════════════════════════

describe('交付 1 L2：OntologyComparator', () => {
  const expected: OntologyExpectedOutput = {
    source: 'refund-entity',
    fields: {
      order_status: { value: 'refunded', severity: 'error' },
      refund_amount: { type: 'number', severity: 'error' },
      reason: { required: false, severity: 'warn' },
    },
  };

  it('实际输出匹配预期 → 无差异', async () => {
    const output = '{"order_status": "refunded", "refund_amount": 100}';
    const report = await compareWithOntology(output, expected, { taskId: 't1' });
    expect(report.mismatches).toHaveLength(0);
    expect(isDiffPass(report)).toBe(true);
  });

  it('value_error：值不对', async () => {
    const output = '{"order_status": "complained", "refund_amount": 100}';
    const report = await compareWithOntology(output, expected, { taskId: 't1' });
    const valueError = report.mismatches.find((m) => m.type === 'value_error');
    expect(valueError).toBeDefined();
    expect(valueError!.field).toBe('order_status');
    expect(valueError!.expected).toBe('refunded');
    expect((valueError as Extract<typeof valueError, 'actual'>).actual).toBe('complained');
  });

  it('field_missing：必需字段缺失', async () => {
    const output = '{"order_status": "refunded"}';
    const report = await compareWithOntology(output, expected, { taskId: 't1' });
    const missing = report.mismatches.find((m) => m.type === 'field_missing');
    expect(missing).toBeDefined();
    expect(missing!.field).toBe('refund_amount');
  });

  it('可选字段缺失不报差异', async () => {
    const output = '{"order_status": "refunded", "refund_amount": 100}';
    const report = await compareWithOntology(output, expected, { taskId: 't1' });
    expect(report.mismatches).toHaveLength(0);
  });

  it('relation_broken：实体关系断裂', async () => {
    const expectedWithRelation: OntologyExpectedOutput = {
      source: 'order-entity',
      fields: { order_id: { type: 'string' } },
      relations: [
        { fromEntity: 'order', relation: 'has_many', toEntity: 'refund' },
      ],
    };
    const output = '{"order_id": "ORD001"}';
    const report = await compareWithOntology(output, expectedWithRelation, { taskId: 't1' });
    const broken = report.mismatches.find((m) => m.type === 'relation_broken');
    expect(broken).toBeDefined();
  });

  it('同步版对比（compareWithOntologySync）', () => {
    const output = '{"order_status": "refunded", "refund_amount": 100}';
    const report = compareWithOntologySync(output, expected, 't1');
    expect(report.mismatches).toHaveLength(0);
  });
});

// ════════════════════════════════════════
// 交付 2：L3 自动定位器
// ════════════════════════════════════════

describe('交付 2 L3：ErrorLocalizer', () => {
  const context: LocalizationContext = {
    skillText: 'Skill: refund handler',
    ontologyText: 'Entity: refund',
    promptText: 'Handle refunds',
    knowledgeText: 'Knowledge: refund flow',
  };

  it('无差异时返回零置信度定位', async () => {
    const emptyReport = emptyDiffReport('t1', 'src');
    const result = await localizeError(emptyReport, context);
    expect(result.confidence).toBe(0);
    expect(result.evidence.diffCount).toBe(0);
  });

  it('LLM 推理定位', async () => {
    const diffReport: DiffReport = {
      taskId: 't1',
      timestamp: new Date().toISOString(),
      expectedSource: 'refund-entity',
      mismatches: [
        { type: 'value_error', field: 'order_status', expected: 'refunded', actual: 'complained', severity: 'error' },
      ],
    };
    const mockLlm = async () => JSON.stringify({
      errorSource: 'prompt',
      confidence: 0.85,
      reasoning: 'prompt 未区分退货和投诉',
    });
    const result = await localizeError(diffReport, context, { callLlm: mockLlm });
    expect(result.errorSource).toBe('prompt');
    expect(result.confidence).toBe(0.85);
  });

  it('启发式降级（field_missing 为主 → ontology）', async () => {
    const diffReport: DiffReport = {
      taskId: 't1',
      timestamp: new Date().toISOString(),
      expectedSource: 'src',
      mismatches: [
        { type: 'field_missing', field: 'f1', expected: 'string', severity: 'error' },
        { type: 'field_missing', field: 'f2', expected: 'number', severity: 'error' },
        { type: 'value_error', field: 'f3', expected: 'a', actual: 'b', severity: 'error' },
      ],
    };
    const result = await localizeError(diffReport, context);
    expect(result.errorSource).toBe('ontology');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('启发式降级（value_error 为主 → prompt）', async () => {
    const diffReport: DiffReport = {
      taskId: 't1',
      timestamp: new Date().toISOString(),
      expectedSource: 'src',
      mismatches: [
        { type: 'value_error', field: 'f1', expected: 'a', actual: 'b', severity: 'error' },
        { type: 'value_error', field: 'f2', expected: 'c', actual: 'd', severity: 'error' },
      ],
    };
    const result = await localizeError(diffReport, context);
    expect(result.errorSource).toBe('prompt');
  });

  it('启发式降级（relation_broken → knowledge）', async () => {
    const diffReport: DiffReport = {
      taskId: 't1',
      timestamp: new Date().toISOString(),
      expectedSource: 'src',
      mismatches: [
        { type: 'relation_broken', fromEntity: 'a', relation: 'has_many', toEntity: 'b', severity: 'error' },
      ],
    };
    const result = await localizeError(diffReport, context);
    expect(result.errorSource).toBe('knowledge');
  });

  it('LLM 调用失败 → 降级启发式（不致命）', async () => {
    const diffReport: DiffReport = {
      taskId: 't1',
      timestamp: new Date().toISOString(),
      expectedSource: 'src',
      mismatches: [
        { type: 'value_error', field: 'f1', expected: 'a', actual: 'b', severity: 'error' },
      ],
    };
    const failingLlm = async () => { throw new Error('LLM 不可用'); };
    const result = await localizeError(diffReport, context, { callLlm: failingLlm });
    expect(result.reasoning).toContain('降级启发式');
    expect(result.confidence).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════
// 交付 3：L4 自动修复器
// ════════════════════════════════════════

describe('交付 3 L4：FixApplier', () => {
  const mockLocalization = {
    errorSource: 'prompt' as const,
    confidence: 0.8,
    reasoning: 'prompt 未区分退货和投诉',
    evidence: { diffCount: 1, contextSummary: 'prompt' },
  };
  const mockDiffReport: DiffReport = {
    taskId: 't1',
    timestamp: new Date().toISOString(),
    expectedSource: 'src',
    mismatches: [
      { type: 'value_error', field: 'order_status', expected: 'refunded', actual: 'complained', severity: 'error' },
    ],
  };

  it('FixProposal 启发式生成（LLM 不可用）', async () => {
    const result = await applyFix(mockLocalization, mockDiffReport, undefined,
      { runAudit: async () => ({ passed: true, violations: [] }) },
      {
        applyChange: async () => {},
        rollback: async () => {},
      },
    );
    expect(result.proposal.errorSource).toBe('prompt');
    expect(result.proposal.fixType).toBe('prompt_patch');
    expect(result.proposal.changes.length).toBeGreaterThan(0);
  });

  it('LLM 生成 FixProposal', async () => {
    const mockLlm = async () => JSON.stringify({
      fixType: 'prompt_patch',
      changes: [{ target: 'think.md', operation: 'append', content: '区分退货和投诉' }],
    });
    const result = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: mockLlm },
      { runAudit: async () => ({ passed: true, violations: [] }) },
      {
        applyChange: async () => {},
        rollback: async () => {},
      },
    );
    expect(result.proposal.fixType).toBe('prompt_patch');
    expect(result.applied).toBe(true);
    expect(result.proposal.auditResult?.passed).toBe(true);
  });

  it('审计 FAIL → 回滚', async () => {
    const mockLlm = async () => JSON.stringify({
      fixType: 'skill_update',
      changes: [{ target: 'SKILL.md', operation: 'append', content: 'bad change' }],
    });
    const rollbackCalled: string[] = [];
    const result = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: mockLlm },
      { runAudit: async () => ({ passed: false, violations: ['A2 密钥泄漏'] }) },
      {
        applyChange: async () => {},
        rollback: async (files) => { rollbackCalled.push(...files); },
      },
    );
    expect(result.applied).toBe(false);
    expect(result.violations).toContain('A2 密钥泄漏');
    expect(result.rollbackInfo).toBeDefined();
    expect(rollbackCalled.length).toBeGreaterThan(0);
  });

  it('FixProposal 格式含 errorSource/confidence/fixType/changes/auditResult', async () => {
    const mockLlm = async () => JSON.stringify({
      fixType: 'knowledge_add',
      changes: [{ target: 'knowledge/refund.md', operation: 'append', content: '退款流程文档' }],
    });
    const result = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: mockLlm },
      { runAudit: async () => ({ passed: true, violations: [] }) },
      {
        applyChange: async () => {},
        rollback: async () => {},
      },
    );
    const proposal = result.proposal;
    expect(proposal).toHaveProperty('errorSource');
    expect(proposal).toHaveProperty('confidence');
    expect(proposal).toHaveProperty('fixType');
    expect(proposal).toHaveProperty('changes');
    expect(proposal).toHaveProperty('auditResult');
  });
});

// ════════════════════════════════════════
// 交付 4：L5 循环收敛
// ════════════════════════════════════════

describe('交付 4 L5：driver 收敛/发散判定', () => {
  it('DEFAULT_L5_CONFIG 收敛阈值默认 3', () => {
    expect(DEFAULT_L5_CONFIG.convergeThreshold).toBe(3);
    expect(DEFAULT_L5_CONFIG.divergeThreshold).toBe(5);
  });

  it('连续 3 轮 L1 crash-free 且 L2 无差异 → 判收敛', async () => {
    const passingRunner = async () => ({
      exitCode: 0,
      stdout: 'ok',
      output: '{"status": "ok"}',
      durationMs: 100,
    });
    const passingJudge = (_o: unknown, _opt: unknown) => ({ state: 'passed' as const, detail: 'ok', durationMs: 100 });
    const passingL2 = async () => emptyDiffReport('t1', 'src');

    const result = await runOnboardLoop('test task', {
      maxRounds: 5,
      runner: passingRunner,
      judge: passingJudge,
      fixer: async () => 'fixed',
      l2Judge: passingL2,
      l5Config: { convergeThreshold: 3, divergeThreshold: 5 },
      log: () => {},
    });
    expect(result.convergence).toBe('converged');
    expect(result.rounds.length).toBe(3);
  });

  it('连续 5 轮 L4 改了仍 FAIL → 判发散', async () => {
    const failingRunner = async () => ({
      exitCode: 0,
      stdout: '{"status": "wrong"}',
      output: '{"status": "wrong"}',
      durationMs: 100,
    });
    const passingL1Judge = (_o: unknown, _opt: unknown) => ({ state: 'passed' as const, detail: 'ok', durationMs: 100 });
    const failingL2 = async (): Promise<DiffReport> => ({
      taskId: 't1',
      timestamp: new Date().toISOString(),
      expectedSource: 'src',
      mismatches: [
        { type: 'value_error', field: 'status', expected: 'ok', actual: 'wrong', severity: 'error' },
      ],
    });
    const mockL3 = async () => ({
      errorSource: 'prompt' as const,
      confidence: 0.8,
      reasoning: 'test',
      evidence: { diffCount: 1, contextSummary: 'test' },
    });
    const mockL4 = async () => ({
      proposal: {
        errorSource: 'prompt' as const,
        confidence: 0.8,
        fixType: 'prompt_patch' as const,
        changes: [{ target: 'think.md', operation: 'append' as const, content: 'fix' }],
      },
      applied: true,
      violations: [],
    });

    const result = await runOnboardLoop('test task', {
      maxRounds: 10,
      runner: failingRunner,
      judge: passingL1Judge,
      fixer: async () => 'fixed',
      l2Judge: failingL2,
      l3Localizer: mockL3,
      l4Fixer: mockL4,
      l5Config: { convergeThreshold: 3, divergeThreshold: 5 },
      log: () => {},
    });
    expect(result.convergence).toBe('diverged');
  });
});
