// ============================================================
// write-surface-boundary.test.ts · 写面权限窄化单测（v1.5.9 章七）
// ============================================================
// 断言面（负向探针为主）：
//   ① 可写面（memory / skill）→ allow
//   ② 控制面五类（策略/注入/路由/状态/审计历史）→ deny 且具名到面
//   ③ 未分类路径 → deny（fail-closed，不默认放行）
//   ④ assertModelWritable 对控制面抛 ControlPlaneWriteError（异常类型 + 面名 + 落点）
//   ⑤ 归一化（反斜杠 / 重复斜杠 / 前导 ./）不改变判定
//   ⑥ 控制面优先：同一落点两侧都命中时判控制面
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  MODEL_WRITABLE_SURFACES,
  CONTROL_PLANE_SURFACES,
  ControlPlaneWriteError,
  normalizeWriteTarget,
  classifyWriteTarget,
  isModelWritable,
  assertModelWritable,
  guardWriteIntent,
} from './write-surface-boundary';

describe('写面权限窄化 · 可写面', () => {
  it('memory / skill 两类产物放行（含任意层级）', () => {
    for (const p of [
      'memory/facts.md',
      'think.md',
      '.sofagent/think.md',
      'knowledge/domain.md',
      'instinct/pool.md',
      'skills/deploy.md',
      'skill/review.md',
      'a/b/skills/x.skill.md',
    ]) {
      expect(isModelWritable(p)).toBe(true);
      expect(guardWriteIntent(p, 'agent-1').decision).toBe('allow');
    }
  });

  it('可写面所有枚举值都被覆盖', () => {
    expect([...MODEL_WRITABLE_SURFACES].sort()).toEqual(['memory', 'skill']);
  });
});

describe('写面权限窄化 · 控制面负向探针', () => {
  const cases: Array<[string, (typeof CONTROL_PLANE_SURFACES)[number]]> = [
    ['policy/rules.md', 'policy'],
    ['rules/no-eval.md', 'policy'],
    ['.sofagent/policy.json', 'policy'],
    ['SKILL/harness/installer.md', 'inject'],
    ['load-chain/overrides/fde.md', 'inject'],
    ['overrides/system-prompt.md', 'inject'],
    ['fde.md', 'inject'],
    ['AGENTS.md', 'inject'],
    ['router/slots.json', 'route'],
    ['route/models.json', 'route'],
    ['state/runtime.state.json', 'state'],
    ['audit/decision-log.jsonl', 'audit-history'],
    ['data/audit/history.jsonl', 'audit-history'],
    ['write-surface.jsonl', 'audit-history'],
  ];

  it('控制面写入 → deny，且具名到面（模型写入即失败）', () => {
    for (const [p, surface] of cases) {
      const v = guardWriteIntent(p, 'agent-1');
      expect(v.decision).toBe('deny');
      expect(v.surface).toBe(surface);
      expect(v.reason).toContain('写面窄化');
      expect(() => assertModelWritable(p, 'agent-1')).toThrow(ControlPlaneWriteError);
    }
  });

  it('负向探针：模型写策略/注入/路由/状态/审计历史 → 抛具名异常（面名 + 落点 + 发起方）', () => {
    const probes: Array<[string, string]> = [
      ['policy/rules.md', 'policy'],
      ['SKILL/harness/installer.md', 'inject'],
      ['router/slots.json', 'route'],
      ['state/runtime.state.json', 'state'],
      ['audit/decision-log.jsonl', 'audit-history'],
    ];
    for (const [p, expectedSurface] of probes) {
      try {
        assertModelWritable(p, 'model-executor');
        throw new Error(`探针失效：${p} 未抛异常（控制面写入应失败）`);
      } catch (err) {
        expect(err).toBeInstanceOf(ControlPlaneWriteError);
        const e = err as ControlPlaneWriteError;
        expect(e.surface).toBe(expectedSurface);
        expect(e.target).toBe(normalizeWriteTarget(p));
        expect(e.actor).toBe('model-executor');
        expect(e.message).toContain(expectedSurface);
      }
    }
  });

  it('控制面五类枚举齐备', () => {
    expect([...CONTROL_PLANE_SURFACES].sort()).toEqual(
      ['audit-history', 'inject', 'policy', 'route', 'state'].sort(),
    );
  });
});

describe('写面权限窄化 · fail-closed 未分类', () => {
  it('未分类路径 → deny（不默认放行）', () => {
    for (const p of ['src/index.ts', 'README.md', 'random/whatever.txt', '']) {
      const v = guardWriteIntent(p, 'agent-1');
      expect(v.decision).toBe('deny');
      expect(v.surface).toBe('unknown');
    }
  });
});

describe('写面权限窄化 · 归一化与控制面优先', () => {
  it('反斜杠 / 重复斜杠 / 前导 ./ 归一后判定不变', () => {
    expect(normalizeWriteTarget('.\\policy\\rules.md')).toBe('policy/rules.md');
    expect(normalizeWriteTarget('./memory//facts.md')).toBe('memory/facts.md');
    expect(classifyWriteTarget('.\\policy\\rules.md').kind).toBe('control-plane');
    expect(classifyWriteTarget('./memory//facts.md').kind).toBe('writable');
  });

  it('两侧都命中时判控制面（保守面）', () => {
    // knowledge/ 是可写 memory 前缀，但 audit/ 前缀命中控制面 → 控制面优先
    const cls = classifyWriteTarget('audit/knowledge/x.md');
    expect(cls.kind).toBe('control-plane');
    expect((cls as { surface: string }).surface).toBe('audit-history');
  });
});
