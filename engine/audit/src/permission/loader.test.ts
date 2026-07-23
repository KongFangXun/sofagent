// ============================================================
// permission/loader.test.ts · 权限合并测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadPermission } from './loader';

describe('loadPermission', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-perm-test-'));
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('两个文件都不存在 → 返回空规则集', () => {
    const result = loadPermission(tmpDir);
    expect(result.merged).toHaveLength(0);
  });

  it('只有 global → 用 global 规则', () => {
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'permission.json'), JSON.stringify({
      rules: [{ name: 'test-rule', effect: 'deny' as const, pattern: '*.env' }],
    }));
    const result = loadPermission(tmpDir);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].name).toBe('test-rule');
  });

  it('local 覆盖同名 global 规则', () => {
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'permission.json'), JSON.stringify({
      rules: [{ name: 'api-key', effect: 'deny' as const, pattern: '*.env' }],
    }));
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'permission.local.json'), JSON.stringify({
      rules: [{ name: 'api-key', effect: 'allow' as const, pattern: '*.env' }],
    }));
    const result = loadPermission(tmpDir);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].effect).toBe('allow');  // local 覆盖
    expect(result.sources['api-key']).toBe('local');
  });

  it('local 新增规则追加', () => {
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'permission.json'), JSON.stringify({
      rules: [{ name: 'rule1', effect: 'deny' as const, pattern: '*.env' }],
    }));
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'permission.local.json'), JSON.stringify({
      rules: [{ name: 'rule2', effect: 'deny' as const, pattern: '*.json' }],
    }));
    const result = loadPermission(tmpDir);
    expect(result.merged).toHaveLength(2);
  });
});
