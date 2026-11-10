// ============================================================
// criteria-domains.test.ts · v1.9.0 §三 判据面扩展单测（10 条验收锁）
// ============================================================
// 覆盖：①三域判据集加载校验 ②FDE 建档+迁移留痕 ③校准声明 ④未校准拒绝入决策
//   ⑤未验证域声明 ⑥不适用面声明 ⑦入口判据 ⑧接缝断言 ⑨软项⑦（盘查：已在
//   criteria-quality-lint.ts:106-120——此处回归引用不断言实现细节）⑩npm test 零新增
// ============================================================
import { describe, it, expect } from 'vitest';
import { validateCriterion } from '@sofagent/audit/public-api';
import {
  loadDomainCriteriaSets,
  DOMAIN_CALIBRATION,
  UNVERIFIED_DOMAINS,
  JUDGE_INAPPLICABLE_FACES,
  assertDomainCalibratedForDecision,
  UncalibratedDomainError,
} from '../router/criteria/domain-criteria';
import { FDE_S1M_CRITERIA, MIGRATION_LOG, checkMigrationGate } from '../router/criteria/fde-criteria-wiring';
import { shouldJudge, gateCriterionForRegistration } from '../router/criteria/entry-gate';
import { assertAdviceOnlyForBranch, makeJudgeAdvice, CascadeSeamError } from '../router/criteria/cascade-seam';

describe('§三·① 三类判据域判据集在位，加载校验通过', () => {
  it('workflow / ontology / routing 三域各 ≥1 套且逐条校验零问题', () => {
    const sets = loadDomainCriteriaSets();
    for (const domain of ['workflow', 'ontology', 'routing'] as const) {
      expect(sets[domain].criteria.length).toBeGreaterThanOrEqual(2);
      expect(sets[domain].problems).toEqual([]);
    }
  });

  it('同 schema 校验（validateCriterion 逐条——与 audit 域同一校验器）', () => {
    const sets = loadDomainCriteriaSets();
    const all = [...sets.workflow.criteria, ...sets.ontology.criteria, ...sets.routing.criteria];
    for (const c of all) expect(validateCriterion(c)).toEqual([]);
  });
});

describe('§三·② FDE 判据面接线（S1M 归属决策点建档）', () => {
  it('覆盖三类首个落点：映射①三问判定 + 离场就绪度 Score + 健康分合成', () => {
    expect(FDE_S1M_CRITERIA.length).toBeGreaterThanOrEqual(3);
    expect(FDE_S1M_CRITERIA.map((c) => c.primitive).sort()).toEqual(['choice', 'noul', 'score']);
  });

  it('归属迁移过 evidenceReadiness 门且留痕（ready 无留痕即红）', () => {
    expect(checkMigrationGate(FDE_S1M_CRITERIA, MIGRATION_LOG)).toEqual([]);
    // 反例：留痕缺失时门要红
    expect(checkMigrationGate(FDE_S1M_CRITERIA, []).length).toBeGreaterThan(0);
  });
});

describe('§三·③④ 校准状态显式声明 + 未校准域不进决策路径', () => {
  it('三域校准状态逐域登记（当前 interface-only——如实不虚标）', () => {
    for (const domain of ['workflow', 'ontology', 'routing'] as const) {
      expect(DOMAIN_CALIBRATION[domain].calibrationStatus).toBe('interface-only');
      expect(DOMAIN_CALIBRATION[domain].declaredAt).toBeTruthy();
    }
  });

  it('门禁断言：interface-only 域进决策路径即抛（fail-closed）', () => {
    expect(() => assertDomainCalibratedForDecision('workflow')).toThrow(UncalibratedDomainError);
    expect(() => assertDomainCalibratedForDecision('ontology')).toThrow(/不得进决策路径/);
  });
});

describe('§三·⑤⑥ 未验证域声明 + 判定不适用面声明', () => {
  it('未验证域三类显式声明（开放式/主观/长链推理）', () => {
    expect(UNVERIFIED_DOMAINS).toHaveLength(3);
    expect(UNVERIFIED_DOMAINS.join()).toContain('开放式写作');
    expect(UNVERIFIED_DOMAINS.join()).toContain('主观偏好');
    expect(UNVERIFIED_DOMAINS.join()).toContain('长链推理');
  });

  it('不适用面四类声明（生成/多轮推理/纯函数/十毫秒级）各带落点与理由', () => {
    expect(JUDGE_INAPPLICABLE_FACES).toHaveLength(4);
    for (const f of JUDGE_INAPPLICABLE_FACES) {
      expect(['代码', '生成模型', '小分类器']).toContain(f.fallback);
      expect(f.reason.length).toBeGreaterThan(4);
    }
  });
});

describe('§三·⑦ 入口判据「该不该交给判定」（理由留痕）', () => {
  it('正位：输入不可写死+答案可写死 → allow', () => {
    const v = shouldJudge({ criterionId: 'T-1', inputDeterminable: false, answerSpaceWritable: true });
    expect(v.decision).toBe('allow');
  });

  it('divert 三路各带落点与理由（纯函数→代码 / 开放产出→生成模型 / 十毫秒→小分类器）', () => {
    expect(shouldJudge({ criterionId: 'T-2', inputDeterminable: true, answerSpaceWritable: true }).fallback).toBe('代码');
    expect(shouldJudge({ criterionId: 'T-3', inputDeterminable: false, answerSpaceWritable: false }).fallback).toBe('生成模型');
    expect(shouldJudge({ criterionId: 'T-4', inputDeterminable: false, answerSpaceWritable: true, latencyBudgetMs: 5 }).fallback).toBe('小分类器');
  });

  it('登记门面：divert 全量留痕（理由列非空）', () => {
    const r = gateCriterionForRegistration([
      { criterionId: 'A', inputDeterminable: false, answerSpaceWritable: true },
      { criterionId: 'B', inputDeterminable: true, answerSpaceWritable: true },
    ]);
    expect(r.allowed).toHaveLength(1);
    expect(r.diverted[0]!.reason.length).toBeGreaterThan(8);
  });
});

describe('§三·⑧ 三层级联接缝（类型层断言）', () => {
  it('JudgeAdvice 过断言；ExecutableAction / Threshold 传入即抛（brand 防混装）', () => {
    const advice = makeJudgeAdvice({ abstained: false, probability: 0.9 });
    expect(() => assertAdviceOnlyForBranch(advice)).not.toThrow();
    const action = { __brand: 'executable-action', effect: async () => undefined } as never;
    expect(() => assertAdviceOnlyForBranch(action)).toThrow(CascadeSeamError);
    const threshold = { __brand: 'deterministic-threshold', value: 0.75, basis: 'x' } as never;
    expect(() => assertAdviceOnlyForBranch(threshold)).toThrow(/执行动作与门槛不经判定/);
  });

  it('JudgeAdvice 不得携带执行面字段（effect/execute 在场即抛）', () => {
    const bad = { __brand: 'judge-advice', reading: { abstained: false }, effect: () => undefined } as never;
    expect(() => assertAdviceOnlyForBranch(bad)).toThrow(/不得携带执行面字段/);
  });
});

describe('§三·⑨ 判据 lint 软项⑦（盘查：已在，回归引用）', () => {
  it('option-exclusivity 软项在 criteria-quality-lint（引用不断言实现）', async () => {
    const mod = await import('@sofagent/audit/public-api');
    expect(typeof mod.lintCriteria).toBe('function');
  });
});
