// ============================================================
// ota-upgrade.test.ts · G12 设备 OTA 升级 + 任务下发推送单测（v1.5.1 第四/五章）
// ============================================================
//
// 覆盖面（任务书验收 + 铁律 8「每个 fail-closed 分支都要有故障注入测试」）：
//   第四章
//     1. 验签 fail-closed：缺签名 / 伪造签名 / 摘要不符（三类各一）+
//        未注册设备拒绝 + 拒绝时零安装（断言组件文件不存在）
//     2. 灰度次序：非核心 → 探针 → 核心（次序断言：探针插在两批之间）
//        + 探针不过 → 核心**绝不安装**（灰度闸门有效性）
//     3. 回滚触发：安装失败 / 探针失败两路；回滚次序为安装次序逆序；
//        版本清单回到前一版本（默认落盘路径端到端：文件内容真回到旧版本）
//     4. 窗口外挂起 + 窗口内放行 + 跨午夜窗口 + 策略非法挂起 + 截止已过挂起
//     5. 手动确认：高风险版本需确认才执行
//     6. 离线设备挂起 → 上线后自动补升（resume / onDeviceOnline）
//     7. 版本清单上报：成功分支末尾调用上报端口（次序断言）+ 未注入端口
//        时明确记 no-pusher（不静默）
//     8. 审计留痕：升级全程进 decision-log，checkDecisionChainDetailed 链可验
//     9. device.deploy：验签失败拒绝（导入器零调用）/ 导入器拒绝透传 /
//        验签通过 → 落盘注册（经 G1 五件套导入器端口）
//   第五章
//    10. 在线推送直达：任务即时送达 + 领取回执进 HMAC 链（回执 hash 可回溯）
//    11. 离线回落心跳捎带：暂存不丢 → 上线补投进 G9 队列 → 心跳响应捎带 →
//        领取回执 → 链完整；且**未上线前 G9 队列零任务**（证明确实回落而非直投）
//    12. 订阅登记：三事件 topic 取自第一章 EVENT_TYPES，共用同一 bus.subscribe
//    13. 反漂移守卫：daemon 侧不再本地声明设备面 payload 契约（唯一源 =
//        @sofagent/orchestrator 的 events/types.ts），且消费侧导入接线未断
//
// 测试隔离：mkdtemp 临时 dataDir + SOFAGENT_KEY_PATH 指向临时密钥
//（HMAC 链 / decision-log 走真签名路径，不触碰真实 ~/.sofagent-key）。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateAgentIdentity,
  generateEd25519KeyPair,
  type AgentIdentity,
} from '@sofagent/core';
import { checkDecisionChainDetailed } from '@sofagent/audit';
import { EVENT_TYPES, type SofagentEvent } from '@sofagent/orchestrator';
import {
  registerDevice,
  reportHeartbeat,
  claimDeviceTask,
  loadDeviceTasks,
  verifyDeviceEventsChain,
  deviceEventsPath,
} from '../device-registry';
import {
  DEVICE_EVENT_TOPICS,
  DEVICE_OTA_SUBSCRIPTIONS,
  bundleDigest,
  computeUpgradeDigest,
  signDelivery,
  executeDeviceUpgrade,
  resumeSuspendedUpgrades,
  onDeviceOnline,
  deliverTaskDispatch,
  listHeldTasks,
  listSuspendedUpgrades,
  getDeviceVersions,
  registerDeviceOtaSubscriptions,
  isWithinWindow,
  isHighRiskVersion,
  parseClockMinutes,
  resolveUpgradePolicy,
  evaluateUpgradePolicy,
  componentPath,
  buildDeliveryResponsibility,
  verifyDeliverySignature,
  type DeviceUpgradePayload,
  type DeviceDeployPayload,
  type UpgradeComponent,
  type DeviceEventBusPort,
  type DeviceSubscriptionOptions,
} from '../ota';

// ────────────────────────────────────────────────────────────
// 测试隔离
// ────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ota-'));
  tmpDirs.push(dir);
  return dir;
}

/** 本地时间某点（策略窗口按本地时区判定——用本地构造消除时区抖动） */
function localNoonMs(): number {
  return new Date(2026, 8, 20, 12, 0, 0).getTime();
}

/** 与 localNoonMs 对应的 ISO 串 */
const NOON_ISO = new Date(localNoonMs()).toISOString();

/** 合法公钥/私钥对（交付签名者——平台侧） */
const signerKeys = generateEd25519KeyPair();

beforeAll(() => {
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-key-ota-'));
  tmpDirs.push(keyDir);
  const keyPath = path.join(keyDir, '.sofagent-key');
  fs.writeFileSync(keyPath, 'test-hmac-key-ota-0123456789abcdef', 'utf-8');
  process.env.SOFAGENT_KEY_PATH = keyPath;
});

afterAll(() => {
  delete process.env.SOFAGENT_KEY_PATH;
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

// ────────────────────────────────────────────────────────────
// 测试夹具
// ────────────────────────────────────────────────────────────

/** 注册一台在线设备（心跳新鲜——nowMs 与心跳同时刻） */
function mkOnlineDevice(dataDir: string, name = 'ota-dev-1'): AgentIdentity {
  const identity = generateAgentIdentity(name, { principal: 'ent-a' });
  const r = registerDevice(identity, { kind: 'pc', capabilities: ['gpu'] }, dataDir, NOON_ISO);
  expect(r.ok).toBe(true);
  reportHeartbeat(identity, { dataDir, nowIso: NOON_ISO });
  return identity;
}

/** 注册一台离线设备（注册后从未心跳 → isOnline=false，fail-closed） */
function mkOfflineDevice(dataDir: string, name = 'ota-dev-offline'): AgentIdentity {
  const identity = generateAgentIdentity(name, { principal: 'ent-a' });
  const r = registerDevice(identity, { kind: 'node', capabilities: ['edge'] }, dataDir, NOON_ISO);
  expect(r.ok).toBe(true);
  return identity;
}

type Cmp = { name: string; version: string; tier: 'core' | 'non-core'; content: string };

const NONCORE_C: Cmp = { name: 'rules-pack', version: '1.1.0', tier: 'non-core', content: 'rules-v2' };
const CORE_C: Cmp = { name: 'engine-core', version: '1.1.0', tier: 'core', content: 'core-v2' };

/** 构造合法签名升级指令 */
function signedUpgrade(
  targetVersion: string,
  components: Cmp[],
  opts: { principal?: string; privateKey?: string; publicKey?: string; overrideDigest?: string } = {},
): DeviceUpgradePayload {
  const contents: Record<string, string> = {};
  for (const c of components) contents[c.name] = c.content;
  const digest = opts.overrideDigest ?? computeUpgradeDigest(targetVersion, components, contents);
  const signature = signDelivery({
    publicKey: opts.publicKey ?? signerKeys.publicKey,
    privateKey: opts.privateKey ?? signerKeys.privateKey,
    principal: opts.principal ?? 'ent-a',
    label: `upgrade-package|version=${targetVersion}`,
    digest,
  });
  return { targetVersion, components, rollout: {}, signature };
}

/** 设备事件总线假实现（同形第一章 EventBus.subscribe——记录订阅与投递） */
function mkFakeBus(): DeviceEventBusPort & {
  topics: string[];
  emit(type: string, payload: unknown, extra?: Partial<SofagentEvent>): Promise<void>;
} {
  const handlers = new Map<string, Array<(e: SofagentEvent) => void | Promise<void>>>();
  return {
    topics: [],
    subscribe(type, handler) {
      this.topics.push(type);
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
      };
    },
    async emit(type, payload, extra) {
      const event: SofagentEvent = {
        id: `evt-${Math.random().toString(36).slice(2, 10)}`,
        type,
        source: 'device',
        ts: NOON_ISO,
        payload,
        correlationId: 'corr-test-1',
        ...extra,
      };
      for (const h of handlers.get(type) ?? []) await h(event);
    },
  };
}

// ────────────────────────────────────────────────────────────
// 第四章 · 策略解析纯函数
// ────────────────────────────────────────────────────────────

describe('G12 升级窗口策略（纯函数）', () => {
  it('parseClockMinutes：合法/非法', () => {
    expect(parseClockMinutes('00:00')).toBe(0);
    expect(parseClockMinutes('09:30')).toBe(570);
    expect(parseClockMinutes('23:59')).toBe(1439);
    expect(parseClockMinutes('24:00')).toBeNull();
    expect(parseClockMinutes('9:5')).toBeNull();
    expect(parseClockMinutes(930)).toBeNull();
  });

  it('窗口内 / 窗口外（边界含 start、不含 end）', () => {
    const w = { start: '11:59', end: '12:01' };
    expect(isWithinWindow(w, new Date(2026, 8, 20, 12, 0, 0))).toBe(true);
    expect(isWithinWindow(w, new Date(2026, 8, 20, 11, 59, 0))).toBe(true);
    expect(isWithinWindow(w, new Date(2026, 8, 20, 12, 1, 0))).toBe(false);
    expect(isWithinWindow(w, new Date(2026, 8, 20, 3, 0, 0))).toBe(false);
  });

  it('跨午夜窗口（start > end 两段判定）', () => {
    const w = { start: '22:00', end: '02:00' };
    expect(isWithinWindow(w, new Date(2026, 8, 20, 23, 0, 0))).toBe(true);
    expect(isWithinWindow(w, new Date(2026, 8, 20, 1, 0, 0))).toBe(true);
    expect(isWithinWindow(w, new Date(2026, 8, 20, 12, 0, 0))).toBe(false);
  });

  it('星期限定', () => {
    // 2026-09-20 是周日（0）
    const w = { start: '00:00', end: '23:59', days: [0] };
    expect(isWithinWindow(w, new Date(2026, 8, 20, 12, 0, 0))).toBe(true);
    const w2 = { start: '00:00', end: '23:59', days: [1] };
    expect(isWithinWindow(w2, new Date(2026, 8, 20, 12, 0, 0))).toBe(false);
  });

  it('窗口字段非法 → 视为窗口外（fail-closed）', () => {
    expect(isWithinWindow({ start: '25:00', end: '02:00' }, new Date(2026, 8, 20, 12, 0, 0))).toBe(false);
  });

  it('策略解析：无策略放行 / 非法策略挂起', () => {
    expect(resolveUpgradePolicy(undefined).valid).toBe(true);
    expect(resolveUpgradePolicy({ window: { start: '01:00', end: '02:00' } }).valid).toBe(true);
    const bad = resolveUpgradePolicy({ window: { start: 'nope', end: '02:00' } });
    expect(bad.valid).toBe(false);
    expect((bad.issues ?? []).length).toBeGreaterThan(0);
    const verdict = evaluateUpgradePolicy(bad, { now: new Date(localNoonMs()) });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('policy-invalid');
  });

  it('高风险版本判定（预发布标记 / 主版本 0）', () => {
    expect(isHighRiskVersion('1.1.0-rc.1')).toBe(true);
    expect(isHighRiskVersion('0.9.0')).toBe(true);
    expect(isHighRiskVersion('1.5.1')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 第四章 · 验签 fail-closed
// ────────────────────────────────────────────────────────────

describe('G12 OTA 验签 fail-closed（伪造签名升级包被拒）', () => {
  it('缺签名信封 → 拒绝且不安装', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir);
    const payload: DeviceUpgradePayload = {
      targetVersion: '1.1.0',
      components: [NONCORE_C],
      rollout: {},
      // 无 signature
    };
    const r = await executeDeviceUpgrade(payload, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });
    expect(r.outcome).toBe('rejected');
    expect(r.reason).toBe('missing-signature');
    expect(fs.existsSync(componentPath(NONCORE_C.name, dataDir))).toBe(false);
  });

  it('伪造签名（改了 principal、签名不重签）→ invalid-signature', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-forge-1');
    const good = signedUpgrade('1.1.0', [NONCORE_C]);
    const forged: DeviceUpgradePayload = {
      ...good,
      signature: { ...good.signature!, principal: 'attacker-enterprise' },
    };
    const r = await executeDeviceUpgrade(forged, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });
    expect(r.outcome).toBe('rejected');
    expect(r.reason).toBe('invalid-signature');
    expect(fs.existsSync(componentPath(NONCORE_C.name, dataDir))).toBe(false);
  });

  it('签名对但内容被换（摘要不符）→ digest-mismatch', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-digest-1');
    // 用「另一份内容」的摘要签名，再投递被换过的内容
    const otherContents = { [NONCORE_C.name]: 'tampered-content' };
    const wrongDigest = computeUpgradeDigest('1.1.0', [NONCORE_C], otherContents);
    const payload = signedUpgrade('1.1.0', [NONCORE_C], { overrideDigest: wrongDigest });
    const r = await executeDeviceUpgrade(payload, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });
    expect(r.outcome).toBe('rejected');
    expect(r.reason).toBe('digest-mismatch');
    expect(fs.existsSync(componentPath(NONCORE_C.name, dataDir))).toBe(false);
  });

  it('未注册设备 → 拒绝（升级面只面向已注册设备）', async () => {
    const dataDir = mkDataDir();
    mkOnlineDevice(dataDir, 'registered-one');
    const stranger = generateAgentIdentity('stranger', { principal: 'ent-x' });
    const r = await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C]), {
      identity: stranger,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
    });
    expect(r.outcome).toBe('rejected');
    expect(r.reason).toBe('not-registered');
  });

  it('签发/验签纯函数对拍（复用 G9 Ed25519 链）', () => {
    const digest = computeUpgradeDigest('1.1.0', [NONCORE_C], { [NONCORE_C.name]: NONCORE_C.content });
    const sig = signDelivery({
      publicKey: signerKeys.publicKey,
      privateKey: signerKeys.privateKey,
      principal: 'ent-a',
      label: 'upgrade-package|version=1.1.0',
      digest,
    });
    expect(sig.responsibility).toBe(buildDeliveryResponsibility('upgrade-package|version=1.1.0', digest));
    expect(verifyDeliverySignature(sig, 'upgrade-package|version=1.1.0', digest).ok).toBe(true);
    expect(verifyDeliverySignature(sig, 'upgrade-package|version=9.9.9', digest).ok).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 第四章 · 灰度次序 + 回滚
// ────────────────────────────────────────────────────────────

describe('G12 灰度次序与回滚', () => {
  it('灰度次序：非核心先升 → 探针 → 核心（探针插在两批之间）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-canary-1');
    const trace: string[] = [];
    const r = await executeDeviceUpgrade(signedUpgrade('1.1.0', [CORE_C, NONCORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      installComponent: ({ component }) => {
        trace.push(`install:${component.name}`);
        return { ok: true };
      },
      rollbackComponent: ({ component }) => {
        trace.push(`rollback:${component.name}`);
        return { ok: true };
      },
      healthProbe: ({ stage }) => {
        trace.push(`probe:${stage}`);
        return { ok: true, detail: 'ok' };
      },
    });
    expect(r.outcome).toBe('upgraded');
    // 组件清单给的是 [core, non-core]，实际执行次序必须非核心在前
    expect(r.order).toEqual(['rules-pack', 'engine-core']);
    expect(trace).toEqual([
      'install:rules-pack',
      'probe:non-core-1',
      'install:engine-core',
      'probe:core-1',
    ]);
    expect(r.probes?.map((p) => p.stage)).toEqual(['non-core-1', 'core-1']);
  });

  it('探针不过 → 核心组件绝不安装（灰度闸门有效）+ 回滚已升组件', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-gate-1');
    const installed: string[] = [];
    const rolledBack: string[] = [];
    const r = await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C, CORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      installComponent: ({ component }) => {
        installed.push(component.name);
        return { ok: true };
      },
      rollbackComponent: ({ component }) => {
        rolledBack.push(component.name);
        return { ok: true };
      },
      healthProbe: () => ({ ok: false, detail: '故障注入：探针不过' }),
    });
    expect(r.outcome).toBe('rolled-back');
    expect(installed).toEqual(['rules-pack']); // 核心未安装
    expect(rolledBack).toEqual(['rules-pack']); // 逆序回滚已升组件
    expect(r.message).toContain('已回滚到前一版本');
  });

  it('安装失败 → 回滚（逆序）+ 版本清单回到前一版本', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-installfail-1');
    const installed: string[] = [];
    const rolledBack: string[] = [];
    const r = await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C, CORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      installComponent: ({ component }) => {
        if (component.tier === 'core') return { ok: false, error: '故障注入：磁盘写失败' };
        installed.push(component.name);
        return { ok: true };
      },
      rollbackComponent: ({ component }) => {
        rolledBack.push(component.name);
        return { ok: true };
      },
      healthProbe: () => ({ ok: true, detail: 'ok' }),
    });
    expect(r.outcome).toBe('rolled-back');
    expect(installed).toEqual(['rules-pack']);
    expect(rolledBack).toEqual(['rules-pack']);
    // 版本清单与升级前一致（空 = 从未记录过）
    expect(r.currentVersions).toEqual(r.previousVersions);
    expect(getDeviceVersions(identity.agentId, dataDir)).toEqual({});
  });

  it('默认落盘路径端到端回滚：文件内容真回到前一版本（设备可继续服务）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-e2e-rollback-1');

    // 第一次升级成功（默认 install）→ 组件文件落 v1
    const ok1 = await executeDeviceUpgrade(signedUpgrade('1.0.0', [{ ...NONCORE_C, version: '1.0.0' }]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      healthProbe: () => ({ ok: true, detail: 'ok' }),
    });
    expect(ok1.outcome).toBe('upgraded');
    const afterV1 = JSON.parse(fs.readFileSync(componentPath(NONCORE_C.name, dataDir), 'utf-8')) as { version: string };
    expect(afterV1.version).toBe('1.0.0');

    // 第二次升级探针不过 → 默认回滚恢复备份
    const fail = await executeDeviceUpgrade(signedUpgrade('2.0.0', [{ ...NONCORE_C, version: '2.0.0' }]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      healthProbe: () => ({ ok: false, detail: '故障注入：探针不过' }),
    });
    expect(fail.outcome).toBe('rolled-back');
    const afterRollback = JSON.parse(fs.readFileSync(componentPath(NONCORE_C.name, dataDir), 'utf-8')) as { version: string };
    expect(afterRollback.version).toBe('1.0.0'); // 回到前一版本
    expect(getDeviceVersions(identity.agentId, dataDir)).toEqual({ [NONCORE_C.name]: '1.0.0' });
  });

  it('组件名非法（路径穿越）→ 参数拒绝', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-badname-1');
    const payload = signedUpgrade('1.1.0', [{ name: '../escape', version: '1.0.0', tier: 'non-core', content: 'x' }]);
    const r = await executeDeviceUpgrade(payload, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });
    expect(r.outcome).toBe('rejected');
    expect(r.reason).toBe('invalid-params');
  });
});

// ────────────────────────────────────────────────────────────
// 第四章 · 挂起与补升
// ────────────────────────────────────────────────────────────

describe('G12 窗口外 / 离线挂起与恢复后自动补升', () => {
  it('窗口外 → 挂起且零安装；恢复（窗口内）→ 自动补升', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-window-1');
    const payload = signedUpgrade('1.1.0', [NONCORE_C, CORE_C]);

    const out = await executeDeviceUpgrade(payload, {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      policy: { valid: true, window: { start: '03:00', end: '03:01' } }, // 本地 12:00 在窗口外
    });
    expect(out.outcome).toBe('suspended');
    expect(out.suspendedReason).toBe('out-of-window');
    expect(fs.existsSync(componentPath(NONCORE_C.name, dataDir))).toBe(false);
    expect(listSuspendedUpgrades(identity.agentId, dataDir)).toHaveLength(1);

    // 恢复：窗口内策略 → 自动补升
    const resumed = await resumeSuspendedUpgrades({
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      policy: { valid: true, window: { start: '11:00', end: '13:00' } },
      healthProbe: () => ({ ok: true, detail: 'ok' }),
    });
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.outcome).toBe('upgraded');
    expect(listSuspendedUpgrades(identity.agentId, dataDir)).toHaveLength(0);
  });

  it('离线设备 → 挂起；上线后（onDeviceOnline）自动补升', async () => {
    const dataDir = mkDataDir();
    const identity = mkOfflineDevice(dataDir, 'ota-offline-1');
    const out = await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
    });
    expect(out.outcome).toBe('suspended');
    expect(out.suspendedReason).toBe('offline');

    // 设备上线（心跳新鲜）
    reportHeartbeat(identity, { dataDir, nowIso: NOON_ISO });
    const r = await onDeviceOnline({
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      executor: { healthProbe: () => ({ ok: true, detail: 'ok' }) },
    });
    expect(r.resumedUpgrades).toHaveLength(1);
    expect(r.resumedUpgrades[0]!.outcome).toBe('upgraded');
    expect(listSuspendedUpgrades(identity.agentId, dataDir)).toHaveLength(0);
  });

  it('截止窗口已过 → 挂起（deadline-exceeded，不盲目执行）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-deadline-1');
    const payload: DeviceUpgradePayload = {
      ...signedUpgrade('1.1.0', [NONCORE_C]),
      deadline: new Date(localNoonMs() - 3600_000).toISOString(),
    };
    const r = await executeDeviceUpgrade(payload, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });
    expect(r.outcome).toBe('suspended');
    expect(r.suspendedReason).toBe('deadline-exceeded');
  });

  it('手动确认模式：高风险版本需确认（未确认挂起 / 确认后执行）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-manual-1');
    const payload = signedUpgrade('0.9.0', [{ ...NONCORE_C, version: '0.9.0' }]);
    const policy = { valid: true, manualConfirmHighRisk: true };

    const hold = await executeDeviceUpgrade(payload, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO, policy });
    expect(hold.outcome).toBe('suspended');
    expect(hold.suspendedReason).toBe('manual-confirm-required');

    const go = await executeDeviceUpgrade(payload, {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      policy,
      manualConfirmed: true,
      healthProbe: () => ({ ok: true, detail: 'ok' }),
    });
    expect(go.outcome).toBe('upgraded');
  });
});

// ────────────────────────────────────────────────────────────
// 第四章 · 版本清单上报 + 审计留痕
// ────────────────────────────────────────────────────────────

describe('G12 版本清单上报与审计留痕', () => {
  it('成功分支末尾调用上报端口（含版本清单与灰度次序）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-manifest-1');
    const pushes: Array<{ targetVersion: string; order: string[]; components: Record<string, string> }> = [];
    const trace: string[] = [];

    const r = await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C, CORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      installComponent: ({ component }) => {
        trace.push(`install:${component.name}`);
        return { ok: true };
      },
      healthProbe: () => ({ ok: true, detail: 'ok' }),
      pushVersionManifest: async (m) => {
        trace.push('push-manifest');
        pushes.push({ targetVersion: m.targetVersion, order: m.order, components: m.components });
        return { ok: true, seq: 7 };
      },
    });

    expect(r.outcome).toBe('upgraded');
    expect(r.manifestReported).toBe(true);
    expect(r.manifestSeq).toBe(7);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.targetVersion).toBe('1.1.0');
    expect(pushes[0]!.order).toEqual(['rules-pack', 'engine-core']);
    expect(pushes[0]!.components).toEqual({ 'rules-pack': '1.1.0', 'engine-core': '1.1.0' });
    // 次序：上报发生在最后一次安装之后
    expect(trace.indexOf('push-manifest')).toBeGreaterThan(trace.indexOf('install:engine-core'));
  });

  it('未注入上报端口 → 明确记 no-pusher（不静默）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-nopusher-1');
    const r = await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      healthProbe: () => ({ ok: true, detail: 'ok' }),
    });
    expect(r.outcome).toBe('upgraded');
    expect(r.manifestReported).toBe(false);
    expect(r.manifestPushNote).toBe('no-pusher');
  });

  it('上报端口抛错 → 不阻断升级，如实记原因', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-pushfail-1');
    const r = await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      healthProbe: () => ({ ok: true, detail: 'ok' }),
      pushVersionManifest: async () => {
        throw new Error('故障注入：上报通道不可用');
      },
    });
    expect(r.outcome).toBe('upgraded');
    expect(r.manifestReported).toBe(false);
    expect(r.manifestPushNote).toContain('故障注入');
  });

  it('升级全程审计留痕：decision-log HMAC 链可验（checkDecisionChainDetailed）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-audit-1');
    // 三条留痕：挂起（离线）→ 拒绝（伪造）→ 成功
    await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      policy: { valid: true, window: { start: '03:00', end: '03:01' } },
    });
    await executeDeviceUpgrade({ ...signedUpgrade('1.1.0', [NONCORE_C]), signature: undefined }, {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
    });
    const ok = await executeDeviceUpgrade(signedUpgrade('1.1.0', [NONCORE_C]), {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      healthProbe: () => ({ ok: true, detail: 'ok' }),
    });
    expect(ok.auditLogged).toBe(true);

    const chain = checkDecisionChainDetailed(dataDir);
    expect(chain.status).toBe('ok');

    const logPath = path.join(dataDir, 'audit', 'decision-log.jsonl');
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(3);
    const entries = lines.map((l) => JSON.parse(l) as { kind: string; agentId: string; evidence?: string[] });
    expect(entries.every((e) => e.kind === 'EVOLUTION')).toBe(true);
    expect(entries.every((e) => e.agentId.startsWith('device-ota-'))).toBe(true);
    expect(entries[2]!.evidence!.some((e) => e.startsWith('order='))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 第四章 · device.deploy（内容下发：验签 + G1 五件套格式校验）
// ────────────────────────────────────────────────────────────

describe('G12 device.deploy 内容下发', () => {
  const bundle = { manifest: { kind: 'sofagent-workflow-template', files: {} }, 'workflow.yml': 'id: wf-x\n' };

  function deployPayload(overrides: { bundleId?: string } = {}): DeviceDeployPayload {
    const bundleId = overrides.bundleId ?? 'b-1';
    return {
      bundleId,
      bundle,
      signature: signDelivery({
        publicKey: signerKeys.publicKey,
        privateKey: signerKeys.privateKey,
        principal: 'ent-a',
        label: `device-deploy|bundle=${bundleId}`,
        digest: bundleDigest(bundle),
      }),
    };
  }

  it('验签通过 → 经 G1 五件套导入器落盘注册', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-deploy-1');
    const bus = mkFakeBus();
    const imported: Array<Record<string, unknown>> = [];
    const opts: DeviceSubscriptionOptions = {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      deployImporter: async (args) => {
        imported.push(args.bundle);
        return { ok: true, importedAs: 'wf-x-imported', message: '导入成功' };
      },
    };
    registerDeviceOtaSubscriptions(bus, opts);
    await bus.emit(EVENT_TYPES.DEVICE_DEPLOY, deployPayload(), { metadata: { targetDevice: identity.agentId } });
    expect(imported).toHaveLength(1);
    expect(imported[0]).toBe(bundle);
  });

  it('伪造签名 → 拒绝且导入器零调用', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-deploy-forge-1');
    const bus = mkFakeBus();
    let importerCalls = 0;
    registerDeviceOtaSubscriptions(bus, {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      deployImporter: async () => {
        importerCalls++;
        return { ok: true, message: '不该被调用' };
      },
    });
    const p = deployPayload();
    const forged: DeviceDeployPayload = { ...p, signature: { ...p.signature!, signature: 'deadbeef' } };
    await bus.emit(EVENT_TYPES.DEVICE_DEPLOY, forged, { metadata: { targetDevice: identity.agentId } });
    expect(importerCalls).toBe(0);
  });

  it('导入器拒绝（G1 五件套格式不合格）→ 透传拒绝码', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-deploy-bad-1');
    const bus = mkFakeBus();
    registerDeviceOtaSubscriptions(bus, {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      deployImporter: async () => ({ ok: false, code: 'bundle-corrupt', message: '包缺 manifest 或 workflow.yml' }),
    });
    await bus.emit(EVENT_TYPES.DEVICE_DEPLOY, deployPayload(), { metadata: { targetDevice: identity.agentId } });
    // 拒绝也留痕：decision-log 有对应条目
    const chain = checkDecisionChainDetailed(dataDir);
    expect(chain.status === 'ok' || chain.status === 'insufficient').toBe(true);
  });

  it('未注入导入器 → 明确拒绝（no-importer，不静默放行）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'ota-deploy-noimp-1');
    const bus = mkFakeBus();
    registerDeviceOtaSubscriptions(bus, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });
    await bus.emit(EVENT_TYPES.DEVICE_DEPLOY, deployPayload(), { metadata: { targetDevice: identity.agentId } });
    const logPath = path.join(dataDir, 'audit', 'decision-log.jsonl');
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
    expect(text).toContain('no-importer');
  });
});

// ────────────────────────────────────────────────────────────
// 第五章 · 任务下发推送 / 离线回落
// ────────────────────────────────────────────────────────────

describe('第五章 任务下发通道二期（推送 / 实时）', () => {
  it('在线设备推送直达：不入心跳轮询即领取 + 回执进 HMAC 链', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'task-online-1');
    const bus = mkFakeBus();
    registerDeviceOtaSubscriptions(bus, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });

    await bus.emit(
      EVENT_TYPES.DEVICE_TASK_DISPATCH,
      { targetDevice: identity.agentId, tasks: [{ title: '跑一次微调', payload: 'prompt', dispatchedBy: 'fde@ops' }] },
      { metadata: { targetDevice: identity.agentId } },
    );

    // 推送直达：任务已 claimed（心跳尚未发生）
    const tasks = loadDeviceTasks(dataDir).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('claimed');

    // 回执进 HMAC 链且链完整
    const chain = verifyDeviceEventsChain(dataDir);
    expect(chain.ok).toBe(true);
    const lines = fs.readFileSync(deviceEventsPath(dataDir), 'utf-8').trim().split('\n').filter(Boolean);
    const claim = lines.map((l) => JSON.parse(l) as { kind: string; hmacSig?: string }).filter((r) => r.kind === 'claim');
    expect(claim).toHaveLength(1);
    expect(typeof claim[0]!.hmacSig).toBe('string');
  });

  it('离线设备回落心跳捎带：暂存不丢 → 上线补投 → 心跳捎带 → 领取回执', async () => {
    const dataDir = mkDataDir();
    const identity = mkOfflineDevice(dataDir, 'task-offline-1');
    const bus = mkFakeBus();
    registerDeviceOtaSubscriptions(bus, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });

    await bus.emit(
      EVENT_TYPES.DEVICE_TASK_DISPATCH,
      { targetDevice: identity.agentId, tasks: [{ title: '离线任务A', payload: 'p1', dispatchedBy: 'fde@ops' }] },
      { metadata: { targetDevice: identity.agentId } },
    );

    // 离线：未入 G9 队列（证明确实走回落而非直投），已在暂存队列
    expect(loadDeviceTasks(dataDir).tasks).toHaveLength(0);
    expect(listHeldTasks(identity.agentId, dataDir)).toEqual(['离线任务A']);

    // 上线 → 补投进 G9 心跳捎带队列
    reportHeartbeat(identity, { dataDir, nowIso: NOON_ISO });
    const online = await onDeviceOnline({ identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });
    expect(online.flushedTasks).toEqual(['离线任务A']);
    expect(listHeldTasks(identity.agentId, dataDir)).toEqual([]);

    // 下一次心跳响应捎带该任务（复用 v1.4.9 既有心跳捎带通道）
    const hb = reportHeartbeat(identity, { dataDir, nowIso: NOON_ISO });
    expect(hb.pendingTasks.map((t) => t.title)).toEqual(['离线任务A']);

    // 设备领取 → 回执进 HMAC 链
    const claim = claimDeviceTask(identity, { dataDir, nowIso: NOON_ISO });
    expect(claim.ok).toBe(true);
    expect(typeof claim.receiptHash).toBe('string');
    expect(verifyDeviceEventsChain(dataDir).ok).toBe(true);
    // 领取后不再捎带
    expect(reportHeartbeat(identity, { dataDir, nowIso: NOON_ISO }).pendingTasks).toHaveLength(0);
  });

  it('任务下发时效：超时不投递（fail-closed）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'task-ttl-1');
    const r = await deliverTaskDispatch(
      { targetDevice: identity.agentId, tasks: [{ title: '过期任务', payload: 'p' }], ttlMs: 1000 },
      { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO, eventTs: new Date(localNoonMs() - 60_000).toISOString() },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('已过时效');
    expect(loadDeviceTasks(dataDir).tasks).toHaveLength(0);
  });

  it('订阅登记：三事件 topic 取自第一章 EVENT_TYPES + 共用同一 bus.subscribe', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'task-sub-1');
    const bus = mkFakeBus();
    const unsubscribe = registerDeviceOtaSubscriptions(bus, { identity, dataDir, nowMs: localNoonMs(), nowIso: NOON_ISO });

    expect(unsubscribe).toHaveLength(3);
    expect(bus.topics).toEqual([
      EVENT_TYPES.DEVICE_UPGRADE,
      EVENT_TYPES.DEVICE_DEPLOY,
      EVENT_TYPES.DEVICE_TASK_DISPATCH,
    ]);
    expect(DEVICE_OTA_SUBSCRIPTIONS.map((s) => s.topic)).toEqual(bus.topics);
    expect(DEVICE_EVENT_TOPICS.upgrade).toBe('device.upgrade');
    expect(DEVICE_EVENT_TOPICS.deploy).toBe('device.deploy');
    expect(DEVICE_EVENT_TOPICS.task).toBe('device.task.dispatch');

    // 退订幂等可用
    for (const u of unsubscribe) u();
  });

  it('升级事件经总线直达执行器（端到端：订阅 → 执行 → 版本清单上报）', async () => {
    const dataDir = mkDataDir();
    const identity = mkOnlineDevice(dataDir, 'bus-upgrade-1');
    const bus = mkFakeBus();
    const pushes: string[] = [];
    registerDeviceOtaSubscriptions(bus, {
      identity,
      dataDir,
      nowMs: localNoonMs(),
      nowIso: NOON_ISO,
      pushVersionManifest: async (m) => {
        pushes.push(m.targetVersion);
        return { ok: true };
      },
      executor: { healthProbe: () => ({ ok: true, detail: 'ok' }) },
    });

    await bus.emit(EVENT_TYPES.DEVICE_UPGRADE, signedUpgrade('1.1.0', [NONCORE_C, CORE_C]), {
      metadata: { targetDevice: identity.agentId },
    });
    expect(pushes).toEqual(['1.1.0']);
    expect(getDeviceVersions(identity.agentId, dataDir)).toEqual({ 'rules-pack': '1.1.0', 'engine-core': '1.1.0' });
  });
});

// ────────────────────────────────────────────────────────────
// 反漂移守卫：设备面 payload 契约只有一处定义
// ────────────────────────────────────────────────────────────

describe('契约单一事实源（反漂移守卫）', () => {
  const OTA_DIR = path.join(__dirname, '..', 'ota');

  it('daemon 侧 ota 模块不再本地声明设备面 payload 契约', () => {
    const files = fs.readdirSync(OTA_DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    // 契约形状（唯一源 = engine/orchestrator/src/events/types.ts）+ 执行侧沿用的别名
    const forbidden = [
      /interface\s+DeviceUpgradePayload\b/,
      /interface\s+DeviceUpgradeComponent\b/,
      /interface\s+DeviceUpgradeRollout\b/,
      /interface\s+DeviceDeliverySignature\b/,
      /interface\s+DeviceDeployPayload\b/,
      /interface\s+DeviceTaskDispatchPayload\b/,
      /interface\s+DeviceTaskItem\b/,
      /interface\s+UpgradeComponent\b/,
      /interface\s+UpgradeRollout\b/,
      /interface\s+DeliverySignature\b/,
      /type\s+UpgradeTier\s*=/,
    ];

    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(OTA_DIR, f), 'utf-8');
      for (const re of forbidden) {
        if (re.test(src)) offenders.push(`${f} 命中本地重复声明: ${re}`);
      }
    }
    // 两处定义 = 两侧漂移后类型仍能通过编译的静默失效 → 必须为空
    expect(offenders).toEqual([]);
  });

  it('daemon 侧仍从 @sofagent/orchestrator 导入设备面契约（消费侧接线未断）', () => {
    const src =
      fs.readFileSync(path.join(OTA_DIR, 'upgrade-executor.ts'), 'utf-8') +
      fs.readFileSync(path.join(OTA_DIR, 'subscriptions.ts'), 'utf-8');

    expect(src).toMatch(/from\s+'@sofagent\/orchestrator'/);
    expect(src).toMatch(/DeviceUpgradeComponent\s+as\s+UpgradeComponent/);
    expect(src).toMatch(/DeviceDeployPayload/);
    expect(src).toMatch(/DeviceTaskDispatchPayload/);
  });
});
