// ============================================================
// validator.test.ts · Validation Engine 测试（v1.5.0 第三章）
//
// 覆盖验收：
//   1. DAG 无环：构造环形依赖 → 激活被拒 + 环路定位输出
//   2. schema 兼容：节点 IO 与实体字段类型不匹配 → 激活被拒 + 字段定位
//   3. fail-closed：校验器自身异常也拒绝激活
// ============================================================

import { describe, it, expect } from 'vitest';
import { validateDag, validateSchemaCompat, validateForActivation, type NodeLike, type EntityLike } from '../graph/validator';

describe('validateDag DAG 无环校验', () => {
  it('无环图通过（零 issue）', () => {
    const nodes: NodeLike[] = [
      { id: 'a', depends_on: [] },
      { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['a', 'b'] },
    ];
    expect(validateDag(nodes)).toEqual([]);
  });

  it('环形依赖 → 环路定位输出', () => {
    const nodes: NodeLike[] = [
      { id: 'a', depends_on: ['c'] },
      { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['b'] },
    ];
    const issues = validateDag(nodes);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('cycle');
    expect(issues[0]!.detail).toContain('存在环');
    expect(issues[0]!.detail).toMatch(/a → b → c|c → b → a|b → c → a/);
  });

  it('悬空依赖 → 定位到节点', () => {
    const nodes: NodeLike[] = [{ id: 'a', depends_on: ['ghost'] }];
    const issues = validateDag(nodes);
    expect(issues[0]!.kind).toBe('cycle');
    expect(issues[0]!.detail).toContain('悬空节点 ghost');
  });
});

describe('validateSchemaCompat schema 兼容校验', () => {
  const entities: EntityLike[] = [
    { name: '报价单', fields: { 金额: 'number', 客户: 'string' } },
  ];

  it('字段与类型全对齐 → 通过', () => {
    const nodes: NodeLike[] = [
      {
        id: 'n1',
        depends_on: [],
        io: { consumes: [{ entity: '报价单', fields: { 金额: 'number' } }] },
      },
    ];
    expect(validateSchemaCompat(nodes, entities)).toEqual([]);
  });

  it('引用未知实体 → 字段级定位', () => {
    const nodes: NodeLike[] = [
      {
        id: 'n2',
        depends_on: [],
        io: { produces: [{ entity: '不存在实体' }] },
      },
    ];
    const issues = validateSchemaCompat(nodes, entities);
    expect(issues[0]!.kind).toBe('schema');
    expect(issues[0]!.field).toBe('produces.不存在实体');
    expect(issues[0]!.detail).toContain('未知实体');
  });

  it('字段缺失 → 字段级定位', () => {
    const nodes: NodeLike[] = [
      {
        id: 'n3',
        depends_on: [],
        io: { consumes: [{ entity: '报价单', fields: { 折扣率: 'number' } }] },
      },
    ];
    const issues = validateSchemaCompat(nodes, entities);
    expect(issues[0]!.field).toBe('consumes.报价单.折扣率');
    expect(issues[0]!.detail).toContain('无此字段');
  });

  it('类型错配 → 双类型输出', () => {
    const nodes: NodeLike[] = [
      {
        id: 'n4',
        depends_on: [],
        io: { consumes: [{ entity: '报价单', fields: { 金额: 'string' } }] },
      },
    ];
    const issues = validateSchemaCompat(nodes, entities);
    expect(issues[0]!.detail).toContain('"string"');
    expect(issues[0]!.detail).toContain('"number"');
  });
});

describe('validateForActivation fail-closed 前置门', () => {
  it('全通过 → valid=true', () => {
    const nodes: NodeLike[] = [{ id: 'a', depends_on: [] }];
    const r = validateForActivation(nodes, []);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('校验器自身异常 → 同样拒绝（internal issue）', () => {
    // 构造异常输入：depends_on 含非字符串导致 sort/compare 崩——用 null 混入
    const badNodes = [
      { id: 'a', depends_on: [null as unknown as string] },
    ] as unknown as NodeLike[];
    // null 在 byId.has 查不到 → 走悬空分支不崩；改用 getter 抛错强制触发 internal
    const explosive: NodeLike[] = new Proxy([{ id: 'x', depends_on: [] }], {
      get(target, prop) {
        if (prop === 'length') throw new Error('爆炸');
        return Reflect.get(target, prop);
      },
    }) as unknown as NodeLike[];
    void badNodes;
    const r = validateForActivation(explosive, []);
    expect(r.valid).toBe(false);
    expect(r.issues[0]!.kind).toBe('internal');
    expect(r.issues[0]!.detail).toContain('fail-closed');
  });
});
