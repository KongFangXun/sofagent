// ============================================================
// engine.test.ts · RulesEngine 单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { RulesEngine, defaultToolRules } from '../index';
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

describe('RulesEngine', () => {
  const engine = new RulesEngine(defaultToolRules);

  it('正常 args → 所有规则 PASS', () => {
    const verdicts = engine.check(makeCtx({ path: 'src/index.ts', content: 'hello world' }));
    const aggregated = engine.aggregate(verdicts);
    expect(aggregated.status).toBe('PASS');
  });

  it('aggregate: 全 PASS → PASS', () => {
    const verdicts: InterceptVerdict[] = [
      { status: 'PASS', ruleName: 'a', ruleNumber: 1, details: [], suggestion: '' },
      { status: 'PASS', ruleName: 'b', ruleNumber: 2, details: [], suggestion: '' },
    ];
    expect(engine.aggregate(verdicts).status).toBe('PASS');
  });

  it('aggregate: 有 WARN 无 FAIL → WARN', () => {
    const verdicts: InterceptVerdict[] = [
      { status: 'PASS', ruleName: 'a', ruleNumber: 1, details: [], suggestion: '' },
      { status: 'WARN', ruleName: 'b', ruleNumber: 2, details: ['warn'], suggestion: 'fix' },
    ];
    expect(engine.aggregate(verdicts).status).toBe('WARN');
  });

  it('aggregate: 有 FAIL → FAIL（即使也有 WARN）', () => {
    const verdicts: InterceptVerdict[] = [
      { status: 'WARN', ruleName: 'a', ruleNumber: 1, details: ['w'], suggestion: '' },
      { status: 'FAIL', ruleName: 'b', ruleNumber: 2, details: ['f'], suggestion: 'fix' },
    ];
    expect(engine.aggregate(verdicts).status).toBe('FAIL');
  });

  it('空规则集 → check 返回空数组，aggregate 返回 PASS', () => {
    const emptyEngine = new RulesEngine([]);
    const verdicts = emptyEngine.check(makeCtx());
    expect(verdicts).toHaveLength(0);
    expect(emptyEngine.aggregate(verdicts).status).toBe('PASS');
  });

  it('自定义规则集成', () => {
    const customRule: ToolRule = {
      name: 'test-custom',
      number: 99,
      ruleClass: '质量拐杖',
      check: (ctx) => ({
        status: ctx.toolName === 'dangerous_tool' ? 'FAIL' : 'PASS',
        ruleName: 'test-custom',
        ruleNumber: 99,
        details: [],
        suggestion: '',
      }),
    };
    const customEngine = new RulesEngine([customRule]);
    expect(customEngine.aggregate(customEngine.check(makeCtx({}, 'safe_tool'))).status).toBe('PASS');
    expect(customEngine.aggregate(customEngine.check(makeCtx({}, 'dangerous_tool'))).status).toBe('FAIL');
  });
});
