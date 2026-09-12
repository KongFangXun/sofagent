// ============================================================
// rule-metadata-snapshot.test.ts · 注册表元数据快照（v1.4.8 深模块条目 7 第 0 步）
// ============================================================
// 24 条规则 name/number/evidenceMode/ruleClass/priority/examples 全量快照——
// makeRule 模板化重构（批二+）前的行为锚：重构后本测试零改动必须仍绿。
// ============================================================
import { describe, expect, it } from 'vitest';
import { defaultRules, extendedRules } from '../rules';
import { ruleCode } from '../rules/assemble';

describe('条目 7 · 规则注册表元数据快照（第 0 步——重构行为锚）', () => {
  it('defaultRules 17 条（双计数锚之一）', () => {
    expect(defaultRules).toHaveLength(17);
  });
  it('defaultRules + extendedRules = 24 条（双计数锚之二）', () => {
    expect(defaultRules.length + extendedRules.length).toBe(24);
  });
  it('规则编号集合快照（A 系/E 系全量——编号推导重构的对照锚）', () => {
    const names = [...defaultRules, ...extendedRules].map((r) => r.name);
    // 精确集合断言（A 系 20 + E 系 4；成员增删须显式改本快照）
    expect(names.filter((n) => n.startsWith('A')).length).toBe(21);
    expect(names.filter((n) => n.startsWith('E')).length).toBe(3);
    // name 唯一（注册表不变式）
    expect(new Set(names).size).toBe(24);
  });
  it('evidenceMode 分布快照（19 git-diff + 4 hybrid + 1 filesystem）', () => {
    const all = [...defaultRules, ...extendedRules];
    const count = (m: string) => all.filter((r) => (r as { evidenceMode?: string }).evidenceMode === m).length;
    expect(count('git-diff')).toBe(19);
    expect(count('hybrid')).toBe(4);
    expect(count('filesystem')).toBe(1);
  });
  it('Rule.id 与 ruleCode(number, name) 全量一致（条目 7 批一：编号单源不变式）', () => {
    const all = [...defaultRules, ...extendedRules];
    for (const r of all) {
      expect(ruleCode(r.number, r.name), `${r.name} 的 id 漂移`).toBe(r.id);
    }
    expect(new Set(all.map((r) => r.id)).size).toBe(24);
  });
});
