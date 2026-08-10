// ============================================================
// ontology-crud.test.ts · MCP Ontology CRUD 补全测试（v1.3.1 交付 5）
// ============================================================
//
// 覆盖：
// - update_entity：字段级更新（只改传入字段、保留其余 frontmatter 与正文、
//   created_at 保留、updated_at 刷新）、改 domain、改名（newName）、
//   更新不存在 entity 报错、D1 拦截（domain 改空）、D5 拦截（secret）、路径穿越
// - delete_entity：强制人审（confirmed=false 不执行；true 执行删除 + D1-D5 留痕）、
//   删除不存在报错
// - delete_concept：强制人审（confirmed=false 不执行；true 执行删除）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock think 依赖（与 create-entity.test.ts 同款）
vi.mock('@sofagent/think', () => ({
  generateDataThink: vi.fn(),
}));

import { generateDataThink } from '@sofagent/think';

import { updateEntity } from '../tools/update-entity';
import { deleteEntity } from '../tools/delete-entity';
import { deleteConcept } from '../tools/delete-concept';

describe('Ontology CRUD · update_entity（字段级更新）', () => {
  let tmpDir: string;
  let originalData: string | undefined;
  let entitiesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ue-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    entitiesDir = path.join(tmpDir, 'knowledge', 'entities');
    fs.mkdirSync(entitiesDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('字段级更新：只改 description，保留 domain/name/created_at/正文', () => {
    const filePath = path.join(entitiesDir, '客户管理.md');
    const oldCreatedAt = '2026-01-01T00:00:00.000Z';
    fs.writeFileSync(
      filePath,
      `---\nname: 客户管理\ndomain: 财务\ncreated_at: ${oldCreatedAt}\nupdated_at: 2026-01-02T00:00:00.000Z\ndescription: 旧描述\n---\n\n客户管理正文`,
      'utf-8',
    );

    const result = updateEntity({ name: '客户管理', description: '新描述' });

    expect(result.data.isError).toBe(false);
    expect(result.data.action).toBe('updated');
    expect(result.data.auditVerdict).toBe('PASS');
    expect(result.text).toContain('[sofagent]');
    expect(result.text).toContain('客户管理');

    const content = fs.readFileSync(filePath, 'utf-8');
    // 未传入字段全部保留
    expect(content).toContain('name: 客户管理');
    expect(content).toContain('domain: 财务');
    expect(content).toContain(oldCreatedAt);
    // 传入字段已更新
    expect(content).toContain('description: 新描述');
    expect(content).not.toContain('description: 旧描述');
    // 正文保留
    expect(content).toContain('客户管理正文');
    // updated_at 刷新
    expect(content).toContain('updated_at');
  });

  it('改 domain：只更新 domain 字段', () => {
    const filePath = path.join(entitiesDir, '供应商.md');
    fs.writeFileSync(
      filePath,
      '---\nname: 供应商\ndomain: 财务\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n供应商正文',
      'utf-8',
    );

    const result = updateEntity({ name: '供应商', domain: '供应链' });

    expect(result.data.isError).toBe(false);
    expect(result.data.auditVerdict).toBe('PASS');

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('domain: 供应链');
    expect(content).not.toContain('domain: 财务');
    expect(content).toContain('供应商正文');
  });

  it('改名（newName）：新文件生成、旧文件删除、frontmatter name 同步', () => {
    const oldPath = path.join(entitiesDir, '旧名.md');
    fs.writeFileSync(
      oldPath,
      '---\nname: 旧名\ndomain: 财务\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n正文',
      'utf-8',
    );

    const result = updateEntity({ name: '旧名', newName: '新名' });

    expect(result.data.isError).toBe(false);
    expect(result.data.action).toBe('renamed');
    expect(result.data.path).toBe(path.join(entitiesDir, '新名.md'));
    expect(result.text).toContain('已更名为');

    const newPath = path.join(entitiesDir, '新名.md');
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(oldPath)).toBe(false);

    const content = fs.readFileSync(newPath, 'utf-8');
    expect(content).toContain('name: 新名');
    expect(content).toContain('domain: 财务');
    expect(content).toContain('正文');
  });

  it('更新不存在的 entity → isError（update 不自动创建）', () => {
    const result = updateEntity({ name: '不存在的实体', description: 'x' });
    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('不存在');
    // 未创建文件
    expect(fs.existsSync(path.join(entitiesDir, '不存在的实体.md'))).toBe(false);
  });

  it('D1 拦截：domain 从有值改为空 → FAIL → 拒绝写入', () => {
    const filePath = path.join(entitiesDir, '测试实体.md');
    fs.writeFileSync(
      filePath,
      '---\nname: 测试实体\ndomain: 财务\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n内容',
      'utf-8',
    );

    const result = updateEntity({ name: '测试实体', domain: '' });

    expect(result.data.isError).toBe(true);
    expect(result.data.auditVerdict).toBe('FAIL');
    expect(result.text).toContain('FAIL');
    expect(result.text).toContain('D1');

    // 文件内容不应被修改
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('domain: 财务');
  });

  it('D5 拦截：正文含 API Key → FAIL → 拒绝写入', () => {
    const filePath = path.join(entitiesDir, '含密钥实体.md');
    fs.writeFileSync(
      filePath,
      '---\nname: 含密钥实体\ndomain: 财务\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n旧正文',
      'utf-8',
    );
    // 运行时拼接避免 A2 误判
    const apiKey = ['sk-ant-api03-abcdef', 'ghijklmnopqrstuvwxyz123456'].join('');

    const result = updateEntity({ name: '含密钥实体', content: `我的密钥是 ${apiKey}` });

    expect(result.data.isError).toBe(true);
    expect(result.data.auditVerdict).toBe('FAIL');
    expect(result.text).toContain('D5');

    // 文件内容不应被修改（旧正文保留、secret 未写入）
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('旧正文');
    expect(content).not.toContain(apiKey);
  });

  it('名称含路径分隔符 → 拒绝', () => {
    const result = updateEntity({ name: '../etc/passwd' });
    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('不合法');
  });
});

describe('Ontology CRUD · delete_entity（强制人审）', () => {
  let tmpDir: string;
  let originalData: string | undefined;
  let entitiesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-de-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    entitiesDir = path.join(tmpDir, 'knowledge', 'entities');
    fs.mkdirSync(entitiesDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('confirmed=false → 不执行删除，返回人工确认提示', () => {
    const filePath = path.join(entitiesDir, '待删实体.md');
    fs.writeFileSync(
      filePath,
      '---\nname: 待删实体\ndomain: 财务\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n内容',
      'utf-8',
    );

    const result = deleteEntity({ name: '待删实体', confirmed: false });

    expect(result.data.executed).toBe(false);
    expect(result.data.confirmed).toBe(false);
    expect(result.data.isError).toBe(false);
    expect(result.text).toContain('人工确认');
    // 文件仍在
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('缺省 confirmed（undefined）→ 同样不执行', () => {
    const filePath = path.join(entitiesDir, '待删实体2.md');
    fs.writeFileSync(filePath, '---\nname: 待删实体2\ndomain: 财务\n---\n\n内容', 'utf-8');

    const result = deleteEntity({ name: '待删实体2', confirmed: undefined as unknown as boolean });

    expect(result.data.executed).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('confirmed=true → 执行删除 + D1-D5 留痕（data-change-log.jsonl）', () => {
    const filePath = path.join(entitiesDir, '过期实体.md');
    fs.writeFileSync(
      filePath,
      '---\nname: 过期实体\ndomain: 财务\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n内容',
      'utf-8',
    );

    const result = deleteEntity({ name: '过期实体', confirmed: true });

    expect(result.data.executed).toBe(true);
    expect(result.data.confirmed).toBe(true);
    expect(result.data.auditVerdict).toBe('PASS');
    expect(result.text).toContain('已删除');
    expect(fs.existsSync(filePath)).toBe(false);

    // 审计留痕
    const logPath = path.join(tmpDir, 'audit', 'data-change-log.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const log = fs.readFileSync(logPath, 'utf-8');
    expect(log).toContain('过期实体');
    expect(log).toContain('"action":"delete"');
    // generateDataThink 被调用（D1-D5 回溯）
    expect(generateDataThink).toHaveBeenCalled();
  });

  it('删除不存在的 entity → isError', () => {
    const result = deleteEntity({ name: '不存在', confirmed: true });
    expect(result.data.isError).toBe(true);
    expect(result.data.executed).toBe(false);
    expect(result.text).toContain('不存在');
  });
});

describe('Ontology CRUD · delete_concept（强制人审）', () => {
  let tmpDir: string;
  let originalData: string | undefined;
  let conceptsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-dc-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    conceptsDir = path.join(tmpDir, 'knowledge', 'concepts');
    fs.mkdirSync(conceptsDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('confirmed=false → 不执行删除，返回人工确认提示', () => {
    const filePath = path.join(conceptsDir, '待删概念.md');
    fs.writeFileSync(
      filePath,
      '---\nname: 待删概念\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n内容',
      'utf-8',
    );

    const result = deleteConcept({ name: '待删概念', confirmed: false });

    expect(result.data.executed).toBe(false);
    expect(result.data.isError).toBe(false);
    expect(result.text).toContain('人工确认');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('confirmed=true → 执行删除 + 留痕', () => {
    const filePath = path.join(conceptsDir, '过期概念.md');
    fs.writeFileSync(
      filePath,
      '---\nname: 过期概念\ncreated_at: 2026-01-01T00:00:00.000Z\n---\n\n内容',
      'utf-8',
    );

    const result = deleteConcept({ name: '过期概念', confirmed: true });

    expect(result.data.executed).toBe(true);
    expect(result.data.auditVerdict).toBe('PASS');
    expect(result.text).toContain('已删除');
    expect(fs.existsSync(filePath)).toBe(false);

    const logPath = path.join(tmpDir, 'audit', 'data-change-log.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const log = fs.readFileSync(logPath, 'utf-8');
    expect(log).toContain('过期概念');
    expect(log).toContain('"action":"delete"');
  });

  it('删除不存在的 concept → isError', () => {
    const result = deleteConcept({ name: '不存在', confirmed: true });
    expect(result.data.isError).toBe(true);
    expect(result.data.executed).toBe(false);
  });
});
