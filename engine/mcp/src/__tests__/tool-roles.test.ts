// ============================================================
// tool-roles.test.ts · MCP 工具角色分层单测（v1.4.0）
// ============================================================
import { describe, it, expect } from 'vitest';
import { TOOLS } from '../tool-registry';
import {
  ROLES,
  getActiveRoles,
  isToolExposed,
  filterToolsByRoles,
} from '../tool-roles';

describe('getActiveRoles 环境变量解析', () => {
  it('未配置 → 全量（null）', () => {
    expect(getActiveRoles({})).toBeNull();
  });

  it('all → null（全量暴露）', () => {
    expect(getActiveRoles({ SOFAGENT_MCP_ROLES: 'all' })).toBeNull();
  });

  it('* → null（全量暴露）', () => {
    expect(getActiveRoles({ SOFAGENT_MCP_ROLES: '*' })).toBeNull();
  });

  it('空字符串 → 全量（null）', () => {
    expect(getActiveRoles({ SOFAGENT_MCP_ROLES: '' })).toBeNull();
  });

  it('单个角色 eval', () => {
    expect(getActiveRoles({ SOFAGENT_MCP_ROLES: 'eval' })).toEqual(['eval']);
  });

  it('多角色 fde,eval 保序去重', () => {
    expect(getActiveRoles({ SOFAGENT_MCP_ROLES: 'fde,eval,fde' })).toEqual(['fde', 'eval']);
  });

  it('大小写 + 空格归一化', () => {
    expect(getActiveRoles({ SOFAGENT_MCP_ROLES: ' FDE , Audit ' })).toEqual(['fde', 'audit']);
  });

  it('混合非法值只保留合法角色', () => {
    expect(getActiveRoles({ SOFAGENT_MCP_ROLES: 'fde,bogus,agent' })).toEqual(['fde', 'agent']);
  });

  it('全非法值 → 全量兜底（null）', () => {
    expect(getActiveRoles({ SOFAGENT_MCP_ROLES: 'bogus,foo' })).toBeNull();
  });
});

describe('isToolExposed 单工具判定', () => {
  it('全量模式 → 任何工具都暴露', () => {
    expect(isToolExposed(['browser'], null)).toBe(true);
    expect(isToolExposed(undefined, null)).toBe(true);
  });

  it('无 roles（动态工具）→ 始终暴露', () => {
    expect(isToolExposed(undefined, ['fde', 'audit', 'agent'])).toBe(true);
    expect(isToolExposed([], ['fde', 'audit', 'agent'])).toBe(true);
  });

  it('角色命中 → 暴露', () => {
    expect(isToolExposed(['audit'], ['fde', 'audit', 'agent'])).toBe(true);
  });

  it('角色不命中 → 不暴露', () => {
    expect(isToolExposed(['browser'], ['fde', 'audit', 'agent'])).toBe(false);
    expect(isToolExposed(['ops'], ['fde', 'audit', 'agent'])).toBe(false);
  });
});

describe('filterToolsByRoles 清单过滤', () => {
  it('全量模式 → 返回原清单', () => {
    const filtered = filterToolsByRoles(TOOLS, null);
    expect(filtered).toHaveLength(67);
  });

  it('显式 fde+audit+agent 三面 → 只暴露这三面（不含 browser/ops/commons 独占工具）', () => {
    const filtered = filterToolsByRoles(TOOLS, ['fde', 'audit', 'agent']);
    expect(filtered.length).toBeGreaterThan(20);
    expect(filtered.length).toBeLessThan(67);
    const names = filtered.map((t) => t.name);
    // 独占面工具应被隐藏
    expect(names).not.toContain('playwright_navigate');
    expect(names).not.toContain('model_register');
    expect(names).not.toContain('commons_publish');
    expect(names).not.toContain('run_ab_test');
    // 核心面工具应保留
    expect(names).toContain('run_audit');
    expect(names).toContain('create_entity');
    expect(names).toContain('route_workflow');
  });

  it('eval 单面 → 只暴露 eval 相关', () => {
    const filtered = filterToolsByRoles(TOOLS, ['eval']);
    const names = filtered.map((t) => t.name);
    expect(names).toContain('run_ab_test');
    expect(names).toContain('define_acceptance');
    expect(names).not.toContain('run_audit');
    expect(names).not.toContain('playwright_navigate');
  });

  it('未打 roles 的工具（动态工具）在任意角色集下都保留', () => {
    const dynamic = { name: 'mem_search', description: 'x', inputSchema: { type: 'object', properties: {} } };
    const filtered = filterToolsByRoles([dynamic], ['audit']);
    expect(filtered).toHaveLength(1);
  });

  it('list_capabilities（能力发现元工具，无 roles）在专职收窄时也始终暴露', () => {
    const filtered = filterToolsByRoles(TOOLS, ['audit']);
    const names = filtered.map((t) => t.name);
    expect(names).toContain('list_capabilities');
  });

  it('所有工具 roles 值均属于合法 ROLES', () => {
    for (const t of TOOLS) {
      if (t.roles) {
        for (const r of t.roles) {
          expect(ROLES).toContain(r);
        }
      }
    }
  });
});
