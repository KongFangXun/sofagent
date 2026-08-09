// ============================================================
// memory-backend.test.ts · 外部记忆后端测试（v1.3.0 交付 10 MA1/MA3/MA6）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { randomBytes } from 'crypto';
import {
  mapSensitivityToACL,
  proxyMemoryToolCall,
  proxyWorkBuddyCall,
  registerMemoryBackends,
  registerDynamicTool,
  getDynamicTools,
  getDynamicTool,
  clearDynamicTools,
} from '../tools/memory-backend';
import type { MemoryBackend } from '@sofagent/core';

function makeBackend(overrides: Partial<MemoryBackend> = {}): MemoryBackend {
  return {
    name: 'tencentdb-test',
    enabled: true,
    type: 'mcp',
    endpoint: 'http://127.0.0.1:8125',
    tools: ['memory_search', 'memory_write'],
    ...overrides,
  };
}

describe('memory-backend (MA1/MA3/MA6)', () => {
  beforeEach(() => { clearDynamicTools(); });
  afterEach(() => { clearDynamicTools(); });

  // ── MA3: mapSensitivityToACL ──
  it('MA3: restricted → restricted；internal → team；public → public', () => {
    const backend = makeBackend({
      sensitivity_map: { private: 'restricted', team: 'internal', restricted: 'restricted', agent: 'internal' },
    });
    expect(mapSensitivityToACL('restricted', backend)).toBe('restricted');
    expect(mapSensitivityToACL('internal', backend)).toBe('internal');
    expect(mapSensitivityToACL('public', backend)).toBe('public');
  });

  it('MA3: 无 sensitivity_map 时走缺省', () => {
    const backend = makeBackend();
    expect(mapSensitivityToACL('restricted', backend)).toBe('restricted');
    expect(mapSensitivityToACL('internal', backend)).toBe('team');
  });

  // ── MA1: registerMemoryBackends 缺省关闭 ──
  it('MA1: enabled=false 不注册任何工具', async () => {
    const cfg = { memory_backends: [makeBackend({ enabled: false })] } as never;
    const registered = await registerMemoryBackends(cfg);
    expect(registered).toEqual([]);
    expect(getDynamicTools()).toEqual([]);
  });

  it('MA1: 无 memory_backends 段不加载', async () => {
    const cfg = {} as never;
    const registered = await registerMemoryBackends(cfg);
    expect(registered).toEqual([]);
  });

  it('MA1: endpoint 不可达 warn + skip 不 crash', async () => {
    // 127.0.0.1:1 必然不可达（无服务监听）
    const cfg = { memory_backends: [makeBackend({ endpoint: 'http://127.0.0.1:1' })] } as never;
    const registered = await registerMemoryBackends(cfg);
    expect(registered).toEqual([]);
    expect(getDynamicTools()).toEqual([]);
  });

  // ── MA6: workbuddy 降级 ──
  it('MA6: workbuddy memory_write 写 .workbuddy/memory/ 文件', async () => {
    const wb: MemoryBackend = {
      name: 'workbuddy-memory',
      enabled: true,
      type: 'workbuddy',
      tools: ['memory_write', 'conversation_search'],
    };
    const r = await proxyMemoryToolCall('memory_write', { content: '测试记忆' }, wb, 'internal');
    expect(r).toHaveProperty('ok', true);
    const r2 = r as { data: { file: string } };
    expect(r2.data.file).toContain('.workbuddy');
    expect(existsSync(r2.data.file)).toBe(true);
    const content = readFileSync(r2.data.file, 'utf-8');
    expect(content).toContain('测试记忆');
    // 清理
    try { rmSync(join(homedir(), '.workbuddy', 'memory'), { recursive: true, force: true }); } catch { /* */ }
  });

  it('MA6: conversation_search 标注待 v1.3.1（不 crash）', async () => {
    const wb: MemoryBackend = {
      name: 'workbuddy-memory',
      enabled: true,
      type: 'workbuddy',
      tools: ['conversation_search'],
    };
    const r = await proxyMemoryToolCall('conversation_search', {}, wb, 'internal');
    expect(r).toHaveProperty('ok', false);
    expect(JSON.stringify(r)).toContain('v1.3.1');
  });

  it('MA6: workbuddy 后端经 registerMemoryBackends 注册动态工具', async () => {
    const cfg = {
      memory_backends: [{
        name: 'workbuddy-memory',
        enabled: true,
        type: 'workbuddy',
        tools: ['memory_write'],
      }],
    } as never;
    const registered = await registerMemoryBackends(cfg);
    expect(registered).toEqual(['memory_write']);
    expect(getDynamicTool('memory_write')).toBeDefined();
  });

  // ── MA3: proxyMemoryToolCall endpoint 不可达降级 ──
  it('MA3: proxyMemoryToolCall endpoint 不可达返回错误标记不 crash', async () => {
    const backend = makeBackend({ endpoint: 'http://127.0.0.1:1' });
    const r = await proxyMemoryToolCall('memory_search', { query: 'x' }, backend, 'internal');
    expect(r).toHaveProperty('ok', false);
    expect(JSON.stringify(r)).toContain('降级');
  });

  it('MA1: registerDynamicTool 幂等 + getDynamicTools/getDynamicTool', () => {
    registerDynamicTool({
      name: 'memory_search',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ ok: true }),
    });
    registerDynamicTool({
      name: 'memory_search',
      description: 'd2',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ ok: true }),
    });
    expect(getDynamicTools().length).toBe(1);
    expect(getDynamicTool('memory_search')).toBeDefined();
    expect(getDynamicTool('nonexistent')).toBeUndefined();
  });
});
