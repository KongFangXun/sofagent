// ============================================================
// create-entity.test.ts · MCP create_entity tool 测试（v1.2.4 S2/S4 新增）
// ============================================================
//
// 覆盖：
// - 创建新 entity（成功）
// - 更新已有 entity（保留 created_at）
// - D1 拦截（domain 从有值改为空 → FAIL → 拒绝写入）
// - D5 拦截（内容含 secret → FAIL → 拒绝写入）
// - 返回值首行含 [sofagent] 前缀
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock think 依赖
vi.mock('@sofagent/think', () => ({
  generateDataThink: vi.fn(),
}));

import { createEntity } from '../tools/create-entity';

describe('create_entity', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ce-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('创建新 entity 成功', () => {
    const result = createEntity({
      name: '客户管理',
      domain: '财务',
      content: '---\nname: 客户管理\ndomain: 财务\n---\n\n客户管理实体',
    });

    expect(result.data.action).toBe('created');
    expect(result.data.isError).toBe(false);
    expect(result.text).toContain('[sofagent]');
    expect(result.text).toContain('客户管理');
    expect(result.data.auditVerdict).toBe('PASS');

    // 文件已创建
    const filePath = path.join(tmpDir, 'knowledge', 'entities', '客户管理.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('created_at');
    expect(content).toContain('updated_at');
  });

  it('更新已有 entity 时保留 created_at', () => {
    const entitiesDir = path.join(tmpDir, 'knowledge', 'entities');
    fs.mkdirSync(entitiesDir, { recursive: true });
    const filePath = path.join(entitiesDir, '已有实体.md');
    const oldCreatedAt = '2026-01-01T00:00:00.000Z';
    fs.writeFileSync(filePath, `---\nname: 已有实体\ndomain: 财务\ncreated_at: ${oldCreatedAt}\n---\n\n旧内容`, 'utf-8');

    const result = createEntity({
      name: '已有实体',
      domain: '财务',
      content: '---\nname: 已有实体\ndomain: 财务\n---\n\n新内容',
    });

    expect(result.data.action).toBe('updated');
    expect(result.data.isError).toBe(false);

    const content = fs.readFileSync(filePath, 'utf-8');
    // created_at 应保留原值
    expect(content).toContain(oldCreatedAt);
    // updated_at 应被更新
    expect(content).toContain('updated_at');
  });

  it('D1 拦截：domain 从有值改为空 → FAIL → 拒绝写入', () => {
    const entitiesDir = path.join(tmpDir, 'knowledge', 'entities');
    fs.mkdirSync(entitiesDir, { recursive: true });
    const filePath = path.join(entitiesDir, '测试实体.md');
    const oldCreatedAt = '2026-01-01T00:00:00.000Z';
    fs.writeFileSync(filePath, `---\nname: 测试实体\ndomain: 财务\ncreated_at: ${oldCreatedAt}\n---\n\n内容`, 'utf-8');

    // 尝试将 domain 改为空
    const result = createEntity({
      name: '测试实体',
      domain: '',
      content: '---\nname: 测试实体\ndomain: ""\n---\n\n新内容',
    });

    expect(result.data.isError).toBe(true);
    expect(result.data.auditVerdict).toBe('FAIL');
    expect(result.text).toContain('FAIL');
    expect(result.text).toContain('D1');

    // 文件内容不应被修改
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('domain: 财务');
    expect(content).not.toContain('新内容');
  });

  it('D5 拦截：内容含 API Key → FAIL → 拒绝写入', () => {
    // 运行时拼接避免 A2 误判
    const apiKey = ['sk-ant-api03-abcdef', 'ghijklmnopqrstuvwxyz123456'].join('');
    const result = createEntity({
      name: '含密钥实体',
      domain: '财务',
      content: `---\nname: 含密钥实体\ndomain: 财务\n---\n\n我的密钥是 ${apiKey}`,
    });

    expect(result.data.isError).toBe(true);
    expect(result.data.auditVerdict).toBe('FAIL');
    expect(result.text).toContain('D5');

    // 文件不应被创建
    const filePath = path.join(tmpDir, 'knowledge', 'entities', '含密钥实体.md');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('名称含路径分隔符 → 拒绝', () => {
    const result = createEntity({
      name: '../etc/passwd',
      domain: '财务',
      content: '---\nname: test\n---\n\ncontent',
    });

    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('不合法');
  });
});
