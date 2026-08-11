// ============================================================
// inspectors/audit-trail.ts · 审计轨迹聚合巡检器（v1.3.2 交付 7）
// ============================================================
//
// @daily 巡检器：扫描审计记录（本地 history.jsonl + 可选 peer 记录），
// 按 agentId 聚合出完整轨迹——跨设备审计轨迹可见性（交付 7）。
//
// 与 conflict-check 等巡检器同模式：
//   - 返回 InspectorResult（name='audit-trail'，triggered/message/severity）
//   - 优雅降级：无审计历史 → info（不触发）
//   - 跨设备记录经 mergeAuditTrails 合并（HMAC 验签 + trust 裁决）
//
// 零新依赖——复用 @sofagent/core + @sofagent/audit + federation/audit-merge。
// ============================================================

import type { InspectorResult } from './types';
import type { DeviceAuditRecord, MergedAuditEntry } from '../federation/audit-merge';
import { readLocalAuditHistory, mergeAuditTrails, buildAuditTrailByAgent } from '../federation/audit-merge';
import type { Trust } from '@sofagent/core';

/** 巡检器选项（测试注入） */
export interface AuditTrailInspectorOptions {
  /** 数据目录（测试隔离；缺省按 core resolveDataDir） */
  dataDir?: string;
  /** 额外 peer 审计记录（跨设备；测试注入 fake） */
  peerRecords?: DeviceAuditRecord[];
  /** 本机设备 trust（缺省 internal——本机记录不因 trust 被远端覆盖） */
  localTrust?: Trust;
  /** 本机设备 id（缺省 'local'） */
  localDeviceId?: string;
}

/**
 * 审计轨迹聚合巡检（@daily）——按 agentId 聚合出完整轨迹。
 *
 * @param projectDir 项目根目录（巡检器统一签名）
 * @param options 可选项（dataDir 测试隔离 / peerRecords 跨设备）
 * @returns InspectorResult
 */
export function runAuditTrailInspector(
  projectDir: string,
  options: AuditTrailInspectorOptions = {},
): InspectorResult {
  void projectDir; // 数据目录走 resolveDataDir（与 audit 一致），projectDir 保留签名
  const dataDir = options.dataDir;
  const localTrust: Trust = options.localTrust ?? 'internal';
  const localDeviceId = options.localDeviceId ?? 'local';

  // 1. 读本地审计历史 + 注入的 peer 记录
  const localRecords = readLocalAuditHistory(dataDir);
  if (localRecords.length === 0 && (options.peerRecords?.length ?? 0) === 0) {
    return {
      name: 'audit-trail',
      triggered: false,
      message: 'No audit history found',
      severity: 'info',
    };
  }

  // 2. 组装跨设备记录（本地 internal trust 恒高于 peer user——默认不被覆盖）
  const allRecords: DeviceAuditRecord[] = [
    ...localRecords.map((entry) => ({ entry, deviceId: localDeviceId, trust: localTrust })),
    ...(options.peerRecords ?? []),
  ];

  // 3. 合并裁决（HMAC 验签 + trust 优先级）
  const merged = mergeAuditTrails(allRecords);

  // 4. 按 agentId 聚合
  const byAgent = buildAuditTrailByAgent(merged);
  const agentIds = Object.keys(byAgent);
  const multiRecordAgents = agentIds.filter((id) => (byAgent[id]?.length ?? 0) >= 2);

  if (agentIds.length === 0) {
    return {
      name: 'audit-trail',
      triggered: false,
      message: 'No agent-id audit records found',
      severity: 'info',
    };
  }

  // 有可聚合轨迹 → warning（提醒审计轨迹已按 agent 归集，可查 MCP audit_trail）
  const triggered = agentIds.length > 0;
  const detail = multiRecordAgents.length > 0
    ? `${multiRecordAgents.length} 个 agent 有跨设备/多记录轨迹（${multiRecordAgents.slice(0, 3).join(', ')}${multiRecordAgents.length > 3 ? '…' : ''}）`
    : `${agentIds.length} 个 agent 有审计记录（单条，尚未形成多记录轨迹）`;
  return {
    name: 'audit-trail',
    triggered,
    message: `审计轨迹聚合：${agentIds.length} 个 agent · ${merged.length} 条合并记录 · ${detail}`,
    severity: triggered ? 'warning' : 'info',
  };
}

/** 供测试/复用：读本地记录 + 合并 → 聚合结果（不依赖 InspectorResult 壳） */
export function aggregateAuditTrails(
  options: AuditTrailInspectorOptions = {},
): Record<string, MergedAuditEntry[]> {
  const dataDir = options.dataDir;
  const localTrust: Trust = options.localTrust ?? 'internal';
  const localDeviceId = options.localDeviceId ?? 'local';
  const localRecords = readLocalAuditHistory(dataDir);
  const allRecords: DeviceAuditRecord[] = [
    ...localRecords.map((entry) => ({ entry, deviceId: localDeviceId, trust: localTrust })),
    ...(options.peerRecords ?? []),
  ];
  return buildAuditTrailByAgent(mergeAuditTrails(allRecords));
}
