// ============================================================
// device-tools.test.ts · device_register / device_list MCP tool 测试
// v1.4.9 G9（T1）新增
// ============================================================
//
// 覆盖面：
//   1. 两 tool 的 text 首行 [sofagent] 前缀（三层签名铁律）
//   2. device_register：合法身份注册成功（真实 daemon registerDevice 链路）
//   3. device_register：伪造签名 → 拒绝（fail-closed 语义经 MCP 面透传）
//   4. device_list：清单查询含已注册设备 + 在线态字段
//   5. registry 注册面：TOOLS 数组含 device_register / device_list（接线存在性）
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateAgentIdentity, type AgentIdentity } from '@sofagent/core';
import { deviceRegister } from '../tools/device-register';
import { deviceList } from '../tools/device-list';
import { TOOLS } from '../tool-registry';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-device-tools-'));
  tmpDirs.push(dir);
  return dir;
}

describe('device_register / device_list MCP tools（v1.4.9 G9）', () => {
  let dataDir: string;
  let legal: AgentIdentity;

  beforeAll(() => {
    // SOFAGENT_DATA 预置临时目录（daemon 侧 registerDevice/listDevices 的
    // dataBase 缺省解析走它——vitest-setup.mjs 已预置，这里再显式覆盖一份，
    // 保证本文件内的注册/查询互见同一注册表）
    dataDir = mkDataDir();
    process.env.SOFAGENT_DATA = dataDir;
    // 临时 HMAC 密钥（隔离真实 ~/.sofagent-key）
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-key-iso-'));
    tmpDirs.push(keyDir);
    fs.writeFileSync(path.join(keyDir, '.sofagent-key'), 'test-hmac-key-0123456789abcdef', 'utf-8');
    process.env.SOFAGENT_KEY_PATH = path.join(keyDir, '.sofagent-key');
    legal = generateAgentIdentity('device-mcp-legal', { principal: 'enterprise-mcp' });
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  it('text 首行以 [sofagent] 开头（注册成功路径）', async () => {
    const r = await deviceRegister({
      identity: legal as unknown as Record<string, unknown>,
      kind: 'pc',
      capabilities: ['train'],
      tenant: 't-mcp',
    });
    expect(r.text.startsWith('[sofagent]')).toBe(true);
    expect(r.data.ok).toBe(true);
    expect(r.data.deviceId).toBe(legal.agentId);
  });

  it('伪造签名 → 拒绝（fail-closed 经 MCP 面透传 + 留痕）', async () => {
    const base = generateAgentIdentity('device-mcp-forge', { principal: 'enterprise-mcp' });
    const forged = { ...base, principal: 'attacker' }; // 篡改载荷不重签
    const r = await deviceRegister({
      identity: forged as unknown as Record<string, unknown>,
      kind: 'pc',
      capabilities: [],
    });
    expect(r.text.startsWith('[sofagent]')).toBe(true);
    expect(r.data.ok).toBe(false);
    expect(r.data.reason).toBe('invalid-identity');
    // 拒绝留痕（事件链——daemon 侧真实链路）
    const events = fs.readFileSync(path.join(dataDir, 'audit', 'device-events.jsonl'), 'utf-8');
    expect(events).toContain('注册拒绝：Ed25519 验签失败');
  });

  it('device_list 清单含已注册设备且不含被拒设备', async () => {
    const r = await deviceList({ tenant: 't-mcp' });
    expect(r.text.startsWith('[sofagent]')).toBe(true);
    expect(r.data.ok).toBe(true);
    expect(r.data.total).toBe(1); // 只有 legal——forge 被拒不进清单
    expect(r.data.devices[0]!.deviceId).toBe(legal.agentId);
    expect(r.data.devices[0]!.online).toBe(false); // 注册后未心跳 → 离线
    expect(r.data.devices[0]!.lastHeartbeatAt).toBeNull();
  });

  it('device_list 全量（无过滤）同样只含已验签设备', async () => {
    const r = await deviceList({});
    expect(r.data.total).toBe(1);
    expect(r.data.online).toBe(0);
  });

  it('TOOLS 数组含两 tool（注册面接线存在性——铁律 9）', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain('device_register');
    expect(names).toContain('device_list');
    // roles 口径：设备注册面归 ops（运维面）
    const reg = TOOLS.find((t) => t.name === 'device_register')!;
    expect(reg.roles).toContain('ops');
    const lst = TOOLS.find((t) => t.name === 'device_list')!;
    expect(lst.roles).toContain('ops');
  });

  it('注册结果幂等边界：重复注册 → duplicate-device', async () => {
    const r = await deviceRegister({
      identity: legal as unknown as Record<string, unknown>,
      kind: 'pc',
      capabilities: [],
    });
    expect(r.data.ok).toBe(false);
    expect(r.data.reason).toBe('duplicate-device');
  });
});
