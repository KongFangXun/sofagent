// ============================================================
// device-registry.test.ts · G9+T11+T12 设备注册面单测（v1.4.9）
// ============================================================
//
// 覆盖面（任务书 T1/T11/T12 验收 + 铁律 8「每个 fail-closed 分支都要有
// 故障注入测试」）：
//   1. 注册：合法身份成功 / 伪造签名拒绝且留审计（验收 ②）/
//      未注册设备调设备态接口拒绝（验收 ①）/ 重复注册拒绝
//   2. 验签链：篡改 publicKey / 篡改 principal / 完全伪造
//   3. 心跳：isOnline 纯函数边界（null / 超时内 / 超时外）/
//      心跳更新新鲜度 / 心跳拒绝留痕
//   4. 离线告警：超时转离线 + webhook 回调触发（验收 ③）/
//      在线设备不告警 / 吊销设备不告警
//   5. 清单过滤：只含已验签设备（验收 ④）/ tenant / kind / capability 过滤
//   6. HMAC 链：注册/心跳/回执进链且 verifyDeviceEventsChain 全绿（验收 ⑤）/
//      篡改链中一行的 summary → 验链失败（故障注入）
//   7. T11 捎带：入队 → 心跳响应带 pendingTasks → 领取 → 回执留痕（谁/
//      何时/领了什么）/ 领取后再心跳不带已领任务
//   8. T12 派单语义：离线设备不接新单（验收 ①）/ 掉线改派同能力在线设备
//      （验收 ②）/ 无同能力候选 → 挂起告警 / hold 模式直接挂起告警
//   9. /health 三态：全 ok → healthy / 单模型不可达 → degraded 而非 dead
//      （验收 ⑥）/ 核心死 → dead / 空 checks → dead（fail-closed）
//
// 测试隔离：mkdtemp 临时 dataDir 注入 + SOFAGENT_KEY_PATH 指向临时密钥
// （HMAC 链测试用真签名路径，不触碰真实 ~/.sofagent-key）。
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateAgentIdentity,
  signIdentityPayload,
  buildSignaturePayload,
  type AgentIdentity,
} from '@sofagent/core';
import {
  isOnline,
  registerDevice,
  gateDevice,
  listDevices,
  reportHeartbeat,
  scanOfflineDevices,
  enqueueDeviceTask,
  claimDeviceTask,
  reassignOrHold,
  appendDeviceEvent,
  verifyDeviceEventsChain,
  deviceEventsPath,
  DEVICE_HEARTBEAT_TIMEOUT_MS,
} from '../device-registry';
import { buildHealthVerdict } from '../health-endpoint';

// ────────────────────────────────────────────────────────────
// 测试隔离：临时 dataDir + 临时 HMAC 密钥
// ────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-device-reg-'));
  tmpDirs.push(dir);
  return dir;
}

/** 伪造身份：合法密钥对 + 篡改载荷后不重签（签名与内容不匹配） */
function forgeIdentity(base: AgentIdentity): AgentIdentity {
  return {
    ...base,
    principal: 'attacker-enterprise',
    // signature 保持 base 的——对篡改后的 payload 验签必败
  };
}

describe('G9 设备注册面（T1）', () => {
  beforeAll(() => {
    // 临时 HMAC 密钥（真签名路径——验收 ⑤ 的 HMAC 可验证性）
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-key-iso-'));
    tmpDirs.push(keyDir);
    const keyPath = path.join(keyDir, '.sofagent-key');
    fs.writeFileSync(keyPath, 'test-hmac-key-0123456789abcdef', 'utf-8');
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  // ── 1. isOnline 纯函数（独立可测——任务书要求） ──
  describe('isOnline 纯函数', () => {
    it('从未心跳（null）→ 离线（fail-closed）', () => {
      expect(isOnline(null, Date.now())).toBe(false);
    });
    it('心跳新鲜（超时内）→ 在线', () => {
      const now = 1_000_000;
      expect(isOnline(now - 10_000, now)).toBe(true);
    });
    it('心跳超时 → 离线', () => {
      const now = 1_000_000;
      expect(isOnline(now - DEVICE_HEARTBEAT_TIMEOUT_MS - 1, now)).toBe(false);
    });
    it('恰好等于超时阈值 → 在线（边界含）', () => {
      const now = 1_000_000;
      expect(isOnline(now - DEVICE_HEARTBEAT_TIMEOUT_MS, now)).toBe(true);
    });
    it('自定义阈值生效', () => {
      const now = 1_000_000;
      expect(isOnline(now - 5_000, now, 3_000)).toBe(false);
    });
  });

  // ── 2. 注册：验签 fail-closed（验收 ②） ──
  describe('注册（验签 fail-closed）', () => {
    it('合法身份注册成功', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-legal-1', { principal: 'enterprise-a' });
      const r = registerDevice(identity, { kind: 'pc', capabilities: ['train'], tenant: 't1' }, dataDir);
      expect(r.ok).toBe(true);
      expect(r.deviceId).toBe(identity.agentId);
      // 清单可查（验收 ④ 的基础）
      const list = listDevices(dataDir);
      expect(list).toHaveLength(1);
      expect(list[0]!.identity.agentId).toBe(identity.agentId);
      expect(list[0]!.kind).toBe('pc');
      expect(list[0]!.capabilities).toEqual(['train']);
    });

    it('伪造签名 → 拒绝且留审计（验收 ②——篡改 principal 不重签）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-forge-1', { principal: 'enterprise-a' });
      const forged = forgeIdentity(identity);
      const r = registerDevice(forged, { kind: 'pc', capabilities: [] }, dataDir);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('invalid-identity');
      // 拒绝动作留痕（验收 ②的「留审计」——事件链含拒绝记录）
      const chain = verifyDeviceEventsChain(dataDir);
      const raw = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8');
      expect(raw).toContain('注册拒绝：Ed25519 验签失败');
      // 链本身完整（拒绝记录也进 HMAC 链——可追溯）
      expect(chain.ok).toBe(true);
      // 清单不含被拒设备（验收 ④：只含已验签设备）
      expect(listDevices(dataDir)).toHaveLength(0);
    });

    it('篡改 publicKey → 拒绝（公钥与签名不匹配）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-pk-1');
      const other = generateAgentIdentity('device-pk-other');
      const tampered = { ...identity, publicKey: other.publicKey };
      const r = registerDevice(tampered, { kind: 'node', capabilities: [] }, dataDir);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('invalid-identity');
    });

    it('同 agentId 重复注册 → 拒绝（不覆盖）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-dup-1');
      expect(registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir).ok).toBe(true);
      const r = registerDevice(identity, { kind: 'node', capabilities: [] }, dataDir);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('duplicate-device');
    });

    it('kind 非法 → 拒绝（invalid-params）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-badkind-1');
      const r = registerDevice(identity, { kind: 'quantum' as 'pc', capabilities: [] }, dataDir);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('invalid-params');
    });

    it('身份字段缺失 → 拒绝并留痕', () => {
      const dataDir = mkDataDir();
      const r = registerDevice({} as AgentIdentity, { kind: 'pc', capabilities: [] }, dataDir);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('invalid-params');
      const raw = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8');
      expect(raw).toContain('注册拒绝：身份字段缺失');
    });
  });

  // ── 3. 设备态闸门（验收 ①：未注册设备调任何设备态接口 → 拒绝） ──
  describe('设备态闸门（验收 ①）', () => {
    it('未注册设备心跳 → 拒绝', () => {
      const dataDir = mkDataDir();
      const stranger = generateAgentIdentity('device-stranger-1');
      const hb = reportHeartbeat(stranger, { dataDir });
      expect(hb.ok).toBe(false);
      expect(hb.reason).toBe('not-registered');
      // 拒绝留痕
      const raw = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8');
      expect(raw).toContain('心跳拒绝：设备未注册');
    });

    it('未注册设备领任务 → 拒绝', () => {
      const dataDir = mkDataDir();
      const stranger = generateAgentIdentity('device-stranger-2');
      const r = claimDeviceTask(stranger, { dataDir });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('not-registered');
    });

    it('注册后换公钥调用设备态接口 → 拒绝（防冒充已注册设备）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-swap-1');
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      const other = generateAgentIdentity('device-swap-other');
      const swapped = { ...identity, publicKey: other.publicKey };
      const hb = reportHeartbeat(swapped, { dataDir });
      expect(hb.ok).toBe(false);
      // reason 归 invalid-identity（公钥与存档不一致）——闸门语义细分
      expect(hb.reason).toBe('invalid-identity');
    });

    it('gateDevice：吊销设备 → 拒绝（revoked）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-revoked-1');
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      // 手动置吊销（管理动作——生产经管理接口，此处直改注册表模拟）
      const regPath = path.join(dataDir, 'device-registry.json');
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
      reg.devices[0].revoked = true;
      fs.writeFileSync(regPath, JSON.stringify(reg));
      const g = gateDevice(identity, dataDir);
      expect(g.ok).toBe(false);
      expect(g.reason).toBe('revoked');
    });
  });

  // ── 4. 心跳 + 离线告警（验收 ③） ──
  describe('心跳与离线告警（验收 ③）', () => {
    it('心跳更新新鲜度，清单纯实时判定在线', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-hb-1');
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      // 注册后从未心跳 → 离线
      expect(listDevices(dataDir)[0]!.online).toBe(false);
      // 心跳后 → 在线
      const t0 = '2026-09-15T00:00:00.000Z';
      reportHeartbeat(identity, { dataDir, nowIso: t0 });
      const t0Ms = new Date(t0).getTime();
      expect(listDevices(dataDir, { nowMs: t0Ms })[0]!.online).toBe(true);
      // 90s 后未再心跳 → 离线（转离线 = 读侧实时判定）
      expect(listDevices(dataDir, { nowMs: t0Ms + DEVICE_HEARTBEAT_TIMEOUT_MS + 1 })[0]!.online).toBe(false);
    });

    it('心跳超时 → 转离线并触发 webhook 告警（验收 ③——回调注入）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-alarm-1');
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      const t0 = '2026-09-15T00:00:00.000Z';
      reportHeartbeat(identity, { dataDir, nowIso: t0 });
      // 注入 webhook 回调（生产接线：daemon 侧 createWebhookPusher().push）
      const alarms: string[] = [];
      const offline = scanOfflineDevices({
        dataDir,
        nowMs: new Date(t0).getTime() + DEVICE_HEARTBEAT_TIMEOUT_MS + 1,
        nowIso: '2026-09-15T00:02:00.000Z',
        onAlarm: (deviceId) => alarms.push(deviceId),
      });
      expect(offline).toHaveLength(1);
      expect(offline[0]!.deviceId).toBe(identity.agentId);
      expect(alarms).toEqual([identity.agentId]);
      // 告警留痕（事件链 offline-alarm）
      const raw = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8');
      expect(raw).toContain('离线告警：心跳超时');
    });

    it('在线设备不触发告警 / 吊销设备不告警', () => {
      const dataDir = mkDataDir();
      const online = generateAgentIdentity('device-alarm-online');
      const revoked = generateAgentIdentity('device-alarm-revoked');
      registerDevice(online, { kind: 'pc', capabilities: [] }, dataDir);
      registerDevice(revoked, { kind: 'pc', capabilities: [] }, dataDir);
      const t0 = '2026-09-15T00:00:00.000Z';
      reportHeartbeat(online, { dataDir, nowIso: t0 });
      // 吊销 revoked（直改注册表模拟管理动作）
      const reg = JSON.parse(fs.readFileSync(path.join(dataDir, 'device-registry.json'), 'utf-8'));
      reg.devices.find((d: { identity: { agentId: string } }) => d.identity.agentId === revoked.agentId).revoked = true;
      fs.writeFileSync(path.join(dataDir, 'device-registry.json'), JSON.stringify(reg));
      const alarms: string[] = [];
      const offline = scanOfflineDevices({
        dataDir,
        nowMs: new Date(t0).getTime() + 1_000,
        onAlarm: (id) => alarms.push(id),
      });
      // online 心跳新鲜不告警；revoked 已吊销不告警（但从未心跳 → 本会离线，
      // 吊销优先——不进告警面）
      expect(alarms).toHaveLength(0);
      expect(offline).toHaveLength(0);
    });
  });

  // ── 5. 清单过滤（验收 ④ + tenant/kind/capability） ──
  describe('设备清单（验收 ④）', () => {
    it('清单只含已验签设备（被拒设备不出现在清单）', () => {
      const dataDir = mkDataDir();
      const legal = generateAgentIdentity('device-list-legal');
      const forged = forgeIdentity(generateAgentIdentity('device-list-forge'));
      registerDevice(legal, { kind: 'pc', capabilities: ['train'] }, dataDir);
      registerDevice(forged, { kind: 'pc', capabilities: [] }, dataDir); // 拒绝
      const list = listDevices(dataDir);
      expect(list).toHaveLength(1);
      expect(list[0]!.identity.agentId).toBe(legal.agentId);
    });

    it('tenant / kind / capability 过滤', () => {
      const dataDir = mkDataDir();
      const a = generateAgentIdentity('device-filter-a');
      const b = generateAgentIdentity('device-filter-b');
      registerDevice(a, { kind: 'pc', capabilities: ['train', 'audit'], tenant: 'tenant-a' }, dataDir);
      registerDevice(b, { kind: 'appliance', capabilities: ['infer'], tenant: 'tenant-b' }, dataDir);
      expect(listDevices(dataDir, { tenant: 'tenant-a' })).toHaveLength(1);
      expect(listDevices(dataDir, { kind: 'appliance' })).toHaveLength(1);
      expect(listDevices(dataDir, { capability: 'train' })).toHaveLength(1);
      expect(listDevices(dataDir, { capability: 'infer' })[0]!.identity.agentId).toBe(b.agentId);
      expect(listDevices(dataDir)).toHaveLength(2);
    });
  });

  // ── 6. HMAC 链（验收 ⑤：注册表 HMAC 留痕可追溯） ──
  describe('HMAC 留痕链（验收 ⑤）', () => {
    it('注册/心跳/回执事件进链且验链全绿（含 HMAC）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-chain-1');
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      reportHeartbeat(identity, { dataDir, nowIso: '2026-09-15T00:00:00.000Z' });
      const chain = verifyDeviceEventsChain(dataDir);
      expect(chain.ok).toBe(true);
      expect(chain.total).toBe(2); // register + heartbeat
      expect(chain.brokenAt).toBeNull();
      // 条目带 hmacSig（SOFAGENT_KEY_PATH 已注入临时密钥）
      const lines = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8').trim().split('\n');
      const first = JSON.parse(lines[0]!);
      expect(typeof first.hmacSig).toBe('string');
      expect(first.hmacSig!.length).toBe(32);
      // 首条 prevHash = genesis
      expect(first.prevHash).toBe('genesis');
    });

    it('故障注入：篡改链中一行的 summary → 验链失败（content-hash-mismatch）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-chain-tamper');
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      reportHeartbeat(identity, { dataDir, nowIso: '2026-09-15T00:00:00.000Z' });
      // 篡改首行 summary（内容 hash 不再匹配）
      const p = deviceEventsPath(dataDir);
      const lines = fs.readFileSync(p, 'utf-8').trim().split('\n');
      const first = JSON.parse(lines[0]!);
      first.summary = '被篡改的记录';
      lines[0] = JSON.stringify(first);
      fs.writeFileSync(p, lines.join('\n') + '\n');
      const chain = verifyDeviceEventsChain(dataDir);
      expect(chain.ok).toBe(false);
      expect(chain.reason).toBe('content-hash-mismatch');
      expect(chain.brokenAt).toBe(0);
    });

    it('故障注入：删除链中间行 → prev-hash-mismatch（链衔接断）', () => {
      const dataDir = mkDataDir();
      appendDeviceEvent('register', 'dev-x', '第一条', dataDir, '2026-09-15T00:00:01.000Z');
      appendDeviceEvent('heartbeat', 'dev-x', '第二条', dataDir, '2026-09-15T00:00:02.000Z');
      appendDeviceEvent('heartbeat', 'dev-x', '第三条', dataDir, '2026-09-15T00:00:03.000Z');
      const p = deviceEventsPath(dataDir);
      const lines = fs.readFileSync(p, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);
      // 删中间行（静默截断攻击模拟）
      const truncated = [lines[0], lines[2]];
      fs.writeFileSync(p, truncated.join('\n') + '\n');
      const chain = verifyDeviceEventsChain(dataDir);
      expect(chain.ok).toBe(false);
      expect(chain.reason).toBe('prev-hash-mismatch');
    });
  });

  // ── 7. T11：心跳捎带 + 回执留痕 ──
  describe('T11 心跳捎带任务清单 + 回执（验收 ①②）', () => {
    it('入队 → 心跳响应带 pendingTasks → 领取 → 回执留痕', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t11-1');
      registerDevice(identity, { kind: 'pc', capabilities: ['train'] }, dataDir);
      // 设备先心跳（在线），派单方才能入队（T12 前置）
      const t0 = '2026-09-15T00:00:00.000Z';
      reportHeartbeat(identity, { dataDir, nowIso: t0 });
      // 派单方入队
      const enq = enqueueDeviceTask(identity.agentId, { title: '跑一次微调', payload: 'prompt...', dispatchedBy: 'fde@ops' }, { dataDir, nowIso: '2026-09-15T00:00:10.000Z', nowMs: new Date(t0).getTime() + 10_000 });
      expect(enq.ok).toBe(true);
      expect(enq.taskId).toBeTruthy();
      // 下一跳心跳捎带任务清单（T11 验收 ①）
      const hb2 = reportHeartbeat(identity, { dataDir, nowIso: '2026-09-15T00:00:20.000Z' });
      expect(hb2.ok).toBe(true);
      expect(hb2.pendingTasks).toHaveLength(1);
      expect(hb2.pendingTasks[0]!.title).toBe('跑一次微调');
      expect(hb2.pendingTasks[0]!.status).toBe('pending');
      // 设备领取 → 回执留痕（T11 验收 ②：谁/何时/领了什么）
      const claim = claimDeviceTask(identity, { dataDir, nowIso: '2026-09-15T00:00:30.000Z' });
      expect(claim.ok).toBe(true);
      expect(claim.task!.status).toBe('claimed');
      expect(claim.receiptHash).toBeTruthy();
      const raw = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8');
      expect(raw).toContain('领任务回执');
      expect(raw).toContain('跑一次微调');
      expect(raw).toContain('fde@ops');
      // 领取后再心跳 → 不再捎带已领任务
      const hb3 = reportHeartbeat(identity, { dataDir, nowIso: '2026-09-15T00:00:40.000Z' });
      expect(hb3.pendingTasks).toHaveLength(0);
      // 回执 hash 在链中可回溯（链完整含回执记录）
      const chain = verifyDeviceEventsChain(dataDir);
      expect(chain.ok).toBe(true);
      expect(chain.total).toBeGreaterThanOrEqual(5); // register+hb+入队+hb+claim+hb
    });

    it('指定 taskId 领取 + 领取不存在/已领任务 → 拒绝', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t11-2');
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      reportHeartbeat(identity, { dataDir, nowIso: '2026-09-15T00:00:00.000Z' });
      const t0Ms = new Date('2026-09-15T00:00:00.000Z').getTime();
      const e1 = enqueueDeviceTask(identity.agentId, { title: '任务A', payload: 'a', dispatchedBy: 'x' }, { dataDir, nowMs: t0Ms + 1_000 });
      const e2 = enqueueDeviceTask(identity.agentId, { title: '任务B', payload: 'b', dispatchedBy: 'x' }, { dataDir, nowMs: t0Ms + 2_000 });
      expect(e1.ok && e2.ok).toBe(true);
      // 指定领取 B
      const claimB = claimDeviceTask(identity, { taskId: e2.taskId, dataDir, nowIso: '2026-09-15T00:00:10.000Z' });
      expect(claimB.ok).toBe(true);
      expect(claimB.task!.title).toBe('任务B');
      // 已领任务再领 → 拒绝
      const again = claimDeviceTask(identity, { taskId: e2.taskId, dataDir });
      expect(again.ok).toBe(false);
      expect(again.reason).toBe('invalid-task-id');
      // 领 A（FIFO 兜底）
      const claimA = claimDeviceTask(identity, { dataDir });
      expect(claimA.ok).toBe(true);
      expect(claimA.task!.title).toBe('任务A');
      // 领完 → no-tasks
      const empty = claimDeviceTask(identity, { dataDir });
      expect(empty.ok).toBe(false);
      expect(empty.reason).toBe('no-tasks');
    });
  });

  // ── 8. T12：派单语义 ──
  describe('T12 派单语义（验收 ①②）', () => {
    it('离线设备不接新单（心跳新鲜度判定——验收 ①）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t12-off');
      registerDevice(identity, { kind: 'pc', capabilities: ['train'] }, dataDir);
      // 从未心跳 → 离线 → 拒单
      const r = enqueueDeviceTask(identity.agentId, { title: 't', payload: 'p', dispatchedBy: 'x' }, { dataDir });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('device-offline');
      // 留痕
      const raw = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8');
      expect(raw).toContain('派单拒绝：设备离线');
    });

    it('心跳后过期 → 离线拒单（新鲜度窗口判定）', () => {
      const dataDir = mkDataDir();
      const identity = generateAgentIdentity('device-t12-stale');
      registerDevice(identity, { kind: 'pc', capabilities: [] }, dataDir);
      const t0 = '2026-09-15T00:00:00.000Z';
      reportHeartbeat(identity, { dataDir, nowIso: t0 });
      const r = enqueueDeviceTask(identity.agentId, { title: 't', payload: 'p', dispatchedBy: 'x' }, {
        dataDir,
        nowMs: new Date(t0).getTime() + DEVICE_HEARTBEAT_TIMEOUT_MS + 1,
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('device-offline');
    });

    it('已派设备掉线 → 改派同能力在线设备（验收 ②）', () => {
      const dataDir = mkDataDir();
      const offline = generateAgentIdentity('device-t12-offline');
      const backup = generateAgentIdentity('device-t12-backup', { principal: 'enterprise-a' });
      registerDevice(offline, { kind: 'pc', capabilities: ['train', 'audit'] }, dataDir);
      registerDevice(backup, { kind: 'node', capabilities: ['train'] }, dataDir);
      const t0 = '2026-09-15T00:00:00.000Z';
      // 两台都心跳过；offline 停在 t0，backup 持续心跳到检查前一刻
      reportHeartbeat(offline, { dataDir, nowIso: t0 });
      const t0Ms = new Date(t0).getTime();
      // offline 掉线（心跳过期），backup 仍在线
      const later = t0Ms + DEVICE_HEARTBEAT_TIMEOUT_MS + 1_000;
      reportHeartbeat(backup, { dataDir, nowIso: new Date(later - 5_000).toISOString() });
      const r = reassignOrHold(offline.agentId, { title: '改派任务', payload: 'p', dispatchedBy: 'x' }, {
        dataDir,
        nowMs: later,
      });
      expect(r.ok).toBe(true);
      expect(r.reassignedTo).toBe(backup.agentId);
      // 改派留痕
      const raw = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8');
      expect(raw).toContain('已改派');
      // 改派目标设备的 pending 清单可见该任务
      const hb = reportHeartbeat(backup, { dataDir, nowIso: new Date(later).toISOString() });
      expect(hb.pendingTasks).toHaveLength(1);
      expect(hb.pendingTasks[0]!.title).toBe('改派任务');
    });

    it('无同能力在线候选 → 挂起告警（fail-closed 不盲目改派）', () => {
      const dataDir = mkDataDir();
      const offline = generateAgentIdentity('device-t12-nocand');
      const unrelated = generateAgentIdentity('device-t12-unrelated');
      registerDevice(offline, { kind: 'pc', capabilities: ['train'] }, dataDir);
      registerDevice(unrelated, { kind: 'pc', capabilities: ['infer'] }, dataDir);
      const t0 = '2026-09-15T00:00:00.000Z';
      reportHeartbeat(unrelated, { dataDir, nowIso: t0 }); // 仅无关能力设备在线
      const alarms: string[] = [];
      const r = reassignOrHold(offline.agentId, { title: 't', payload: 'p', dispatchedBy: 'x' }, {
        dataDir,
        nowMs: new Date(t0).getTime() + 60_000,
        onHoldAlarm: (m) => alarms.push(m),
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('no-candidate');
      expect(alarms).toHaveLength(1);
      expect(alarms[0]).toContain('挂起');
      const raw = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8');
      expect(raw).toContain('改派失败：无同能力在线候选');
    });

    it('hold 模式：按配置直接挂起告警（不改派）', () => {
      const dataDir = mkDataDir();
      const offline = generateAgentIdentity('device-t12-hold');
      const backup = generateAgentIdentity('device-t12-holdbk');
      registerDevice(offline, { kind: 'pc', capabilities: ['train'] }, dataDir);
      registerDevice(backup, { kind: 'pc', capabilities: ['train'] }, dataDir);
      const t0 = '2026-09-15T00:00:00.000Z';
      reportHeartbeat(backup, { dataDir, nowIso: t0 });
      const alarms: string[] = [];
      const r = reassignOrHold(offline.agentId, { title: 't', payload: 'p', dispatchedBy: 'x' }, {
        dataDir,
        mode: 'hold',
        nowMs: new Date(t0).getTime() + 60_000,
        onHoldAlarm: (m) => alarms.push(m),
      });
      expect(r.ok).toBe(false);
      // hold 优先——即便有同能力在线设备也不改派（配置语义）
      expect(r.reason).toBe('held-for-alarm');
      expect(alarms).toHaveLength(1);
      // backup 不接单（hold 模式不入队）
      const hb = reportHeartbeat(backup, { dataDir, nowIso: '2026-09-15T00:01:10.000Z' });
      expect(hb.pendingTasks).toHaveLength(0);
    });
  });

  // ── 9. /health 三态判定（验收 ⑥——纯函数注入测试） ──
  describe('/health 三态判定（验收 ⑥）', () => {
    it('全部 ok → healthy', () => {
      const v = buildHealthVerdict([
        { id: 'engine:core', status: 'ok' },
        { id: 'audit-chain', status: 'ok' },
        { id: 'model:qwen3', status: 'ok' },
      ]);
      expect(v.status).toBe('healthy');
    });

    it('单模型不可达 → degraded 而非 dead（验收 ⑥ 原文语义）', () => {
      const v = buildHealthVerdict([
        { id: 'engine:core', status: 'ok' },
        { id: 'audit-chain', status: 'ok' },
        { id: 'model:qwen3', status: 'dead', detail: '不可达' },
        { id: 'model:glm4', status: 'ok' },
      ]);
      expect(v.status).toBe('degraded');
      expect(v.summary).toContain('model:qwen3');
    });

    it('核心（engine:*）不可达 → dead', () => {
      const v = buildHealthVerdict([
        { id: 'engine:core', status: 'dead' },
        { id: 'model:qwen3', status: 'ok' },
      ]);
      expect(v.status).toBe('dead');
    });

    it('空 checks → dead（fail-closed：不因缺数据误报健康）', () => {
      const v = buildHealthVerdict([]);
      expect(v.status).toBe('dead');
    });

    it('degraded 项（非 dead）→ 整体 degraded', () => {
      const v = buildHealthVerdict([
        { id: 'engine:core', status: 'ok' },
        { id: 'audit-chain', status: 'degraded', detail: '链断裂' },
      ]);
      expect(v.status).toBe('degraded');
    });
  });
});
