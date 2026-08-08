// ============================================================
// migration.test.ts · ab-history 路径迁移测试
// v1.2.8 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateAbHistory, resolveAbHistoryPath } from '../migration';

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'sofagent-migration-test-'));
  // loadEnvConfig() 使用 SOFAGENT_DATA 环境变量解析 dataDir
  process.env.SOFAGENT_DATA = join(tempHome, 'data');
  mkdirSync(process.env.SOFAGENT_DATA, { recursive: true });
});

afterEach(() => {
  delete process.env.SOFAGENT_DATA;
  if (existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe('migrateAbHistory', () => {
  it('旧路径存在 → 迁移到新路径', () => {
    const dataDir = process.env.SOFAGENT_DATA!;
    const oldPath = join(dataDir, 'ab-history.jsonl');
    const newPath = join(dataDir, 'ab-test', 'scheduler-history.jsonl');

    // 创建旧文件
    writeFileSync(oldPath, '{"plan":"A","task":"test"}\n', 'utf-8');

    // 执行迁移
    const result = migrateAbHistory(oldPath, newPath);

    expect(result).toBe(true);
    expect(existsSync(newPath)).toBe(true);
    expect(existsSync(oldPath)).toBe(false);
  });

  it('新路径已存在 → 不迁移', () => {
    const dataDir = process.env.SOFAGENT_DATA!;
    mkdirSync(join(dataDir, 'ab-test'), { recursive: true });
    const oldPath = join(dataDir, 'ab-history.jsonl');
    const newPath = join(dataDir, 'ab-test', 'scheduler-history.jsonl');

    // 创建两个文件
    writeFileSync(oldPath, '{"old":true}\n', 'utf-8');
    writeFileSync(newPath, '{"new":true}\n', 'utf-8');

    const result = migrateAbHistory(oldPath, newPath);

    expect(result).toBe(false);
    // 新路径内容不变
    expect(existsSync(oldPath)).toBe(true);
    expect(existsSync(newPath)).toBe(true);
  });

  it('旧路径不存在 → 不报错，返回 false', () => {
    const dataDir = process.env.SOFAGENT_DATA!;
    const oldPath = join(dataDir, 'ab-history.jsonl');
    const newPath = join(dataDir, 'ab-test', 'scheduler-history.jsonl');

    // 两个文件都不存在
    const result = migrateAbHistory(oldPath, newPath);

    expect(result).toBe(false);
    expect(existsSync(newPath)).toBe(false);
  });
});

describe('resolveAbHistoryPath', () => {
  it('首次运行（无旧文件）→ 返回新路径', () => {
    const path = resolveAbHistoryPath();
    // 路径包含 ab-test/scheduler-history.jsonl
    expect(path).toContain('ab-test');
    expect(path).toContain('scheduler-history.jsonl');
  });

  it('有旧文件 → 自动迁移后返回新路径', () => {
    const dataDir = process.env.SOFAGENT_DATA!;
    const oldPath = join(dataDir, 'ab-history.jsonl');
    writeFileSync(oldPath, '{"plan":"A"}\n', 'utf-8');

    const path = resolveAbHistoryPath();
    expect(path).toContain('ab-test');
    expect(path).toContain('scheduler-history.jsonl');
    // 旧文件已被迁移
    expect(existsSync(oldPath)).toBe(false);
  });
});
