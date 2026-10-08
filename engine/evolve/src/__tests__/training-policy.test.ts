// training-policy.test.ts · 默认不启用 / 命中折算 / 留痕 / 两门互补单测（v1.5.8 章五）
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyTrainingPolicySet,
  judgePolicyHits,
  combineGates,
  type TrainingPolicySet,
  type TrajectoryRuleHit,
} from '../training-policy';
import { shapeRewardPenalty, recordShaping } from '../reward-shaping';
import { severityWeightOf } from '@sofagent/audit';

const POLICY: TrainingPolicySet = {
  rulesetVersion: 'v1.5.8-train',
  ruleIds: ['A1', 'A20'],
  declaredAt: '2026-10-09T00:00:00Z',
};

describe('章五 · 训练期策略集 opt-in', () => {
  it('默认空不启用（emptyTrainingPolicySet → 恒不命中）', () => {
    const empty = emptyTrainingPolicySet();
    const v = judgePolicyHits(empty, [{ trajectoryId: 't1', ruleId: 'A1' }]);
    expect(v.hit).toBe(false);
    expect(v.disabled).toBe(true);
  });

  it('声明后命中即判（轨迹命中 ∩ 策略集）', () => {
    const hits: TrajectoryRuleHit[] = [
      { trajectoryId: 't1', ruleId: 'A1' },
      { trajectoryId: 't2', ruleId: 'A5' }, // 不在策略集——不计
    ];
    const v = judgePolicyHits(POLICY, hits);
    expect(v.hit).toBe(true);
    expect(v.hits).toHaveLength(1);
    expect(v.hits[0]!.ruleId).toBe('A1');
  });

  it('声明但轨迹零命中 → hit=false 且 disabled=false（启用未违规）', () => {
    const v = judgePolicyHits(POLICY, [{ trajectoryId: 't1', ruleId: 'A5' }]);
    expect(v.hit).toBe(false);
    expect(v.disabled).toBe(false);
  });
});

describe('章五 · 惩罚信号折算（承接 v1.4.4 映射——无第三套）', () => {
  it('命中折算为 reward 惩罚判据（权重经 audit severityWeightOf）', () => {
    const v = judgePolicyHits(POLICY, [
      { trajectoryId: 't1', ruleId: 'A1' },  // critical → 1.0
      { trajectoryId: 't2', ruleId: 'A20' }, // critical → 1.0
    ]);
    const r = shapeRewardPenalty(v, () => 'critical');
    expect(r.signals).toHaveLength(2);
    expect(r.totalPenalty).toBeCloseTo(2.0);
    expect(r.signals[0]!.penaltyWeight).toBe(severityWeightOf('critical')); // 与 audit 原值逐条相等
  });

  it('不同严重级折算正确（warning 0.6 / extended 0.4）', () => {
    const v = judgePolicyHits(POLICY, [
      { trajectoryId: 't1', ruleId: 'A1' },
      { trajectoryId: 't2', ruleId: 'A20' },
    ]);
    const r = shapeRewardPenalty(v, (rid) => (rid === 'A1' ? 'warning' : 'extended'));
    expect(r.totalPenalty).toBeCloseTo(0.6 + 0.4);
  });

  it('无第三套映射（静态断言：reward-shaping 源码无自有 severity→weight 表）', () => {
    const src = readFileSync(join(__dirname, '..', 'reward-shaping.ts'), 'utf8');
    // 自有映射的形态：switch/对象字面量定义 critical→数值。本文件只允许 import 消费。
    const hasOwnMap = /case\s+'critical'[^}]*return\s+[0-9]/.test(src)
      || /critical['"]?\s*:\s*[0-9]/.test(src.replace(/severityWeightOf|penaltyWeight/g, ''));
    expect(hasOwnMap).toBe(false);
    expect(src).toContain("from '@sofagent/audit'"); // 消费面 = 包名 import
  });
});

describe('章五 · 留痕（含规则集版本）', () => {
  it('策略命中与惩罚折算进台账（规则集版本随行）', () => {
    const v = judgePolicyHits(POLICY, [{ trajectoryId: 't1', ruleId: 'A1' }]);
    const r = shapeRewardPenalty(v, () => 'critical');
    const entry = recordShaping(v, r, POLICY.rulesetVersion, '2026-10-09T00:00:00Z');
    expect(entry.rulesetVersion).toBe('v1.5.8-train');
    expect(entry.hitCount).toBe(1);
    expect(entry.totalPenalty).toBeCloseTo(1.0);
    expect(entry.ruleIds).toEqual(['A1']);
  });
});

describe('章五 · 与准入门互补不互替（组合覆盖三分支）', () => {
  it('① 仅准入门未过：训练策略门通过不代偿——proceed=false 且 basis 只点名准入门', () => {
    const v = combineGates(false, true);
    expect(v.proceed).toBe(false);
    expect(v.basis).toContain('准入门');
    expect(v.basis).not.toContain('训练期策略门');
  });

  it('② 仅训练策略门未过：准入门通过不代偿——proceed=false 且 basis 只点名策略门', () => {
    const v = combineGates(true, false);
    expect(v.proceed).toBe(false);
    expect(v.basis).toContain('训练期策略门');
    expect(v.basis).not.toContain('该不该自动进化');
  });

  it('③ 双门全过才 proceed=true', () => {
    expect(combineGates(true, true).proceed).toBe(true);
    expect(combineGates(false, false).proceed).toBe(false);
  });
});
