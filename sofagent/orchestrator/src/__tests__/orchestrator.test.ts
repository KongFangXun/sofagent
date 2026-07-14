// ============================================================
// orchestrator.test.ts · 编排器测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadDefinition, listAgents, BUILTIN_AGENTS } from '../index';

describe('loadDefinition', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-orch-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('文件不存在时返回 null', () => {
    const def = loadDefinition('/nonexistent/agent.yml');
    expect(def).toBeNull();
  });

  it('有效 YAML 返回 SubAgentDefinition', () => {
    const ymlPath = path.join(tmpDir, 'agent.yml');
    fs.writeFileSync(ymlPath, 'name: test-agent\ndescription: A test agent\n');
    const def = loadDefinition(ymlPath);
    expect(def).not.toBeNull();
    expect(def!.name).toBe('test-agent');
    expect(def!.description).toBe('A test agent');
  });
});

describe('listAgents', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-orch-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('返回包含内置 Agent 的数组', () => {
    const agents = listAgents(tmpDir);
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });
});

describe('BUILTIN_AGENTS', () => {
  it('包含 fde 和 audit', () => {
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(names).toContain('fde');
    expect(names).toContain('audit');
  });

  it('所有内置 Agent 有 name 和 description', () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(agent.name).toBeTruthy();
      expect(agent.description).toBeTruthy();
    }
  });
});
