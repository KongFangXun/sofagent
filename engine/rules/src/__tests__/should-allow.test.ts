// ============================================================
// should-allow.test.ts · shouldAllow 便捷 API 单元测试（v1.3.0 交付 2）
// ============================================================

import { describe, it, expect } from 'vitest';
import { RulesEngine, defaultToolRules, shouldAllow } from '../index';
import type { ToolCallContext, InterceptVerdict, ToolRule } from '../types';

function makeCtx(args: Record<string, unknown> = {}, toolName = 'write_file'): ToolCallContext {
  return {
    toolName,
    args,
    agentName: 'engineer',
    taskDesc: 'test task',
    cwd: '/tmp',
  };
}

describe('shouldAllow', () => {
  const engine = new RulesEngine(defaultToolRules);

  it('正常 args → allow=true, requireApproval=false', () => {
    const result = shouldAllow(engine, makeCtx({ path: 'src/index.ts', content: 'hello' }));
    expect(result.allow).toBe(true);
    expect(result.requireApproval).toBe(false);
  });

  it('敏感文件（.env）→ allow=false（FAIL 拦截）', () => {
    const result = shouldAllow(engine, makeCtx({ path: '.env', content: 'x=1' }));
    expect(result.allow).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('任一规则 requireApproval=true → requireApproval=true', () => {
    const approvalRule: ToolRule = {
      name: 'tool-approval-demo',
      number: 99,
      ruleClass: '业务底线',
      check: () => ({
        status: 'PASS',
        ruleName: 'tool-approval-demo',
        ruleNumber: 99,
        details: ['需要人工确认'],
        suggestion: '等待批准',
        requireApproval: true,
      }),
    };
    const engineWithApproval = new RulesEngine([approvalRule]);
    const result = shouldAllow(engineWithApproval, makeCtx({}));
    // PASS 状态 + requireApproval=true（挂起批准，不硬拦）
    expect(result.allow).toBe(true);
    expect(result.requireApproval).toBe(true);
  });

  it('requireApproval=true 且 FAIL → allow=false 且 requireApproval=true', () => {
    const failApprovalRule: ToolRule = {
      name: 'tool-fail-approval',
      number: 98,
      ruleClass: '业务底线',
      check: () => ({
        status: 'FAIL',
        ruleName: 'tool-fail-approval',
        ruleNumber: 98,
        details: ['高危操作'],
        suggestion: '禁止执行',
        requireApproval: true,
      }),
    };
    const engineWithRule = new RulesEngine([failApprovalRule]);
    const result = shouldAllow(engineWithRule, makeCtx({}));
    expect(result.allow).toBe(false);
    expect(result.requireApproval).toBe(true);
  });

  it('reason 聚合多条 details（; 分隔）', () => {
    const multiRule: ToolRule = {
      name: 'tool-multi-detail',
      number: 97,
      ruleClass: '质量拐杖',
      check: () => ({
        status: 'WARN',
        ruleName: 'tool-multi-detail',
        ruleNumber: 97,
        details: ['detail1', 'detail2'],
        suggestion: 'fix',
      }),
    };
    const engineWithRule = new RulesEngine([multiRule]);
    const result = shouldAllow(engineWithRule, makeCtx({}));
    expect(result.allow).toBe(true);
    expect(result.reason).toContain('detail1');
    expect(result.reason).toContain('detail2');
  });
});
