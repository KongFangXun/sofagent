// ============================================================
// identity-store.ts · Agent 身份注册表（v1.3.4 交付 6）
//
// 身份码本地持久化：JSON 存储于 data/identity/identities.json
//（走 core resolveDataDir()——SOFAGENT_HOME 可被环境变量覆盖，测试可隔离）。
//
// API：register / get / list / revoke（撤销标记 revoked:true）。
// 注册同一 agentId 时覆盖更新（幂等——activate 重复执行不产生重复记录）。
// ============================================================
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { atomicWriteSync } from './shared/atomic-write';
import { resolveDataDir } from './data-paths';
import type { AgentIdentity } from './agent-identity';

/** 注册表条目——身份码 + 撤销标记 */
export interface IdentityRecord {
  /** 完整身份码对象 */
  identity: AgentIdentity;
  /** 撤销标记（v1.3.1：撤销不物理删除，保留审计追溯） */
  revoked: boolean;
  /** 注册时间（ISO 8601） */
  registeredAt: string;
  /** 撤销时间（ISO 8601，仅 revoked=true 时存在） */
  revokedAt?: string;
}

/** 注册表内部结构 */
interface IdentityStoreFile {
  /** 按 agentId 索引 */
  records: Record<string, IdentityRecord>;
}

/**
 * 解析身份注册表文件路径：data/identity/identities.json
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 */
export function getIdentityStorePath(overrideHome?: string): string {
  return join(resolveDataDir(overrideHome), 'identity', 'identities.json');
}

/** 读取注册表文件（不存在返回空表） */
function loadStore(overrideHome?: string): IdentityStoreFile {
  const filePath = getIdentityStorePath(overrideHome);
  if (!existsSync(filePath)) return { records: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as IdentityStoreFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.records) return { records: {} };
    return parsed;
  } catch {
    // 文件损坏——返回空表（不覆盖原文件，交由下次 register 重建）
    console.warn('[sofagent] identity-store: 注册表文件解析失败，视为空表');
    return { records: {} };
  }
}

/** 原子写回注册表文件 */
function saveStore(store: IdentityStoreFile, overrideHome?: string): void {
  const filePath = getIdentityStorePath(overrideHome);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  atomicWriteSync(filePath, JSON.stringify(store, null, 2));
}

/**
 * 注册（或幂等更新）一个 Agent 身份。
 *
 * 同一 agentId 重复注册 → 覆盖更新（activate 幂等语义）。
 * 已撤销的身份重新注册 → 清除 revoked 标记（视为重新授权）。
 *
 * @param identity 身份码对象
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 * @returns 注册后的条目
 */
export function registerIdentity(identity: AgentIdentity, overrideHome?: string): IdentityRecord {
  if (!identity.agentId) {
    throw new Error('registerIdentity: identity.agentId 不能为空');
  }
  const store = loadStore(overrideHome);
  const existing = store.records[identity.agentId];
  const record: IdentityRecord = {
    identity,
    revoked: false,
    registeredAt: existing?.registeredAt ?? new Date().toISOString(),
  };
  store.records[identity.agentId] = record;
  saveStore(store, overrideHome);
  return record;
}

/**
 * 按 agentId 查询身份条目。
 *
 * @param agentId 身份唯一标识
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 * @returns 身份条目（含撤销标记）；不存在返回 null
 */
export function getIdentity(agentId: string, overrideHome?: string): IdentityRecord | null {
  const store = loadStore(overrideHome);
  return store.records[agentId] ?? null;
}

/** listIdentities 过滤选项 */
export interface ListIdentitiesOptions {
  /** true = 只返回已撤销；false = 只返回未撤销；缺省 = 全部 */
  includeRevoked?: boolean;
}

/**
 * 列出所有注册身份（可按撤销状态过滤）。
 *
 * @param options 过滤选项（includeRevoked: true=仅已撤销 / false=仅未撤销 / 缺省=全部）
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 * @returns 身份条目数组（按注册时间升序）
 */
export function listIdentities(
  options: ListIdentitiesOptions = {},
  overrideHome?: string,
): IdentityRecord[] {
  const store = loadStore(overrideHome);
  let records = Object.values(store.records);
  if (options.includeRevoked === true) {
    records = records.filter((r) => r.revoked);
  } else if (options.includeRevoked === false) {
    records = records.filter((r) => !r.revoked);
  }
  return records.sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
}

/**
 * 撤销一个 Agent 身份（标记 revoked:true，保留记录供审计追溯）。
 *
 * @param agentId 身份唯一标识
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 * @returns true = 撤销成功；false = 身份不存在
 */
export function revokeIdentity(agentId: string, overrideHome?: string): boolean {
  const store = loadStore(overrideHome);
  const record = store.records[agentId];
  if (!record) return false;
  if (!record.revoked) {
    record.revoked = true;
    record.revokedAt = new Date().toISOString();
    store.records[agentId] = record;
    saveStore(store, overrideHome);
  }
  return true;
}
