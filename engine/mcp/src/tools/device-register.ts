// ============================================================
// device-register.ts · MCP tool：设备上线注册（v1.5.1 G9 · T1）
// ============================================================
//
// 设备注册面（G9）：设备身份码验签（fail-closed）+ 设备类型 + 能力声明。
//
// 形态照抄 daemon-status.ts：text 首行 [sofagent] 前缀 + data 结构化。
// 实现经 @sofagent/daemon 的 registerDevice（lazy import optionalDependencies
// 模式——daemon 未安装时友好提示不崩溃）。
//
// 注册语义（changelog 一章交付表）：
//   - 身份码验签 fail-closed（伪造签名 → 拒绝且留审计）
//   - 设备类型 pc / node / appliance
//   - 能力声明（挂载的 MCP / skill / 数据源清单——派单方按能力匹配）
// ============================================================

/** 注册结果（结构化——与 daemon registerDevice 的 RegisterResult 对齐） */
export interface DeviceRegisterResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    ok: boolean;
    deviceId?: string;
    reason?: 'invalid-identity' | 'duplicate-device' | 'invalid-params' | 'daemon-unavailable';
    message: string;
  };
}

/**
 * 设备上线注册（G9）。
 *
 * 延迟导入 @sofagent/daemon（optionalDependencies——与 daemon-status 同款）。
 *
 * @param args 注册参数
 * @param args.identity 设备身份码（AgentIdentity JSON——须含 publicKey + signature）
 * @param args.kind 设备类型（pc / node / appliance）
 * @param args.capabilities 能力标签清单
 * @param args.tenant 租户（缺省 default）
 */
export async function deviceRegister(args: {
  identity: Record<string, unknown>;
  kind: string;
  capabilities?: string[];
  tenant?: string;
}): Promise<DeviceRegisterResult> {
  let registerDevice: (
    identity: Parameters<typeof import('@sofagent/daemon').registerDevice>[0],
    opts: { kind: 'pc' | 'node' | 'appliance'; capabilities: string[]; tenant?: string },
    dataDir?: string,
  ) => { ok: boolean; deviceId?: string; reason?: string; message: string };

  try {
    const daemon = (await import('@sofagent/daemon')) as Record<string, unknown>;
    const fn = daemon.registerDevice;
    if (typeof fn !== 'function') {
      throw new Error('registerDevice 不可用');
    }
    registerDevice = fn as typeof registerDevice;
  } catch {
    return {
      text: '[sofagent] 设备注册失败：@sofagent/daemon 未安装或不可用',
      data: { ok: false, reason: 'daemon-unavailable', message: '@sofagent/daemon 未安装或不可用' },
    };
  }

  try {
    const r = registerDevice(
      args.identity as unknown as Parameters<typeof registerDevice>[0],
      {
        kind: (args.kind as 'pc' | 'node' | 'appliance') ?? 'pc',
        capabilities: Array.isArray(args.capabilities) ? args.capabilities : [],
        ...(args.tenant ? { tenant: args.tenant } : {}),
      },
      undefined,
    );
    const okLine = r.ok
      ? `✅ ${r.message}（deviceId=${r.deviceId?.slice(0, 8) ?? 'unknown'}）`
      : `❌ ${r.message}${r.reason ? `（reason=${r.reason}）` : ''}`;
    return {
      text: `[sofagent] 设备注册\n${okLine}\n类型: ${args.kind}\n能力: ${(args.capabilities ?? []).join(', ') || '无'}`,
      data: r.ok
        ? { ok: true, deviceId: r.deviceId, message: r.message }
        : { ok: false, reason: r.reason as DeviceRegisterResult['data']['reason'], message: r.message },
    };
  } catch (err) {
    return {
      text: `[sofagent] 设备注册异常: ${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, reason: 'daemon-unavailable', message: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ============================================================
// v1.5.1 第四 + 五章：设备侧事件订阅登记 + 领任务回执出口
// ============================================================
//
// 本节**只新增**订阅登记与回执出口——上方 deviceRegister 的注册 / 心跳逻辑
// **保持原样零改动**（改造保留声明）。
//
// 三件事：
//   1. registerDeviceSubscriptions —— 把设备侧三条订阅（device.upgrade /
//      device.deploy / 任务下发）挂到设备本地事件总线。登记表与处理器归
//      `@sofagent/daemon` 的 `ota/subscriptions.ts`（覆盖式登记，新增订阅只改那张表）；
//      本函数只做「取表 → 注入端口 → 挂载」，不复制事件类型、不另起总线。
//   2. deviceTaskReceipt —— 领任务回执出口（进 G9 设备事件 HMAC 链）。
//   3. 两个端口工厂 —— 版本清单上报（G11 `device_data_push`）与 G1 五件套
//      导入器（既有 `workflow_import`）。**都在本包内绑定**：daemon 包不得
//      import @sofagent/mcp（mcp 反向 optionalDepend daemon，硬依赖会成包循环），
//      故端口实现留在 MCP 侧、经登记时注入。
// ============================================================

/** 设备侧订阅登记结果 */
export interface DeviceSubscriptionRegistrationResult {
  /** 三条订阅是否全部挂上 */
  ok: boolean;
  /** 已登记的 topic 清单（取自 daemon 侧登记表——本包不复制事件类型表） */
  topics: string[];
  /** 退订句柄（逐个调用即解除订阅） */
  unsubscribe: Array<() => void>;
  reason?: 'daemon-unavailable' | 'registry-unavailable' | 'invalid-params';
  message: string;
}

/** 版本清单（升级成功后上报——与 daemon `VersionManifest` 结构对齐） */
interface UpgradeVersionManifest {
  deviceId: string;
  targetVersion: string;
  components: Record<string, string>;
  outcome: string;
  at: string;
  order?: string[];
}

/** G1 五件套导入器入参（与 daemon `DeployImporterPort` 对齐） */
interface DeployImportArgs {
  bundle: Record<string, unknown>;
  imported_as?: string;
  actor?: string;
  data_dir?: string;
}

/**
 * 版本清单上报端口工厂（G11 通道——复用既有 `device_data_push`）。
 *
 * 升级成功后由 daemon 执行器在成功分支末尾调用；上报走既有设备门禁 →
 * 采集声明校验 → 脱敏 → 加密入队链路。**不新建上报通道**。
 *
 * ⚠️ 采集声明：`device_data_push` 的类别须在
 * `<dataDir>/config/device-upload-policy.json` 声明（默认空=不上行，opt-in）；
 * 未声明时上报被拒（fail-closed），本端口如实回传失败原因，不静默吞掉。
 */
export function createVersionManifestPusher(
  identity: Record<string, unknown>,
): (manifest: UpgradeVersionManifest) => Promise<{ ok: boolean; seq?: number; message?: string }> {
  return async (manifest) => {
    try {
      const { deviceDataPush } = await import('./device-data-push');
      const r = await deviceDataPush({
        identity,
        category: 'metrics',
        payload: JSON.stringify({
          kind: 'device-version-manifest',
          targetVersion: manifest.targetVersion,
          components: manifest.components,
          outcome: manifest.outcome,
          at: manifest.at,
        }),
      });
      return {
        ok: r.data.ok === true,
        ...(typeof r.data.seq === 'number' ? { seq: r.data.seq } : {}),
        message: r.data.message,
      };
    } catch (err) {
      return { ok: false, message: `版本清单上报异常：${err instanceof Error ? err.message : String(err)}` };
    }
  };
}

/**
 * G1 五件套导入器工厂（`device.deploy` 落盘注册用）。
 *
 * 直接复用既有 `workflow_import`（结构闸 / 完整性核对 / schema 门 / 落地闸
 * 四道 fail-closed 校验）——模板包格式与既有 G1 **完全一致，不另立格式**。
 */
export function createG1DeployImporter(): (
  args: DeployImportArgs,
) => Promise<{ ok: boolean; importedAs?: string; code?: string; message: string }> {
  return async (args) => {
    try {
      const { workflowImport } = await import('./workflow-import');
      const r = await workflowImport({
        bundle: args.bundle,
        ...(args.imported_as !== undefined ? { imported_as: args.imported_as } : {}),
        ...(args.actor !== undefined ? { actor: args.actor } : {}),
        ...(args.data_dir !== undefined ? { data_dir: args.data_dir } : {}),
      });
      return {
        ok: r.data.isError !== true,
        ...(r.data.importedAs !== undefined ? { importedAs: r.data.importedAs } : {}),
        ...(r.data.code !== undefined ? { code: r.data.code } : {}),
        message: r.data.message,
      };
    } catch (err) {
      return { ok: false, code: 'importer-error', message: err instanceof Error ? err.message : String(err) };
    }
  };
}

/**
 * 设备侧订阅登记（第五章「设备侧订阅消费」入口）。
 *
 * 设备注册成功后由设备进程调用：把 `device.upgrade` / `device.deploy` /
 * 任务下发三条订阅挂到设备本地事件总线（三者**共用同一推送底座**），并
 * 注入两个 MCP 侧端口（G11 上报 / G1 导入器）。
 *
 * @param args.bus 设备本地事件总线实例（第一章事件总线）
 * @param args.identity 设备身份码（AgentIdentity JSON）
 * @param args.dataDir 数据目录（测试隔离）
 */
export async function registerDeviceSubscriptions(args: {
  bus: unknown;
  identity: Record<string, unknown>;
  dataDir?: string;
}): Promise<DeviceSubscriptionRegistrationResult> {
  if (!args.bus || typeof args.bus !== 'object' || typeof (args.bus as { subscribe?: unknown }).subscribe !== 'function') {
    return { ok: false, topics: [], unsubscribe: [], reason: 'invalid-params', message: 'bus 缺失或未实现 subscribe(topic, handler)' };
  }
  if (!args.identity || typeof args.identity !== 'object') {
    return { ok: false, topics: [], unsubscribe: [], reason: 'invalid-params', message: 'identity 缺失' };
  }
  let daemon: Record<string, unknown>;
  try {
    daemon = (await import('@sofagent/daemon')) as Record<string, unknown>;
  } catch {
    return { ok: false, topics: [], unsubscribe: [], reason: 'daemon-unavailable', message: '@sofagent/daemon 未安装或不可用' };
  }
  const registerFn = daemon.registerDeviceOtaSubscriptions;
  if (typeof registerFn !== 'function') {
    return {
      ok: false,
      topics: [],
      unsubscribe: [],
      reason: 'registry-unavailable',
      message: '@sofagent/daemon 未导出 registerDeviceOtaSubscriptions（设备侧订阅登记面未就绪）',
    };
  }
  const table = daemon.DEVICE_OTA_SUBSCRIPTIONS;
  const topics = Array.isArray(table)
    ? (table as Array<{ topic?: unknown }>).map((e) => String(e?.topic ?? '')).filter((t) => t !== '')
    : [];
  try {
    const unsubscribe = (
      registerFn as (bus: unknown, opts: Record<string, unknown>) => Array<() => void>
    )(args.bus, {
      identity: args.identity,
      ...(args.dataDir !== undefined ? { dataDir: args.dataDir } : {}),
      deployImporter: createG1DeployImporter(),
      pushVersionManifest: createVersionManifestPusher(args.identity),
    });
    return { ok: true, topics, unsubscribe, message: `已登记 ${unsubscribe.length} 条设备事件订阅` };
  } catch (err) {
    return {
      ok: false,
      topics,
      unsubscribe: [],
      reason: 'daemon-unavailable',
      message: `订阅登记异常：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 领任务回执结果 */
export interface DeviceTaskReceiptResult {
  text: string;
  data: {
    ok: boolean;
    taskId?: string;
    receiptHash?: string;
    reason?: string;
    message: string;
  };
}

/**
 * 领任务回执出口（第五章：领任务回执进审计链，HMAC 留痕）。
 *
 * 复用 G9 `claimDeviceTask`（pending → claimed + 设备事件 HMAC 链留痕），
 * 返回 receiptHash 供调用方经 `verifyDeviceEventsChain` 回溯。
 *
 * @param args.identity 设备身份码（过 G9 闸门）
 * @param args.taskId 指定领取的任务 ID（缺省领取最早入队的 pending 任务）
 * @param args.dataDir 数据目录（测试隔离）
 */
export async function deviceTaskReceipt(args: {
  identity: Record<string, unknown>;
  taskId?: string;
  dataDir?: string;
}): Promise<DeviceTaskReceiptResult> {
  let claimDeviceTask: (identity: unknown, opts: Record<string, unknown>) => {
    ok: boolean;
    task?: { id: string; title: string };
    reason?: string;
    message: string;
    receiptHash?: string;
  };
  try {
    const daemon = (await import('@sofagent/daemon')) as Record<string, unknown>;
    const fn = daemon.claimDeviceTask;
    if (typeof fn !== 'function') throw new Error('claimDeviceTask 不可用');
    claimDeviceTask = fn as typeof claimDeviceTask;
  } catch {
    return {
      text: '[sofagent] 领任务回执失败：@sofagent/daemon 未安装或不可用',
      data: { ok: false, reason: 'daemon-unavailable', message: '@sofagent/daemon 未安装或不可用' },
    };
  }
  try {
    const r = claimDeviceTask(args.identity, {
      ...(args.taskId !== undefined ? { taskId: args.taskId } : {}),
      ...(args.dataDir !== undefined ? { dataDir: args.dataDir } : {}),
    });
    if (!r.ok) {
      return {
        text: `[sofagent] 领任务回执未通过：${r.message}${r.reason ? `（reason=${r.reason}）` : ''}`,
        data: { ok: false, ...(r.reason !== undefined ? { reason: r.reason } : {}), message: r.message },
      };
    }
    return {
      text: `[sofagent] ✅ 领任务回执已入审计链：${r.task?.title ?? ''}（receipt=${r.receiptHash ?? 'unknown'}）`,
      data: {
        ok: true,
        ...(r.task?.id !== undefined ? { taskId: r.task.id } : {}),
        ...(r.receiptHash !== undefined ? { receiptHash: r.receiptHash } : {}),
        message: r.message,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] 领任务回执异常：${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, reason: 'daemon-unavailable', message: err instanceof Error ? err.message : String(err) },
    };
  }
}
