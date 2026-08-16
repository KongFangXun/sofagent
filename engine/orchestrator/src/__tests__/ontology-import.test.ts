// ============================================================
// ontology-import.test.ts · Ontology 标准注入管线单测（v1.3.6 交付 ②）
//
// 覆盖：
//   ① 合法注入（entity + concept + relations）→ 注册成功 + 双写（yml + md）
//   ② 非法注入 → 结构化错误 + 零写入（不污染 entity-store）
//   ③ D1-D5 审计留痕（decision-log emitDecision 被调用 + evidence 完整）
//   ④ D5 敏感信息拦截（FAIL 拒绝写入）
//   ⑤ 回滚：写入失败时已写文件还原
//   ⑥ DSH 映射契约（ONTOLOGY_IMPORT_DSH_MAPPING 形态冻结）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { load as yamlLoad } from 'js-yaml';
import {
  importOntology,
  validateOntologyPayload,
  RELATION_KEYS,
  ONTOLOGY_IMPORT_DSH_MAPPING,
  type OntologyImportPayload,
} from '../ontology/import-pipeline';

// 隔离数据目录（不碰真实 data/）
let dataDir: string;

// decision-log mock——记录 emitDecision 调用（审计留痕验证用）
let decisionCalls: Array<Record<string, unknown>> = [];
const mockEmitDecision = (input: Record<string, unknown>): void => {
  decisionCalls.push(input);
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-ontology-import-'));
  decisionCalls = [];
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('ontology 注入管线 · 合法路径', () => {
  it('注入 entity + concept + relation 全成功（双写 yml + md）', () => {
    const payload: OntologyImportPayload = {
      entities: [
        { name: 'customer', domain: 'sales', description: '客户实体' },
        { name: 'order', domain: 'sales', description: '订单实体' },
      ],
      concepts: [{ name: 'gmv', description: '成交总额' }],
      relations: [{ source: 'order', target: 'customer', relation: 'belongs_to' }],
    };
    const result = importOntology(payload, { dataDir, emitDecision: mockEmitDecision });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.imported).toEqual({ entities: 2, concepts: 1, relations: 1 });

    // entity-store YML 注册（order 的 relations 含合并后的 belongs_to）
    const orderYml = yamlLoad(readFileSync(join(dataDir, 'ontology', 'entities', 'order.yml'), 'utf-8')) as Record<string, unknown>;
    expect(orderYml['name']).toBe('order');
    expect(Array.isArray(orderYml['relations'])).toBe(true);
    expect((orderYml['relations'] as Array<Record<string, unknown>>)[0]).toMatchObject({ target: 'customer', relation: 'belongs_to' });

    // knowledge md 页（read_entity MCP tool 消费面）
    const customerMd = readFileSync(join(dataDir, 'knowledge', 'entities', 'customer.md'), 'utf-8');
    expect(customerMd).toContain('name: customer');
    expect(customerMd).toContain('domain: sales');
    expect(customerMd).toContain('客户实体');

    const conceptMd = readFileSync(join(dataDir, 'knowledge', 'concepts', 'gmv.md'), 'utf-8');
    expect(conceptMd).toContain('name: gmv');

    // written 清单完整（2 entity × 双写 + 1 concept = 5）
    expect(result.written.length).toBe(5);
  });

  it('重复注入同名 entity = 更新（覆盖写，不报错）', () => {
    const base: OntologyImportPayload = { entities: [{ name: 'customer', domain: 'sales' }] };
    expect(importOntology(base, { dataDir, emitDecision: mockEmitDecision }).ok).toBe(true);

    const update: OntologyImportPayload = { entities: [{ name: 'customer', domain: 'crm', description: '改域' }] };
    const result = importOntology(update, { dataDir, emitDecision: mockEmitDecision });
    expect(result.ok).toBe(true);

    const md = readFileSync(join(dataDir, 'knowledge', 'entities', 'customer.md'), 'utf-8');
    expect(md).toContain('domain: crm');
  });

  it('created_at/updated_at 缺省自动补齐', () => {
    const result = importOntology(
      { entities: [{ name: 'customer', domain: 'sales' }] },
      { dataDir, emitDecision: mockEmitDecision },
    );
    expect(result.ok).toBe(true);
    const md = readFileSync(join(dataDir, 'knowledge', 'entities', 'customer.md'), 'utf-8');
    expect(md).toMatch(/created_at:/);
    expect(md).toMatch(/updated_at:/);
  });
});

describe('ontology 注入管线 · 非法路径（零写入）', () => {
  it('entity 缺 domain → 结构化错误且不写任何文件', () => {
    const payload: OntologyImportPayload = { entities: [{ name: 'customer' } as never] };
    const result = importOntology(payload, { dataDir, emitDecision: mockEmitDecision });

    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.includes('domain'))).toBe(true);
    expect(result.written).toEqual([]);
    expect(existsSync(join(dataDir, 'ontology', 'entities', 'customer.yml'))).toBe(false);
    expect(existsSync(join(dataDir, 'knowledge', 'entities', 'customer.md'))).toBe(false);
  });

  it('名称含路径分隔符 → 拒绝（防路径穿越）', () => {
    const payload: OntologyImportPayload = { entities: [{ name: '../evil', domain: 'x' }] };
    const result = importOntology(payload, { dataDir, emitDecision: mockEmitDecision });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes('路径分隔符'))).toBe(true);
    expect(result.written).toEqual([]);
  });

  it('payload 内重名 entity → 拒绝', () => {
    const payload: OntologyImportPayload = {
      entities: [
        { name: 'dup', domain: 'a' },
        { name: 'dup', domain: 'b' },
      ],
    };
    const result = importOntology(payload, { dataDir, emitDecision: mockEmitDecision });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes('重复'))).toBe(true);
  });

  it('非法 relation 键 → 拒绝', () => {
    const payload: OntologyImportPayload = {
      entities: [
        { name: 'a', domain: 'x' },
        { name: 'b', domain: 'x' },
      ],
      relations: [{ source: 'a', target: 'b', relation: 'likes' as never }],
    };
    const result = importOntology(payload, { dataDir, emitDecision: mockEmitDecision });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes('relation'))).toBe(true);
    // 全量校验先行——entity 也不写入
    expect(result.written).toEqual([]);
  });

  it('validateOntologyPayload 空 payload → 通过（无内容可注入）', () => {
    expect(validateOntologyPayload({}).valid).toBe(true);
    expect(validateOntologyPayload(null as never).valid).toBe(false);
  });
});

describe('ontology 注入管线 · D1-D5 审计留痕', () => {
  it('合法注入 → emitDecision 被调用（KNOWLEDGE_DISTILL + evidence 三件）', () => {
    const payload: OntologyImportPayload = {
      entities: [{ name: 'customer', domain: 'sales' }],
      concepts: [{ name: 'gmv' }],
      relations: [],
    };
    const result = importOntology(payload, {
      dataDir,
      agentId: 'model-layer-test',
      comment: '测试注入',
      emitDecision: mockEmitDecision,
    });

    expect(result.ok).toBe(true);
    expect(result.decisionLogged).toBe(true);
    expect(decisionCalls.length).toBe(1);
    const call = decisionCalls[0];
    expect(call['agentId']).toBe('model-layer-test');
    expect(call['kind']).toBe('KNOWLEDGE_DISTILL');
    expect(call['moment']).toBe('ACT');
    expect(String(call['why'])).toContain('1 entity');
    expect(String(call['why'])).toContain('测试注入');
    expect(Array.isArray(call['evidence'])).toBe(true);
    expect((call['evidence'] as string[]).length).toBe(3);
  });

  it('emitDecision 抛错 → 注入仍成功（留痕降级不阻塞）', () => {
    const throwingEmit = (): void => {
      throw new Error('decision-log 不可写');
    };
    const result = importOntology(
      { entities: [{ name: 'customer', domain: 'sales' }] },
      { dataDir, emitDecision: throwingEmit },
    );
    expect(result.ok).toBe(true);
    expect(result.decisionLogged).toBe(false);
  });

  it('D5 敏感信息拦截（secret-like 串 → FAIL 零写入）', () => {
    const payload: OntologyImportPayload = {
      entities: [
        // 运行时拼接避免源码出现敏感串被全局脱敏误伤（测试纪律 2）
        { name: 'leaky', domain: 'x', description: `key ${'sk-' + 'a'.repeat(24)}` },
      ],
    };
    const result = importOntology(payload, { dataDir, emitDecision: mockEmitDecision });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes('D5') || i.includes('敏感'))).toBe(true);
    expect(result.written).toEqual([]);
    expect(decisionCalls.length).toBe(0);
  });
});

describe('ontology 注入管线 · 回滚', () => {
  it('第二个 entity 写入失败 → 第一个 entity 的文件被还原', () => {
    // 构造失败：把 knowledge/entities 变成文件（mkdir 写 md 时抛 ENOTDIR）——
    // 第一个 entity 写 store yml 成功、md 写入即失败 → 触发回滚
    const entitiesDir = join(dataDir, 'knowledge', 'entities');
    mkdirSync(join(dataDir, 'knowledge'), { recursive: true });
    writeFileSync(entitiesDir, '占位文件（让 md 写入失败）', 'utf-8');

    const payload: OntologyImportPayload = {
      entities: [{ name: 'first', domain: 'a' }, { name: 'second', domain: 'b' }],
    };
    const result = importOntology(payload, { dataDir, emitDecision: mockEmitDecision });

    expect(result.ok).toBe(false);
    expect(result.rollbackNote).toBeTruthy();
    expect(result.written).toEqual([]);
    // 回滚验证：first 的 yml（已写入）被删除还原
    expect(existsSync(join(dataDir, 'ontology', 'entities', 'first.yml'))).toBe(false);
  });
});

describe('ontology 注入管线 · DSH 映射契约', () => {
  it('ONTOLOGY_IMPORT_DSH_MAPPING 形态冻结（v1.4.0 plugin 消费面）', () => {
    expect(ONTOLOGY_IMPORT_DSH_MAPPING.length).toBeGreaterThanOrEqual(4);
    for (const m of ONTOLOGY_IMPORT_DSH_MAPPING) {
      expect(typeof m.importField).toBe('string');
      expect(typeof m.cordisSurface).toBe('string');
      expect(typeof m.note).toBe('string');
    }
    // 四个消费面齐全（entity/concept/relation 参数组 + 校验回报）
    const surfaces = ONTOLOGY_IMPORT_DSH_MAPPING.map((m) => m.importField).join(' ');
    expect(surfaces).toContain('entities');
    expect(surfaces).toContain('concepts');
    expect(surfaces).toContain('relations');
  });

  it('RELATION_KEYS 五键冻结（简化形态合法键）', () => {
    expect([...RELATION_KEYS].sort()).toEqual(
      ['belongs_to', 'consumes', 'depends_on', 'has_many', 'produces'].sort(),
    );
  });
});
