// ============================================================
// print-results.test.ts · printResults 在 ci||silent 下 stdout 一行结论
// v1.1.5 新增（审计结果 session 可见性）
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printResults } from '../index';
import type { AuditResult, RuleCheck } from '../reporter';

function makeResults(rules: RuleCheck[]): AuditResult {
  const failCount = rules.filter((r) => r.status === 'FAIL').length;
  const warnCount = rules.filter((r) => r.status === 'WARN').length;
  const exitCode = failCount > 0 ? 2 : warnCount > 0 ? 1 : 0;
  return { rules, exitCode };
}

const passRules: RuleCheck[] = [
  { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [], ruleClass: '业务底线' },
  { name: 'A2 不泄密钥', number: 2, status: 'PASS', details: [], ruleClass: '业务底线' },
];

const warnRules: RuleCheck[] = [
  { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [], ruleClass: '业务底线' },
  { name: 'A7 不存盲改', number: 7, status: 'WARN', details: ['未找到修改文件的 Read 日志'], ruleClass: '能力拐杖' },
];

const failRules: RuleCheck[] = [
  { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [], ruleClass: '业务底线' },
  { name: 'A2 不泄密钥', number: 2, status: 'FAIL', details: ['发现硬编码密钥'], ruleClass: '业务底线' },
];

describe('printResults · ci||silent 模式 stdout 结论行（P0 可见性）', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it('case1: PASS + ci + silent → stdout 含 ✅ [sofagent] 审计通过', () => {
    printResults(makeResults(passRules), [], false, true, true);
    const out = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('✅ [sofagent] 审计通过');
    expect(out).toContain('exit 0');
    // N 项检查 == 规则数
    expect(out).toContain(`· ${passRules.length} 项检查`);
  });

  it('case2: WARN + ci → stdout 含 ⚠️ [sofagent] 审计 且保留原有详情行', () => {
    printResults(makeResults(warnRules), [], false, true, true);
    const out = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('⚠️ [sofagent] 审计');
    // 原有 WARN 详情打印必须保留（不破坏现有行为）
    expect(out).toContain('未找到修改文件的 Read 日志');
    expect(out).toContain('exit 1');
  });

  it('case3: FAIL + ci → stdout 含 ❌ [sofagent] 审计拦截 且保留原有详情行', () => {
    printResults(makeResults(failRules), [], false, true, true);
    const out = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('❌ [sofagent] 审计拦截');
    // 原有 FAIL 详情打印必须保留
    expect(out).toContain('发现硬编码密钥');
    expect(out).toContain('exit 2');
  });

  it('case4: 非 ci 模式 PASS → 走原可视化 banner，不回归', () => {
    printResults(makeResults(passRules), [], false, false, false);
    const out = spy.mock.calls.map((c) => String(c[0])).join('\n');
    // 非 ci 模式不应出现 ci 专属结论行格式
    expect(out).not.toContain('[sofagent] 审计通过 ·');
    // 但应有可视化 banner（sofagent-audit）
    expect(out).toContain('sofagent-audit');
  });
});
