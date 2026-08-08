// ============================================================
// golden-set.test.ts · golden set YAML 格式校验测试
// v1.2.9 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

const GOLDEN_SET_PATH = join(__dirname, '..', '..', 'data', 'golden-set.yaml');

describe('golden-set.yaml 格式校验', () => {
  it('文件存在', () => {
    expect(existsSync(GOLDEN_SET_PATH)).toBe(true);
  });

  it('sha256 校验文件存在', () => {
    expect(existsSync(GOLDEN_SET_PATH + '.sha256')).toBe(true);
  });

  it('解析为有效 YAML 数组', () => {
    const content = readFileSync(GOLDEN_SET_PATH, 'utf-8');
    const parsed = yamlLoad(content);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('每条用例有 id / input / expected', () => {
    const content = readFileSync(GOLDEN_SET_PATH, 'utf-8');
    const parsed = yamlLoad(content) as unknown[];
    expect(parsed.length).toBeGreaterThan(0);

    for (const item of parsed) {
      const tc = item as Record<string, unknown>;
      expect(tc['id']).toBeDefined();
      expect(typeof tc['id']).toBe('string');
      expect(tc['input']).toBeDefined();
      expect(typeof tc['input']).toBe('object');
      expect(tc['expected']).toBeDefined();
      expect(typeof tc['expected']).toBe('object');
    }
  });

  it('input 包含 diffFiles 数组', () => {
    const content = readFileSync(GOLDEN_SET_PATH, 'utf-8');
    const parsed = yamlLoad(content) as unknown[];

    for (const item of parsed) {
      const tc = item as Record<string, unknown>;
      const input = tc['input'] as Record<string, unknown>;
      expect(input['diffFiles']).toBeDefined();
      expect(Array.isArray(input['diffFiles'])).toBe(true);
    }
  });

  it('每个 DiffFile 有 path / status / lines', () => {
    const content = readFileSync(GOLDEN_SET_PATH, 'utf-8');
    const parsed = yamlLoad(content) as unknown[];

    for (const item of parsed) {
      const tc = item as Record<string, unknown>;
      const input = tc['input'] as Record<string, unknown>;
      const diffFiles = input['diffFiles'] as Record<string, unknown>[];

      for (const df of diffFiles) {
        expect(df['path']).toBeDefined();
        expect(typeof df['path']).toBe('string');
        expect(df['status']).toBeDefined();
        expect(typeof df['status']).toBe('string');
        expect(df['lines']).toBeDefined();
        expect(Array.isArray(df['lines'])).toBe(true);
      }
    }
  });

  it('expected 包含 result 字段', () => {
    const content = readFileSync(GOLDEN_SET_PATH, 'utf-8');
    const parsed = yamlLoad(content) as unknown[];

    for (const item of parsed) {
      const tc = item as Record<string, unknown>;
      const expected = tc['expected'] as Record<string, unknown>;
      expect(expected['result']).toBeDefined();
      expect(['PASS', 'WARN', 'FAIL']).toContain(expected['result']);
    }
  });

  it('fail 用例的 expected 包含非空 rules_triggered', () => {
    const content = readFileSync(GOLDEN_SET_PATH, 'utf-8');
    const parsed = yamlLoad(content) as unknown[];

    const failCases = parsed.filter((item) => {
      const tc = item as Record<string, unknown>;
      const tags = tc['tags'] as string[] | undefined;
      return tags?.includes('fail');
    });

    expect(failCases.length).toBeGreaterThan(0);

    for (const item of failCases) {
      const tc = item as Record<string, unknown>;
      const expected = tc['expected'] as Record<string, unknown>;
      expect(['FAIL', 'WARN']).toContain(expected['result']);
      const rules = expected['rules_triggered'] as string[];
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(0);
    }
  });
});
