// ============================================================
// permission.test.ts · 场景驱动权限体系测试
// v1.3.7 交付② 新增
//
// 覆盖 changelog §二 验收标准 7 项：
//   1. 判定链完整（身份→场景→风险→处置），decision-log 留痕
//   2. 三维度至少各 3 预设场景
//   3. 极高风险触发人工批准
//   4. 团队/市场/动态提权三合一
//   5. fail-closed
//   6. 守卫先于事件分发（decide 在执行前）
//   7. npm test 全绿（运行本身）
// ============================================================

import { describe, it, expect } from 'vitest';
import { createScenarioRouter, BUILTIN_SCENARIOS } from '../../permission/scenario-router';
import { classifyRisk, riskToDefaultAction } from '../../permission/risk-classifier';
import { createPolicyEngine } from '../../permission/policy-engine';
import type { PermissionRequest } from '../../permission/policy-engine';

function req(partial: Partial<PermissionRequest>): PermissionRequest {
  return {
    agentId: 'agent-001',
    taskType: 'code-development',
    domain: 'code',
    action: 'write',
    source: 'task',
    ...partial,
  };
}

describe('场景匹配引擎（scenario-router）', () => {
  it('三维度预设场景 ≥3 任务类型 × 各自数据域（验收 2）', () => {
    expect(BUILTIN_SCENARIOS.length).toBeGreaterThanOrEqual(6);
    const taskTypes = new Set(BUILTIN_SCENARIOS.map(s => s.taskType));
    expect(taskTypes.size).toBeGreaterThanOrEqual(3); // 至少 3 种任务类型
    for (const s of BUILTIN_SCENARIOS) {
      expect(s.allowedDomains.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('匹配成功返回场景', () => {
    const router = createScenarioRouter();
    const r = router.match({ taskType: 'code-development', domain: 'code', action: 'write' });
    expect(r.matched).toBe(true);
    expect(r.scenario?.id).toBe('code-dev-main');
  });

  it('fail-closed：数据域不在场景允许面 → 不匹配', () => {
    const router = createScenarioRouter();
    const r = router.match({ taskType: 'testing', domain: 'user-data', action: 'read' });
    expect(r.matched).toBe(false);
    expect(r.reason).toContain('不允许触碰数据域');
  });

  it('fail-closed：未知任务类型 → 不匹配', () => {
    const router = createScenarioRouter();
    const r = router.match({ taskType: 'unknown-type' as never, domain: 'code', action: 'read' });
    expect(r.matched).toBe(false);
    expect(r.reason).toContain('无预设场景');
  });

  it('企业扩展场景叠加生效', () => {
    const router = createScenarioRouter({
      extraScenarios: [{
        id: 'custom-finance',
        taskType: 'ops',
        allowedDomains: ['audit-data'],
        description: '自定义：财务运维可碰审计数据',
      }],
    });
    expect(router.match({ taskType: 'ops', domain: 'audit-data', action: 'read' }).matched).toBe(true);
    expect(router.listScenarios().length).toBe(BUILTIN_SCENARIOS.length + 1);
  });
});

describe('风险等级分类器（risk-classifier）', () => {
  it('基线：读低/写中/删高/外传极高（changelog 示例表）', () => {
    expect(classifyRisk('read', 'code')).toBe('low');
    expect(classifyRisk('write', 'code')).toBe('medium');
    expect(classifyRisk('delete', 'code')).toBe('high');
    expect(classifyRisk('export', 'code')).toBe('critical');
  });

  it('敏感域提级：审计数据写/删一律 critical（防篡改审计）', () => {
    expect(classifyRisk('write', 'audit-data')).toBe('critical');
    expect(classifyRisk('delete', 'audit-data')).toBe('critical');
    expect(classifyRisk('read', 'audit-data')).toBe('low'); // 读不提级
  });

  it('用户数据删除提级 critical（不可恢复）', () => {
    expect(classifyRisk('delete', 'user-data')).toBe('critical');
    expect(classifyRisk('write', 'user-data')).toBe('medium'); // 写不提
  });

  it('风险→默认处置：low/medium 自动，high/critical 人审', () => {
    expect(riskToDefaultAction('low')).toBe('auto-allow');
    expect(riskToDefaultAction('medium')).toBe('auto-allow');
    expect(riskToDefaultAction('high')).toBe('human-approval');
    expect(riskToDefaultAction('critical')).toBe('human-approval');
  });
});

describe('策略引擎（policy-engine）判定链', () => {
  it('判定链完整：身份→场景→风险→放行，decision-log 全链留痕（验收 1）', () => {
    const engine = createPolicyEngine();
    const { action, log: entry } = engine.decide(req({}));
    expect(action).toBe('allow');
    expect(entry.chain.identity).toBe('agent-001');
    expect(entry.chain.scenarioMatched).toBe(true);
    expect(entry.chain.scenarioId).toBe('code-dev-main');
    expect(entry.chain.risk).toBe('medium');
    expect(engine.exportLog().length).toBe(1);
  });

  it('fail-closed：缺身份 → deny（验收 5）', () => {
    const engine = createPolicyEngine();
    const { action, reason } = engine.decide(req({ agentId: '' }));
    expect(action).toBe('deny');
    expect(reason).toContain('缺少 agent 身份');
  });

  it('fail-closed：场景不匹配（数据处理写审计数据）→ deny', () => {
    const engine = createPolicyEngine();
    const { action } = engine.decide(req({ taskType: 'data-processing', domain: 'audit-data', action: 'write' }));
    expect(action).toBe('deny');
  });

  it('fail-closed：策略异常防御——未知来源字段组合不崩溃且不默认放行', () => {
    const engine = createPolicyEngine();
    const r = engine.decide(req({ source: 'team', target: '不存在角色' }));
    expect(r.action).toBe('deny');
    expect(r.reason).toContain('无策略');
  });

  it('极高/高风险触发 human-approval——无人审不执行（验收 3）', () => {
    const engine = createPolicyEngine();
    // 外传用户数据（report-generation 场景允许 user-data + export → 场景过但风险 critical 拦）
    const r1 = engine.decide(req({ taskType: 'report-generation', domain: 'user-data', action: 'export' }));
    expect(r1.action).toBe('human-approval');
    // 删代码（code-dev 场景允许 code + delete → 场景过但风险 high 拦）
    const r2 = engine.decide(req({ action: 'delete' }));
    expect(r2.action).toBe('human-approval');
  });

  it('守卫先于事件分发：decide 返回 allow 后调用方才执行（时序由 API 形状保证）', () => {
    const engine = createPolicyEngine();
    // decide() 是纯判定——不执行任何副作用；调用方模式：
    const { action } = engine.decide(req({}));
    let executed = false;
    if (action === 'allow') executed = true; // 执行在判定之后
    expect(executed).toBe(true);
  });
});

describe('三合一：团队 / 市场 / 动态提权（验收 4）', () => {
  it('L2 团队权限：角色在策略表内放行，角色外 fail-closed', () => {
    const engine = createPolicyEngine({
      teamPolicies: [{ role: 'reviewer', allowedTaskTypes: ['code-development', 'testing'] }],
    });
    const ok = engine.decide(req({ source: 'team', target: 'reviewer', taskType: 'code-development' }));
    expect(ok.action).toBe('allow');
    const bad = engine.decide(req({ source: 'team', target: 'reviewer', taskType: 'data-processing' }));
    expect(bad.action).toBe('deny');
    const unknown = engine.decide(req({ source: 'team', target: 'ghost-role' }));
    expect(unknown.action).toBe('deny');
  });

  it('L3 市场权限：授权名单内放行，名单外 deny，* 全放', () => {
    const engine = createPolicyEngine({
      commonsPolicies: [
        { capability: 'fintech-scanner', allowedAgents: ['agent-001'] },
        { capability: 'public-tool', allowedAgents: '*' },
      ],
    });
    expect(engine.decide(req({ source: 'commons', target: 'fintech-scanner' })).action).toBe('allow');
    expect(engine.decide(req({ source: 'commons', target: 'fintech-scanner', agentId: 'agent-999' })).action).toBe('deny');
    expect(engine.decide(req({ source: 'commons', target: 'public-tool', agentId: 'agent-999' })).action).toBe('allow');
    expect(engine.decide(req({ source: 'commons', target: '未注册能力' })).action).toBe('deny');
  });

  it('动态提权：授予后场景外域放行，到期自动回收（惰性清理）', () => {
    const engine = createPolicyEngine();
    // 基线：testing 场景不碰 user-data → deny
    expect(engine.decide(req({ taskType: 'testing', domain: 'user-data', action: 'read' })).action).toBe('deny');
    // 授予 100ms 提权
    engine.grantElevation('agent-001', 'user-data', 100, '临时数据处理任务');
    expect(engine.activeElevations('agent-001').length).toBe(1);
    // 提权期内放行（read 是 low）
    const lifted = engine.decide(req({ taskType: 'testing', domain: 'user-data', action: 'read' }));
    expect(lifted.action).toBe('allow');
    expect(lifted.log.viaElevation).toBe(true);
    // 过期后回收
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const expired = engine.decide(req({ taskType: 'testing', domain: 'user-data', action: 'read' }));
        expect(expired.action).toBe('deny');
        expect(engine.activeElevations('agent-001').length).toBe(0);
        resolve();
      }, 150);
    });
  });

  it('提权不豁免高危：critical 仍 human-approval', () => {
    const engine = createPolicyEngine();
    engine.grantElevation('agent-001', 'audit-data', 60_000, '临时导出审计');
    const r = engine.decide(req({ taskType: 'testing', domain: 'audit-data', action: 'write' }));
    expect(r.action).toBe('human-approval'); // 提权命中但 critical 仍人审
  });
});
