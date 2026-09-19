// ============================================================
// device-register.ts · MCP tool：设备上线注册（v1.5.0 G9 · T1）
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
