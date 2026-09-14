// ============================================================
// model-inventory.test.ts · T10 第三项：模型清单扫描 + 心跳上报单测
// ============================================================
//
// 覆盖面（验收「上报字段进注册表/心跳事件流、可查询」+ 铁律 8 故障注入）：
//   1. scanRegistryModels：注册表正常扫描（retired 剔除）/ 注册表缺失
//      → 空清单 + 降级原因（观测面不抛错）/ 注册表损坏 → 同上
//   2. probeEndpoint：正常响应收录 / 非 2xx → 降级 / 结构不符 → 降级 /
//      网络异常（fetch 抛错）→ 降级 / name 非法条目跳过
//   3. scanModelInventory：registry + probed 合并去重（registry 优先）/
//      全来源失败 → 两类降级原因并存、清单为空
//   4. reportHeartbeat 携带 availableModels / runtimeSkillPackages：
//      上报后进注册表（listDevices 可查）/ 未带字段保留原值 /
//      显式 null 清空 / 注册时初值 null
//   5. 事件流摘要：心跳事件 summary 带 models=N skills=N 计数（回放可查）
//
// 测试隔离：mkdtemp 临时 dataDir + SOFAGENT_KEY_PATH 临时密钥（与
// device-registry.test.ts 同款纪律，不触碰真实 ~/.sofagent-key）。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateAgentIdentity } from '@sofagent/core';
import {
  scanRegistryModels,
  probeEndpoint,
  scanModelInventory,
  DEFAULT_PROBE_ENDPOINTS,
} from '../model-inventory';
import {
  registerDevice,
  reportHeartbeat,
  listDevices,
  deviceEventsPath,
  deviceRegistryPath,
} from '../device-registry';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-model-inv-'));
  tmpDirs.push(dir);
  return dir;
}

/** 写一个最小合法 model-registry.json（loadRegistry schema：version=1 + models + active + events） */
function writeRegistry(dataDir: string, models: Record<string, unknown>): void {
  const configDir = path.join(dataDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'model-registry.json'),
    JSON.stringify({ version: 1, models, active: {}, events: [] }, null, 2),
    'utf-8',
  );
}

function entry(name: string, status: 'registered' | 'active' | 'retired'): Record<string, unknown> {
  return {
    name,
    endpoint: 'http://localhost:8000/v1',
    clientType: 'openai-compatible',
    model: name,
    source: 'endpoint',
    status,
    registeredAt: '2026-09-14T00:00:00.000Z',
    ...(status === 'retired' ? { retiredAt: '2026-09-14T01:00:00.000Z' } : {}),
  };
}

describe('T10 第三项 · 模型清单扫描（model-inventory）', () => {
  beforeAll(() => {
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-key-inv-'));
    tmpDirs.push(keyDir);
    const keyPath = path.join(keyDir, '.sofagent-key');
    fs.writeFileSync(keyPath, 'test-hmac-key-inventory-abcdef', 'utf-8');
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  // ── 1. 注册表扫描 ──
  describe('scanRegistryModels', () => {
    it('注册表正常 → 收录非 retired 条目（五字段）', () => {
      const dataDir = mkDataDir();
      writeRegistry(dataDir, {
        'm-executor': entry('m-executor', 'active'),
        'm-canary': entry('m-canary', 'canary'),
        'm-old': entry('m-old', 'retired'),
      });
      const inv = scanRegistryModels(dataDir);
      expect(inv.degradedReasons).toEqual([]);
      expect(inv.availableModels).toHaveLength(2);
      const names = inv.availableModels.map((m) => m.name);
      expect(names).toContain('m-executor');
      expect(names).toContain('m-canary');
      expect(names).not.toContain('m-old'); // retired 不进可用清单
      const first = inv.availableModels[0]!;
      expect(first.source).toBe('registry');
      expect(first.clientType).toBe('openai-compatible');
      expect(first.endpoint).toBe('http://localhost:8000/v1');
    });

    it('注册表缺失 → 正常空清单（loadRegistry 对缺失文件返回空注册表——「从未注册过」是合法形态非降级）', () => {
      const dataDir = mkDataDir(); // 不写注册表
      const inv = scanRegistryModels(dataDir);
      expect(inv.availableModels).toEqual([]);
      expect(inv.degradedReasons).toEqual([]);
    });

    it('注册表损坏（非法 JSON）→ 空清单 + 降级原因', () => {
      const dataDir = mkDataDir();
      const configDir = path.join(dataDir, 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'model-registry.json'), '{broken json!!', 'utf-8');
      const inv = scanRegistryModels(dataDir);
      expect(inv.availableModels).toEqual([]);
      expect(inv.degradedReasons[0]).toContain('模型注册表不可读');
    });

    it('注册表 schema 版本非法 → 空清单 + 降级原因', () => {
      const dataDir = mkDataDir();
      const configDir = path.join(dataDir, 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'model-registry.json'),
        JSON.stringify({ version: 99, models: {}, active: {}, events: [] }),
        'utf-8',
      );
      const inv = scanRegistryModels(dataDir);
      expect(inv.availableModels).toEqual([]);
      expect(inv.degradedReasons[0]).toContain('模型注册表不可读');
    });
  });

  // ── 2. 端点探测 ──
  describe('probeEndpoint', () => {
    it('正常响应（Ollama tags 形态）→ 收录 probed 条目', async () => {
      const fetchFn = (async () =>
        ({ ok: true, status: 200, json: async () => ({ models: [{ name: 'llama3' }, { name: 'qwen2.5' }] }) })) as typeof fetch;
      const r = await probeEndpoint('http://localhost:11434/api/tags', { fetchFn });
      expect(r.degraded).toBeUndefined();
      expect(r.models).toHaveLength(2);
      expect(r.models[0]).toMatchObject({ name: 'llama3', source: 'probed', clientType: 'ollama', status: 'active' });
      expect(r.models[1]!.name).toBe('qwen2.5');
    });

    it('响应非 2xx → 降级原因（不打哑炮）', async () => {
      const fetchFn = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as typeof fetch;
      const r = await probeEndpoint('http://localhost:11434/api/tags', { fetchFn });
      expect(r.models).toEqual([]);
      expect(r.degraded).toContain('503');
    });

    it('响应结构不符（无 models 数组）→ 降级原因', async () => {
      const fetchFn = (async () => ({ ok: true, status: 200, json: async () => ({ data: 'other' }) })) as typeof fetch;
      const r = await probeEndpoint('http://x/api', { fetchFn });
      expect(r.models).toEqual([]);
      expect(r.degraded).toContain('结构不符');
    });

    it('fetch 抛错（网络不可达）→ 降级原因而非异常', async () => {
      const fetchFn = (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;
      const r = await probeEndpoint('http://localhost:1/api', { fetchFn });
      expect(r.models).toEqual([]);
      expect(r.degraded).toContain('ECONNREFUSED');
    });

    it('models 数组内 name 非法条目（缺失/空串/非字符串）→ 跳过', async () => {
      const fetchFn = (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ models: [{}, { name: '' }, { name: 42 }, { name: 'valid-one' }] }),
        })) as typeof fetch;
      const r = await probeEndpoint('http://x/api', { fetchFn });
      expect(r.models).toHaveLength(1);
      expect(r.models[0]!.name).toBe('valid-one');
    });
  });

  // ── 3. 全量合并 ──
  describe('scanModelInventory（合并去重）', () => {
    it('registry + probed 合并，同名去重 registry 优先', async () => {
      const dataDir = mkDataDir();
      writeRegistry(dataDir, { 'shared-name': entry('shared-name', 'active') });
      const fetchFn = (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'shared-name' }, { name: 'probe-only' }] }),
        })) as typeof fetch;
      const inv = await scanModelInventory(dataDir, { probeEndpoints: ['http://x/api'], fetchFn });
      expect(inv.degradedReasons).toEqual([]);
      expect(inv.availableModels).toHaveLength(2);
      const shared = inv.availableModels.find((m) => m.name === 'shared-name')!;
      expect(shared.source).toBe('registry'); // 同名 registry 优先
      const probeOnly = inv.availableModels.find((m) => m.name === 'probe-only')!;
      expect(probeOnly.source).toBe('probed');
    });

    it('注册表缺失 + 网络全断 → 注册表来源正常空（缺失=合法）+ 探测来源降级', async () => {
      const dataDir = mkDataDir(); // 无注册表（缺失=合法空，非降级）
      const fetchFn = (async () => {
        throw new Error('network down');
      }) as typeof fetch;
      const inv = await scanModelInventory(dataDir, { probeEndpoints: DEFAULT_PROBE_ENDPOINTS, fetchFn });
      expect(inv.availableModels).toEqual([]);
      expect(inv.degradedReasons.some((r) => r.includes('探测失败'))).toBe(true);
      expect(inv.degradedReasons.some((r) => r.includes('模型注册表不可读'))).toBe(false);
    });

    it('注册表损坏 + 网络全断 → 两类降级原因并存（fail-closed 观测面）', async () => {
      const dataDir = mkDataDir();
      const configDir = path.join(dataDir, 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'model-registry.json'), '{broken', 'utf-8');
      const fetchFn = (async () => {
        throw new Error('network down');
      }) as typeof fetch;
      const inv = await scanModelInventory(dataDir, { probeEndpoints: DEFAULT_PROBE_ENDPOINTS, fetchFn });
      expect(inv.availableModels).toEqual([]);
      expect(inv.degradedReasons.some((r) => r.includes('模型注册表不可读'))).toBe(true);
      expect(inv.degradedReasons.some((r) => r.includes('探测失败'))).toBe(true);
    });
  });

  // ── 4. 心跳携带上报（进注册表、可查询） ──
  describe('reportHeartbeat 携带上报字段', () => {
    it('心跳带 availableModels/runtimeSkillPackages → 进注册表且 listDevices 可查', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t10-report', { principal: 'enterprise-a' });
      expect(registerDevice(identity, { kind: 'pc', capabilities: ['exec'] }, dataDir).ok).toBe(true);

      const models = [
        { name: 'm-1', endpoint: 'http://localhost:8000/v1', clientType: 'openai-compatible' as const, source: 'registry' as const, status: 'active' as const },
      ];
      const skills = [{ name: 'installer', version: '2026-09-14', sha256: 'abc123def4567890' }];
      const r = reportHeartbeat(identity, { dataDir, availableModels: models, runtimeSkillPackages: skills });
      expect(r.ok).toBe(true);

      const list = listDevices(dataDir);
      expect(list).toHaveLength(1);
      expect(list[0]!.availableModels).toEqual(models);
      expect(list[0]!.runtimeSkillPackages).toEqual(skills);
      // 注册表文件层面可查（持久化断言——不只内存态）
      const persisted = JSON.parse(fs.readFileSync(deviceRegistryPath(dataDir), 'utf-8')) as {
        devices: Array<{ availableModels?: unknown[]; runtimeSkillPackages?: unknown[] }>;
      };
      expect(persisted.devices[0]!.availableModels).toEqual(models);
      expect(persisted.devices[0]!.runtimeSkillPackages).toEqual(skills);
    });

    it('注册时初值 null（未上报形态——区分「无模型」与「未上报」）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t10-init', { principal: 'enterprise-a' });
      expect(registerDevice(identity, { kind: 'node', capabilities: [] }, dataDir).ok).toBe(true);
      const list = listDevices(dataDir);
      expect(list[0]!.availableModels).toBeNull();
      expect(list[0]!.runtimeSkillPackages).toBeNull();
    });

    it('心跳未带字段（undefined）→ 保留原值不覆盖', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t10-keep', { principal: 'enterprise-a' });
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      const models = [
        { name: 'm-keep', endpoint: 'http://x', clientType: 'ollama' as const, source: 'probed' as const, status: 'active' as const },
      ];
      reportHeartbeat(identity, { dataDir, availableModels: models });
      // 第二跳不带字段（undefined）
      reportHeartbeat(identity, { dataDir });
      const list = listDevices(dataDir);
      expect(list[0]!.availableModels).toEqual(models); // 保留
    });

    it('心跳显式 null → 清空（设备侧声明「本次无清单」）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t10-clear', { principal: 'enterprise-a' });
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      const models = [
        { name: 'm-old', endpoint: 'http://x', clientType: 'ollama' as const, source: 'probed' as const, status: 'active' as const },
      ];
      reportHeartbeat(identity, { dataDir, availableModels: models });
      reportHeartbeat(identity, { dataDir, availableModels: null, runtimeSkillPackages: null });
      const list = listDevices(dataDir);
      expect(list[0]!.availableModels).toBeNull();
      expect(list[0]!.runtimeSkillPackages).toBeNull();
    });

    it('未注册设备心跳带上报字段 → 拒绝（字段不落库——fail-closed 一致性）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t10-ghost', { principal: 'enterprise-a' });
      const models = [
        { name: 'm-ghost', endpoint: 'http://x', clientType: 'ollama' as const, source: 'probed' as const, status: 'active' as const },
      ];
      const r = reportHeartbeat(identity, { dataDir, availableModels: models });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('not-registered');
      const list = listDevices(dataDir);
      expect(list).toHaveLength(0);
    });
  });

  // ── 5. 事件流摘要（回放可查） ──
  describe('心跳事件摘要带清单计数', () => {
    it('summary 含 models=N skills=N（事件流可查上报时点）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t10-event', { principal: 'enterprise-a' });
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      const models = [
        { name: 'm-a', endpoint: 'http://x', clientType: 'ollama' as const, source: 'probed' as const, status: 'active' as const },
        { name: 'm-b', endpoint: 'http://x', clientType: 'ollama' as const, source: 'probed' as const, status: 'active' as const },
      ];
      reportHeartbeat(identity, { dataDir, availableModels: models, runtimeSkillPackages: [] });
      const lines = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8').trim().split('\n');
      const heartbeatLine = lines.reverse().find((l) => l.includes('"kind":"heartbeat"'))!;
      const evt = JSON.parse(heartbeatLine) as { summary: string };
      expect(evt.summary).toContain('models=2');
      expect(evt.summary).toContain('skills=0');
    });
  });
});
