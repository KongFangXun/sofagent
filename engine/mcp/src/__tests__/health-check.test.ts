// ============================================================
// health-check.test.ts · MCP health_check tool 测试（v1.2.9 S2 新增）
// ============================================================
//
// 覆盖：
// - doctor 模式基础调用
// - verify 模式基础调用
// - 返回值含结构化 checks 数组
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock think 依赖
vi.mock('@sofagent/think', () => ({
  generateDataThink: vi.fn(),
}));

import { healthCheck } from '../tools/health-check';

describe('health_check', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-hc-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('doctor 模式：返回结构化检查结果', () => {
    const result = healthCheck({ mode: 'doctor' });

    expect(result.text).toContain('[sofagent]');
    expect(result.data.mode).toBe('doctor');
    expect(result.data.checks).toBeDefined();
    expect(Array.isArray(result.data.checks)).toBe(true);
    expect(result.data.checks.length).toBeGreaterThan(0);

    // 应包含环境检查
    const envCheck = result.data.checks.find((c) => c.name === '环境检查');
    expect(envCheck).toBeDefined();
  });

  it('verify 模式：返回结构化检查结果', () => {
    const result = healthCheck({ mode: 'verify', platform: 'workbuddy' });

    expect(result.text).toContain('[sofagent]');
    expect(result.data.mode).toBe('verify');
    expect(result.data.checks).toBeDefined();
  });

  it('默认 mode 为 doctor', () => {
    const result = healthCheck({});
    expect(result.data.mode).toBe('doctor');
  });
});
