// ============================================================
// okf-consumption.test.ts · OKF ①②③ 消费侧测试（mcp 包）
// v1.3.7 交付⑥ 新增——create_entity/create_concept type 必填 +
//   search/read 信任时效消费 + index 链接化
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createEntity } from '../tools/create-entity';
import { createConcept } from '../tools/create-concept';
import { parseOkfFields, refreshKnowledgeIndex } from '../tools/knowledge-tools';

let dir: string;
let dataDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sofagent-okf-mcp-'));
  dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  process.env.SOFAGENT_DATA = dataDir;
});

afterEach(() => {
  delete process.env.SOFAGENT_DATA;
  rmSync(dir, { recursive: true, force: true });
});

describe('OKF ①：type 必填校验（写入强制）', () => {
  it('create_entity 缺 type → 拒绝写入 + 结构化错误（okfViolation）', () => {
    const r = createEntity({ name: 'no-type', domain: 'test', content: '---\nname: no-type\n---\n无 type 字段' });
    expect(r.data.isError).toBe(true);
    expect(r.data.auditVerdict).toBe('FAIL');
    expect((r.data as unknown as { okfViolation?: string }).okfViolation).toBe('missing-required-field:type');
    // 未写入
    expect(existsSync(join(dataDir, 'knowledge', 'entities', 'no-type.md'))).toBe(false);
  });

  it('create_entity 带 type → 正常通过写入', () => {
    const r = createEntity({ name: 'typed', domain: 'test', content: '---\ntype: agent\nname: typed\n---\n有 type 字段' });
    expect(r.data.isError).toBe(false);
    expect(existsSync(join(dataDir, 'knowledge', 'entities', 'typed.md'))).toBe(true);
  });

  it('create_entity type 空串 → 同样拒绝', () => {
    const r = createEntity({ name: 'empty-type', domain: 'test', content: '---\ntype: ""\nname: empty-type\n---\n空 type' });
    expect(r.data.isError).toBe(true);
  });

  it('create_concept 缺 type → 拒绝写入 + 结构化错误', () => {
    const r = createConcept({ name: 'no-type-c', content: '---\nname: no-type-c\n---\n无 type' });
    expect(r.data.isError).toBe(true);
    expect((r.data as unknown as { okfViolation?: string }).okfViolation).toBe('missing-required-field:type');
  });

  it('create_concept 带 type → 正常通过', () => {
    const r = createConcept({ name: 'typed-c', content: '---\ntype: concept\nname: typed-c\n---\n概念' });
    expect(r.data.isError).toBe(false);
  });

  it('存量条目读取容忍缺 type（OKF 宽容性——读取侧不拒绝消费）', () => {
    expect(() => parseOkfFields('---\nname: legacy\n---\n老条目无 type')).not.toThrow();
    expect(parseOkfFields('---\nname: legacy\n---\n老').stale).toBe(false);
  });
});

describe('OKF ②：status/stale_after/verified 消费', () => {
  it('过期判定：stale_after 早于今天 → stale=true（字段名是 stale_after 非 valid_after）', () => {
    expect(parseOkfFields('---\ntype: agent\nstale_after: 2020-01-01\n---\n旧').stale).toBe(true);
    expect(parseOkfFields('---\ntype: agent\nstale_after: 2099-01-01\n---\n新').stale).toBe(false);
  });

  it('无 stale_after → 永不过期', () => {
    expect(parseOkfFields('---\ntype: agent\n---\n').stale).toBe(false);
  });

  it('信任分层推导：human > process > unverified', () => {
    const human = parseOkfFields('---\ntype: agent\nverified:\n  - by: "human:k"\n    at: "2026-01-01"\n---\n');
    const process = parseOkfFields('---\ntype: agent\nverified:\n  - by: "process:auto"\n    at: "2026-01-01"\n---\n');
    const agent = parseOkfFields('---\ntype: agent\nverified:\n  - by: "agent:v1"\n    at: "2026-01-01"\n---\n');
    const none = parseOkfFields('---\ntype: agent\n---\n');
    expect(human.trustTier).toBe('human-verified');
    expect(process.trustTier).toBe('process-verified');
    expect(agent.trustTier).toBe('process-verified'); // agent: 归机审层
    expect(none.trustTier).toBeUndefined(); // unverified
  });

  it('status 解析（draft/stable/deprecated）', () => {
    expect(parseOkfFields('---\ntype: agent\nstatus: deprecated\n---\n').status).toBe('deprecated');
  });
});

describe('OKF ③：index.md 链接化（渐进披露）', () => {
  function setupKb(): string {
    const kb = join(dataDir, 'knowledge');
    mkdirSync(join(kb, 'entities'), { recursive: true });
    mkdirSync(join(kb, 'concepts'), { recursive: true });
    return kb;
  }

  it('生成含相对链接的目录表——agent 先读目录再定位正文', () => {
    const kb = setupKb();
    writeFileSync(join(kb, 'entities', 'e1.md'), '---\ntype: agent\nname: e1\n---\n实体一');
    writeFileSync(join(kb, 'concepts', 'c1.md'), '---\ntype: concept\nname: c1\n---\n概念一');
    const indexPath = refreshKnowledgeIndex(kb);
    expect(indexPath).toBe(join(kb, 'index.md'));
    const idx = readFileSync(indexPath!, 'utf-8');
    expect(idx).toContain('[e1](./entities/e1.md)');
    expect(idx).toContain('[c1](./concepts/c1.md)');
    expect(idx).toContain('渐进披露');
    // 链接目标真实存在（渐进披露的物理基础）
    expect(existsSync(join(kb, 'entities', 'e1.md'))).toBe(true);
    expect(existsSync(join(kb, 'concepts', 'c1.md'))).toBe(true);
  });

  it('过期与信任分层在 index 标注', () => {
    const kb = setupKb();
    writeFileSync(join(kb, 'entities', 'stale-e.md'), '---\ntype: agent\nname: stale-e\nstale_after: 2020-01-01\nverified:\n  - by: "human:admin"\n    at: "2019-01-01"\n---\n过期实体');
    refreshKnowledgeIndex(kb);
    const idx = readFileSync(join(kb, 'index.md'), 'utf-8');
    expect(idx).toContain('过期');
    expect(idx).toContain('human-verified');
  });

  it('unverified 条目标注 unverified（信任可见）', () => {
    const kb = setupKb();
    writeFileSync(join(kb, 'entities', 'noob.md'), '---\ntype: agent\nname: noob\n---\n未验证');
    refreshKnowledgeIndex(kb);
    const idx = readFileSync(join(kb, 'index.md'), 'utf-8');
    expect(idx).toContain('unverified');
  });

  it('空知识库返回 null（不生成空 index）', () => {
    const kb = setupKb();
    expect(refreshKnowledgeIndex(kb)).toBeNull();
  });
});
