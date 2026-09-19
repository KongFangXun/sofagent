// ============================================================
// device-registry.ts · G9 设备注册 / 发现 / 心跳（v1.5.0 T1+T11+T12）
// ============================================================
//
// 设备接入的第一步：谁在线、能干什么、健康吗。
//
// 设计决策（任务书 §二 T1/T11/T12 + changelog 一章）：
//   - 设备身份复用 v1.3.1 Agent 身份码 Ed25519（engine/core/src/agent-identity.ts
//     的 generateEd25519KeyPair / signIdentityPayload / verifyAgentIdentity——
//     Node crypto 零新依赖），设备 = 一个 Agent 实例，身份体系零新建，不自研签名。
//   - 注册走 connector 语义，验签 fail-closed（铁律 4）：verifyAgentIdentity
//     不通过一律拒绝，不降级、不留「待验证」中间态；拒绝动作本身留痕。
//   - 注册表持久化：<dataDir>/device-registry.json（身份 + 能力标签 + 心跳
//     状态）。daemon 侧照 long-tasks.ts 同款「直接 fs 读写、不跨包 import
//     audit 内部」纪律——注册表读写不经过 @sofagent/audit。
//   - 注册 / 心跳 / 领任务回执 / 拒绝事件：HMAC-SHA256 链式留痕（appendHistory
//     语义的 daemon 侧实现，落 <dataDir>/audit/device-events.jsonl；每条含
//     prevHash 链字段 + hmacSig，密钥同源 HOME 下 .sofagent-key——与 audit
//     主链同一密钥体系，但独立 jsonl 文件，不与主链互写）。
//   - T11 心跳捎带：心跳响应体带 pendingTasks（待执行任务清单——派单方经
//     enqueueDeviceTask 写入，设备侧拉取式消费，零新增连接）。设备领任务后
//     回执 HMAC 留痕（谁 / 何时 / 领了什么）。
//   - T12 派单语义：离线设备不接新单（心跳新鲜度判定）；已派设备掉线 →
//     改派同能力在线设备，或按配置挂起告警。
//   - 在线判定：isOnline(lastHeartbeatMs, nowMs) 纯函数，独立可测。
//
// 已知边界（诚实披露，通道级认证归 v1.5.1 事件总线）：
//   设备态请求（心跳 / 领任务）的身份验证 = 公钥与注册存档一致 + 身份码
//   自身 Ed25519 验签。整体复制合法身份对象（含 signature）的重放可绕过
//   这一层——请求级载荷签名（对 deviceId|timestamp 签名 + 时间窗校验）
//   需要通道层配合，排 v1.5.1 事件总线（T13 评估项的前置）。
//
// 数据流边界（铁律 1：平台不直连设备，数据一律过约束层）：
//   device_register / device_list 是约束层侧注册面 MCP tool；设备侧 agent
//   经心跳上报状态，派单方经本注册表写入任务，设备拉取消费。
// ============================================================

import { createHash, createHmac, randomUUID } from 'crypto';
import { verifyAgentIdentity, getHmacKey, getDataDir, type AgentIdentity } from '@sofagent/core';
import type { AvailableModelEntry, RuntimeSkillPackage } from './model-inventory';
import * as fs from 'fs';
import * as path from 'path';

// ────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────

/** 心跳超时阈值（毫秒）——超过此值未收到心跳判离线。默认 90s（3 × 30s 周期） */
export const DEVICE_HEARTBEAT_TIMEOUT_MS = 90_000;

/** 设备注册表文件名（<dataDir>/device-registry.json） */
export const DEVICE_REGISTRY_FILE = 'device-registry.json';

/** 设备事件 HMAC 留痕链文件名（<dataDir>/audit/device-events.jsonl） */
export const DEVICE_EVENTS_FILE = 'audit/device-events.jsonl';

/** 设备待执行任务队列文件名（<dataDir>/device-tasks.json） */
export const DEVICE_TASKS_FILE = 'device-tasks.json';

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 设备类型（changelog 一章：pc / node / appliance） */
export type DeviceKind = 'pc' | 'node' | 'appliance';

/** 设备注册表条目（<dataDir>/device-registry.json 的 devices[] 之一） */
export interface DeviceRecord {
  /** 设备身份（复用 AgentIdentity——agentId 为唯一键，publicKey 用于验签） */
  identity: AgentIdentity;
  /** 设备类型 */
  kind: DeviceKind;
  /** 能力标签（派单方按能力匹配设备——T12 改派「同能力在线设备」的判据） */
  capabilities: string[];
  /** 租户（多租户隔离，缺省 'default'） */
  tenant: string;
  /** 注册时间（ISO 8601） */
  registeredAt: string;
  /** 最后心跳时间（ISO 8601；null = 注册后从未心跳） */
  lastHeartbeatAt: string | null;
  /** 是否已被管理员吊销（吊销后设备态接口全拒） */
  revoked: boolean;
  /** 本机可用模型清单（T10 第三项：心跳携带——注册表扫描 + 端点探测，去重后五字段条目；null=未上报过） */
  availableModels?: AvailableModelEntry[] | null;
  /** 执行时 skill 快照清单（T10 第三项：执行前打包、执行后清理——心跳只携带清单摘要；null=未上报过） */
  runtimeSkillPackages?: RuntimeSkillPackage[] | null;
}

/** 设备注册表持久化结构 */
export interface DeviceRegistryFile {
  /** 注册表版本（格式演进预留） */
  version: number;
  /** 设备清单 */
  devices: DeviceRecord[];
}

/** 设备待执行任务（T11：派单方写入，设备拉取式消费） */
export interface DeviceTask {
  /** 任务 ID（UUID） */
  id: string;
  /** 目标设备（deviceId = DeviceRecord.identity.agentId） */
  deviceId: string;
  /** 任务标题（人读） */
  title: string;
  /** 任务载荷（派单方与设备侧约定的自由文本——多为 prompt 或 JSON 指令） */
  payload: string;
  /** 派单方（写入者标识——审计留痕用） */
  dispatchedBy: string;
  /** 入队时间（ISO 8601） */
  enqueuedAt: string;
  /** 领取状态：pending=待领取 / claimed=已领取（领取后置，回执已留痕） */
  status: 'pending' | 'claimed';
  /** 领取时间（ISO 8601；status=claimed 时存在） */
  claimedAt?: string;
}

/** 设备任务队列持久化结构 */
export interface DeviceTasksFile {
  version: number;
  tasks: DeviceTask[];
}

/** 设备事件 HMAC 留痕链条目（device-events.jsonl 每行） */
export interface DeviceEventRecord {
  /** 事件类型：register / heartbeat / claim / offline-alarm / dispatch-reassign */
  kind: 'register' | 'heartbeat' | 'claim' | 'offline-alarm' | 'dispatch-reassign';
  /** 时间戳（ISO 8601） */
  ts: string;
  /** 设备 ID（identity.agentId；未知设备拒绝事件用其 agentId 或 'unknown'） */
  deviceId: string;
  /** 事件摘要（人读中文） */
  summary: string;
  /** 上一条记录的 hash（链式——首条 'genesis'；解析失败 'unknown'） */
  prevHash: string;
  /** 本条内容 hash（SHA-256 前 16 位——与 audit-history prevHash 同口径） */
  hash: string;
  /** HMAC-SHA256 签名前 32 位（密钥同源 HOME 下 .sofagent-key；无密钥时缺省——降级不签名，向后兼容） */
  hmacSig?: string;
}

// ────────────────────────────────────────────────────────────
// 在线判定（纯函数——T1 验收 / T12 派单前置条件）
// ────────────────────────────────────────────────────────────

/**
 * 心跳新鲜度判定（纯函数，独立可测）。
 *
 * 判定规则：
 *   - lastHeartbeatMs 为 null（注册后从未心跳）→ 离线
 *   - nowMs - lastHeartbeatMs > timeoutMs → 离线
 *   - 其余 → 在线
 *
 * fail-closed（铁律 4）：无心跳记录 = 不在线，不默认放行。
 *
 * @param lastHeartbeatMs 最后心跳的 epoch 毫秒（null = 从未心跳）
 * @param nowMs 当前时间 epoch 毫秒
 * @param timeoutMs 超时阈值（默认 DEVICE_HEARTBEAT_TIMEOUT_MS）
 * @returns true = 在线（心跳新鲜）
 */
export function isOnline(
  lastHeartbeatMs: number | null,
  nowMs: number,
  timeoutMs: number = DEVICE_HEARTBEAT_TIMEOUT_MS,
): boolean {
  if (lastHeartbeatMs === null) return false;
  return nowMs - lastHeartbeatMs <= timeoutMs;
}

// ────────────────────────────────────────────────────────────
// 文件路径解析（dataDir 可注入——测试隔离）
// ────────────────────────────────────────────────────────────

/** 数据根目录解析（core getDataDir SSOT 直用——显式注入 > SOFAGENT_DATA > 默认，测试注入 dataDir 即隔离） */
function dataBase(dataDir?: string): string {
  return getDataDir(dataDir);
}

/** 注册表文件路径 */
export function deviceRegistryPath(dataDir?: string): string {
  return path.join(dataBase(dataDir), DEVICE_REGISTRY_FILE);
}

/** 事件链文件路径 */
export function deviceEventsPath(dataDir?: string): string {
  return path.join(dataBase(dataDir), DEVICE_EVENTS_FILE);
}

/** 任务队列文件路径 */
export function deviceTasksPath(dataDir?: string): string {
  return path.join(dataBase(dataDir), DEVICE_TASKS_FILE);
}

// ────────────────────────────────────────────────────────────
// HMAC 留痕链（appendHistory 语义的 daemon 侧实现）
// ────────────────────────────────────────────────────────────

/**
 * 读取 HMAC 密钥（core getHmacKey 直用——真同源：与 audit 主链同一密钥
 * 文件 HOME 直下 .sofagent-key，支持 SOFAGENT_KEY_PATH 覆盖用于测试隔离）。
 *
 * 缺失 / 空文件 → null（降级不签名——与 audit 主链 getHmacKey 同语义，向后兼容）。
 */
function deviceHmacKey(): Buffer | null {
  const raw = getHmacKey();
  if (!raw || raw.length === 0) return null;
  return Buffer.from(raw, 'utf-8');
}

/**
 * 追加一条设备事件到 HMAC 留痕链。
 *
 * 链语义（对齐 engine/audit/src/audit-history.ts appendHistory）：
 *   - prevHash = 上一条记录的 hash（文件不存在 / 空文件 → 'genesis'；
 *     尾行解析失败 → 'unknown'）；
 *   - hash = SHA-256(stable 序列化 {kind,ts,deviceId,summary,prevHash}) 前 16 位；
 *   - hmacSig = HMAC-SHA256(recordForSig) 前 32 位（recordForSig 含 hash、
 *     不含 hmacSig 自身——写读两侧同口径，见 verifyDeviceEventsChain）。
 *
 * 设备事件无自由文本脱敏面（summary 为结构化中文摘要、其余为结构化字段），
 * 故不做 sanitize 步骤（与主链差异点：主链 commitMsg/task 需脱敏后再签名）。
 *
 * 写入失败不抛异常（console.error + 继续——审计可用性优先，与主链同取舍）。
 */
export function appendDeviceEvent(
  kind: DeviceEventRecord['kind'],
  deviceId: string,
  summary: string,
  dataDir?: string,
  nowIso?: string,
): void {
  try {
    const filePath = deviceEventsPath(dataDir);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    // 链尾读取（上一条 hash）
    let prevHash = 'genesis';
    if (fs.existsSync(filePath)) {
      const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        try {
          const last = JSON.parse(lines[lines.length - 1]!) as DeviceEventRecord;
          prevHash = last.hash;
        } catch {
          prevHash = 'unknown';
        }
      }
    }
    const ts = nowIso ?? new Date().toISOString();
    const contentHash = createHash('sha256')
      .update(JSON.stringify({ kind, ts, deviceId, summary, prevHash }))
      .digest('hex')
      .slice(0, 16);
    const record: DeviceEventRecord = { kind, ts, deviceId, summary, prevHash, hash: contentHash };
    const hmacKey = deviceHmacKey();
    if (hmacKey) {
      record.hmacSig = createHmac('sha256', hmacKey)
        .update(JSON.stringify(record))
        .digest('hex')
        .slice(0, 32);
    }
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
    // 权限收紧（对齐 audit-history P1-B1：每次追加后确保 0o600）
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      /* 为何可静默：非 POSIX 平台（Windows）无 chmod 语义，0o600 权限收紧为尽力而为，失败不阻断写入主流程 */
    }
  } catch (err) {
    console.error(
      `[sofagent] 设备事件留痕失败（不阻断）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 校验设备事件链完整性（读侧——验收 ⑤「注册表 HMAC 留痕可追溯」）。
 *
 * 校验内容：prevHash 链衔接 + 内容 hash 重算 + HMAC（有密钥且条目带签名时）。
 * 返回首个断点的行号与原因——供测试与 /health 巡检消费。
 */
export function verifyDeviceEventsChain(dataDir?: string): {
  ok: boolean;
  total: number;
  brokenAt: number | null;
  reason?: 'json-parse-failed' | 'prev-hash-mismatch' | 'content-hash-mismatch' | 'hmac-mismatch';
} {
  const filePath = deviceEventsPath(dataDir);
  if (!fs.existsSync(filePath)) return { ok: true, total: 0, brokenAt: null };
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
  const hmacKey = deviceHmacKey();
  let prevHash: string = 'genesis';
  for (let i = 0; i < lines.length; i++) {
    let rec: DeviceEventRecord;
    try {
      rec = JSON.parse(lines[i]!) as DeviceEventRecord;
    } catch {
      return { ok: false, total: lines.length, brokenAt: i, reason: 'json-parse-failed' };
    }
    if (rec.prevHash !== prevHash) {
      return { ok: false, total: lines.length, brokenAt: i, reason: 'prev-hash-mismatch' };
    }
    const expectHash = createHash('sha256')
      .update(JSON.stringify({ kind: rec.kind, ts: rec.ts, deviceId: rec.deviceId, summary: rec.summary, prevHash: rec.prevHash }))
      .digest('hex')
      .slice(0, 16);
    if (rec.hash !== expectHash) {
      return { ok: false, total: lines.length, brokenAt: i, reason: 'content-hash-mismatch' };
    }
    if (hmacKey && rec.hmacSig) {
      const expectSig = createHmac('sha256', hmacKey)
        .update(JSON.stringify({ kind: rec.kind, ts: rec.ts, deviceId: rec.deviceId, summary: rec.summary, prevHash: rec.prevHash, hash: rec.hash }))
        .digest('hex')
        .slice(0, 32);
      if (rec.hmacSig !== expectSig) {
        return { ok: false, total: lines.length, brokenAt: i, reason: 'hmac-mismatch' };
      }
    }
    prevHash = rec.hash;
  }
  return { ok: true, total: lines.length, brokenAt: null };
}

// ────────────────────────────────────────────────────────────
// 注册 / 查询（G9 核心——验收 ①②④）
// ────────────────────────────────────────────────────────────

/** 注册结果（成功 / 拒绝及原因——fail-closed 语义显式化） */
export interface RegisterResult {
  ok: boolean;
  deviceId?: string;
  reason?: 'invalid-identity' | 'duplicate-device' | 'invalid-params';
  message: string;
}

/**
 * 注册设备（fail-closed 验签——验收 ②：伪造签名 → 拒绝且留审计）。
 *
 * 验签失败 / 身份字段缺失 / publicKey 被篡改 → 拒绝（reason=invalid-identity），
 * 拒绝动作本身写入事件链（留审计）。
 *
 * @param identity 设备身份码（AgentIdentity——须含 publicKey + signature）
 * @param opts 注册参数（kind / capabilities / tenant）
 * @param dataDir 数据目录（测试注入）
 * @param nowIso 时间注入（测试用）
 */
export function registerDevice(
  identity: AgentIdentity,
  opts: { kind: DeviceKind; capabilities: string[]; tenant?: string },
  dataDir?: string,
  nowIso?: string,
): RegisterResult {
  const ts = nowIso ?? new Date().toISOString();
  // 参数校验（fail-closed：身份字段缺失 / kind 非法 → 拒绝并留痕）
  if (!identity || typeof identity.agentId !== 'string' || identity.agentId.length === 0) {
    appendDeviceEvent('register', identity?.agentId ?? 'unknown', '注册拒绝：身份字段缺失（agentId）', dataDir, ts);
    return { ok: false, reason: 'invalid-params', message: '身份字段缺失（agentId）' };
  }
  if (opts.kind !== 'pc' && opts.kind !== 'node' && opts.kind !== 'appliance') {
    appendDeviceEvent('register', identity.agentId, `注册拒绝：设备类型非法（${opts.kind}）`, dataDir, ts);
    return { ok: false, reason: 'invalid-params', message: `设备类型非法：${opts.kind}（合法值 pc/node/appliance）` };
  }
  // 验签 fail-closed（铁律 4）——verifyAgentIdentity 任一绑定信息被篡改即 false，
  // 不降级、不留「待验证」中间态
  if (!verifyAgentIdentity(identity)) {
    appendDeviceEvent('register', identity.agentId, '注册拒绝：Ed25519 验签失败（fail-closed）', dataDir, ts);
    return { ok: false, reason: 'invalid-identity', message: '身份码验签失败（fail-closed）' };
  }
  // 同 agentId 重注册 → 拒绝（不覆盖已注册设备——防「挤占身份」）
  const registry = loadDeviceRegistry(dataDir);
  if (registry.devices.some((d) => d.identity.agentId === identity.agentId)) {
    appendDeviceEvent('register', identity.agentId, '注册拒绝：设备已注册（agentId 唯一，不覆盖）', dataDir, ts);
    return { ok: false, reason: 'duplicate-device', message: '设备已注册（agentId 唯一）' };
  }
  const record: DeviceRecord = {
    identity,
    kind: opts.kind,
    capabilities: Array.isArray(opts.capabilities) ? opts.capabilities : [],
    tenant: opts.tenant ?? 'default',
    registeredAt: ts,
    lastHeartbeatAt: null,
    revoked: false,
    // T10 第三项：注册时未上报（null）——首次心跳携带后填充
    availableModels: null,
    runtimeSkillPackages: null,
  };
  registry.devices.push(record);
  saveDeviceRegistry(registry, dataDir);
  appendDeviceEvent(
    'register',
    identity.agentId,
    `设备注册成功：kind=${opts.kind} capabilities=${record.capabilities.join(',') || '无'} tenant=${record.tenant}`,
    dataDir,
    ts,
  );
  return { ok: true, deviceId: identity.agentId, message: '注册成功' };
}

/** 设备态闸门结果（未注册 / 已吊销 / 验签失败 → 拒绝——验收 ①） */
export interface DeviceGateResult {
  ok: boolean;
  record?: DeviceRecord;
  reason?: 'not-registered' | 'revoked' | 'invalid-identity';
  message: string;
}

/**
 * 设备态接口前置闸门：未注册 / 已吊销 / 身份验签不通过 → 拒绝（验收 ①）。
 *
 * 「调用任何设备态接口」（心跳 / 领任务）都先过这道闸门。验签在闸门内
 * 重做（每请求重验——传入的 identity 必须是完整合法身份码，且公钥与
 * 注册存档一致，防「换公钥冒充已注册设备」）。
 *
 * 已知边界（文件头注释披露）：整体复制合法身份对象的重放不在此层防——
 * 请求级载荷签名排 v1.5.1 事件总线。
 */
export function gateDevice(identity: AgentIdentity, dataDir?: string): DeviceGateResult {
  if (!identity || typeof identity.agentId !== 'string') {
    return { ok: false, reason: 'invalid-identity', message: '身份字段缺失' };
  }
  const registry = loadDeviceRegistry(dataDir);
  const record = registry.devices.find((d) => d.identity.agentId === identity.agentId);
  if (!record) {
    return { ok: false, reason: 'not-registered', message: '设备未注册' };
  }
  if (record.revoked) {
    return { ok: false, reason: 'revoked', message: '设备已被吊销' };
  }
  if (identity.publicKey !== record.identity.publicKey || !verifyAgentIdentity(identity)) {
    return { ok: false, reason: 'invalid-identity', message: '身份码验签失败（公钥与注册存档不一致或签名非法）' };
  }
  return { ok: true, record, message: 'ok' };
}

/**
 * 设备清单查询（验收 ④：只含已验签设备）。
 *
 * 过滤面：只列已注册且未吊销的设备（注册时已过验签——「只含已验签设备」
 * 的语义是清单不含被拒绝 / 吊销条目）；在线态按 isOnline 实时判定
 * （「转离线」是读侧实时计算，不写状态——验收 ③ 的离线态来源）。
 */
export function listDevices(
  dataDir?: string,
  opts: { tenant?: string; kind?: DeviceKind; capability?: string; nowMs?: number } = {},
): Array<DeviceRecord & { online: boolean }> {
  const registry = loadDeviceRegistry(dataDir);
  const nowMs = opts.nowMs ?? Date.now();
  return registry.devices
    .filter((d) => !d.revoked)
    .filter((d) => (opts.tenant ? d.tenant === opts.tenant : true))
    .filter((d) => (opts.kind ? d.kind === opts.kind : true))
    .filter((d) => (opts.capability ? d.capabilities.includes(opts.capability) : true))
    .map((d) => {
      const lastMs = d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).getTime() : null;
      return { ...d, online: isOnline(lastMs, nowMs) };
    });
}

// ────────────────────────────────────────────────────────────
// 心跳（G9 主交付 + T11 捎带 + 验收 ③ 离线告警扫描）
// ────────────────────────────────────────────────────────────

/** 心跳响应体（T11：带 pendingTasks——设备侧拉取式消费，零新增连接） */
export interface HeartbeatResponse {
  ok: boolean;
  reason?: 'not-registered' | 'revoked' | 'invalid-identity';
  message: string;
  /** 服务器时间（设备侧对钟用） */
  serverTime: string;
  /** 待执行任务清单（T11 验收 ①：心跳响应可携带任务清单且设备侧可拉取消费） */
  pendingTasks: DeviceTask[];
  /** 心跳超时阈值（毫秒）——设备侧按此值配置下一跳间隔 */
  heartbeatTimeoutMs: number;
}

/**
 * 心跳上报（更新新鲜度 + T11 捎带待执行任务清单）。
 *
 * 流程：
 *   1. gateDevice 闸门（未注册 / 吊销 / 验签失败 → 拒绝并留痕）；
 *   2. 更新 lastHeartbeatAt 并落盘；
 *   3. 留痕 heartbeat 事件；
 *   4. T11 捎带：读该设备 pending 任务清单（**不在此处置 claimed**——
 *      领取是显式动作 claimDeviceTask，带回执留痕）。
 *
 * 离线告警不在此函数（单一职责）——由 scanOfflineDevices 扫描触发（daemon
 * 巡检周期驱动，见 cli.ts 接线）。
 */
export function reportHeartbeat(
  identity: AgentIdentity,
  opts: {
    dataDir?: string;
    nowIso?: string;
    /** T10 第三项：随心跳上报的本机模型清单（缺省 null = 本次心跳不更新该字段） */
    availableModels?: AvailableModelEntry[] | null;
    /** T10 第三项：随心跳上报的 skill 快照清单（缺省 null = 本次心跳不更新该字段） */
    runtimeSkillPackages?: RuntimeSkillPackage[] | null;
  } = {},
): HeartbeatResponse {
  const ts = opts.nowIso ?? new Date().toISOString();
  const gate = gateDevice(identity, opts.dataDir);
  if (!gate.ok) {
    // 拒绝也留痕（设备态接口的拒绝动作进审计链——验收 ① 的可追溯面）
    appendDeviceEvent('heartbeat', identity?.agentId ?? 'unknown', `心跳拒绝：${gate.message}`, opts.dataDir, ts);
    return {
      ok: false,
      reason: gate.reason,
      message: gate.message,
      serverTime: ts,
      pendingTasks: [],
      heartbeatTimeoutMs: DEVICE_HEARTBEAT_TIMEOUT_MS,
    };
  }
  const record = gate.record!;
  const registry = loadDeviceRegistry(opts.dataDir);
  const dev = registry.devices.find((d) => d.identity.agentId === record.identity.agentId);
  if (dev) {
    dev.lastHeartbeatAt = ts;
    // T10 第三项：上报字段进注册表（undefined = 调用方未带该字段，保留原值——
    // 显式 null 才视为「本次无模型清单」清空；数组则整组替换）
    if (opts.availableModels !== undefined) dev.availableModels = opts.availableModels;
    if (opts.runtimeSkillPackages !== undefined) dev.runtimeSkillPackages = opts.runtimeSkillPackages;
    saveDeviceRegistry(registry, opts.dataDir);
  }
  // 事件留痕摘要带清单计数（回放可查「哪次心跳报了几个模型几个 skill 包」）
  const modelCount = Array.isArray(opts.availableModels) ? opts.availableModels.length : (dev?.availableModels?.length ?? 0);
  const skillCount = Array.isArray(opts.runtimeSkillPackages)
    ? opts.runtimeSkillPackages.length
    : (dev?.runtimeSkillPackages?.length ?? 0);
  appendDeviceEvent(
    'heartbeat',
    record.identity.agentId,
    `心跳：${ts}（models=${modelCount} skills=${skillCount}）`,
    opts.dataDir,
    ts,
  );
  const pendingTasks = loadDeviceTasks(opts.dataDir).tasks.filter(
    (t) => t.deviceId === record.identity.agentId && t.status === 'pending',
  );
  return {
    ok: true,
    message: '心跳已记录',
    serverTime: ts,
    pendingTasks,
    heartbeatTimeoutMs: DEVICE_HEARTBEAT_TIMEOUT_MS,
  };
}

/**
 * 离线扫描（验收 ③：心跳超时 → 转离线并触发 webhook 告警）。
 *
 * 「转离线」= 读侧 isOnline 实时判定（listDevices 的 online 字段）；
 * 本函数扫出已超时设备并逐台：① 事件链留 offline-alarm 痕 ② 回调
 * onAlarm（daemon 侧接线 webhook pusher——复用 engine/daemon/src/webhook/
 * 现有 push 机制）。幂等性：同一设备持续离线会重复告警（每轮巡检一次），
 * 降噪（告警去重/升级）排后续版本。
 *
 * @returns 本轮判离线的设备清单（deviceId + 最后心跳时间）
 */
export function scanOfflineDevices(
  opts: {
    dataDir?: string;
    nowMs?: number;
    onAlarm?: (deviceId: string, lastHeartbeatAt: string | null) => void;
    nowIso?: string;
  } = {},
): Array<{ deviceId: string; lastHeartbeatAt: string | null }> {
  const registry = loadDeviceRegistry(opts.dataDir);
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const offline: Array<{ deviceId: string; lastHeartbeatAt: string | null }> = [];
  for (const d of registry.devices) {
    if (d.revoked) continue; // 吊销设备不产生离线告警（已退出编制）
    const lastMs = d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).getTime() : null;
    if (!isOnline(lastMs, nowMs)) {
      offline.push({ deviceId: d.identity.agentId, lastHeartbeatAt: d.lastHeartbeatAt });
      appendDeviceEvent(
        'offline-alarm',
        d.identity.agentId,
        `离线告警：心跳超时（最后心跳 ${d.lastHeartbeatAt ?? '从未心跳'}）`,
        opts.dataDir,
        nowIso,
      );
      opts.onAlarm?.(d.identity.agentId, d.lastHeartbeatAt);
    }
  }
  return offline;
}

// ────────────────────────────────────────────────────────────
// T11：任务入队 + 领取回执
// ────────────────────────────────────────────────────────────

/** 入队结果 */
export interface EnqueueResult {
  ok: boolean;
  taskId?: string;
  reason?: 'not-registered' | 'revoked' | 'device-offline' | 'invalid-params';
  message: string;
}

/**
 * 派单方写入待执行任务（T11：派单方写入、设备拉取式消费）。
 *
 * 目标设备以 deviceId 指定（派单方不持有设备私钥——与 gateDevice 的
 * 设备自证语义区分）。T12 派单前置条件：目标设备不在线（心跳新鲜度
 * 判定）→ 拒绝（reason=device-offline，验收 T12 ①）并留痕。
 */
export function enqueueDeviceTask(
  deviceId: string,
  task: { title: string; payload: string; dispatchedBy: string },
  opts: { dataDir?: string; nowIso?: string; nowMs?: number } = {},
): EnqueueResult {
  const ts = opts.nowIso ?? new Date().toISOString();
  if (!deviceId || typeof deviceId !== 'string') {
    return { ok: false, reason: 'invalid-params', message: 'deviceId 缺失' };
  }
  if (!task.title || !task.payload) {
    return { ok: false, reason: 'invalid-params', message: 'title / payload 不能为空' };
  }
  const registry = loadDeviceRegistry(opts.dataDir);
  const record = registry.devices.find((d) => d.identity.agentId === deviceId);
  if (!record) {
    return { ok: false, reason: 'not-registered', message: '设备未注册' };
  }
  if (record.revoked) {
    return { ok: false, reason: 'revoked', message: '设备已被吊销' };
  }
  // T12 验收 ①：离线设备不接新单（心跳新鲜度判定——fail-closed）
  const nowMs = opts.nowMs ?? Date.now();
  const lastMs = record.lastHeartbeatAt ? new Date(record.lastHeartbeatAt).getTime() : null;
  if (!isOnline(lastMs, nowMs)) {
    appendDeviceEvent('dispatch-reassign', deviceId, `派单拒绝：设备离线（最后心跳 ${record.lastHeartbeatAt ?? '从未心跳'}）`, opts.dataDir, ts);
    return { ok: false, reason: 'device-offline', message: '设备离线，不接新单（T12：在线才派单）' };
  }
  const tasks = loadDeviceTasks(opts.dataDir);
  const entry: DeviceTask = {
    id: randomUUID(),
    deviceId,
    title: task.title,
    payload: task.payload,
    dispatchedBy: task.dispatchedBy,
    enqueuedAt: ts,
    status: 'pending',
  };
  tasks.tasks.push(entry);
  saveDeviceTasks(tasks, opts.dataDir);
  appendDeviceEvent('dispatch-reassign', deviceId, `任务入队：${entry.id.slice(0, 8)}「${task.title}」（by ${task.dispatchedBy}）`, opts.dataDir, ts);
  return { ok: true, taskId: entry.id, message: '任务已入队' };
}

/** 领取结果（含回执 hash——T11 验收 ②：回执进审计链可验签回溯） */
export interface ClaimResult {
  ok: boolean;
  task?: DeviceTask;
  reason?: 'not-registered' | 'revoked' | 'invalid-identity' | 'no-tasks' | 'invalid-task-id';
  message: string;
  /** 回执在事件链中的 hash（验签回溯锚点） */
  receiptHash?: string;
}

/**
 * 设备领取任务（T11 验收 ②：领任务回执进审计链——谁 / 何时 / 领了什么）。
 *
 * 领取动作：pending → claimed + 回执 HMAC 留痕（receiptHash 返回调用方，
 * 可经 verifyDeviceEventsChain 回溯验证）。
 *
 * @param identity 设备身份（设备自证——过 gateDevice 闸门）
 * @param opts.taskId 指定领取的任务 ID（缺省领取最早入队的 pending 任务）
 */
export function claimDeviceTask(
  identity: AgentIdentity,
  opts: { taskId?: string; dataDir?: string; nowIso?: string } = {},
): ClaimResult {
  const ts = opts.nowIso ?? new Date().toISOString();
  const gate = gateDevice(identity, opts.dataDir);
  if (!gate.ok) {
    appendDeviceEvent('claim', identity?.agentId ?? 'unknown', `领任务拒绝：${gate.message}`, opts.dataDir, ts);
    return { ok: false, reason: gate.reason, message: gate.message };
  }
  const record = gate.record!;
  const tasks = loadDeviceTasks(opts.dataDir);
  const mine = tasks.tasks.filter((t) => t.deviceId === record.identity.agentId && t.status === 'pending');
  if (mine.length === 0) {
    return { ok: false, reason: 'no-tasks', message: '无待领取任务' };
  }
  const target = opts.taskId ? mine.find((t) => t.id === opts.taskId) : mine[0]!;
  if (!target) {
    return { ok: false, reason: 'invalid-task-id', message: `任务不属于本设备或已领取：${opts.taskId}` };
  }
  target.status = 'claimed';
  target.claimedAt = ts;
  saveDeviceTasks(tasks, opts.dataDir);
  appendDeviceEvent(
    'claim',
    record.identity.agentId,
    `领任务回执：${target.id.slice(0, 8)}「${target.title}」by ${target.dispatchedBy}`,
    opts.dataDir,
    ts,
  );
  const chain = readLastDeviceEvent(opts.dataDir);
  return { ok: true, task: target, message: '已领取', receiptHash: chain?.hash };
}

// ────────────────────────────────────────────────────────────
// T12：掉线改派 / 挂起告警（验收 ②）
// ────────────────────────────────────────────────────────────

/** 改派 / 挂起判定结果 */
export interface ReassignResult {
  ok: boolean;
  /** 改派目标 deviceId（ok=true 时有值） */
  reassignedTo?: string;
  /** 未改派原因（ok=false 时有值） */
  reason?: 'no-candidate' | 'held-for-alarm';
  /** 挂起告警文案（reason=held-for-alarm / no-candidate 时有值——onHoldAlarm 的同款内容） */
  holdMessage?: string;
  message: string;
}

/**
 * 已派设备掉线 → 改派同能力在线设备，或按配置挂起告警（T12 验收 ②）。
 *
 * 语义（任务书 T12）：本版只做「派不派 + 掉线怎么办」的最小语义——
 * 改派候选 = 与原设备**至少一个共同能力标签**的在线设备（同能力匹配；
 * 负载 / 数据 locality 路由不实做——那是 v1.5.1 事件总线的范畴，T13 评估项）。
 *
 * @param offlineDeviceId 掉线原设备的 deviceId
 * @param task 待改派的任务（title / payload / dispatchedBy）
 * @param opts.mode 'reassign'（缺省——尝试改派；无候选则挂起告警）| 'hold'（按配置直接挂起告警）
 * @param opts.onHoldAlarm 挂起告警回调（daemon 侧接线 webhook pusher）
 */
export function reassignOrHold(
  offlineDeviceId: string,
  task: { title: string; payload: string; dispatchedBy: string },
  opts: {
    mode?: 'reassign' | 'hold';
    dataDir?: string;
    nowIso?: string;
    nowMs?: number;
    onHoldAlarm?: (message: string) => void;
  } = {},
): ReassignResult {
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = opts.nowIso ?? new Date().toISOString();
  // 挂起模式（配置驱动）：直接挂起 + 告警回调
  if (opts.mode === 'hold') {
    appendDeviceEvent('dispatch-reassign', offlineDeviceId, `任务挂起：原设备掉线，按配置挂起告警「${task.title}」`, opts.dataDir, nowIso);
    const holdMsg = `设备 ${offlineDeviceId.slice(0, 8)} 掉线，任务「${task.title}」已挂起（等待人工处置）`;
    opts.onHoldAlarm?.(holdMsg);
    return { ok: false, reason: 'held-for-alarm', holdMessage: holdMsg, message: '已挂起并告警' };
  }
  // 改派模式：找同能力在线设备（排除掉线设备自己 + 吊销设备）
  const registry = loadDeviceRegistry(opts.dataDir);
  const offline = registry.devices.find((d) => d.identity.agentId === offlineDeviceId);
  const offlineCaps = offline?.capabilities ?? [];
  const candidates = registry.devices.filter((d) => {
    if (d.revoked || d.identity.agentId === offlineDeviceId) return false;
    const lastMs = d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).getTime() : null;
    return isOnline(lastMs, nowMs) && d.capabilities.some((c) => offlineCaps.includes(c));
  });
  if (candidates.length === 0) {
    // 无候选 → 挂起 + 告警（fail-closed：不盲目改派给能力不符的设备）
    appendDeviceEvent('dispatch-reassign', offlineDeviceId, `改派失败：无同能力在线候选，任务挂起「${task.title}」`, opts.dataDir, nowIso);
    const holdMsg = `设备 ${offlineDeviceId.slice(0, 8)} 掉线且无同能力在线设备，任务「${task.title}」已挂起`;
    opts.onHoldAlarm?.(holdMsg);
    return { ok: false, reason: 'no-candidate', holdMessage: holdMsg, message: '无同能力在线候选，已挂起告警' };
  }
  // 首个候选即改派目标（最小语义——不做负载路由）
  const target = candidates[0]!;
  const enqueue = enqueueDeviceTask(target.identity.agentId, task, { dataDir: opts.dataDir, nowIso, nowMs });
  if (!enqueue.ok) {
    // 改派入队失败（竞争窗口内候选恰好掉线等）→ 挂起告警（fail-closed）
    appendDeviceEvent('dispatch-reassign', offlineDeviceId, `改派入队失败（候选 ${target.identity.agentId.slice(0, 8)}：${enqueue.message}），任务挂起「${task.title}」`, opts.dataDir, nowIso);
    const holdMsg = `改派候选 ${target.identity.agentId.slice(0, 8)} 入队失败：${enqueue.message}——任务「${task.title}」已挂起`;
    opts.onHoldAlarm?.(holdMsg);
    return { ok: false, reason: 'no-candidate', holdMessage: holdMsg, message: enqueue.message };
  }
  appendDeviceEvent(
    'dispatch-reassign',
    offlineDeviceId,
    `已改派：${target.identity.agentId.slice(0, 8)} 接手「${task.title}」（by ${task.dispatchedBy}）`,
    opts.dataDir,
    nowIso,
  );
  return { ok: true, reassignedTo: target.identity.agentId, message: `已改派至 ${target.identity.agentId}` };
}

// ────────────────────────────────────────────────────────────
// 持久化（读 / 写 / 默认值——注册表 + 任务队列）
// ────────────────────────────────────────────────────────────

/** 读注册表（文件不存在 / 损坏 → 空表——首启零设备；损坏不阻断 daemon 启动） */
export function loadDeviceRegistry(dataDir?: string): DeviceRegistryFile {
  const p = deviceRegistryPath(dataDir);
  if (!fs.existsSync(p)) return { version: 1, devices: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as DeviceRegistryFile;
    if (raw && Array.isArray(raw.devices)) return raw;
  } catch {
    /* 为何可静默：注册表损坏按空表 fail-open——读取面损坏不阻断注册流程，重注册即恢复；写入侧仍严格报错 */
  }
  return { version: 1, devices: [] };
}

/** 写注册表（目录 0o700 / 文件 0o600——权限收紧，对齐 audit-history 纪律） */
export function saveDeviceRegistry(registry: DeviceRegistryFile, dataDir?: string): void {
  const p = deviceRegistryPath(dataDir);
  if (!fs.existsSync(path.dirname(p))) {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(p, JSON.stringify(registry, null, 2), 'utf-8');
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* 为何可静默：非 POSIX 平台（Windows）无 chmod 语义，0o600 权限收紧为尽力而为，失败不阻断写入主流程 */
  }
}

/** 读任务队列（文件不存在 / 损坏 → 空队列） */
export function loadDeviceTasks(dataDir?: string): DeviceTasksFile {
  const p = deviceTasksPath(dataDir);
  if (!fs.existsSync(p)) return { version: 1, tasks: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as DeviceTasksFile;
    if (raw && Array.isArray(raw.tasks)) return raw;
  } catch {
    /* 为何可静默：任务队列损坏按空队列 fail-open——同上读取面纪律（写入侧严格） */
  }
  return { version: 1, tasks: [] };
}

/** 写任务队列（目录 0o700 / 文件 0o600） */
export function saveDeviceTasks(tasks: DeviceTasksFile, dataDir?: string): void {
  const p = deviceTasksPath(dataDir);
  if (!fs.existsSync(path.dirname(p))) {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(p, JSON.stringify(tasks, null, 2), 'utf-8');
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* 为何可静默：非 POSIX 平台（Windows）无 chmod 语义，0o600 权限收紧为尽力而为，失败不阻断写入主流程 */
  }
}

/** 读事件链尾（回执 hash 返回用——claimDeviceTask 消费） */
function readLastDeviceEvent(dataDir?: string): DeviceEventRecord | null {
  const p = deviceEventsPath(dataDir);
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]!) as DeviceEventRecord;
  } catch {
    return null;
  }
}
