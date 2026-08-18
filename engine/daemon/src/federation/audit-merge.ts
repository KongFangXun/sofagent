// ============================================================
// federation/audit-merge.ts · 跨设备审计轨迹聚合（v1.3.7 交付 7）
// ============================================================
//
// 审计轨迹带身份跨设备合并：同一 Agent（agentId，交付 6 身份码）在两台
// 设备上的审计记录合并为一条完整轨迹。
//
// 冲突裁决（交付 7 核心）：
//   1. HMAC 验签——每条设备记录先过 HMAC 验签（复用 core 原语：
//      getHmacKey / stableStringify / getEnvFingerprint，铁律 #1）；
//      验签失败（tampered）的记录**直接丢弃**（不可信源不进入合并）
//   2. trust 优先级——同 mergeKey 多设备版本，高 trust 设备记录胜出
//      （低 trust 设备记录不覆盖高 trust；TRUST_ORDER：official>internal>user>web）
//   3. tie-break——trust 相同取 timestamp 更新者（与 pickWinner 的
//      trust 优先于 mtime 语义一致）
//
// 复用安全联邦通道（v1.1.8 加密配对 + 联邦查询）——本文件只做合并裁决
// 原语，通道获取由调用方注入（peerRecords），测试可注入 fake 记录。
//
// 零新依赖——复用 @sofagent/core + @sofagent/audit 既有原语。
// ============================================================

import { createHmac } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { getEnvFingerprint, getHmacKey, stableStringify, TRUST_ORDER, getHistoryFilePath } from '@sofagent/core';
import type { Trust } from '@sofagent/core';
import type { AuditHistoryEntry } from '@sofagent/audit';

/** 单条设备审计记录（带来源与设备 trust） */
export interface DeviceAuditRecord {
  /** 审计记录（含 agentId，交付 6 身份码协同） */
  entry: AuditHistoryEntry;
  /** 来源设备标识（peerId / 'local'） */
  deviceId: string;
  /** 设备 trust——冲突裁决优先级（低 trust 设备记录不覆盖高 trust） */
  trust: Trust;
}

/** HMAC 验签状态 */
export type EntryHmacStatus = 'ok' | 'tampered' | 'unverifiable' | 'unsigned';

/** 合并后的审计条目（带来源标注 + 验签状态） */
export interface MergedAuditEntry {
  /** 合并后的审计记录（胜出版本） */
  entry: AuditHistoryEntry;
  /** 来源设备（胜出记录的 deviceId） */
  deviceId: string;
  /** 设备 trust */
  trust: Trust;
  /** 验签状态（tampered 已被丢弃，不会出现在合并结果） */
  hmacStatus: EntryHmacStatus;
}

/**
 * 读取本地审计历史（history.jsonl 全量——不受 loadHistory 默认 100 条限制）。
 *
 * @param dataDir 数据目录（测试隔离；缺省按 core resolveDataDir）
 * @returns 按写入顺序的审计记录
 */
export function readLocalAuditHistory(dataDir?: string): AuditHistoryEntry[] {
  const filePath = getHistoryFilePath(dataDir);
  if (!existsSync(filePath)) return [];
  const entries: AuditHistoryEntry[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as AuditHistoryEntry);
    } catch {
      // 坏行跳过（链完整性由 checkHistoryChainDetailed 报告）
    }
  }
  return entries;
}

/**
 * 单条审计记录 HMAC 验签（与 llm-call-trace verifyRecordHmac 同逻辑）。
 *
 * 判定语义：
 *   - 无 hmacSig → 'unsigned'（无密钥降级 SHA-256 时代——不视为篡改）
 *   - hmacSig 匹配 → 'ok'
 *   - 不匹配且环境指纹一致 → 'tampered'（真篡改）
 *   - 不匹配且环境指纹不一致 → 'unverifiable'（环境漂移，无法复验）
 *
 * @param entry 审计记录
 * @returns EntryHmacStatus
 */
export function verifyAuditEntryHmac(entry: AuditHistoryEntry): EntryHmacStatus {
  const sig = entry.hmacSig;
  if (typeof sig !== 'string' || sig.length === 0) return 'unsigned';
  const hmacKey = getHmacKey();
  if (!hmacKey) return 'unverifiable'; // 读侧无密钥——无法复验（非篡改）
  const fingerprint = getEnvFingerprint();
  const recordForSig = {
    ...entry,
    prevHash: undefined,
    hashVersion: undefined,
    hmacSig: undefined,
    hmacAlgo: undefined,
  };
  const expected = createHmac('sha256', hmacKey)
    .update(stableStringify(recordForSig) + '|' + fingerprint)
    .digest('hex').slice(0, 32);
  if (sig === expected) return 'ok';
  // HMAC 不匹配：用条目记录的环境指纹区分「真篡改」与「环境漂移」
  const recordedFp = entry.envFingerprint;
  if (typeof recordedFp === 'string' && recordedFp.length > 0 && recordedFp === fingerprint) {
    return 'tampered';
  }
  return 'unverifiable';
}

/**
 * 合并键——同一 Agent 同一次审计的跨设备记录归并到同一键。
 * 优先 agentId + commitSha（同一次提交的审计）；无 commitSha 时
 * 用 agentId + timestamp + diffRange（时间+范围足够区分）。
 * 无 agentId 的记录（旧记录）不参与跨设备合并（保持向后兼容）。
 *
 * @param entry 审计记录
 * @returns 合并键（无 agentId → null = 不参与合并）
 */
export function auditMergeKey(entry: AuditHistoryEntry): string | null {
  if (!entry.agentId) return null;
  if (entry.commitSha) return `${entry.agentId}:${entry.commitSha}`;
  return `${entry.agentId}:${entry.timestamp}:${entry.diffRange}`;
}

/**
 * 合并跨设备审计轨迹（核心裁决）：
 *   1. 逐条 HMAC 验签——tampered 丢弃（不可信源不进入合并）
 *   2. 按 mergeKey 分组——同键多设备版本按 trust 优先（低 trust 不覆盖
 *      高 trust），trust 相同取 timestamp 更新者
 *   3. 返回合并后的记录列表（按 timestamp 升序——轨迹顺序）
 *
 * @param records 各设备审计记录（本地 + peer）
 * @returns 合并后的完整轨迹（tampered 已剔除）
 */
export function mergeAuditTrails(records: DeviceAuditRecord[]): MergedAuditEntry[] {
  const winners = new Map<string, MergedAuditEntry>();

  for (const record of records) {
    // 1. HMAC 验签——tampered 直接丢弃
    const hmacStatus = verifyAuditEntryHmac(record.entry);
    if (hmacStatus === 'tampered') continue;

    const key = auditMergeKey(record.entry);
    if (key === null) {
      // 无 agentId 记录：不参与跨设备合并，但保留（本地记录仍进轨迹）
      const existing = winners.get(`__noagent__${record.entry.timestamp}:${record.entry.diffRange}`);
      if (!existing) {
        winners.set(`__noagent__${record.entry.timestamp}:${record.entry.diffRange}`, {
          entry: record.entry,
          deviceId: record.deviceId,
          trust: record.trust,
          hmacStatus,
        });
      }
      continue;
    }

    // 2. trust 优先级裁决（低 trust 不覆盖高 trust；同 trust 取 timestamp 新者）
    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, { entry: record.entry, deviceId: record.deviceId, trust: record.trust, hmacStatus });
      continue;
    }
    const trustA = TRUST_ORDER[existing.trust];
    const trustB = TRUST_ORDER[record.trust];
    if (trustB > trustA) {
      winners.set(key, { entry: record.entry, deviceId: record.deviceId, trust: record.trust, hmacStatus });
    } else if (trustB === trustA) {
      // 同 trust：timestamp 更新者胜出（与 pickWinner 的 mtime tiebreak 一致）
      const tsA = new Date(existing.entry.timestamp).getTime() || 0;
      const tsB = new Date(record.entry.timestamp).getTime() || 0;
      if (tsB > tsA) {
        winners.set(key, { entry: record.entry, deviceId: record.deviceId, trust: record.trust, hmacStatus });
      }
    }
    // 低 trust → 保持现有（不覆盖）
  }

  return [...winners.values()].sort((a, b) => {
    const ta = new Date(a.entry.timestamp).getTime() || 0;
    const tb = new Date(b.entry.timestamp).getTime() || 0;
    return ta - tb;
  });
}

/**
 * 按 agentId 聚合出完整轨迹（跨设备合并后的按 Agent 视角）。
 *
 * @param merged 合并后的记录（mergeAuditTrails 输出）
 * @param agentId 可选过滤——只返回该 agent 的轨迹；缺省返回全部
 * @returns agentId → 该 agent 的完整轨迹（按 timestamp 升序）
 */
export function buildAuditTrailByAgent(
  merged: MergedAuditEntry[],
  agentId?: string,
): Record<string, MergedAuditEntry[]> {
  const byAgent = new Map<string, MergedAuditEntry[]>();
  for (const item of merged) {
    const id = item.entry.agentId;
    if (!id) continue; // 无 agentId 记录不进入按 Agent 聚合
    if (agentId !== undefined && id !== agentId) continue;
    const list = byAgent.get(id) ?? [];
    list.push(item);
    byAgent.set(id, list);
  }
  // 轨迹内按 timestamp 升序（完整时序）
  for (const list of byAgent.values()) {
    list.sort((a, b) => {
      const ta = new Date(a.entry.timestamp).getTime() || 0;
      const tb = new Date(b.entry.timestamp).getTime() || 0;
      return ta - tb;
    });
  }
  return Object.fromEntries(byAgent);
}
