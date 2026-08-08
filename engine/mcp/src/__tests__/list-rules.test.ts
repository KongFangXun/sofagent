// ============================================================
// list-rules.test.ts · list_rules MCP tool 测试（v1.3.0 交付 4）
// ============================================================

import { describe, it, expect } from 'vitest';
import { listRules, type RuleListEntry } from '../tools/list-rules';

describe('list_rules tool（v1.3.0 交付 4）', () => {
  it('type 缺省 = all：合并列出 tool + diff 规则', () => {
    const result = listRules();
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('data');
    const rules = (result.data as { rules: RuleListEntry[] }).rules;
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(3);
    // 同时包含 tool 与 diff
    expect(rules.some((r) => r.ruleType === 'tool')).toBe(true);
    expect(rules.some((r) => r.ruleType === 'diff')).toBe(true);
  });

  it('type=tool：只返回运行时 tool-gate 规则（3 条）', () => {
    const result = listRules({ type: 'tool' });
    const rules = (result.data as { rules: RuleListEntry[] }).rules;
    expect(rules.every((r) => r.ruleType === 'tool')).toBe(true);
    expect(rules.length).toBe(3);
    const names = rules.map((r) => r.name);
    expect(names).toContain('tool-sensitive-file');
    expect(names).toContain('tool-secret-leak');
    expect(names).toContain('tool-injection');
  });

  it('type=diff：返回 git-diff 规则（默认启用 + 扩展关闭）', () => {
    const result = listRules({ type: 'diff' });
    const rules = (result.data as { rules: RuleListEntry[] }).rules;
    expect(rules.every((r) => r.ruleType === 'diff')).toBe(true);
    expect(rules.length).toBeGreaterThan(20);
    // 默认规则 enabled=true，扩展规则 enabled=false
    expect(rules.some((r) => r.enabled)).toBe(true);
    expect(rules.some((r) => !r.enabled)).toBe(true);
    // A1/A2 在列
    const names = rules.map((r) => r.name);
    expect(names.some((n) => n.startsWith('A1'))).toBe(true);
    expect(names.some((n) => n.startsWith('A2'))).toBe(true);
  });

  it('规则条目包含 name/number/ruleClass/ruleType/enabled，不暴露 check 实现', () => {
    const result = listRules({ type: 'all' });
    const rules = (result.data as { rules: RuleListEntry[] }).rules;
    for (const r of rules) {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('number');
      expect(r).toHaveProperty('ruleClass');
      expect(r).toHaveProperty('ruleType');
      expect(r).toHaveProperty('enabled');
      // 不暴露实现逻辑（无 check 函数字段）
      expect('check' in r).toBe(false);
    }
  });

  it('text 描述规则总数', () => {
    const result = listRules({ type: 'tool' });
    expect(result.text).toMatch(/共 \d+ 条规则/);
  });
});
