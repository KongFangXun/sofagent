// ============================================================
// rule-metadata-snapshot.test.ts · 注册表元数据快照（v1.4.8 深模块条目 7 第 0 步）
// ============================================================
// 25 条规则 name/number/evidenceMode/ruleClass/priority/examples 全量快照——
// 条目 7（meta 单源 + scan 装配）重构前后的行为锚：重构后本测试零改动必须仍绿。
// ============================================================
import { describe, expect, it } from 'vitest';
import { defaultRules, extendedRules } from '../rules';
import { ruleCode } from '../rules/assemble';

describe('条目 7 · 规则注册表元数据快照（第 0 步——重构行为锚）', () => {
  it('defaultRules 17 条（双计数锚之一）', () => {
    expect(defaultRules).toHaveLength(17);
  });
  it('defaultRules + extendedRules = 25 条（双计数锚之二）', () => {
    expect(defaultRules.length + extendedRules.length).toBe(25);
  });
  it('规则编号集合快照（A 系/E 系全量——编号推导重构的对照锚）', () => {
    const names = [...defaultRules, ...extendedRules].map((r) => r.name);
    // 精确集合断言（A 系 22 + E 系 3；成员增删须显式改本快照）
    expect(names.filter((n) => n.startsWith('A')).length).toBe(22);
    expect(names.filter((n) => n.startsWith('E')).length).toBe(3);
    // name 唯一（注册表不变式）
    expect(new Set(names).size).toBe(25);
  });
  it('evidenceMode 分布快照（20 git-diff + 4 hybrid + 1 filesystem）', () => {
    const all = [...defaultRules, ...extendedRules];
    const count = (m: string) => all.filter((r) => (r as { evidenceMode?: string }).evidenceMode === m).length;
    expect(count('git-diff')).toBe(20);
    expect(count('hybrid')).toBe(4);
    expect(count('filesystem')).toBe(1);
  });
  it('Rule.id 与 ruleCode(number, name) 全量一致（条目 7 批一：编号单源不变式）', () => {
    const all = [...defaultRules, ...extendedRules];
    for (const r of all) {
      expect(ruleCode(r.number, r.name), `${r.name} 的 id 漂移`).toBe(r.id);
    }
    expect(new Set(all.map((r) => r.id)).size).toBe(25);
  });
  // v1.4.8 条目 7 批三：原散落在各 rule-*.test.ts 的 evidenceMode / ruleClass 断言收口至此
  // （元数据断言的唯一集中地）——注册表 meta 全量逐条快照，成员/字段漂移须显式改本快照。
  it('注册表全量元数据快照（id|name|number|evidenceMode|ruleClass|priority）', () => {
    const snapshot = [...defaultRules, ...extendedRules].map(
      (r) => `${r.id}|${r.name}|${r.number}|${r.evidenceMode}|${r.ruleClass ?? ''}|${r.priority ?? ''}`,
    );
    expect(snapshot).toEqual([
      'A1|A1 不碰敏感|1|git-diff|业务底线|critical',
      'A2|A2 不泄密钥|2|git-diff|业务底线|critical',
      'A3|A3 不改越界|3|git-diff|能力拐杖|warning',
      'A4|A4 不删配置|4|git-diff|业务底线|warning',
      'A5|A5 不瞒真相|5|git-diff|业务底线|warning',
      'A6|A6 不坏构建|6|git-diff|能力拐杖|crutch',
      'A7|A7 不存盲改|7|hybrid|能力拐杖|crutch',
      'A8|A8 不逃验证|8|hybrid|能力拐杖|crutch',
      'A9|A9 不纳注入|9|git-diff|业务底线|critical',
      'A10|A10 不引毒源|10|git-diff|业务底线|critical',
      'A11|A11 不滥资源|11|git-diff|业务底线|warning',
      'A18|A18 垃圾文件|18|git-diff|能力拐杖|crutch',
      'A19|A19 msg 质量|19|git-diff|工程规范|warning',
      'A20|A20 不泄外联|20|git-diff|业务底线|critical',
      'A21|A21 不植后门|21|git-diff|业务底线|critical',
      'A22|A22 不越权限|22|git-diff|业务底线|critical',
      'A23|A23 不逃路径|23|git-diff|业务底线|critical',
      'E1|E1 不落测试|201|git-diff|能力拐杖|extended',
      'E2|E2 TODO 未声明|202|git-diff|能力拐杖|extended',
      'E4|E4 不低注释|204|git-diff|能力拐杖|extended',
      'A14|A14 知识库越权|14|hybrid|能力拐杖|extended',
      'A15|A15 不盲动|15|hybrid|能力拐杖|extended',
      'A16|A16 非授权文件变更|16|git-diff|工程规范|extended',
      'A17|A17 异常批量变更|17|filesystem|工程规范|extended',
      'A24|A24 交付物落点|24|git-diff|工程规范|extended',
    ]);
  });
});
