// ============================================================
// ontology-contracts.test.ts · Ontology 内核契约四类测试（v1.3.2 交付 1）
// ============================================================
//
// 覆盖：
// - CORE_CONTRACTS 四类契约清单（CORE-OBJ / CORE-ACT / CORE-LNK / CORE-STM）
//   —— 顺序即标准枚举序
// - CORE-STM 状态机契约注册：合法注册 + 查询；initialState / 迁移引用
//   未知状态 → 骨架校验 throw
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';

import {
  CORE_CONTRACTS,
  registerStateMachine,
  getStateMachine,
  clearStateMachineRegistry,
} from '../ontology';

afterEach(() => {
  clearStateMachineRegistry();
});

describe('CORE_CONTRACTS · 内核契约四类框架（v1.3.1 交付 1）', () => {
  it('四类契约齐全且顺序固定（OBJ → ACT → LNK → STM）', () => {
    expect(CORE_CONTRACTS.map((c) => c.id)).toEqual(['CORE-OBJ', 'CORE-ACT', 'CORE-LNK', 'CORE-STM']);
  });

  it('每类契约都有标题 + 语义描述（供审计/文档引用）', () => {
    for (const contract of CORE_CONTRACTS) {
      expect(contract.title.length).toBeGreaterThan(0);
      expect(contract.description.length).toBeGreaterThan(0);
    }
  });

  it('CORE-OBJ 描述引用 entity/concept schema；CORE-ACT 引用 action-registry', () => {
    const obj = CORE_CONTRACTS.find((c) => c.id === 'CORE-OBJ');
    const act = CORE_CONTRACTS.find((c) => c.id === 'CORE-ACT');
    const lnk = CORE_CONTRACTS.find((c) => c.id === 'CORE-LNK');
    expect(obj?.description).toContain('entity.schema.json');
    expect(act?.description).toContain('action-registry');
    expect(lnk?.description).toContain('relations.schema.json');
  });
});

describe('CORE-STM · 状态机契约注册（本版框架）', () => {
  it('合法状态机注册后可按 objectType 查询', () => {
    registerStateMachine({
      objectType: 'entity',
      states: ['draft', 'active', 'archived'],
      initialState: 'draft',
      transitions: { draft: ['active'], active: ['archived'], archived: [] },
    });

    const sm = getStateMachine('entity');
    expect(sm?.initialState).toBe('draft');
    expect(sm?.transitions.active).toEqual(['archived']);
    expect(sm?.states).toContain('archived');
  });

  it('initialState 不在 states 集合 → throw（骨架约束）', () => {
    expect(() =>
      registerStateMachine({
        objectType: 'x',
        states: ['a', 'b'],
        initialState: 'z',
        transitions: {},
      }),
    ).toThrow(/CORE-STM/);
  });

  it('迁移起点不在 states 集合 → throw', () => {
    expect(() =>
      registerStateMachine({
        objectType: 'x',
        states: ['a', 'b'],
        initialState: 'a',
        transitions: { z: ['b'] },
      }),
    ).toThrow(/CORE-STM/);
  });

  it('迁移终点不在 states 集合 → throw', () => {
    expect(() =>
      registerStateMachine({
        objectType: 'x',
        states: ['a', 'b'],
        initialState: 'a',
        transitions: { a: ['zzz'] },
      }),
    ).toThrow(/CORE-STM/);
  });

  it('未注册的 objectType → undefined；clearStateMachineRegistry 清空', () => {
    expect(getStateMachine('nothing')).toBeUndefined();
    registerStateMachine({
      objectType: 'entity',
      states: ['draft'],
      initialState: 'draft',
      transitions: {},
    });
    expect(getStateMachine('entity')).toBeDefined();
    clearStateMachineRegistry();
    expect(getStateMachine('entity')).toBeUndefined();
  });
});
