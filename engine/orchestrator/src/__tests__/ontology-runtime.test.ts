// ============================================================
// ontology-runtime.test.ts · Ontology 运行时层测试（v1.3.1 交付 1）
// ============================================================
//
// 覆盖：
// - ActionRegistry：注册 / 按 Action 解析 / 工具反查 / 列表排序 / 清空
// - validateToolCall 三态：已注册 → PASS（含 actionType）；未注册非 strict → WARN；
//   未注册 strict → FAIL
// - JSON Schema 校验（entity / concept / relations 对齐真实 frontmatter）
// - wrapToolsWithGate 集成回归：可选 ontologyValidator 三态（PASS 放行 /
//   WARN 放行拼告警 / strict-FAIL 拦截不执行）
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';

import {
  ActionRegistry,
  globalActionRegistry,
  createOntologyValidator,
  validateToolCall,
  validateAgainstSchema,
  ENTITY_SCHEMA,
  CONCEPT_SCHEMA,
  RELATIONS_SCHEMA,
} from '../ontology';
import { wrapToolsWithGate, type ExecutableTool } from '../tools';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

/** 构造一个最小 ExecutableTool（与 tool-gate.test.ts 同款） */
function makeFakeTool(name: string, funcResult = 'ok'): ExecutableTool {
  return {
    name,
    description: `fake ${name} tool for ontology test`,
    schema: { type: 'object', properties: {} },
    func: () => funcResult,
  };
}

/** 永远 PASS 的 gate（不干扰 Ontology 校验层） */
const passGate: (toolName: string, args: Record<string, unknown>) => { allowed: boolean; reason?: string } =
  () => ({ allowed: true });

afterEach(() => {
  // 全局注册表测试后清空，避免用例间互相污染
  globalActionRegistry.clear();
});

// ════════════════════════════════════════
// ActionRegistry
// ════════════════════════════════════════

describe('ActionRegistry · Ontology Action 注册表（v1.3.1 交付 1）', () => {
  it('注册后可按 Action 名解析 + 工具反查 + permission 默认 rw', () => {
    const registry = new ActionRegistry();
    registry.registerAction('read-entity', 'sf_read', { permission: 'r' });
    registry.registerAction('write-entity', 'update_entity');

    const byAction = registry.resolveAction('read-entity');
    expect(byAction?.toolName).toBe('sf_read');
    expect(byAction?.permission).toBe('r');
    expect(byAction?.action.name).toBe('read-entity');

    // 未显式传 permission → 默认 rw（保守）
    const write = registry.resolveAction('write-entity');
    expect(write?.permission).toBe('rw');

    // 工具反查
    const byTool = registry.actionForTool('update_entity');
    expect(byTool?.action.name).toBe('write-entity');
  });

  it('未注册的 Action/工具返回 undefined', () => {
    const registry = new ActionRegistry();
    expect(registry.resolveAction('nope')).toBeUndefined();
    expect(registry.actionForTool('nope')).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('listActions 按 actionName 字典序稳定输出', () => {
    const registry = new ActionRegistry();
    registry.registerAction('zeta', 't1');
    registry.registerAction('alpha', 't2');
    registry.registerAction('mid', 't3');
    const names = registry.listActions().map((r) => r.action.name);
    expect(names).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('重复注册同 actionName → 覆盖（幂等）', () => {
    const registry = new ActionRegistry();
    registry.registerAction('dup', 't1');
    registry.registerAction('dup', 't2');
    expect(registry.size).toBe(1);
    expect(registry.resolveAction('dup')?.toolName).toBe('t2');
  });
});

// ════════════════════════════════════════
// validateToolCall 三态
// ════════════════════════════════════════

describe('validateToolCall · 执行前 Ontology 校验三态', () => {
  it('已注册 Action → PASS（ruleName=ontology-action + actionType + permission）', () => {
    const registry = new ActionRegistry();
    registry.registerAction('read-entity', 'sf_read', { permission: 'r' });

    const verdict = validateToolCall('sf_read', {}, registry);
    expect(verdict.status).toBe('PASS');
    expect(verdict.ruleName).toBe('ontology-action');
    expect(verdict.actionType).toBe('read-entity');
    expect(verdict.permission).toBe('r');
  });

  it('未注册 Action + strict=false（默认）→ WARN（不破坏既有行为）', () => {
    const registry = new ActionRegistry();
    const verdict = validateToolCall('sf_write', {}, registry);
    expect(verdict.status).toBe('WARN');
    expect(verdict.ruleName).toBe('ontology-action');
    expect(verdict.actionType).toBeUndefined();
  });

  it('未注册 Action + strict=true → FAIL 拦截', () => {
    const registry = new ActionRegistry();
    const verdict = validateToolCall('sf_write', {}, registry, { strict: true });
    expect(verdict.status).toBe('FAIL');
    expect(verdict.ruleName).toBe('ontology-action');
  });

  it('createOntologyValidator 闭包绑定 registry + 策略', () => {
    const registry = new ActionRegistry();
    registry.registerAction('read-entity', 'sf_read');
    const validator = createOntologyValidator(registry);
    expect(validator('sf_read', {}).status).toBe('PASS');
    expect(validator('unknown_tool', {}).status).toBe('WARN');

    const strictValidator = createOntologyValidator(registry, { strict: true });
    expect(strictValidator('unknown_tool', {}).status).toBe('FAIL');
  });
});

// ════════════════════════════════════════
// JSON Schema 校验
// ════════════════════════════════════════

describe('Ontology JSON Schema 校验（单一事实源）', () => {
  const validEntity = {
    name: '客户管理',
    domain: '财务',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  it('合法 entity frontmatter → valid', () => {
    const result = validateAgainstSchema(validEntity, ENTITY_SCHEMA);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('entity 缺必填字段 → invalid（含字段名错误）', () => {
    const result = validateAgainstSchema({ name: '客户管理' }, ENTITY_SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain('domain');
    expect(result.errors.join()).toContain('created_at');
    expect(result.errors.join()).toContain('updated_at');
  });

  it('entity relations 为对象（简化形态）→ valid', () => {
    const withRelations = { ...validEntity, relations: { belongs_to: ['母公司'] } };
    const result = validateAgainstSchema(withRelations, ENTITY_SCHEMA);
    expect(result.valid).toBe(true);
  });

  it('entity relations 类型错误（字符串）→ invalid', () => {
    const badRelations = { ...validEntity, relations: 'A' };
    const result = validateAgainstSchema(badRelations, ENTITY_SCHEMA);
    expect(result.valid).toBe(false);
  });

  it('合法 concept frontmatter（无 domain）→ valid；缺 updated_at → invalid', () => {
    const validConcept = {
      name: '业务概念',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    expect(validateAgainstSchema(validConcept, CONCEPT_SCHEMA).valid).toBe(true);

    const missingUpdated = { name: '业务概念', created_at: '2026-01-01T00:00:00.000Z' };
    const result = validateAgainstSchema(missingUpdated, CONCEPT_SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain('updated_at');
  });

  it('relations 简化形态（对象）→ valid（CORE-LNK 键名隐含方向基数）', () => {
    const simple = { belongs_to: ['母公司'], has_many: ['子公司'] };
    expect(validateAgainstSchema(simple, RELATIONS_SCHEMA).valid).toBe(true);
  });

  it('relations 完整形态（数组 + direction/cardinality）→ valid', () => {
    const full = [{ target: '子公司', direction: 'outgoing', cardinality: 'one-to-many' }];
    const result = validateAgainstSchema(full, RELATIONS_SCHEMA);
    expect(result.valid).toBe(true);
  });

  it('relations 完整形态非法 direction → invalid（oneOf 全分支失败）', () => {
    const badFull = [{ target: '子公司', direction: 'sideways', cardinality: 'one-to-many' }];
    const result = validateAgainstSchema(badFull, RELATIONS_SCHEMA);
    expect(result.valid).toBe(false);
  });
});

// ════════════════════════════════════════
// wrapToolsWithGate 集成回归
// ════════════════════════════════════════

describe('wrapToolsWithGate · Ontology validator 集成（v1.3.1）', () => {
  it('不传 validator → v1.3.0 行为零变化（gate PASS 正常执行）', () => {
    const [wrapped] = wrapToolsWithGate([makeFakeTool('sf_read', 'read-ok')], passGate);
    const result = wrapped.func({ path: 'a.md' });
    expect(result).toBe('read-ok');
    expect(result).not.toContain('⛔');
    expect(result).not.toContain('⚠️');
  });

  it('validator PASS → 放行，返回值不拼任何前缀', () => {
    const registry = new ActionRegistry();
    registry.registerAction('read-entity', 'sf_read', { permission: 'r' });
    const validator = createOntologyValidator(registry);

    const [wrapped] = wrapToolsWithGate([makeFakeTool('sf_read', 'read-ok')], passGate, validator);
    const result = wrapped.func({ path: 'a.md' });

    expect(result).toBe('read-ok');
    expect(result).not.toContain('⛔');
    expect(result).not.toContain('⚠️');
  });

  it('validator WARN → 放行但拼 Ontology 告警（ruleName + Action Type）', () => {
    const registry = new ActionRegistry(); // 空注册表 → 未注册 → WARN
    const validator = createOntologyValidator(registry); // strict=false

    const [wrapped] = wrapToolsWithGate([makeFakeTool('sf_edit', 'edit-ok')], passGate, validator);
    const result = wrapped.func({ path: 'a.ts' });

    expect(result.startsWith('⚠️')).toBe(true);
    expect(result).toContain('ontology-action');
    expect(result).toContain('sf_edit');
    // 原始执行结果保留
    expect(result).toContain('edit-ok');
  });

  it('validator strict-FAIL → 拦截，原 func 不执行', () => {
    const registry = new ActionRegistry();
    const validator = createOntologyValidator(registry, { strict: true });

    let callCount = 0;
    const tool: ExecutableTool = {
      ...makeFakeTool('sf_write'),
      func: () => {
        callCount += 1;
        return 'should-never-happen';
      },
    };

    const [wrapped] = wrapToolsWithGate([tool], passGate, validator);
    const result = wrapped.func({ path: 'a.ts', content: 'x' });

    expect(callCount).toBe(0);
    expect(result).toContain('⛔');
    expect(result).toContain('Ontology 拦截');
    expect(result).toContain('ontology-action');
  });

  it('gate FAIL 仍优先拦截（Ontology 层不绕过 ToolGate）', () => {
    const registry = new ActionRegistry();
    registry.registerAction('write-entity', 'sf_write');
    const validator = createOntologyValidator(registry); // sf_write 已注册 → PASS

    const failGate: (toolName: string, args: Record<string, unknown>) => { allowed: boolean; reason?: string } =
      () => ({ allowed: false, reason: '[test-rule] 测试拦截原因' });

    let callCount = 0;
    const tool: ExecutableTool = {
      ...makeFakeTool('sf_write'),
      func: () => {
        callCount += 1;
        return 'nope';
      },
    };

    const [wrapped] = wrapToolsWithGate([tool], failGate, validator);
    const result = wrapped.func({ path: 'a.ts' });

    expect(callCount).toBe(0);
    expect(result).toContain('⛔');
    expect(result).toContain('ToolGate 拦截');
    expect(result).toContain('测试拦截原因');
  });
});
