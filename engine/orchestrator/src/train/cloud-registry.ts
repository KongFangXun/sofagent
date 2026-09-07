// cloud-registry.ts · v1.4.6 章二 · 云 VM 注册表（endpoint / 凭据引用 / 状态）
//
// 定位：租云 GPU VM 做多卡/分布式训练前，先把 VM 注册进来——endpoint（ssh 或
// 云 API）+ 凭据引用 + 心跳状态。注册表是 train-cloud 的「VM 地址簿」。
//
// 凭据边界（红线）：真实凭据（ssh 私钥 / 云 API key）**不落本表、不落明文**——
// 走 v1.3.7 虚拟 key 边界托管，本表只存 credentialRef（虚拟 key 引用）。
// 注册/体检/远程 spawn 事件写审计链时先按「键名/值双轴」脱敏再签名
// （SECURITY.md:642 已把「云凭据经日志泄漏」列为既有攻击面）。
//
// 纯内存账本 + 序列化（落盘由 train-cloud 在需要时执行）——零真实网络，
// 状态判定可全量注入测试。

// ════════════════════════════════════════
// 数据模型
// ════════════════════════════════════════

/** 云 VM 状态 */
export type CloudVmStatus = 'unknown' | 'reachable' | 'unreachable';

/** 云 VM 注册条目 */
export interface CloudVmRecord {
  /** 注册名（train submit 的 cloud 字段引用） */
  name: string;
  /** endpoint（ssh user@host 或云 API endpoint） */
  endpoint: string;
  /** 状态（unknown=刚注册未体检 / reachable=可达 / unreachable=失联） */
  status: CloudVmStatus;
  /** 凭据引用（虚拟 key 引用——真实凭据不落明文，走 virtual-key 边界） */
  credentialRef?: string;
  /** 注册时间（ISO 8601） */
  registeredAt: string;
  /** 最近心跳时间（ISO 8601——失联止损判据） */
  lastHeartbeatAt?: string;
  /** 最近错误（体检/spawn 失败原因——诊断可读） */
  lastError?: string;
}

/** 注册表快照（监控/审计） */
export interface CloudRegistrySnapshot {
  total: number;
  reachable: number;
  unreachable: number;
  vms: CloudVmRecord[];
}

// ════════════════════════════════════════
// 注册表（内存账本）
// ════════════════════════════════════════

/** 云 VM 注册表（train-cloud 唯一持有——单实例） */
export function createCloudRegistry(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const vms = new Map<string, CloudVmRecord>();

  return {
    /**
     * 注册云 VM（幂等覆盖——同名重复注册刷新 endpoint/credentialRef）。
     * @returns 注册后的记录
     */
    register(record: {
      name: string;
      endpoint: string;
      credentialRef?: string;
    }): CloudVmRecord {
      const existing = vms.get(record.name);
      const registered: CloudVmRecord = {
        name: record.name,
        endpoint: record.endpoint,
        credentialRef: record.credentialRef,
        status: existing?.status ?? 'unknown',
        registeredAt: existing?.registeredAt ?? new Date(now()).toISOString(),
        lastHeartbeatAt: existing?.lastHeartbeatAt,
        lastError: existing?.lastError,
      };
      vms.set(record.name, registered);
      return registered;
    },

    /** 查询云 VM（不存在返回 undefined） */
    get(name: string): CloudVmRecord | undefined {
      return vms.get(name);
    },

    /** 列全部云 VM（按注册名排序——稳定输出） */
    list(): CloudVmRecord[] {
      return [...vms.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    /** 更新状态（体检/心跳——失联止损消费 status=unreachable） */
    updateStatus(
      name: string,
      status: CloudVmStatus,
      opts: { error?: string; heartbeat?: boolean } = {},
    ): CloudVmRecord | undefined {
      const vm = vms.get(name);
      if (!vm) return undefined;
      vm.status = status;
      if (opts.error !== undefined) vm.lastError = opts.error;
      else if (status !== 'unreachable') vm.lastError = undefined;
      if (opts.heartbeat) vm.lastHeartbeatAt = new Date(now()).toISOString();
      return vm;
    },

    /** 注销（移除注册——清理用） */
    unregister(name: string): boolean {
      return vms.delete(name);
    },

    /** 快照（监控/审计） */
    snapshot(): CloudRegistrySnapshot {
      const all = [...vms.values()];
      return {
        total: all.length,
        reachable: all.filter((v) => v.status === 'reachable').length,
        unreachable: all.filter((v) => v.status === 'unreachable').length,
        vms: all,
      };
    },
  };
}

export type CloudRegistry = ReturnType<typeof createCloudRegistry>;
