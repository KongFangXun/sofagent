// ============================================================
// formations.test.ts · 六阵型实例化 + 审计留痕测试（v1.4.8 第三章）
// ============================================================
import { describe, expect, it } from 'vitest';
import { validateFormation, parseFormation, FORMATION_NAMES } from '../formations/schema';
import { instantiateFormation, FORMATION_TEMPLATES } from '../formations/registry';

describe('第三章 · 阵型 schema 校验', () => {
  it('六种合法阵型名', () => {
    expect(FORMATION_NAMES).toHaveLength(6);
    expect(FORMATION_NAMES).toContain('commander-crews');
    expect(FORMATION_NAMES).toContain('cost-pyramid');
  });

  it('合法配置通过', () => {
    const v = validateFormation({
      formation: 'driver-advisor',
      members: [
        { role: 'driver', agentType: 'engineer' },
        { role: 'advisor', agentType: 'reviewer' },
      ],
      edges: [{ from: 'advisor', to: 'driver', protocol: 'review' }],
    });
    expect(v.valid).toBe(true);
  });

  it('未识别阵型名报错并列出六种合法值', () => {
    const v = validateFormation({ formation: 'nonexistent', members: [{ role: 'a', agentType: 'x' }], edges: [] });
    expect(v.valid).toBe(false);
    if (!v.valid) {
      expect(v.errors[0]).toContain('nonexistent');
      for (const name of FORMATION_NAMES) expect(v.errors[0]).toContain(name);
    }
  });

  it('成员空/角色重复/边端点漂移各报错', () => {
    expect(validateFormation({ formation: 'cross-review', members: [], edges: [] }).valid).toBe(false);
    const dup = validateFormation({
      formation: 'cross-review',
      members: [
        { role: 'a', agentType: 'x' },
        { role: 'a', agentType: 'y' },
      ],
      edges: [],
    });
    expect(dup.valid).toBe(false);
    const badEdge = validateFormation({
      formation: 'cross-review',
      members: [{ role: 'a', agentType: 'x' }],
      edges: [{ from: 'a', to: 'ghost', protocol: 'async' }],
    });
    expect(badEdge.valid).toBe(false);
  });

  it('YAML 解析（注入式 yamlLoad）', () => {
    const v = parseFormation(
      'formation: bake-off\nmembers:\n  - role: judge\n    agentType: reviewer\nedges: []\n',
      (s) => JSON.parse(s) as unknown,
    );
    // JSON.parse 对 yaml 文本会抛——走解析失败分支
    expect(v.valid).toBe(false);
  });
});

describe('第三章 · 六阵型实例化 + 审计留痕', () => {
  it('六阵型全部可实例化（模板兜底）', () => {
    for (const name of FORMATION_NAMES) {
      const inst = instantiateFormation({ formation: name, members: [], edges: [] });
      expect(inst.formation).toBe(name);
      expect(inst.members.length).toBeGreaterThanOrEqual(2);
      expect(inst.members.every((m) => m.state === 'open')).toBe(true);
    }
  });

  it('自定义 members 优先于模板', () => {
    const inst = instantiateFormation({
      formation: 'commander-crews',
      members: [
        { role: '主将', agentType: 'engineer' },
        { role: '兵卒', agentType: 'engineer' },
      ],
      edges: [],
    });
    expect(inst.members.map((m) => m.role)).toEqual(['主将', '兵卒']);
  });

  it('跨成员派发/交接留痕（who-派发-who 可回溯）', () => {
    const inst = instantiateFormation(FORMATION_TEMPLATES['commander-crews']);
    inst.recordHandoff({ from: 'commander', to: 'crew-1', protocol: 'sync' }, 'commander');
    inst.recordHandoff({ from: 'commander', to: 'crew-2', protocol: 'sync' }, 'commander');
    const audit = inst.exportFormationAudit();
    expect(audit.handoffs).toHaveLength(2);
    expect(audit.handoffs[0]?.dispatchedBy).toBe('commander');
    expect(audit.handoffs[1]?.from).toBe('commander');
  });

  it('边生命周期管理（open → closed）', () => {
    const inst = instantiateFormation(FORMATION_TEMPLATES['driver-advisor']);
    inst.closeMember('advisor');
    const audit = inst.exportFormationAudit();
    expect(audit.members.find((m) => m.role === 'advisor')?.state).toBe('closed');
    expect(audit.members.find((m) => m.role === 'driver')?.state).toBe('open');
  });

  it('bake-off 阵型拓扑对接 A/B 形态（judge 汇聚双候选）', () => {
    const inst = instantiateFormation(FORMATION_TEMPLATES['bake-off']);
    const judge = inst.members.find((m) => m.role === 'judge');
    expect(judge).toBeDefined();
    // 双候选 → judge 两条 async 边（择优由调用方接 v1.3.5 A/B 基建）
    expect(FORMATION_TEMPLATES['bake-off'].edges.filter((e) => e.to === 'judge')).toHaveLength(2);
  });
});
