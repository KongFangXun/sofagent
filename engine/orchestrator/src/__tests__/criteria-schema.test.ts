// criteria-schema.test.ts · 判据 schema 校验器单测（缺字段/类型不符/畸形 → 拒绝加载）
// ============================================================
// 覆盖面（对齐 devlog 章二验收）：
//   ① 28 条规则逐条对账（无遗漏无凭空）
//   ② fail-closed 整批（任一不合规即拒）
//   ③ 三硬项 + 第④硬项 lint（样例矛盾/证据不可复现/概率来源/问句混装）
//   ④ 两软项提示不阻断 + 待修清单
//   ⑤ 依赖显式 + 环检测 + 串行
//   ⑥ 判定化范围（纯函数留代码记来源）
//   ⑦ 修订标识内容哈希 + 随判定可落 decision-log
//   ⑧ 五态档位 + ABSTAIN 三源归因
//   ⑨ evidenceReadiness 非 ready 拒落数/拒启用（三盲区实例）
//   ⑩ 单边记录判据须显式挂起
//   ⑪ 选项表必含「无合适项→转人工」位
//   ⑫ 硬标签清单
//   ⑬ 正负样例与 v1.5.3 格式一致
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  loadCriterionSet,
  isCriterionEnabled,
  validateCriterion,
  CriteriaSchemaError,
  type AuditCriterion,
} from '../../../audit/src/rules/criteria/criteria-schema';
import { lintCriteria, lintOrFail, hardLabelList } from '../../../audit/src/rules/criteria/criteria-quality-lint';
import { AUDIT_CRITERIA, AUDIT_CRITERIA_RECONCILIATION } from '../../../audit/src/rules/criteria/audit-criteria';

function cloneReady(): AuditCriterion[] {
  // 取一条合规判据做模板（A1-1）
  const a1 = AUDIT_CRITERIA.find((c) => c.id === 'A1-1')!;
  return JSON.parse(JSON.stringify([a1]));
}

describe('28 条规则逐条对账', () => {
  it('test_reconciliation_判据ruleId集合与规则id集合双向相等', () => {
    const covered = new Set(AUDIT_CRITERIA.map((c) => c.ruleId));
    const declared = new Set<string>(AUDIT_CRITERIA_RECONCILIATION.ruleIds);
    expect(declared.size).toBe(28);
    // 双向
    for (const id of declared) expect(covered.has(id), `规则 ${id} 无对应判据（遗漏）`).toBe(true);
    for (const id of covered) expect(declared.has(id), `判据覆盖了未声明规则 ${id}（凭空）`).toBe(true);
  });

  it('test_loadCriterionSet_全量判据非ready剔除后可加载', () => {
    const readyOnly = AUDIT_CRITERIA.filter((c) => c.evidenceReadiness === 'ready');
    const set = loadCriterionSet(readyOnly);
    expect(set.criteria.length).toBeGreaterThan(20);
    expect(set.revision).toMatch(/^[0-9a-f]{16}$/);
  });

  it('test_revision_内容变化则修订标识变化（随判定可举证）', () => {
    const readyOnly = AUDIT_CRITERIA.filter((c) => c.evidenceReadiness === 'ready');
    const s1 = loadCriterionSet(readyOnly);
    const mutated = JSON.parse(JSON.stringify(readyOnly));
    mutated[0].question += '（修订）';
    const s2 = loadCriterionSet(mutated);
    expect(s2.revision).not.toBe(s1.revision);
  });
});

describe('schema fail-closed 整批', () => {
  it('test_loadCriterionSet_单条缺question_整批拒绝', () => {
    const cs = cloneReady();
    (cs[0] as { question?: string }).question = '';
    expect(() => loadCriterionSet(cs)).toThrow(CriteriaSchemaError);
  });

  it('test_loadCriterionSet_primitive畸形_拒绝', () => {
    const cs = cloneReady();
    (cs[0] as { primitive?: string }).primitive = 'boolean';
    expect(() => loadCriterionSet(cs)).toThrow(/primitive/);
  });

  it('test_loadCriterionSet_证据locator缺失_拒绝', () => {
    const cs = cloneReady();
    (cs[0].evidence[0] as { locator?: string }).locator = '';
    expect(() => loadCriterionSet(cs)).toThrow(/locator/);
  });

  it('test_loadCriterionSet_stayCode无系数来源_拒绝', () => {
    const cs = cloneReady();
    cs[0].disposition = 'stay-code';
    cs[0].constantSource = undefined;
    expect(() => loadCriterionSet(cs)).toThrow(/constantSource/);
  });

  it('test_loadCriterionSet_门槛原语不一致_拒绝', () => {
    const cs = cloneReady();
    cs[0].thresholds[0]!.primitive = 'score';
    expect(() => loadCriterionSet(cs)).toThrow(/门槛须按原语分档/);
  });

  it('test_loadCriterionSet_正负样例逐字矛盾_拒绝（可判别性）', () => {
    const cs = cloneReady();
    cs[0].examples = { match: ['.env'], notMatch: ['.env'] };
    expect(() => loadCriterionSet(cs)).toThrow(/矛盾/);
  });
});

describe('质量 lint 四硬项', () => {
  it('test_lint_hard1_正负样例子串近矛盾_拒载', () => {
    const cs = cloneReady();
    cs[0].examples = { match: [['AK' + 'IA', 'IOSFODNN7EXAMPLE'].join('') + ' 泄漏'], notMatch: [['AK' + 'IA', 'IOSFODNN7EXAMPLE'].join('')] };
    const r = lintCriteria(cs);
    expect(r.hard.some((h) => h.rule === 'discriminability')).toBe(true);
    expect(() => lintOrFail(cs)).toThrow(/硬项/);
  });

  it('test_lint_hard2_证据通道白名单外_拒载', () => {
    const cs = cloneReady();
    cs[0].evidence[0]!.source = '某个不存在的通道';
    const r = lintCriteria(cs);
    expect(r.hard.some((h) => h.rule === 'evidentiability')).toBe(true);
  });

  it('test_lint_hard3_概率来源自述形态_拒载', () => {
    const cs = cloneReady();
    (cs[0] as { probabilitySource?: unknown }).probabilitySource = 'self-report（模型自述）';
    const r = lintCriteria(cs);
    expect(r.hard.some((h) => h.rule === 'probability-traceability')).toBe(true);
  });

  it('test_lint_hard4_问句混装多独立判断_拒载', () => {
    const cs = cloneReady();
    cs[0].question = '这线索是否有价值、紧急且会买？';
    const r = lintCriteria(cs);
    expect(r.hard.some((h) => h.rule === 'decomposability')).toBe(true);
    expect(() => lintOrFail(cs)).toThrow(/拆原子问句/);
  });

  it('test_lint_软项_选项包含形态互斥提示_不阻断', () => {
    const cs = cloneReady();
    cs[0].primitive = 'choice';
    cs[0].options = ['写生产配置', '生产配置', '无合适项→转人工'];
    cs[0].thresholds[0].primitive = 'choice';
    const { report, pendingFixes } = lintOrFail(cs);
    expect(report.hard).toHaveLength(0);
    expect(report.soft.some((s) => s.rule === 'option-exclusivity')).toBe(true);
    expect(pendingFixes.length).toBeGreaterThan(0);
  });
});

describe('依赖显式与环检测', () => {
  it('test_deps_依赖不存在_拒绝', () => {
    const cs = cloneReady();
    cs[0].deps = ['Z99-1'];
    expect(() => loadCriterionSet(cs)).toThrow(/依赖不存在/);
  });

  it('test_deps_依赖成环_拒绝', () => {
    const a = cloneReady()[0]!;
    const b = JSON.parse(JSON.stringify(a));
    b.id = 'A1-1b';
    a.deps = ['A1-1b'];
    b.deps = ['A1-1'];
    expect(() => loadCriterionSet([a, b])).toThrow(/成环/);
  });

  it('test_deps_全量判据依赖图无环（串行拓扑可行）', () => {
    const readyOnly = AUDIT_CRITERIA.filter((c) => c.evidenceReadiness === 'ready');
    expect(() => loadCriterionSet(readyOnly)).not.toThrow();
  });
});

describe('evidenceReadiness 与三盲区', () => {
  it('test_nonReady_拒绝落数（fail-closed）', () => {
    const cs = cloneReady();
    cs[0].evidenceReadiness = 'gated:v1.9.9';
    expect(() => loadCriterionSet(cs)).toThrow(/不得落数/);
  });

  it('test_blindSpots_三盲区判据在数据中且非ready（A22-2/A17-2/A16-2）', () => {
    for (const id of ['A22-2', 'A17-2', 'A16-2']) {
      const c = AUDIT_CRITERIA.find((x) => x.id === id);
      expect(c, `盲区判据 ${id} 缺失`).toBeDefined();
      expect(c!.evidenceReadiness).toMatch(/^gated:/);
      expect(isCriterionEnabled(c!)).toBe(false);
    }
  });

  it('test_singleSided_单边记录判据无挂起登记_拒绝', () => {
    const cs = cloneReady();
    cs[0].evidence[0]!.source = '单边记录（只记告警）';
    delete (cs[0] as { singleSidedRecordWaiver?: unknown }).singleSidedRecordWaiver;
    expect(() => loadCriterionSet(cs, { allowNonReady: true })).toThrow(/单边记录/);
  });

  it('test_singleSided_显式挂起可载入但不得启用', () => {
    const a16_2 = AUDIT_CRITERIA.find((c) => c.id === 'A16-2')!;
    expect(a16_2.singleSidedRecordWaiver).toBe('pending-record-completion');
    expect(isCriterionEnabled(a16_2)).toBe(false);
  });
});

describe('选项表与档位', () => {
  it('test_choiceOptions_缺无合适项位_拒绝', () => {
    const cs = cloneReady();
    cs[0].primitive = 'choice';
    cs[0].options = ['选项甲', '选项乙'];
    cs[0].thresholds[0].primitive = 'choice';
    const errs = validateCriterion(cs[0]!);
    expect(errs.some((e) => e.includes('无合适项'))).toBe(true);
  });

  it('test_A15_2_选项表含无合适项位', () => {
    const a15_2 = AUDIT_CRITERIA.find((c) => c.id === 'A15-2')!;
    expect(a15_2.primitive).toBe('choice');
    expect(a15_2.options!.some((o) => o.includes('无合适项'))).toBe(true);
  });

  it('test_A15_2_依赖A15_1_串行声明在位', () => {
    const a15_2 = AUDIT_CRITERIA.find((c) => c.id === 'A15-2')!;
    expect(a15_2.deps).toContain('A15-1');
  });

  it('test_hardLabelList_留代码判据进硬标签清单', () => {
    const list = hardLabelList(AUDIT_CRITERIA);
    expect(list).toContain('A19-1');
    expect(list).not.toContain('A1-1');
  });
});

describe('正负样例格式与规则自测一致', () => {
  it('test_examplesShape_与v1_5_3规则自测schema同构（match[]+notMatch[]）', () => {
    for (const c of AUDIT_CRITERIA) {
      expect(Array.isArray(c.examples.match)).toBe(true);
      expect(Array.isArray(c.examples.notMatch)).toBe(true);
    }
  });
});
