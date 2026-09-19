// ============================================================
// device-list.ts · MCP tool：设备清单查询（v1.5.0 G9 · T1）
// ============================================================
//
// 设备发现面（G9）：设备清单 + 在线态（心跳新鲜度实时判定）。
//
// 形态照抄 daemon-status.ts：text 首行 [sofagent] 前缀 + data 结构化。
// 实现经 @sofagent/daemon 的 listDevices（lazy import optionalDependencies
// 模式——daemon 未安装时友好提示不崩溃）。
//
// 清单语义（changelog 一章验收 ④）：只含已验签设备（注册时已过
// fail-closed 验签——被拒/吊销设备不出现在清单）；在线态按
// isOnline(lastHeartbeatMs, nowMs) 实时判定。
// ============================================================

/** 清单结果（结构化——每台设备一行摘要 + 在线态） */
export interface DeviceListResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    ok: boolean;
    total: number;
    online: number;
    reason?: 'daemon-unavailable';
    devices: Array<{
      deviceId: string;
      displayName: string;
      kind: string;
      capabilities: string[];
      tenant: string;
      online: boolean;
      lastHeartbeatAt: string | null;
      registeredAt: string;
    }>;
  };
}

/**
 * 设备清单查询（G9 发现面）。
 *
 * 延迟导入 @sofagent/daemon（optionalDependencies——与 daemon-status 同款）。
 *
 * @param args 过滤参数
 * @param args.tenant 租户过滤
 * @param args.kind 设备类型过滤
 * @param args.capability 能力标签过滤
 */
export async function deviceList(args: {
  tenant?: string;
  kind?: string;
  capability?: string;
} = {}): Promise<DeviceListResult> {
  let listDevices: (
    dataDir?: string,
    opts?: { tenant?: string; kind?: 'pc' | 'node' | 'appliance'; capability?: string; nowMs?: number },
  ) => Array<{
    identity: { agentId: string; displayName: string };
    kind: 'pc' | 'node' | 'appliance';
    capabilities: string[];
    tenant: string;
    lastHeartbeatAt: string | null;
    registeredAt: string;
    online: boolean;
  }>;

  try {
    const daemon = (await import('@sofagent/daemon')) as Record<string, unknown>;
    const fn = daemon.listDevices;
    if (typeof fn !== 'function') {
      throw new Error('listDevices 不可用');
    }
    listDevices = fn as typeof listDevices;
  } catch {
    return {
      text: '[sofagent] 设备清单查询失败：@sofagent/daemon 未安装或不可用',
      data: { ok: false, total: 0, online: 0, reason: 'daemon-unavailable', devices: [] },
    };
  }

  try {
    const devices = listDevices(undefined, {
      ...(args.tenant ? { tenant: args.tenant } : {}),
      ...(args.kind === 'pc' || args.kind === 'node' || args.kind === 'appliance' ? { kind: args.kind } : {}),
      ...(args.capability ? { capability: args.capability } : {}),
    });
    const online = devices.filter((d) => d.online).length;
    const lines: string[] = [];
    lines.push('[sofagent] 设备清单');
    lines.push(`总数: ${devices.length}（在线 ${online}）`);
    if (args.tenant) lines.push(`租户过滤: ${args.tenant}`);
    if (args.kind) lines.push(`类型过滤: ${args.kind}`);
    if (args.capability) lines.push(`能力过滤: ${args.capability}`);
    for (const d of devices) {
      lines.push(
        `${d.online ? '🟢' : '⚪'} ${d.identity.displayName}（${d.identity.agentId.slice(0, 8)}）` +
          ` [${d.kind}] 能力=${d.capabilities.join(',') || '无'} 租户=${d.tenant}` +
          ` 最后心跳=${d.lastHeartbeatAt ?? '从未'}`,
      );
    }
    return {
      text: lines.join('\n'),
      data: {
        ok: true,
        total: devices.length,
        online,
        devices: devices.map((d) => ({
          deviceId: d.identity.agentId,
          displayName: d.identity.displayName,
          kind: d.kind,
          capabilities: d.capabilities,
          tenant: d.tenant,
          online: d.online,
          lastHeartbeatAt: d.lastHeartbeatAt,
          registeredAt: d.registeredAt,
        })),
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] 设备清单查询异常: ${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, total: 0, online: 0, reason: 'daemon-unavailable', devices: [] },
    };
  }
}
