// ============================================================
// approval-mode.test.ts · 工具审批四模式测试（v1.3.1 交付 10）
//
// 覆盖：
//   - 四模式 × r/rw 全组合（shouldApprove 真值表）
//   - 保守默认拒绝语义（read-only 遇 rw / always-ask 返回 allow:false，
//     交由 middleware 人工确认；无回调即拒绝——铁律 #7）
//   - 审批继承（middleware 模块默认值机制——FORGE 层覆盖，此处验证
//     rules 包导出的类型与函数契约）
// ============================================================

import { describe, it, expect } from 'vitest';
import { shouldApprove } from '../approval-mode';
import type { ApprovalMode, ApprovalResult } from '../approval-mode';
import { RulesEngine, defaultToolRules } from '../index';

describe('交付 10：工具审批四模式 shouldApprove', () => {
  // ── 四模式 × r/rw 全组合真值表 ──

  it('allow-with-audit：r 放行', () => {
    const r = shouldApprove('allow-with-audit', 'r');
    expect(r.allow).toBe(true);
    expect(r.mode).toBe('allow-with-audit');
    expect(r.reason).toContain('审计');
  });

  it('allow-with-audit：rw 放行（默认模式 = v1.3.0 行为）', () => {
    const r = shouldApprove('allow-with-audit', 'rw');
    expect(r.allow).toBe(true);
    expect(r.mode).toBe('allow-with-audit');
  });

  it('deny-all：r 拦截', () => {
    const r = shouldApprove('deny-all', 'r');
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('deny-all');
  });

  it('deny-all：rw 拦截', () => {
    const r = shouldApprove('deny-all', 'rw');
    expect(r.allow).toBe(false);
    expect(r.mode).toBe('deny-all');
  });

  it('read-only：r 放行（只读自动放行）', () => {
    const r = shouldApprove('read-only', 'r');
    expect(r.allow).toBe(true);
    expect(r.reason).toContain('只读');
  });

  it('read-only：rw 拦截（读写需人工确认——Benchmark 评测安全底座）', () => {
    const r = shouldApprove('read-only', 'rw');
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('人工确认');
  });

  it('always-ask：r 待人工确认', () => {
    const r = shouldApprove('always-ask', 'r');
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('人工确认');
  });

  it('always-ask：rw 待人工确认', () => {
    const r = shouldApprove('always-ask', 'rw');
    expect(r.allow).toBe(false);
    expect(r.mode).toBe('always-ask');
  });

  // ── 返回结构契约 ──

  it('ApprovalResult 结构完整（allow/reason/mode 三字段）', () => {
    const modes: ApprovalMode[] = ['allow-with-audit', 'deny-all', 'read-only', 'always-ask'];
    for (const mode of modes) {
      for (const permission of ['r', 'rw'] as const) {
        const r: ApprovalResult = shouldApprove(mode, permission);
        expect(typeof r.allow).toBe('boolean');
        expect(typeof r.reason).toBe('string');
        expect(r.reason.length).toBeGreaterThan(0);
        expect(r.mode).toBe(mode);
      }
    }
  });

  // ── 保守默认拒绝语义 ──

  it('保守默认拒绝：所有非 allow-with-audit 模式都至少存在拦截面', () => {
    // deny-all 拦一切；read-only 拦 rw；always-ask 拦一切——
    // 需人工确认/拦截的场景若无人工回调，middleware 层拒绝一切（铁律 #7）。
    expect(shouldApprove('deny-all', 'r').allow).toBe(false);
    expect(shouldApprove('deny-all', 'rw').allow).toBe(false);
    expect(shouldApprove('read-only', 'rw').allow).toBe(false);
    expect(shouldApprove('always-ask', 'r').allow).toBe(false);
    expect(shouldApprove('always-ask', 'rw').allow).toBe(false);
  });

  // ── 类型导出契约（审批继承消费方依赖） ──

  it('rules 包导出 shouldApprove + ApprovalMode 类型供 middleware 消费', () => {
    // 通过 barrel 入口也能拿到（FORGE audit-middleware 经 dist 消费同一入口）
    expect(typeof shouldApprove).toBe('function');
    // 规则引擎与审批模式互不干扰：规则判定 PASS 后仍需过审批模式分支
    const engine = new RulesEngine(defaultToolRules);
    const verdicts = engine.check({
      toolName: 'sf_read',
      args: { path: 'README.md' },
      agentName: 'test',
      taskDesc: '',
      cwd: process.cwd(),
    });
    const agg = engine.aggregate(verdicts);
    expect(agg.status).toBe('PASS');
    // 规则 PASS ≠ 审批放行——read-only 模式下 rw 工具仍需拦截
    expect(shouldApprove('read-only', 'rw').allow).toBe(false);
  });
});
