// ============================================================
// acceptance.test.ts · define_acceptance / check_acceptance MCP tool 测试
// v1.3.6 交付⑨
// ============================================================
//
// 覆盖：
// - define_acceptance 参数校验（task_id / criteria 必填）
// - define → check 往返（schema 条件通过 / 失败）
// - check 未定义 task_id → notDefined=true
// - text 首行 [sofagent] 前缀（MCP tool 统一契约）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { defineAcceptance, checkAcceptance } from '../tools/acceptance';

let dataDir: string;
let projectRoot: string;
let savedSofagentData: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-mcp-acc-data-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'sofagent-mcp-acc-root-'));
  savedSofagentData = process.env.SOFAGENT_DATA;
  process.env.SOFAGENT_DATA = dataDir;
});

afterEach(() => {
  if (savedSofagentData === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = savedSofagentData;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('define_acceptance 参数校验', () => {
  it('缺 task_id → ok=false', async () => {
    const r = await defineAcceptance({ task_id: '', criteria: [{ type: 'test' }] });
    expect(r.data.ok).toBe(false);
    expect(r.data.isError).toBe(true);
    expect(r.text).toMatch(/^\[sofagent\]/);
  });

  it('空 criteria → ok=false', async () => {
    const r = await defineAcceptance({ task_id: 't1', criteria: [] });
    expect(r.data.ok).toBe(false);
    expect(r.data.isError).toBe(true);
  });

  it('合法 define → ok=true + criteriaCount 正确', async () => {
    const r = await defineAcceptance({
      task_id: 't-ok',
      criteria: [{ type: 'test' }, { type: 'schema', file: 'package.json', requiredFields: ['name'] }],
      notes: '测试定义',
    });
    expect(r.data.ok).toBe(true);
    expect(r.data.isError).toBe(false);
    expect(r.data.criteriaCount).toBe(2);
    expect(r.text).toMatch(/^\[sofagent\]/);
  });

  it('未知条件类型 → zod 校验失败 ok=false', async () => {
    const r = await defineAcceptance({ task_id: 't-bad', criteria: [{ type: 'nonexistent' }] });
    expect(r.data.ok).toBe(false);
    expect(r.data.isError).toBe(true);
  });
});

describe('define → check 往返', () => {
  it('schema 条件通过 → accepted=true', async () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
    await defineAcceptance({
      task_id: 'roundtrip-ok',
      criteria: [{ type: 'schema', file: 'package.json', requiredFields: ['name', 'version'] }],
    });
    const r = await checkAcceptance({ task_id: 'roundtrip-ok', project_root: projectRoot });
    expect(r.data.accepted).toBe(true);
    expect(r.data.ok).toBe(true);
    expect(r.data.isError).toBe(false);
    expect(r.data.results).toHaveLength(1);
    expect(r.text).toMatch(/验收通过/);
  });

  it('schema 条件失败 → accepted=false + isError=true', async () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'demo' })); // 缺 version
    await defineAcceptance({
      task_id: 'roundtrip-bad',
      criteria: [{ type: 'schema', file: 'package.json', requiredFields: ['name', 'version'] }],
    });
    const r = await checkAcceptance({ task_id: 'roundtrip-bad', project_root: projectRoot });
    expect(r.data.accepted).toBe(false);
    expect(r.data.isError).toBe(true);
    expect(r.data.failedCount).toBe(1);
    expect(r.text).toMatch(/验收未通过/);
  });

  it('未定义 task_id → notDefined=true', async () => {
    const r = await checkAcceptance({ task_id: 'never-defined', project_root: projectRoot });
    expect(r.data.notDefined).toBe(true);
    expect(r.data.accepted).toBe(false);
    expect(r.data.isError).toBe(true);
    expect(r.text).toMatch(/尚未定义/);
  });

  it('check 缺 task_id → ok=false', async () => {
    const r = await checkAcceptance({ task_id: '', project_root: projectRoot });
    expect(r.data.ok).toBe(false);
    expect(r.data.isError).toBe(true);
  });

  it('多条件聚合（test exit0 + schema 通过）→ accepted=true', async () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'x' }));
    await defineAcceptance({
      task_id: 'multi-ok',
      criteria: [
        { type: 'test', command: 'true' },
        { type: 'schema', file: 'package.json', requiredFields: ['name'] },
      ],
    });
    const r = await checkAcceptance({ task_id: 'multi-ok', project_root: projectRoot });
    expect(r.data.accepted).toBe(true);
    expect(r.data.failedCount).toBe(0);
    expect(r.data.results).toHaveLength(2);
  });
});
