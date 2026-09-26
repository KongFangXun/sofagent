// ============================================================
// subscriptions.ts · 设备侧事件订阅登记（v1.5.3 第四 + 五章）
// ============================================================
//
// 三类事件共用**同一推送底座**（本版第一章事件总线，`@sofagent/orchestrator`
// 的 `events/**` 交付，dev-events 组独占）：
//   · `device.upgrade`       —— 升级指令 → OTA 执行器（upgrade-executor.ts）
//   · `device.deploy`        —— 平台→设备内容下发（skill/workflow 模板包）→ 验签 →
//                               G1 五件套格式校验 → 落盘注册（校验器经端口注入，
//                               实现在 MCP 侧复用既有 `workflow_import`，不另立格式）
//   · `device.task.dispatch` —— 任务清单 → 领取回执进 HMAC 链；离线回落心跳捎带
//     ⚠️ **零验签**（诚实披露）：三条下发面中只有 `device.deploy`（:257）调用
//     `verifyDeliverySignature`；`device.upgrade` 的验签在执行器内部
//     （upgrade-executor.ts）；**任务下发通道 `deliverTaskDispatch`（:299）全路径
//     无任何签名校验**——本版未接真实传输（注入端口），故不可被外部触发，
//     属设计期已知缺口而非已暴露面；接真实传输前必须补任务面验签。
//
// ── 事件类型与总线：**只消费不重建**（任务书硬边界）────────────
// 本文件不定义事件名、不定义总线、不建第二套类型：
//   · 事件名从 `EVENT_TYPES`（第一章 types.ts 的单一事实源）取；
//   · 订阅入参类型直接取总线 `EventBus.subscribe` 的签名（`Pick<EventBus,'subscribe'>`）；
//   · 处理器入参就是总线事件本体 `SofagentEvent`（读 `type` / `payload` / `correlationId`）。
// 三个事件类型共用同一 `bus.subscribe` 底座——任务下发未另起一套总线。
//
// ── 注册点 / 挂载点（自查第 2 条——「只做这些，它会自动生效吗？」）────
// 唯一登记处＝本文件导出的数组常量 + 覆盖式登记函数：
//   · `DEVICE_OTA_SUBSCRIPTIONS`（条目形如 `{ topic, description, handler, enabled }`）
//     —— 照本仓 `engine/daemon/src/inspectors/registry.ts` 的 `INSPECTORS` 表先例，
//     新增订阅只在此数组加一行，登记函数自动挂载，杜绝「写了 handler 没人接」。
//   · `registerDeviceOtaSubscriptions(bus, opts)` —— 遍历上表逐条 `bus.subscribe`，
//     返回 unsubscribe 句柄数组（幂等可退订）。
//   · 生产调用点（设备侧）：`engine/mcp/src/tools/device-register.ts` 的
//     `registerDeviceSubscriptions()` —— 设备注册成功后由设备进程调用，把三条
//     订阅挂到设备本地总线，并注入 G1 导入器与 G11 版本清单上报端口。
//
// ── 双通道回落（第五章，复用不新建）────────────────────────
// 在线：推送底座直达 → 立即入 G9 队列并领取（`claimDeviceTask` 回执进
//       device-events.jsonl HMAC 链）——不等心跳轮询。
// 离线：推送不可达且心跳离线 → 任务进 `ota/state.json` 的 `pendingDispatches`
//       暂存；设备重新上线（`onDeviceOnline`）→ 补投进 **G9 心跳捎带队列**
//       （`enqueueDeviceTask`）→ 下一次心跳响应 `pendingTasks` 捎带 → 设备领取。
//       ⚠️ 回落**通道**仍是 v1.4.9 心跳捎带（零新增通道）；暂存队列只是
//       「离线期间不丢」的落盘缓冲区，不承担投递语义。
// ============================================================

import type { AgentIdentity } from '@sofagent/core';
import { EVENT_TYPES, type EventBus, type SofagentEvent } from '@sofagent/orchestrator';
import { listDevices, isOnline, enqueueDeviceTask, claimDeviceTask } from '../device-registry';
import {
  emitDeviceAudit,
  executeDeviceUpgrade,
  resumeSuspendedUpgrades,
  sha256Hex,
  verifyDeliverySignature,
  type DeviceUpgradePayload,
  type UpgradeExecutorOptions,
  type UpgradeResult,
} from './upgrade-executor';
import {
  clearSuspendedUpgrade,
  holdTaskDispatch,
  listHeldTaskDispatches,
  takeHeldTaskDispatches,
} from './upgrade-policy';

// ────────────────────────────────────────────────────────────
// 总线端口（直接取第一章 EventBus 的订阅面——零类型复制）
// ────────────────────────────────────────────────────────────

/**
 * 设备侧订阅所需的总线端口。
 *
 * 结构性等于第一章 `EventBus` 的公开订阅面（`subscribe(type, handler) => 退订句柄`），
 * 故真实 `new EventBus(...)` 实例可直接传入；测试可用同形假总线。
 */
export type DeviceEventBusPort = Pick<EventBus, 'subscribe'>;

/** 总线事件（处理器入参＝第一章事件本体，不另立 envelope 类型） */
export type DeviceEventEnvelope = SofagentEvent;

/**
 * 设备事件 topic（取第一章 `EVENT_TYPES` 单一事实源——本文件不复制事件名）。
 *
 * ⚠️ 任务下发的事件名是 `device.task.dispatch`（第一章 types.ts 登记值），
 * 非任务书行文里的简写 `device.task`——以登记表为准。
 */
export const DEVICE_EVENT_TOPICS = {
  upgrade: EVENT_TYPES.DEVICE_UPGRADE,
  deploy: EVENT_TYPES.DEVICE_DEPLOY,
  task: EVENT_TYPES.DEVICE_TASK_DISPATCH,
} as const;

// ────────────────────────────────────────────────────────────
// 端口类型（跨包注入面）
// ────────────────────────────────────────────────────────────

/**
 * G1 五件套导入器端口。
 *
 * 实现在 MCP 侧复用既有 `workflow_import`（`engine/mcp/src/tools/workflow-import.ts`
 * ——结构闸 / 完整性核对 / schema 门 / 落地闸四道，模板包格式与既有 G1 完全一致）。
 * daemon 包不得 import @sofagent/mcp（mcp 反向 optionalDepend daemon，硬依赖成包循环），
 * 故经端口注入。
 */
export type DeployImporterPort = (args: {
  bundle: Record<string, unknown>;
  imported_as?: string;
  actor?: string;
  data_dir?: string;
}) => Promise<{ ok: boolean; importedAs?: string; code?: string; message: string }>;

// ── 设备下发面 payload：**不在本地定义**（契约单一事实源）────────
// 唯一定义处 = @sofagent/orchestrator 的 events/types.ts（v1.5.1 收口①）。
// 任务条目不再用本地内联匿名类型——`payload.tasks` 的元素类型由契约的
// `DeviceTaskItem` 提供（结构同形，读法零改动）。
import type {
  DeviceDeployPayload,
  DeviceTaskDispatchPayload,
} from '@sofagent/orchestrator';

export type { DeviceDeployPayload, DeviceTaskDispatchPayload };

/** 下发结果 */
export interface TaskDispatchResult {
  ok: boolean;
  /** 实际走的通道：push（在线推送直达）/ heartbeat-fallback（离线回落暂存） */
  channel: 'push' | 'heartbeat-fallback';
  /** 已投递（含回执 hash） */
  delivered: Array<{ title: string; taskId?: string; receiptHash?: string }>;
  /** 暂存待补投的任务标题 */
  held: string[];
  auditLogged: boolean;
  message: string;
}

/** 订阅登记条目（登记表元素） */
export interface DeviceSubscriptionEntry {
  topic: string;
  description: string;
  /** 表内置缺省处理器（登记函数会用带身份与端口的闭包覆盖；保留以便静态巡检） */
  handler: (event: DeviceEventEnvelope) => void | Promise<void>;
  enabled: boolean;
}

/** 订阅登记选项 */
export interface DeviceSubscriptionOptions {
  /** 设备身份（设备自证——执行面闸门依据） */
  identity: AgentIdentity;
  dataDir?: string;
  nowMs?: number;
  nowIso?: string;
  /** G1 五件套导入器（生产：MCP 侧绑定 `workflow_import`） */
  deployImporter?: DeployImporterPort;
  /** 版本清单上报端口（生产：MCP 侧绑定 G11 `device_data_push`） */
  pushVersionManifest?: UpgradeExecutorOptions['pushVersionManifest'];
  /** 执行器端口覆盖（测试注入 pull/install/probe/policy 等） */
  executor?: Omit<UpgradeExecutorOptions, 'identity'>;
}

// ────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────

/** 递归键排序的稳定序列化（交付摘要输入——消除键序不确定性） */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** 包摘要（deploy / upgrade 共用同一摘要口径：sha256 of 稳定序列化） */
export function bundleDigest(bundle: Record<string, unknown>): string {
  return sha256Hex(stableStringify(bundle));
}

/** 目标设备解析（payload.targetDevice 优先，回落总线 metadata.targetDevice） */
function resolveTargetDevice(event: DeviceEventEnvelope, payloadTarget?: string): string | undefined {
  if (typeof payloadTarget === 'string' && payloadTarget !== '') return payloadTarget;
  const meta = event.metadata?.['targetDevice'];
  return typeof meta === 'string' && meta !== '' ? meta : undefined;
}

/** 设备当前是否在线（G9 心跳新鲜度——离线即推送不可达） */
function isDeviceOnline(deviceId: string, opts: { dataDir?: string; nowMs?: number }): boolean {
  const nowMs = opts.nowMs ?? Date.now();
  const record = listDevices(opts.dataDir, { nowMs }).find((d) => d.identity.agentId === deviceId);
  const lastMs = record?.lastHeartbeatAt ? new Date(record.lastHeartbeatAt).getTime() : null;
  return isOnline(lastMs, nowMs);
}

/** 汇总执行器选项（身份 + 数据目录 + 注入端口 + 总线追溯键） */
function withExecutorPorts(
  opts: DeviceSubscriptionOptions,
  trace?: { correlationId?: string },
): UpgradeExecutorOptions {
  return {
    identity: opts.identity,
    ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
    ...(opts.nowMs !== undefined ? { nowMs: opts.nowMs } : {}),
    ...(opts.nowIso !== undefined ? { nowIso: opts.nowIso } : {}),
    ...(opts.pushVersionManifest !== undefined ? { pushVersionManifest: opts.pushVersionManifest } : {}),
    ...(opts.executor ?? {}),
    ...(trace?.correlationId !== undefined ? { correlationId: trace.correlationId } : {}),
  };
}

// ────────────────────────────────────────────────────────────
// 处理器：device.upgrade / device.deploy / device.task.dispatch
// ────────────────────────────────────────────────────────────

/** 升级事件处理（第四章节流：执行器全权，本处只做定向核对与结果收敛） */
async function handleUpgradeEvent(
  event: DeviceEventEnvelope,
  opts: DeviceSubscriptionOptions,
): Promise<UpgradeResult | null> {
  const payload = event.payload as DeviceUpgradePayload | undefined;
  if (!payload || typeof payload !== 'object') return null;
  const target = resolveTargetDevice(event, (payload as unknown as { targetDevice?: string }).targetDevice);
  // 定向投递：事件指定他机时不处理（总线广播场景防串机）
  if (target !== undefined && target !== opts.identity.agentId) return null;
  return executeDeviceUpgrade(payload, withExecutorPorts(opts, { correlationId: event.correlationId }));
}

/**
 * 内容下发事件处理（`device.deploy`）。
 *
 * 链路：定向核对 → 验签（Ed25519 交付签名，fail-closed）→ G1 五件套导入器
 * （格式校验 + 落盘注册，校验口径与既有 G1 一致，不另立格式）→ 审计留痕。
 */
async function handleDeployEvent(
  event: DeviceEventEnvelope,
  opts: DeviceSubscriptionOptions,
): Promise<{ ok: boolean; code?: string; message: string; auditLogged: boolean }> {
  const payload = event.payload as DeviceDeployPayload | undefined;
  const deviceId = opts.identity?.agentId ?? 'unknown';
  const nowIso = opts.nowIso ?? event.ts ?? new Date().toISOString();
  const trace = [`correlationId=${event.correlationId}`, `eventId=${event.id}`];
  const reject = (code: string, message: string): { ok: boolean; code: string; message: string; auditLogged: boolean } => {
    const auditLogged = emitDeviceAudit({
      deviceId,
      outcome: 'rejected',
      why: `device.deploy 下发拒绝：${message}`,
      evidence: [...trace, `code=${code}`, `bundleId=${String(payload?.bundleId ?? 'unknown')}`],
      ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
      nowIso,
    });
    return { ok: false, code, message, auditLogged };
  };

  if (!payload || typeof payload !== 'object' || !payload.bundle || typeof payload.bundle !== 'object') {
    return reject('invalid-params', 'payload 缺 bundle（G1 五件套模板包）');
  }
  const target = resolveTargetDevice(event, payload.targetDevice);
  if (target !== undefined && target !== deviceId) {
    // 他机指令——静默忽略（不审计，避免广播风暴噪声）
    return { ok: false, code: 'not-target', message: '非本机指令，忽略', auditLogged: false };
  }
  // ── 验签（fail-closed——伪造签名模板包被拒）──
  const digest = bundleDigest(payload.bundle);
  const label = `device-deploy|bundle=${payload.bundleId ?? 'unnamed'}`;
  const verify = verifyDeliverySignature(payload.signature, label, digest);
  if (!verify.ok) return reject(verify.reason ?? 'invalid-signature', verify.message);

  // ── G1 五件套格式校验 + 落盘注册（复用既有导入面，经端口注入）──
  if (!opts.deployImporter) {
    return reject('no-importer', 'G1 五件套导入器未注入（生产应由 MCP 侧 workflow_import 提供）');
  }
  let imported: { ok: boolean; importedAs?: string; code?: string; message: string };
  try {
    imported = await opts.deployImporter({
      bundle: payload.bundle,
      ...(payload.importedAs !== undefined ? { imported_as: payload.importedAs } : {}),
      actor: `device-deploy:${deviceId.slice(0, 8)}`,
      ...(opts.dataDir !== undefined ? { data_dir: opts.dataDir } : {}),
    });
  } catch (err) {
    return reject('importer-error', `导入器抛错：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!imported.ok) return reject(imported.code ?? 'import-rejected', imported.message);

  const auditLogged = emitDeviceAudit({
    deviceId,
    outcome: 'deployed',
    why: `device.deploy 下发完成：模板包 ${payload.bundleId ?? 'unnamed'} 验签通过并落盘注册为「${imported.importedAs ?? 'unknown'}」`,
    evidence: [
      ...trace,
      `digest=${digest}`,
      `importedAs=${imported.importedAs ?? 'unknown'}`,
      `bundleId=${payload.bundleId ?? 'unknown'}`,
    ],
    ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
    nowIso,
  });
  return { ok: true, message: imported.message, auditLogged };
}

/**
 * 任务下发事件处理（第五章）。
 *
 * 在线 → 推送直达：入 G9 队列 + 立即领取（回执进 HMAC 链）——不等心跳轮询。
 * 离线 → 回落：任务进暂存队列，设备上线后补投进 G9 心跳捎带队列。
 */
export async function deliverTaskDispatch(
  payload: DeviceTaskDispatchPayload,
  opts: DeviceSubscriptionOptions & { eventTs?: string; correlationId?: string },
): Promise<TaskDispatchResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = opts.nowIso ?? opts.eventTs ?? new Date().toISOString();
  const deviceId = opts.identity?.agentId ?? 'unknown';
  const delivered: TaskDispatchResult['delivered'] = [];
  const held: string[] = [];

  if (!payload || !Array.isArray(payload.tasks) || payload.tasks.length === 0) {
    return {
      ok: false,
      channel: 'push',
      delivered,
      held,
      auditLogged: false,
      message: '任务下发 payload 非法（tasks 为空）',
    };
  }
  if (typeof payload.targetDevice === 'string' && payload.targetDevice !== '' && payload.targetDevice !== deviceId) {
    return { ok: false, channel: 'push', delivered, held, auditLogged: false, message: '非本机任务下发，忽略' };
  }
  // 时效：超时任务不投递（fail-closed）
  if (typeof payload.ttlMs === 'number' && payload.ttlMs >= 0 && typeof opts.eventTs === 'string') {
    const sentMs = Date.parse(opts.eventTs);
    if (Number.isFinite(sentMs) && nowMs - sentMs > payload.ttlMs) {
      return {
        ok: false,
        channel: 'push',
        delivered,
        held,
        auditLogged: false,
        message: `任务下发已过时效（${nowMs - sentMs}ms > ${payload.ttlMs}ms）`,
      };
    }
  }

  const trace = opts.correlationId !== undefined ? [`correlationId=${opts.correlationId}`] : [];
  const online = isDeviceOnline(deviceId, opts);
  if (!online) {
    // ── 离线回落：暂存，等上线补投（回落通道仍是 G9 心跳捎带）──
    for (const t of payload.tasks) {
      holdTaskDispatch(
        {
          deviceId,
          task: { title: t.title, payload: t.payload, dispatchedBy: t.dispatchedBy ?? 'orchestrator' },
          reason: 'device-offline',
          suspendedAt: nowIso,
        },
        opts.dataDir,
      );
      held.push(t.title);
    }
    const auditLogged = emitDeviceAudit({
      deviceId,
      outcome: 'suspended',
      why: `任务下发回落：设备心跳离线，${held.length} 个任务暂存，上线后经心跳捎带补收（不丢）`,
      evidence: [...trace, `held=${held.length}`, 'channel=heartbeat-fallback', `ttlMs=${String(payload.ttlMs ?? 'none')}`],
      ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
      nowIso,
    });
    return {
      ok: false,
      channel: 'heartbeat-fallback',
      delivered,
      held,
      auditLogged,
      message: `设备离线，${held.length} 个任务已暂存等待上线补收`,
    };
  }

  // ── 在线推送直达：入队 → 立即领取（回执 HMAC 留痕）──
  for (const t of payload.tasks) {
    const enq = enqueueDeviceTask(
      deviceId,
      { title: t.title, payload: t.payload, dispatchedBy: t.dispatchedBy ?? 'orchestrator' },
      { ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}), nowIso, nowMs },
    );
    if (!enq.ok || !enq.taskId) {
      held.push(t.title);
      continue;
    }
    const claim = claimDeviceTask(opts.identity, {
      taskId: enq.taskId,
      ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
      nowIso,
    });
    delivered.push({
      title: t.title,
      taskId: enq.taskId,
      ...(claim.receiptHash !== undefined ? { receiptHash: claim.receiptHash } : {}),
    });
  }

  const auditLogged = emitDeviceAudit({
    deviceId,
    outcome: 'dispatched',
    why: `任务下发推送直达：${delivered.length} 个任务已领取（回执进 HMAC 链，不等心跳轮询）`,
    evidence: [
      ...trace,
      `delivered=${delivered.length}`,
      `receiptHashes=${delivered.map((d) => d.receiptHash ?? 'none').join(',')}`,
      ...(held.length > 0 ? [`held=${held.length}`] : []),
    ],
    ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
    nowIso,
  });
  return {
    ok: held.length === 0,
    channel: 'push',
    delivered,
    held,
    auditLogged,
    message: `推送直达：${delivered.length} 个任务已领取${held.length > 0 ? `，${held.length} 个未入队` : ''}`,
  };
}

/**
 * 设备上线钩子——两件事一起做（第四 + 五章的「恢复后自动补升 / 补收」）：
 *   1. 挂起中的升级指令自动补升（resumeSuspendedUpgrades）；
 *   2. 离线期间暂存的任务补投进 G9 心跳捎带队列（下一次心跳响应即捎带）。
 */
export async function onDeviceOnline(opts: DeviceSubscriptionOptions): Promise<{
  resumedUpgrades: UpgradeResult[];
  flushedTasks: string[];
}> {
  const deviceId = opts.identity?.agentId ?? 'unknown';
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const nowMs = opts.nowMs ?? Date.now();

  const resumedUpgrades = await resumeSuspendedUpgrades(withExecutorPorts(opts));

  const flushedTasks: string[] = [];
  const heldItems = takeHeldTaskDispatches(deviceId, opts.dataDir);
  for (const item of heldItems) {
    const enq = enqueueDeviceTask(deviceId, item.task, {
      ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
      nowMs,
      nowIso,
    });
    if (enq.ok) {
      flushedTasks.push(item.task.title);
    } else {
      // 仍未上线 / 竞争窗口内掉线 → 放回暂存（不丢）
      holdTaskDispatch(item, opts.dataDir);
    }
  }
  if (flushedTasks.length > 0) {
    emitDeviceAudit({
      deviceId,
      outcome: 'dispatched',
      why: `离线任务补投：${flushedTasks.length} 个暂存任务已进 G9 心跳捎带队列（下一跳心跳响应捎带）`,
      evidence: [`flushed=${flushedTasks.length}`, 'channel=heartbeat-fallback', `resumedUpgrades=${resumedUpgrades.length}`],
      ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
      nowIso,
    });
  }
  return { resumedUpgrades, flushedTasks };
}

/** 离线暂存任务清单（巡检 / 测试对账） */
export function listHeldTasks(deviceId: string, dataDir?: string): string[] {
  return listHeldTaskDispatches(deviceId, dataDir).map((p) => p.task.title);
}

// ────────────────────────────────────────────────────────────
// 订阅登记表 + 覆盖式登记函数（注册点）
// ────────────────────────────────────────────────────────────

/**
 * 设备侧订阅登记表——**新增订阅只在本数组加一行**。
 *
 * 照 `engine/daemon/src/inspectors/registry.ts` 的 `INSPECTORS` 表先例：
 * 数据表 + 派生挂载，杜绝「写了 handler 没人接」的静默不生效。
 *
 * 注：表内 `handler` 为占位（登记函数会用带身份与端口的闭包覆盖）——
 * 保留同一签名以便静态巡检「每条 topic 都有处理器」。
 */
export const DEVICE_OTA_SUBSCRIPTIONS: DeviceSubscriptionEntry[] = [
  {
    topic: DEVICE_EVENT_TOPICS.upgrade,
    description: 'G12 升级指令 → OTA 执行器（拉取 → 验签 → 灰度 → 回滚 → 版本清单上报）',
    enabled: true,
    handler: () => undefined,
  },
  {
    topic: DEVICE_EVENT_TOPICS.deploy,
    description: 'G12 内容下发 → 验签 → G1 五件套格式校验 → 落盘注册',
    enabled: true,
    handler: () => undefined,
  },
  {
    topic: DEVICE_EVENT_TOPICS.task,
    description: '第五章 任务下发 → 在线推送直达领取回执 / 离线回落心跳捎带',
    enabled: true,
    handler: () => undefined,
  },
];

/**
 * 把设备侧订阅挂到事件总线（覆盖式登记——处理器在此闭包化携带身份与端口）。
 *
 * @param bus 事件总线（第一章 `EventBus` 实例或其同形实现）
 * @param opts 设备身份 + 端口（G1 导入器 / G11 上报端口）
 * @returns unsubscribe 句柄数组（逐个调用即退订）
 */
export function registerDeviceOtaSubscriptions(
  bus: DeviceEventBusPort,
  opts: DeviceSubscriptionOptions,
): Array<() => void> {
  const handles: Array<() => void> = [];
  for (const entry of DEVICE_OTA_SUBSCRIPTIONS) {
    if (!entry.enabled) continue;
    const topic = entry.topic;
    let handler: (event: DeviceEventEnvelope) => void | Promise<void>;
    if (topic === DEVICE_EVENT_TOPICS.upgrade) {
      handler = async (event) => {
        await handleUpgradeEvent(event, opts);
      };
    } else if (topic === DEVICE_EVENT_TOPICS.deploy) {
      handler = async (event) => {
        await handleDeployEvent(event, opts);
      };
    } else if (topic === DEVICE_EVENT_TOPICS.task) {
      handler = async (event) => {
        await deliverTaskDispatch(event.payload as DeviceTaskDispatchPayload, {
          ...opts,
          eventTs: event.ts,
          correlationId: event.correlationId,
        });
      };
    } else {
      handler = entry.handler;
    }
    handles.push(bus.subscribe(topic, handler));
  }
  return handles;
}
