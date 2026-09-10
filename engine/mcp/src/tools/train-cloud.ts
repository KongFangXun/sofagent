// train-cloud.ts · MCP tool：train_cloud（v1.4.6 章二）
// ============================================================
//
// 云 VM 执行面入口（控制面本地 / 执行面云上）四操作：
//   - add：注册云 VM（endpoint + 凭据引用——真实凭据走虚拟 key 边界，不落明文）
//   - list：列出已注册云 VM（含状态）
//   - status：查单个云 VM 状态（体检/心跳）
//   - remove：注销云 VM
//
// 委托 @sofagent/orchestrator 的 createCloudRegistry（内存账本）+ 本文件落盘
// 持久化到 data/train/cloud/registry.json（MCP tool 每次调用独立进程，注册表
// 必须落盘才能跨调用存活）。
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { getDataDir, atomicWriteSync } from '@sofagent/core';
import { createCloudRegistry, type CloudVmRecord } from '@sofagent/orchestrator';

/** train_cloud tool 入参 */
export interface TrainCloudArgs {
  /** 操作（缺省 list） */
  action?: 'add' | 'list' | 'status' | 'remove';
  /** 云 VM 注册名（add/status/remove 必填） */
  name?: string;
  /** endpoint（add 必填——ssh user@host 或云 API endpoint） */
  endpoint?: string;
  /** 凭据引用（add 可选——虚拟 key 引用，真实凭据不落明文） */
  credential_ref?: string;
}

/** train_cloud tool 结果 */
export interface TrainCloudToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    action?: string;
    vms?: CloudVmRecord[];
    total?: number;
  };
}

/** 注册表落盘路径：data/train/cloud/registry.json */
function registryPath(): string {
  return join(getDataDir(), 'train', 'cloud', 'registry.json');
}

/** 读落盘注册表（不存在返回空；损坏 WARN + 备份留证后重建——两态可辨） */
function loadRegistry(): CloudVmRecord[] {
  const file = registryPath();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return Array.isArray(parsed) ? (parsed as CloudVmRecord[]) : [];
  } catch (err) {
    // v1.4.7 批次 I：损坏与首次运行两态可辨——损坏时 WARN + 备份留证后重建空表
    // （此前静默返回空表 = 云 VM 注册记录损坏即静默丢失）
    console.warn(
      `[train-cloud] 注册表损坏（${file}）：${err instanceof Error ? err.message : String(err)}——已备份为 .corrupt 留证，返回空表重建`,
    );
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}.bak`);
    } catch {
      /* 备份失败不阻断——原文件留在原地供人工取证 */
    }
    return [];
  }
}

/** 写落盘注册表（原子写——幂等覆盖） */
function saveRegistry(records: CloudVmRecord[]): void {
  const file = registryPath();
  const dir = join(file, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(file, JSON.stringify(records, null, 2));
}

/**
 * train_cloud tool 主入口（MCP 派发——mcp-server case 'train_cloud'）。
 */
export async function trainCloud(args: TrainCloudArgs): Promise<TrainCloudToolResult> {
  const action = args.action ?? 'list';
  const records = loadRegistry();
  const registry = createCloudRegistry();
  for (const r of records) registry.register(r);

  try {
    switch (action) {
      case 'add': {
        if (!args.name) return err(action, 'Missing required argument: name');
        if (!args.endpoint) return err(action, 'Missing required argument: endpoint');
        // 凭据走引用——真实凭据（ssh 私钥/云 API key）不落明文，走虚拟 key 边界
        const vm = registry.register({
          name: args.name,
          endpoint: args.endpoint,
          ...(args.credential_ref ? { credentialRef: args.credential_ref } : {}),
        });
        saveRegistry(registry.list());
        return ok(action, `云 VM "${args.name}" 已注册（endpoint=${args.endpoint}）`, [vm]);
      }
      case 'list': {
        const vms = registry.list();
        return ok(action, `已注册 ${vms.length} 个云 VM`, vms);
      }
      case 'status': {
        if (!args.name) return err(action, 'Missing required argument: name');
        const vm = registry.get(args.name);
        if (!vm) return err(action, `云 VM "${args.name}" 未注册`);
        return ok(action, `云 VM "${args.name}" 状态=${vm.status}`, [vm]);
      }
      case 'remove': {
        if (!args.name) return err(action, 'Missing required argument: name');
        const removed = registry.unregister(args.name);
        if (!removed) return err(action, `云 VM "${args.name}" 未注册，无法注销`);
        saveRegistry(registry.list());
        return ok(action, `云 VM "${args.name}" 已注销`, []);
      }
      default:
        return err(action, `未知操作 "${String(action)}"`);
    }
  } catch (e) {
    return err(action, e instanceof Error ? e.message : String(e));
  }
}

/** 成功结果 */
function ok(action: string, text: string, vms: CloudVmRecord[]): TrainCloudToolResult {
  return {
    text,
    data: { isError: false, ok: true, issues: [], action, vms, total: vms.length },
  };
}

/** 错误结果 */
function err(action: string, text: string): TrainCloudToolResult {
  return { text, data: { isError: true, ok: false, issues: [text], action } };
}
