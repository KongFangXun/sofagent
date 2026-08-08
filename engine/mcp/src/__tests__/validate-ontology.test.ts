// ============================================================
// validate-ontology.test.ts · MCP validate_ontology tool 测试（v1.2.8 S2 新增）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock think 依赖（防止 generateDataThink 被触发时报错）
vi.mock('@sofagent/think', () => ({
  generateDataThink: vi.fn(),
}));

import { validateOntology } from '../tools/validate-ontology';

describe('validate_ontology', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-vo-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('空知识库 → exists=false, objectCount=0', () => {
    const result = validateOntology({});
    expect(result.text).toContain('[sofagent]');
    expect(result.data.exists).toBe(false);
    expect(result.data.objectCount).toBe(0);
  });

  it('返回值含 [sofagent] 前缀', () => {
    const result = validateOntology({});
    expect(result.text.startsWith('[sofagent]')).toBe(true);
  });

  it('返回值含 objectCount / actionCount / constraintCount 字段', () => {
    const result = validateOntology({});
    expect(result.data).toHaveProperty('objectCount');
    expect(result.data).toHaveProperty('actionCount');
    expect(result.data).toHaveProperty('constraintCount');
    expect(result.data).toHaveProperty('fresh');
  });

  it('fix 参数可传入且不报错', () => {
    const result = validateOntology({ fix: true });
    expect(result.text).toContain('[sofagent]');
  });
});
